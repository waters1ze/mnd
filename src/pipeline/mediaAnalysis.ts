import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type {
  AnalysisDiagnostic,
  OperationRecord,
  SceneV1,
  SourceAnalysis,
  SourceRecord,
  TimeRange,
  TranscriptV1,
} from "../types/production.js";
import { atomicWriteFile } from "../core/atomic.js";
import { isCancellationRequested, registerProcess, unregisterProcess } from "../core/cancellation.js";

export interface AnalysisParameters {
  sceneThreshold: number;
  blackMinDuration: number;
  blackPixelThreshold: number;
  silenceMinDuration: number;
  silenceNoiseDb: number;
}

export interface AnalysisRunResult {
  analysis: SourceAnalysis;
  operations: OperationRecord[];
  cacheHit: boolean;
}

export const DEFAULT_ANALYSIS_PARAMETERS: AnalysisParameters = {
  sceneThreshold: 0.35,
  blackMinDuration: 0.2,
  blackPixelThreshold: 0.1,
  silenceMinDuration: 0.4,
  silenceNoiseDb: -35,
};

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableId(...values: Array<string | number>): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 24);
}

async function runFfmpeg(filePath: string, outputArgs: string[]): Promise<string> {
  if (isCancellationRequested()) throw new Error("Analysis cancelled");
  return new Promise((resolve, reject) => {
    const executable = ffmpegPath as unknown as string;
    const child = spawn(executable, ["-hide_banner", "-nostats", "-i", filePath, ...outputArgs], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (child.pid) registerProcess({ pid: child.pid, kind: "ffmpeg", process: child, ownedByRun: true });
    let stderr = "";
    const maximum = 32 * 1024 * 1024;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < maximum) stderr += chunk.toString("utf8", 0, maximum - stderr.length);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (child.pid) unregisterProcess(child.pid);
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg analysis exited with code ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

function parseSceneTimes(stderr: string, duration: number): number[] {
  const times = [0];
  const regex = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  for (const match of stderr.matchAll(regex)) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time > 0 && time < duration) times.push(time);
  }
  if (duration > 0) times.push(duration);
  return [...new Set(times)].sort((left, right) => left - right);
}

function parseBlack(stderr: string, duration: number): AnalysisDiagnostic[] {
  const diagnostics: AnalysisDiagnostic[] = [];
  const regex = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  for (const match of stderr.matchAll(regex)) {
    const start = Number(match[1]);
    const end = Math.min(duration, Number(match[2]));
    if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
      diagnostics.push({ type: "black", severity: "warning", start, end, value: end - start, message: "Black or near-black frames detected" });
    }
  }
  return diagnostics;
}

function parseSilence(stderr: string, duration: number): AnalysisDiagnostic[] {
  const starts: number[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([0-9.]+)/.exec(line);
    if (startMatch) starts.push(Number(startMatch[1]));
    const endMatch = /silence_end:\s*([0-9.]+)/.exec(line);
    if (endMatch) {
      const start = starts.shift() ?? 0;
      const end = Math.min(duration, Number(endMatch[1]));
      if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
        diagnostics.push({ type: "silence", severity: "info", start, end, value: end - start, message: "Sustained silence detected" });
      }
    }
  }
  for (const start of starts) {
    if (start < duration) diagnostics.push({ type: "silence", severity: "info", start, end: duration, value: duration - start, message: "Sustained silence detected" });
  }
  return diagnostics;
}

function parseLoudness(stderr: string): SourceAnalysis["loudness"] {
  const blocks = [...stderr.matchAll(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)];
  const block = blocks.at(-1)?.[0];
  if (!block) return undefined;
  try {
    const value = JSON.parse(block) as Record<string, string>;
    const integratedLufs = Number(value["input_i"]);
    const truePeakDb = Number(value["input_tp"]);
    const loudnessRange = Number(value["input_lra"]);
    const result: NonNullable<SourceAnalysis["loudness"]> = {};
    if (Number.isFinite(integratedLufs)) result.integratedLufs = integratedLufs;
    if (Number.isFinite(truePeakDb)) result.truePeakDb = truePeakDb;
    if (Number.isFinite(loudnessRange)) result.loudnessRange = loudnessRange;
    return result;
  } catch {
    return undefined;
  }
}

function overlaps(range: TimeRange, diagnostic: AnalysisDiagnostic): boolean {
  return diagnostic.start < range.end && diagnostic.end > range.start;
}

