// src/pipeline/selectKeyframes.ts
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
  saveProjectState,
} from "../core/projectState.js";
import type { TranscriptSegment, KeyframeCandidate, ProjectState } from "../types/pipeline.js";

const FRAME_INTERVAL_SEC = 5; // Extract one frame every N seconds
const MAX_FRAMES = 20;

async function extractFrame(videoPath: string, atSec: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, [
      "-y",
      "-ss", String(atSec),
      "-i", videoPath,
      "-vframes", "1",
      "-q:v", "2",
      outputPath,
    ], { stdio: "ignore" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg frame extract failed at ${atSec}s`));
    });
    proc.on("error", reject);
  });
}

async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobeStatic.path, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      videoPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("exit", (code) => {
      if (code !== 0) { resolve(60); return; } // fallback
      try {
        const info = JSON.parse(out) as { streams: Array<{ duration?: string }> };
        const dur = parseFloat(info.streams[0]?.duration ?? "60");
        resolve(isNaN(dur) ? 60 : dur);
      } catch {
        resolve(60);
      }
    });
    proc.on("error", () => resolve(60));
  });
}

export async function selectKeyframesStep(
  videoPath: string,
  _segments: TranscriptSegment[],
  state: ProjectState,
  vaultPath: string,
  framesDir: string
): Promise<KeyframeCandidate[]> {
  if (isStepDone(state, "keyframes")) {
    const cached = getCachedStepOutput<KeyframeCandidate[]>(state, "keyframes");
    if (cached) return cached;
  }

  await mkdir(framesDir, { recursive: true });

  const duration = await getVideoDuration(videoPath);
  const numFrames = Math.min(
    Math.floor(duration / FRAME_INTERVAL_SEC),
    MAX_FRAMES
  );

  const candidates: KeyframeCandidate[] = [];

  for (let i = 0; i < numFrames; i++) {
    const atSec = (i + 0.5) * FRAME_INTERVAL_SEC;
    if (atSec >= duration) break;
    const outputPath = join(framesDir, `frame_${String(i).padStart(3, "0")}.jpg`);
    try {
      await extractFrame(videoPath, atSec, outputPath);
      candidates.push({ atSec, thumbnailPath: outputPath });
    } catch {
      // skip failed frames
    }
  }

  cacheStepOutput(state, "keyframes", candidates);
  markStepDone(state, "keyframes");
  await saveProjectState(vaultPath, state);
  return candidates;
}
