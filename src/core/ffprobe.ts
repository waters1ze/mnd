import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerProcess, unregisterProcess, isCancellationRequested } from "./cancellation.js";
import type { MediaKind, MediaStream, Rational } from "../types/production.js";

const execFileAsync = promisify(execFile);

// @ts-ignore
import ffprobeStatic from "ffprobe-static";

interface FfprobeStream {
  index?: number;
  codec_name?: string;
  codec_long_name?: string;
  codec_type?: string;
  profile?: string;
  time_base?: string;
  duration?: string;
  bit_rate?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

export interface MediaProbeResult {
  durationSeconds: number;
  format: string;
  kind: MediaKind;
  videoStreams: MediaStream[];
  audioStreams: MediaStream[];
  width: number;
  height: number;
  fps: Rational;
  timeBase: string;
  sampleRate: number;
  channels: number;
  tags?: Record<string, string>;
}

function finiteNumber(value: string | number | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseRational(value: string | undefined): Rational | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    return undefined;
  }
  return { numerator, denominator };
}

function mapStream(stream: FfprobeStream): MediaStream {
  const mapped: MediaStream = {
    index: stream.index ?? 0,
    codec: stream.codec_name ?? "unknown",
  };
  if (stream.codec_long_name) mapped.codecLongName = stream.codec_long_name;
  if (stream.profile) mapped.profile = stream.profile;
  if (stream.time_base) mapped.timeBase = stream.time_base;
  const durationSeconds = finiteNumber(stream.duration);
  if (durationSeconds !== undefined) mapped.durationSeconds = durationSeconds;
  const bitRate = finiteNumber(stream.bit_rate);
  if (bitRate !== undefined) mapped.bitRate = bitRate;
  if (stream.width !== undefined) mapped.width = stream.width;
  if (stream.height !== undefined) mapped.height = stream.height;
  const fps = parseRational(stream.avg_frame_rate) ?? parseRational(stream.r_frame_rate);
  if (fps) mapped.fps = fps;
  if (stream.pix_fmt) mapped.pixelFormat = stream.pix_fmt;
  const sampleRate = finiteNumber(stream.sample_rate);
  if (sampleRate !== undefined) mapped.sampleRate = sampleRate;
  if (stream.channels !== undefined) mapped.channels = stream.channels;
  if (stream.channel_layout) mapped.channelLayout = stream.channel_layout;
  if (stream.tags) mapped.tags = stream.tags;
  return mapped;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  if (isCancellationRequested()) throw new Error("Media probe cancelled");

  const ffprobePromise = execFileAsync(ffprobeStatic.path, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const child = ffprobePromise.child;
  if (child?.pid) {
    registerProcess({ pid: child.pid, kind: "ffprobe", process: child, ownedByRun: true });
  }

  try {
    const { stdout } = await ffprobePromise;
    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const rawStreams = parsed.streams ?? [];
    const videoRaw = rawStreams.filter((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
    const imageRaw = rawStreams.filter((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic === 1);
    const audioRaw = rawStreams.filter((stream) => stream.codec_type === "audio");
    const videoStreams = videoRaw.map(mapStream);
    const audioStreams = audioRaw.map(mapStream);
    const primaryVideo = videoStreams[0];
    const primaryAudio = audioStreams[0];
    const durationCandidates = [
      finiteNumber(parsed.format?.duration),
      ...videoStreams.map((stream) => stream.durationSeconds),
      ...audioStreams.map((stream) => stream.durationSeconds),
    ].filter((value): value is number => value !== undefined && value >= 0);
    const durationSeconds = durationCandidates.length > 0 ? Math.max(...durationCandidates) : 0;
    const kind: MediaKind = videoStreams.length > 0
      ? "video"
      : audioStreams.length > 0
        ? "audio"
        : imageRaw.length > 0
          ? "image"
          : "unknown";

    return {
      durationSeconds,
      format: parsed.format?.format_name ?? "unknown",
      kind,
      videoStreams,
      audioStreams,
      width: primaryVideo?.width ?? imageRaw[0]?.width ?? 0,
      height: primaryVideo?.height ?? imageRaw[0]?.height ?? 0,
      fps: primaryVideo?.fps ?? { numerator: 0, denominator: 1 },
      timeBase: primaryVideo?.timeBase ?? primaryAudio?.timeBase ?? "",
      sampleRate: primaryAudio?.sampleRate ?? 0,
      channels: primaryAudio?.channels ?? 0,
      ...(parsed.format?.tags ? { tags: parsed.format.tags } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe failed for ${filePath}: ${message}`);
  } finally {
    if (child?.pid) unregisterProcess(child.pid);
  }
}

export async function getMediaDuration(filePath: string): Promise<number | null> {
  if (isCancellationRequested()) return null;

  try {
    const ffprobePromise = execFileAsync(ffprobeStatic.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);

    const child = ffprobePromise.child;
    if (child && child.pid) {
      registerProcess({
        pid: child.pid,
        kind: "ffprobe",
        process: child,
        ownedByRun: true
      });
    }

    const { stdout } = await ffprobePromise;

    if (child && child.pid) {
      unregisterProcess(child.pid);
    }

    const dur = parseFloat(stdout.trim());
    return Number.isFinite(dur) ? dur : null;
  } catch (e) {
    // ffprobe failed
    return null;
  }
}