function transcriptReferences(transcript: TranscriptV1 | undefined, start: number, end: number): string[] {
  if (!transcript) return [];
  return transcript.segments.filter((segment) => segment.start < end && segment.end > start).map((segment) => segment.id);
}

function similarity(left: string, right: string): number {
  const a = new Set(left.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const b = new Set(right.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function duplicateDiagnostics(transcript: TranscriptV1 | undefined): AnalysisDiagnostic[] {
  if (!transcript) return [];
  const diagnostics: AnalysisDiagnostic[] = [];
  for (let right = 1; right < transcript.segments.length; right += 1) {
    const current = transcript.segments[right]!;
    for (let left = Math.max(0, right - 8); left < right; left += 1) {
      const previous = transcript.segments[left]!;
      const score = similarity(previous.text, current.text);
      if (score >= 0.88 && current.text.trim().length >= 12) {
        diagnostics.push({
          type: "duplicate",
          severity: "warning",
          start: current.start,
          end: current.end,
          value: score,
          message: `Near-duplicate speech segment; similar to ${previous.id}`,
        });
        break;
      }
    }
  }
  return diagnostics;
}

function operation(kind: string, source: SourceRecord, fingerprint: string): OperationRecord {
  return {
    id: `op_${stableId(kind, source.id, fingerprint)}`,
    kind,
    sourceId: source.id,
    status: "pending",
    inputFingerprint: fingerprint,
    outputPaths: [],
  };
}

async function executeOperation<T>(record: OperationRecord, task: () => Promise<T>): Promise<T> {
  record.status = "running";
  record.startedAt = new Date().toISOString();
  try {
    const result = await task();
    record.status = isCancellationRequested() ? "cancelled" : "completed";
    record.completedAt = new Date().toISOString();
    return result;
  } catch (error) {
    record.status = isCancellationRequested() ? "cancelled" : "failed";
    record.completedAt = new Date().toISOString();
    record.error = {
      code: record.status === "cancelled" ? "CANCELLED" : "ANALYSIS_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
    throw error;
  }
}

export async function analyzeSource(
  source: SourceRecord,
  cacheDir: string,
  transcript?: TranscriptV1,
  parameters: AnalysisParameters = DEFAULT_ANALYSIS_PARAMETERS,
): Promise<AnalysisRunResult> {
  const parametersHash = hashJson(parameters);
  const transcriptFingerprint = transcript
    ? hashJson({ provider: transcript.provider, model: transcript.model, language: transcript.language, segments: transcript.segments })
    : null;
  const fingerprint = hashJson({ sourceHash: source.sha256, parameters, transcriptFingerprint });
  const targetDir = join(cacheDir, "analysis");
  const cachePath = join(targetDir, `${source.id}-${fingerprint}.json`);
  if (existsSync(cachePath)) {
    const analysis = JSON.parse(await readFile(cachePath, "utf8")) as SourceAnalysis;
    return { analysis, operations: [], cacheHit: true };
  }
  await mkdir(targetDir, { recursive: true });

  const sceneOperation = operation("scene_detection", source, fingerprint);
  const blackOperation = operation("black_frame_detection", source, fingerprint);
  const silenceOperation = operation("silence_detection", source, fingerprint);
  const loudnessOperation = operation("loudness_analysis", source, fingerprint);
  const operations = [sceneOperation, blackOperation, silenceOperation, loudnessOperation];

  const duration = source.durationSeconds;
  const sceneTimes = source.kind === "video"
    ? parseSceneTimes(await executeOperation(sceneOperation, () => runFfmpeg(source.canonicalPath, [
        "-vf", `select=gt(scene\\,${parameters.sceneThreshold}),showinfo`, "-an", "-f", "null", "-",
      ])), duration)
    : [0, duration].filter((value, index, values) => index === 0 || value > values[index - 1]!);
  if (source.kind !== "video") sceneOperation.status = "completed";

  const black = source.kind === "video"
    ? parseBlack(await executeOperation(blackOperation, () => runFfmpeg(source.canonicalPath, [
        "-vf", `blackdetect=d=${parameters.blackMinDuration}:pix_th=${parameters.blackPixelThreshold}`, "-an", "-f", "null", "-",
      ])), duration)
    : [];
  if (source.kind !== "video") blackOperation.status = "completed";

  const silence = source.audioStreams.length > 0
    ? parseSilence(await executeOperation(silenceOperation, () => runFfmpeg(source.canonicalPath, [
        "-af", `silencedetect=noise=${parameters.silenceNoiseDb}dB:d=${parameters.silenceMinDuration}`, "-vn", "-f", "null", "-",
      ])), duration)
    : [];
  if (source.audioStreams.length === 0) silenceOperation.status = "completed";

  const loudness = source.audioStreams.length > 0
    ? parseLoudness(await executeOperation(loudnessOperation, () => runFfmpeg(source.canonicalPath, [
        "-af", "loudnorm=I=-16:LRA=11:TP=-1.5:print_format=json", "-vn", "-f", "null", "-",
      ])))
    : undefined;
  if (source.audioStreams.length === 0) loudnessOperation.status = "completed";

  const diagnostics: AnalysisDiagnostic[] = [...black, ...silence, ...duplicateDiagnostics(transcript)];
  if (source.kind === "video" && (source.width < 1280 || source.height < 720)) {
    diagnostics.push({ type: "low_quality", severity: "warning", start: 0, end: duration, message: `Low source resolution ${source.width}x${source.height}` });
  }
  if (loudness?.integratedLufs !== undefined && (loudness.integratedLufs < -28 || loudness.integratedLufs > -9)) {
    diagnostics.push({ type: "loudness", severity: "warning", start: 0, end: duration, value: loudness.integratedLufs, message: `Integrated loudness is ${loudness.integratedLufs} LUFS` });
  }

  const scenes: SceneV1[] = [];
  for (let index = 0; index + 1 < sceneTimes.length; index += 1) {
    const sourceStart = sceneTimes[index]!;
    const sourceEnd = sceneTimes[index + 1]!;
    if (!(sourceStart < sourceEnd)) continue;
    const range = { start: sourceStart, end: sourceEnd };
    const sceneDiagnostics = diagnostics.filter((item) => overlaps(range, item));
    const blackSeconds = sceneDiagnostics.filter((item) => item.type === "black").reduce((sum, item) => sum + Math.min(sourceEnd, item.end) - Math.max(sourceStart, item.start), 0);
    const silenceSeconds = sceneDiagnostics.filter((item) => item.type === "silence").reduce((sum, item) => sum + Math.min(sourceEnd, item.end) - Math.max(sourceStart, item.start), 0);
    const sceneDuration = sourceEnd - sourceStart;
    const visualQuality = Math.max(0, Math.min(1, 1 - blackSeconds / sceneDuration));
    const audioQuality = source.audioStreams.length === 0 ? 1 : Math.max(0, Math.min(1, 1 - silenceSeconds / sceneDuration));
    const keepScore = Math.max(0, Math.min(1, visualQuality * 0.55 + audioQuality * 0.35 + Math.min(sceneDuration / 8, 1) * 0.1));
    scenes.push({
      id: `scene_${stableId(source.id, sourceStart.toFixed(6), sourceEnd.toFixed(6))}`,
      sourceId: source.id,
      sourceStart,
      sourceEnd,
      description: `Detected scene ${index + 1}`,
      transcriptReferences: transcriptReferences(transcript, sourceStart, sourceEnd),
      visualQuality,
      audioQuality,
      tags: [],
      people: [],
      objects: [],
      suggestedRole: keepScore < 0.25 ? "reject" : source.kind === "video" && source.audioStreams.length === 0 ? "broll" : "primary",
      keepScore,
      rejectScore: 1 - keepScore,
      diagnostics: sceneDiagnostics,
    });
  }

  const highlights = scenes.filter((scene) => scene.keepScore >= 0.75).map((scene) => ({ start: scene.sourceStart, end: scene.sourceEnd }));
  const brollOpportunities = transcript
    ? transcript.segments.filter((segment) => segment.end - segment.start >= 3).map((segment) => ({ start: segment.start, end: Math.min(segment.end, segment.start + 5) }))
    : [];
  const analysis: SourceAnalysis = {
    schemaVersion: 1,
    sourceId: source.id,
    sourceHash: source.sha256,
    parametersHash,
    scenes,
    diagnostics: diagnostics.sort((left, right) => left.start - right.start || left.type.localeCompare(right.type)),
    highlights,
    brollOpportunities,
    ...(loudness ? { loudness } : {}),
    generatedAt: new Date().toISOString(),
  };
  await atomicWriteFile(cachePath, `${JSON.stringify(analysis, null, 2)}\n`, { overwrite: false });
  return { analysis, operations, cacheHit: false };
}
