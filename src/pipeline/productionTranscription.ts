import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { OperationRecord, SourceRecord, TranscriptSegmentV1, TranscriptV1, TranscriptWord } from "../types/production.js";
import { atomicWriteFile } from "../core/atomic.js";
import { getActiveProfile } from "../core/config.js";
import { groqTranscribeDetailed } from "../core/groqClient.js";
import { sidecarTranscribe } from "../core/pythonSidecarClient.js";
import { isCancellationRequested, registerProcess, unregisterProcess } from "../core/cancellation.js";

const CHUNK_SECONDS = 480;

function stableId(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}

async function extractAudioChunks(source: SourceRecord, directory: string): Promise<string[]> {
  const pattern = join(directory, "chunk-%05d.flac");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath as unknown as string, [
      "-hide_banner", "-loglevel", "error", "-i", source.canonicalPath,
      "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "flac",
      "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1", pattern,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    if (child.pid) registerProcess({ pid: child.pid, kind: "ffmpeg", process: child, ownedByRun: true });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (child.pid) unregisterProcess(child.pid);
      if (code === 0) resolve();
      else reject(new Error(`Audio extraction failed with code ${code}: ${stderr.slice(-1000)}`));
    });
  });
  return (await readdir(directory))
    .filter((name) => /^chunk-\d+\.flac$/.test(name))
    .sort()
    .map((name) => join(directory, name));
}

function validTime(value: number, duration: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label} timestamp ${value}`);
  if (value > duration + 0.5) throw new Error(`${label} timestamp ${value} exceeds source duration ${duration}`);
  return Math.min(value, duration);
}

export interface TranscriptionResult {
  transcript: TranscriptV1;
  operation: OperationRecord;
  cacheHit: boolean;
}

export async function transcribeSource(source: SourceRecord, cacheDir: string): Promise<TranscriptionResult> {
  if (source.audioStreams.length === 0) throw new Error(`Source has no audio stream: ${source.relativePath}`);
  const profile = await getActiveProfile();
  const provider = profile.transcription.provider;
  const model = profile.transcription.model ?? (provider === "groq" ? "whisper-large-v3" : "medium");
  const fingerprint = createHash("sha256").update(JSON.stringify({ sourceHash: source.sha256, provider, model, chunkSeconds: CHUNK_SECONDS, wordTimestamps: true })).digest("hex");
  const targetDir = join(cacheDir, "transcripts");
  const cachePath = join(targetDir, `${source.id}-${fingerprint}.json`);
  const operation: OperationRecord = {
    id: `op_${stableId("transcribe", source.id, fingerprint)}`,
    kind: "transcription",
    sourceId: source.id,
    status: "pending",
    inputFingerprint: fingerprint,
    outputPaths: [cachePath],
  };
  if (existsSync(cachePath)) {
    operation.status = "completed";
    return { transcript: JSON.parse(await readFile(cachePath, "utf8")) as TranscriptV1, operation, cacheHit: true };
  }

  await mkdir(targetDir, { recursive: true });
  const tempDir = await mkdtemp(join(targetDir, `.chunks-${source.id}-`));
  operation.status = "running";
  operation.startedAt = new Date().toISOString();
  try {
    const chunks = await extractAudioChunks(source, tempDir);
    if (chunks.length === 0) throw new Error(`No audio chunks were produced for ${source.relativePath}`);
    const segments: TranscriptSegmentV1[] = [];
    let language = "und";
    for (const [chunkIndex, chunk] of chunks.entries()) {
      if (isCancellationRequested()) throw new Error("Transcription cancelled");
      const offset = chunkIndex * CHUNK_SECONDS;
      if (provider === "groq") {
        const result = await groqTranscribeDetailed(chunk);
        if (result.language) language = result.language;
        for (const [segmentIndex, item] of result.segments.entries()) {
          const start = validTime(offset + item.start, source.durationSeconds, "segment start");
          const end = validTime(offset + item.end, source.durationSeconds, "segment end");
          if (!(start < end) || !item.text.trim()) continue;
          const words: TranscriptWord[] = result.words
            .filter((word) => word.start < item.end && word.end > item.start)
            .map((word) => {
              const mapped: TranscriptWord = {
                text: word.word,
                start: validTime(offset + word.start, source.durationSeconds, "word start"),
                end: validTime(offset + word.end, source.durationSeconds, "word end"),
              };
              if (word.probability !== undefined && Number.isFinite(word.probability)) mapped.confidence = word.probability;
              if (word.speaker) mapped.speaker = word.speaker;
              return mapped;
            })
            .filter((word) => word.start < word.end);
          const segment: TranscriptSegmentV1 = {
            id: `seg_${stableId(source.id, start.toFixed(6), end.toFixed(6), segmentIndex)}`,
            start,
            end,
            text: item.text.trim(),
            words,
          };
          if (item.avg_logprob !== undefined && Number.isFinite(item.avg_logprob)) segment.confidence = Math.exp(item.avg_logprob);
          if (item.speaker) segment.speaker = item.speaker;
          segments.push(segment);
        }
      } else {
        const result = await sidecarTranscribe(chunk, model);
        for (const [segmentIndex, item] of result.entries()) {
          const start = validTime(offset + item.start, source.durationSeconds, "segment start");
          const end = validTime(offset + item.end, source.durationSeconds, "segment end");
          if (!(start < end) || !item.text.trim()) continue;
          segments.push({
            id: `seg_${stableId(source.id, start.toFixed(6), end.toFixed(6), segmentIndex)}`,
            start,
            end,
            text: item.text.trim(),
            words: (item.words ?? []).map((word) => {
              const mapped: TranscriptWord = {
                text: word.text,
                start: validTime(offset + word.start, source.durationSeconds, "word start"),
                end: validTime(offset + word.end, source.durationSeconds, "word end"),
              };
              if (word.confidence !== undefined && Number.isFinite(word.confidence)) mapped.confidence = word.confidence;
              return mapped;
            }).filter((word) => word.text.trim() && word.start < word.end),
          });
        }
      }
    }
    segments.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
    for (let index = 1; index < segments.length; index += 1) {
      if (segments[index]!.start < segments[index - 1]!.start) throw new Error("Transcript segments are not ordered");
    }
    const transcript: TranscriptV1 = {
      schemaVersion: 1,
      sourceId: source.id,
      sourceHash: source.sha256,
      language,
      provider,
      model,
      segments,
      generatedAt: new Date().toISOString(),
    };
    await atomicWriteFile(cachePath, `${JSON.stringify(transcript, null, 2)}\n`, { overwrite: false });
    operation.status = "completed";
    operation.completedAt = new Date().toISOString();
    return { transcript, operation, cacheHit: false };
  } catch (error) {
    operation.status = isCancellationRequested() ? "cancelled" : "failed";
    operation.completedAt = new Date().toISOString();
    operation.error = {
      code: operation.status === "cancelled" ? "CANCELLED" : "TRANSCRIPTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
