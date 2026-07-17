// src/pipeline/transcribe.ts
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { getActiveProfile } from "../core/config.js";
import { groqTranscribeSegments } from "../core/groqClient.js";
import { sidecarTranscribe } from "../core/pythonSidecarClient.js";
import {
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
  saveProjectState,
} from "../core/projectState.js";
import type { TranscriptSegment, ProjectState } from "../types/pipeline.js";

async function extractAudio(videoPath: string): Promise<string> {
  const audioPath = join(tmpdir(), `mnd_audio_${Date.now()}.wav`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, [
      "-y", "-i", videoPath,
      "-vn", "-acodec", "pcm_s16le",
      "-ar", "16000", "-ac", "1",
      audioPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg audio extraction failed with code ${code}`));
    });
    proc.on("error", reject);
  });
  return audioPath;
}

export async function transcribeStep(
  videoPath: string,
  state: ProjectState,
  vaultPath: string
): Promise<TranscriptSegment[]> {
  if (isStepDone(state, "transcribe")) {
    const cached = getCachedStepOutput<TranscriptSegment[]>(state, "transcribe");
    if (cached) return cached;
  }

  const profile = await getActiveProfile();
  let audioPath: string | null = null;

  try {
    audioPath = await extractAudio(videoPath);

    let segments: TranscriptSegment[];

    if (profile.transcription.provider === "groq") {
      segments = await groqTranscribeSegments(audioPath);
    } else {
      // sidecar_whisper
      const model = profile.transcription.model ?? "medium";
      segments = await sidecarTranscribe(audioPath, model);
    }

    cacheStepOutput(state, "transcribe", segments);
    markStepDone(state, "transcribe");
    await saveProjectState(vaultPath, state);
    return segments;
  } finally {
    if (audioPath) {
      await rm(audioPath, { force: true });
    }
  }
}
