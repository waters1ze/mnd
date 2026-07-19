import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { ProjectPaths } from "../core/projectPaths.js";
import { buildSourceRecord, sourceManifestFingerprint } from "../core/sourceManifest.js";
import { registerProcess, unregisterProcess } from "../core/cancellation.js";
import type { EditClipV1, EditPlanV1, SourceManifest, SourceRecord } from "../types/production.js";

export interface MaterializedEffects {
  plan: EditPlanV1;
  manifest: SourceManifest;
  generatedFiles: string[];
}

function effectKey(clip: EditClipV1, source: SourceRecord): string {
  return createHash("sha256").update(JSON.stringify({
    source: source.sha256,
    start: clip.sourceStart,
    end: clip.sourceEnd,
    effect: clip.effect ?? null,
    pitchSemitones: clip.audio.pitchSemitones ?? 0,
  })).digest("hex").slice(0, 24);
}

export function buildEffectFfmpegArgs(clip: EditClipV1, source: SourceRecord, outputPath: string): string[] {
  const duration = clip.sourceEnd - clip.sourceStart;
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", clip.sourceStart.toFixed(6),
    "-i", source.canonicalPath,
    "-t", duration.toFixed(6),
  ];
  if (source.videoStreams.length > 0) {
    args.push("-map", "0:v:0");
    if (clip.effect === "monochrome") args.push("-vf", "hue=s=0");
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
  } else {
    args.push("-vn");
  }
  if (source.audioStreams.length > 0 && clip.audio.enabled) {
    args.push("-map", "0:a:0?");
    const semitones = clip.audio.pitchSemitones ?? 0;
    if (Math.abs(semitones) > 1e-9) {
      const factor = 2 ** (semitones / 12);
      const sampleRate = source.sampleRate || 48_000;
      args.push("-af", `asetrate=${Math.round(sampleRate * factor)},aresample=${sampleRate},atempo=${(1 / factor).toFixed(8)}`);
    }
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", outputPath);
  return args;
}

async function renderEffectClip(clip: EditClipV1, source: SourceRecord, outputPath: string): Promise<void> {
  const executable = ffmpegPath as unknown as string | null;
  if (!executable) throw new Error("FFmpeg is unavailable; prompt-directed rendered effects cannot be materialized");
  await mkdir(dirname(outputPath), { recursive: true });
  const args = buildEffectFfmpegArgs(clip, source, outputPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    if (child.pid) registerProcess({ pid: child.pid, kind: "ffmpeg", process: child, ownedByRun: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (child.pid) unregisterProcess(child.pid);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg effect render failed (${code ?? "unknown"}): ${stderr.trim().slice(-1200)}`));
    });
  }).catch(async (error) => {
    await rm(outputPath, { force: true }).catch(() => {});
    throw error;
  });
}

export async function materializeEditPlanEffects(
  plan: EditPlanV1,
  manifest: SourceManifest,
  paths: ProjectPaths,
): Promise<MaterializedEffects> {
  const materializedPlan = structuredClone(plan);
  const materializedManifest = structuredClone(manifest);
  const sources = new Map(materializedManifest.entries.map((source) => [source.id, source]));
  const generatedFiles: string[] = [];
  const effectsDirectory = join(paths.exportBundleDir, "Assets", "effects");

  for (const track of materializedPlan.tracks) {
    for (const clip of track.clips) {
      const requiresRender = clip.effect === "monochrome" || Math.abs(clip.audio.pitchSemitones ?? 0) > 1e-9;
      if (!requiresRender) continue;
      const source = sources.get(clip.sourceId);
      if (!source) throw new Error(`Cannot materialize effect for missing source ${clip.sourceId}`);
      if (source.videoStreams.length === 0) throw new Error(`Rendered clip effects require a video source: ${source.relativePath}`);
      const outputPath = join(effectsDirectory, `${effectKey(clip, source)}.mp4`);
      let rendered: SourceRecord | undefined;
      if (existsSync(outputPath)) {
        try {
          rendered = await buildSourceRecord(paths.root, outputPath);
        } catch {
          await rm(outputPath, { force: true });
        }
      }
      if (!rendered) {
        await renderEffectClip(clip, source, outputPath);
        rendered = await buildSourceRecord(paths.root, outputPath);
      }
      if (!sources.has(rendered.id)) {
        sources.set(rendered.id, rendered);
        materializedManifest.entries.push(rendered);
      }
      const sourceDuration = clip.sourceEnd - clip.sourceStart;
      clip.sourceId = rendered.id;
      clip.sourceHash = rendered.sha256;
      clip.sourceStart = 0;
      clip.sourceEnd = sourceDuration;
      delete clip.effect;
      delete clip.audio.pitchSemitones;
      generatedFiles.push(outputPath);
    }
  }

  materializedManifest.entries.sort((left, right) => left.id.localeCompare(right.id));
  materializedPlan.sourceManifestHash = sourceManifestFingerprint(materializedManifest);
  if (generatedFiles.length > 0) {
    materializedPlan.warnings = [...materializedPlan.warnings, `Materialized ${generatedFiles.length} prompt-directed effect clip(s) with FFmpeg`];
  }
  return { plan: materializedPlan, manifest: materializedManifest, generatedFiles };
}
