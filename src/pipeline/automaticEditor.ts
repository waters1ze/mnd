import { createHash } from "node:crypto";
import type {
  EditClipV1,
  EditPlanV1,
  EditProfile,
  EditTrackV1,
  SourceAnalysis,
  SourceManifest,
  SourceRecord,
  TimeRange,
  TranscriptV1,
} from "../types/production.js";
import { sourceManifestFingerprint } from "../core/sourceManifest.js";

export interface SourceRangeInstruction extends TimeRange {
  sourceId: string;
}

export interface AutomaticEditOptions {
  profile: EditProfile;
  timelineName: string;
  targetDurationSeconds?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
  fps?: { numerator: number; denominator: number };
  pacing?: "slow" | "balanced" | "fast";
  aggressiveness?: number;
  subtitleStyle?: string;
  musicLevelDb?: number;
  brollFrequency?: "none" | "low" | "medium" | "high";
  keepInstructions?: string[];
  removeInstructions?: string[];
  protectedSegments?: SourceRangeInstruction[];
  bannedSegments?: SourceRangeInstruction[];
}

interface Candidate extends TimeRange {
  source: SourceRecord;
  score: number;
  protected: boolean;
}

function id(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20)}`;
}

function overlap(left: TimeRange, right: TimeRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function resolution(aspectRatio: AutomaticEditOptions["aspectRatio"]): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  if (aspectRatio === "4:5") return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}

function defaultTransform(): EditClipV1["transform"] {
  return { scale: 1, positionX: 0, positionY: 0, rotation: 0, opacity: 1 };
}

function defaultAudio(enabled: boolean, duration: number, gainDb = 0, duckUnderVoice = false): EditClipV1["audio"] {
  const fadeSeconds = enabled ? Math.min(0.15, Math.max(0, duration / 2)) : 0;
  return { enabled, gainDb, fadeInSeconds: fadeSeconds, fadeOutSeconds: fadeSeconds, duckUnderVoice };
}

function subtractRanges(base: TimeRange, removals: TimeRange[]): TimeRange[] {
  let ranges = [base];
  for (const removal of removals.sort((left, right) => left.start - right.start)) {
    const next: TimeRange[] = [];
    for (const range of ranges) {
      if (!overlap(range, removal)) {
        next.push(range);
        continue;
      }
      if (removal.start > range.start) next.push({ start: range.start, end: Math.min(removal.start, range.end) });
      if (removal.end < range.end) next.push({ start: Math.max(removal.end, range.start), end: range.end });
    }
    ranges = next;
  }
  return ranges.filter((range) => range.end - range.start > 0.01);
}

function transcriptFor(sourceId: string, transcripts: TranscriptV1[]): TranscriptV1 | undefined {
  return transcripts.find((item) => item.sourceId === sourceId);
}

function snapToSpeech(range: TimeRange, transcript: TranscriptV1 | undefined): TimeRange {
  if (!transcript) return range;
  const segments = transcript.segments.filter((segment) => segment.start < range.end && segment.end > range.start);
  if (segments.length === 0) return range;
  return {
    start: Math.max(range.start, segments[0]!.start),
    end: Math.min(range.end, segments.at(-1)!.end),
  };
}

function buildCandidates(
  source: SourceRecord,
  analysis: SourceAnalysis | undefined,
  transcript: TranscriptV1 | undefined,
  options: AutomaticEditOptions,
): Candidate[] {
  const protectedRanges = (options.protectedSegments ?? []).filter((item) => item.sourceId === source.id);
  const banned = (options.bannedSegments ?? []).filter((item) => item.sourceId === source.id);
  const diagnostics = analysis?.diagnostics ?? [];
  const removals: TimeRange[] = [
    ...banned,
    ...diagnostics.filter((item) => item.type === "black" && item.end - item.start >= 0.15),
    ...diagnostics.filter((item) => item.type === "duplicate"),
    ...diagnostics.filter((item) => item.type === "silence" && item.end - item.start >= 0.75).map((item) => ({ start: item.start + 0.12, end: item.end - 0.12 })),
  ];
  const sceneRanges = analysis?.scenes.length
    ? analysis.scenes.filter((scene) => scene.suggestedRole !== "reject").map((scene) => ({ start: scene.sourceStart, end: scene.sourceEnd, score: scene.keepScore }))
    : [{ start: 0, end: source.durationSeconds, score: 0.6 }];
  const minimum = options.pacing === "fast" ? 0.65 : options.pacing === "slow" ? 1.5 : 1;
  const candidates: Candidate[] = [];
  for (const scene of sceneRanges) {
    for (const remaining of subtractRanges(scene, removals)) {
      const snapped = snapToSpeech(remaining, transcript);
      const isProtected = protectedRanges.some((range) => overlap(range, snapped));
      if (snapped.end - snapped.start < minimum && !isProtected) continue;
      candidates.push({ ...snapped, source, score: scene.score, protected: isProtected });
    }
  }
  candidates.sort((left, right) => left.start - right.start);
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && previous.source.id === candidate.source.id && candidate.start - previous.end <= 0.2) {
      previous.end = candidate.end;
      previous.score = Math.max(previous.score, candidate.score);
      previous.protected ||= candidate.protected;
    } else {
      merged.push({ ...candidate });
    }
  }
  return merged;
}

function selectForTarget(candidates: Candidate[], target: number | undefined): Candidate[] {
  if (!target || target <= 0) return candidates;
  const protectedDuration = candidates.filter((item) => item.protected).reduce((sum, item) => sum + item.end - item.start, 0);
  const budget = Math.max(target, protectedDuration);
  const ranked = [...candidates].sort((left, right) => Number(right.protected) - Number(left.protected) || right.score - left.score || left.start - right.start);
  const selected = new Map<Candidate, Candidate>();
  let used = 0;
  for (const candidate of ranked) {
    const duration = candidate.end - candidate.start;
    if (candidate.protected) {
      selected.set(candidate, candidate);
      used += duration;
      continue;
    }
    const remaining = budget - used;
    if (remaining <= 0.01) continue;
    if (duration <= remaining + 0.25) {
      selected.set(candidate, candidate);
      used += duration;
      continue;
    }
    selected.set(candidate, { ...candidate, end: candidate.start + remaining });
    used += remaining;
  }
  return candidates.flatMap((candidate) => {
    const value = selected.get(candidate);
    return value ? [value] : [];
  });
}

function makeClip(
  source: SourceRecord,
  start: number,
  end: number,
  timelineStart: number,
  trackId: string,
  audioEnabled: boolean,
  audioGain = 0,
  duckUnderVoice = false,
): EditClipV1 {
  const duration = end - start;
  const transitionDuration = Math.min(0.2, start, Math.max(0, source.durationSeconds - end));
  return {
    id: id("clip", source.id, start.toFixed(6), end.toFixed(6), trackId, timelineStart.toFixed(6)),
    sourceId: source.id,
    sourceHash: source.sha256,
    sourceStart: start,
    sourceEnd: end,
    timelineStart,
    timelineEnd: timelineStart + duration,
    trackId,
    enabled: true,
    speed: 1,
    transform: defaultTransform(),
    audio: defaultAudio(audioEnabled, duration, audioGain, duckUnderVoice),
    transitionIn: transitionDuration >= 0.08 ? { type: "cross_dissolve", durationSeconds: transitionDuration } : null,
    transitionOut: transitionDuration >= 0.08 ? { type: "cross_dissolve", durationSeconds: transitionDuration } : null,
  };
}

export function buildAutomaticEditPlan(
  projectId: string,
  manifest: SourceManifest,
  analyses: SourceAnalysis[],
  transcripts: TranscriptV1[],
  options: AutomaticEditOptions,
): EditPlanV1 {
  const sourceAnalyses = new Map(analyses.map((analysis) => [analysis.sourceId, analysis]));
  const spoken = manifest.entries.filter((source) => source.kind === "video" && source.audioStreams.length > 0 && source.durationSeconds > 0);
  const primarySources = spoken.length > 0 ? spoken : manifest.entries.filter((source) => source.kind === "video" && source.durationSeconds > 0).slice(0, 1);
  if (primarySources.length === 0) throw new Error("No video source is available for the primary timeline");

  const allCandidates = primarySources.flatMap((source) => buildCandidates(source, sourceAnalyses.get(source.id), transcriptFor(source.id, transcripts), options));
  const candidates = selectForTarget(allCandidates, options.targetDurationSeconds);
  if (candidates.length === 0) throw new Error("Automatic editing rejected every source range; adjust banned/protected segments or aggressiveness");

  const primaryTrackId = "track_primary_video";
  let timelineCursor = 0;
  const primaryClips = candidates.map((candidate) => {
    const clip = makeClip(candidate.source, candidate.start, candidate.end, timelineCursor, primaryTrackId, candidate.source.audioStreams.length > 0);
    timelineCursor = clip.timelineEnd;
    return clip;
  });
  const tracks: EditTrackV1[] = [{ id: primaryTrackId, kind: "primary_video", name: "Primary Video", exclusive: true, clips: primaryClips }];

  const frequencySeconds = options.brollFrequency === "high" ? 8 : options.brollFrequency === "medium" ? 14 : options.brollFrequency === "low" ? 24 : Number.POSITIVE_INFINITY;
  const brollSources = manifest.entries.filter((source) => source.kind === "video" && !primarySources.some((primary) => primary.id === source.id) && source.durationSeconds > 0);
  if (brollSources.length > 0 && Number.isFinite(frequencySeconds)) {
    const trackId = "track_broll";
    const clips: EditClipV1[] = [];
    let sourceIndex = 0;
    for (let at = frequencySeconds; at < timelineCursor - 1; at += frequencySeconds) {
      const source = brollSources[sourceIndex++ % brollSources.length]!;
      const duration = Math.min(4, source.durationSeconds, timelineCursor - at);
      if (duration < 0.5) continue;
      clips.push(makeClip(source, 0, duration, at, trackId, false));
    }
    if (clips.length > 0) tracks.push({ id: trackId, kind: "broll", name: "B-roll", exclusive: true, clips });
  }

  const images = manifest.entries.filter((source) => source.kind === "image");
  if (images.length > 0) {
    const trackId = "track_images";
    const clips: EditClipV1[] = [];
    for (const [index, source] of images.entries()) {
      const start = Math.min(timelineCursor - 0.5, 5 + index * 12);
      if (start < 0) continue;
      const duration = Math.min(3, timelineCursor - start);
      const imageSource = { ...source, durationSeconds: Math.max(source.durationSeconds, duration) };
      clips.push(makeClip(imageSource, 0, duration, start, trackId, false));
    }
    if (clips.length > 0) tracks.push({ id: trackId, kind: "images", name: "Images", exclusive: true, clips });
  }

  const musicSources = manifest.entries.filter((source) => source.kind === "audio" && source.durationSeconds > 0);
  if (musicSources.length > 0 && timelineCursor > 0) {
    const trackId = "track_music";
    const clips: EditClipV1[] = [];
    let cursor = 0;
    let index = 0;
    while (cursor < timelineCursor - 0.01) {
      const source = musicSources[index++ % musicSources.length]!;
      const duration = Math.min(source.durationSeconds, timelineCursor - cursor);
      if (duration <= 0) break;
      clips.push(makeClip(source, 0, duration, cursor, trackId, true, options.musicLevelDb ?? -18, true));
      cursor += duration;
    }
    if (clips.length > 0) tracks.push({ id: trackId, kind: "music", name: "Music", exclusive: true, clips });
  }

  const subtitles = primaryClips.flatMap((clip) => {
    const transcript = transcriptFor(clip.sourceId, transcripts);
    if (!transcript) return [];
    return transcript.segments
      .filter((segment) => segment.start >= clip.sourceStart - 1e-6 && segment.end <= clip.sourceEnd + 1e-6)
      .map((segment) => ({
        id: id("sub", clip.id, segment.id),
        start: clip.timelineStart + segment.start - clip.sourceStart,
        end: clip.timelineStart + segment.end - clip.sourceStart,
        text: segment.text.trim(),
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
      }))
      .filter((cue) => cue.text && cue.end > cue.start);
  });

  const warnings: string[] = [];
  if (transcripts.length === 0) warnings.push("No transcript was available; semantic continuity and word-boundary protection are limited");
  if (options.keepInstructions?.length) warnings.push("Free-text keep instructions require an AI-authored plan; deterministic protectedSegments were applied");
  if (options.removeInstructions?.length) warnings.push("Free-text remove instructions require an AI-authored plan; deterministic bannedSegments were applied");
  const totalPrimaryDuration = primaryClips.reduce((sum, clip) => sum + clip.timelineEnd - clip.timelineStart, 0);
  const rationale = [
    `Selected ${primaryClips.length} primary ranges totaling ${totalPrimaryDuration.toFixed(2)} seconds`,
    "Removed sustained silence, black frames, and detected repeated speech while preserving transcript segment boundaries",
    options.targetDurationSeconds ? `Optimized selections toward the requested ${options.targetDurationSeconds.toFixed(2)} second duration` : "Preserved all source ranges that passed quality checks",
    tracks.some((track) => track.kind === "broll") ? "Placed B-roll on a connected video lane at profile-controlled intervals" : "No eligible B-roll placement was produced",
    tracks.some((track) => track.kind === "music") ? "Placed music on a separate lane with speech ducking metadata and fades" : "No music source was available",
  ];

  return {
    schemaVersion: 1,
    projectId,
    profile: options.profile,
    timeline: {
      name: options.timelineName,
      resolution: resolution(options.aspectRatio),
      fps: options.fps ?? (primarySources[0]!.fps.numerator > 0 ? primarySources[0]!.fps : { numerator: 25, denominator: 1 }),
      audioSampleRate: 48000,
    },
    tracks,
    markers: [],
    subtitles,
    assets: [],
    rationale,
    warnings,
    sourceManifestHash: sourceManifestFingerprint(manifest),
    createdAt: new Date().toISOString(),
  };
}
