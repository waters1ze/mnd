import { createHash } from "node:crypto";
import { basename, parse } from "node:path";
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

interface TranscriptAnchor extends TimeRange {
  sourceId: string;
  text: string;
  score: number;
}

const IMAGE_REQUEST = /\b(image|picture|photo|screenshot|logo|overlay)\b|\.(?:png|jpe?g|webp|gif|bmp|tiff?|heic)\b|картин|изображ|фото|скрин|логотип|оверле/i;
const HAND_PLACEMENT = /between\s+(?:my\s+)?hands|между\s+(?:моих\s+)?рук|между\s+ладон/i;
const DOWN_PLACEMENT = /point(?:ed|ing)?\s+down|show(?:ed|ing)?\s+down|показал\w*\s+вниз|указал\w*\s+вниз|снизу|ниже/i;
const FULLSCREEN_PLACEMENT = /full[ -]?screen|на\s+весь\s+экран|полноэкран/i;
const MONOCHROME_EFFECT = /black\s*(?:and|&)\s*white|monochrome|grayscale|ч[её]рно[ -]?бел|ч\/?б|чбшн/i;
const NO_TRANSITIONS = /no\s+transitions?|without\s+transitions?|без\s+переход|не\s+добавляй\s+переход/i;
const EXPLICIT_SMOOTH_TRANSITIONS = /smooth\s+transitions?|soft\s+cuts?|плавн[а-яё]*\s+переход|мягк[а-яё]*\s+склей|сглад[а-яё]*\s+(?:переход|склей)|резк[а-яё]*\s+смен/i;
const VOICE_ENHANCE = /voice\s+enhance|enhance\s+(?:the\s+)?voice|улучш[а-яё]*\s+голос|обработ[а-яё]*\s+голос|чист[а-яё]*\s+голос/i;
const VOICE_DEEPER = /deeper\s+voice|lower\s+(?:the\s+)?voice|голос[а-яё]*\s+(?:ниже|глубже)|низк[а-яё]*\s+голос/i;
const VOICE_BRIGHTER = /brighter\s+voice|higher\s+(?:the\s+)?voice|голос[а-яё]*\s+(?:выше|ярче)|высок[а-яё]*\s+голос/i;
const NOISE_REDUCTION = /noise\s+reduction|remove\s+(?:the\s+)?noise|убер[а-яё]*\s+(?:шум|шипен)|подав[а-яё]*\s+шум|шумоподав/i;
const NORMALIZE_LOUDNESS = /normalize\s+(?:the\s+)?(?:voice|audio|loudness)|нормализ[а-яё]*\s+(?:голос|звук|громкост)|выровн[а-яё]*\s+громкост/i;
const STOP_WORDS = new Set(["this", "that", "with", "when", "then", "into", "from", "have", "will", "чтобы", "когда", "потом", "между", "моих", "этот", "эту", "картинку", "изображение", "вставь", "поставь", "добавь"]);

function normalizedWords(value: string): string[] {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/giu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function imageInstruction(options: AutomaticEditOptions): string {
  return [...(options.keepInstructions ?? []), ...(options.removeInstructions ?? [])].join(" ").trim();
}

function findTranscriptAnchor(instruction: string, transcripts: TranscriptV1[]): TranscriptAnchor | undefined {
  const instructionWords = new Set(normalizedWords(instruction));
  if (instructionWords.size === 0) return undefined;
  const anchors = transcripts.flatMap((transcript) => transcript.segments.map((segment) => {
    const segmentWords = normalizedWords(segment.text);
    const overlapScore = segmentWords.reduce((score, word) => score + (instructionWords.has(word) ? 1 : 0), 0);
    const semanticBoost = /link|description|below|ссылк|описан|вниз|ниже/i.test(segment.text) ? 2 : 0;
    return {
      sourceId: transcript.sourceId,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      score: overlapScore + semanticBoost,
    };
  }));
  const best = anchors.sort((left, right) => right.score - left.score || left.start - right.start)[0];
  return best && best.score > 0 ? best : undefined;
}

function selectInstructionImages(images: SourceRecord[], instruction: string): SourceRecord[] {
  if (images.length <= 1) return images;
  const normalizedInstruction = instruction.toLocaleLowerCase("ru-RU");
  const mentioned = images.filter((source) => {
    const stem = parse(basename(source.relativePath)).name.toLocaleLowerCase("ru-RU");
    const meaningful = normalizedWords(stem);
    return normalizedInstruction.includes(stem) || meaningful.some((word) => normalizedInstruction.includes(word));
  });
  return (mentioned.length > 0 ? mentioned : [...images].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "ru"))).slice(0, 1);
}

function imageTransformForInstruction(instruction: string): EditClipV1["transform"] {
  if (FULLSCREEN_PLACEMENT.test(instruction)) return defaultTransform();
  if (HAND_PLACEMENT.test(instruction) || DOWN_PLACEMENT.test(instruction)) {
    return { scale: 0.34, positionX: 0, positionY: -140, rotation: 0, opacity: 1 };
  }
  if (/left|слева/i.test(instruction)) return { scale: 0.38, positionX: -420, positionY: 0, rotation: 0, opacity: 1 };
  if (/right|справа/i.test(instruction)) return { scale: 0.38, positionX: 420, positionY: 0, rotation: 0, opacity: 1 };
  return { scale: 0.42, positionX: 0, positionY: 0, rotation: 0, opacity: 1 };
}

function explicitGainDb(instruction: string): number | undefined {
  const match = /([+-]?\d+(?:[.,]\d+)?)\s*(?:db|дб)(?=\s|$|[,.!?;:])/i.exec(instruction);
  if (match?.[1]) return Math.max(-24, Math.min(12, Number(match[1].replace(",", "."))));
  if (/louder|increase\s+(?:the\s+)?volume|громче|увелич[а-яё]*\s+громкост/i.test(instruction)) return 3;
  if (/quieter|lower\s+(?:the\s+)?volume|тише|уменьш[а-яё]*\s+громкост/i.test(instruction)) return -3;
  return undefined;
}

function explicitPitchSemitones(instruction: string): number | undefined {
  const match = /([+-]?\d+(?:[.,]\d+)?)\s*(?:semitones?|полутон[а-яё]*)/i.exec(instruction);
  if (match?.[1]) return Math.max(-4, Math.min(4, Number(match[1].replace(",", "."))));
  if (VOICE_DEEPER.test(instruction)) return -2;
  if (VOICE_BRIGHTER.test(instruction)) return 2;
  return undefined;
}

function targetedPrimaryClips(instruction: string, transcripts: TranscriptV1[], primaryClips: EditClipV1[]): EditClipV1[] {
  const quoted = [...instruction.matchAll(/[«“"]([^»”"]{3,})[»”"]/g)].map((match) => match[1]!).join(" ");
  if (!quoted || !/(?:when|while|at\s+the\s+words?|когда|на\s+фраз)/i.test(instruction)) return primaryClips;
  const anchor = findTranscriptAnchor(quoted, transcripts);
  if (!anchor) return primaryClips;
  const selected = primaryClips.filter((clip) =>
    clip.sourceId === anchor.sourceId && anchor.start < clip.sourceEnd && anchor.end > clip.sourceStart,
  );
  return selected.length > 0 ? selected : primaryClips;
}

function applyPromptAudioAndVideoEffects(instruction: string, transcripts: TranscriptV1[], primaryClips: EditClipV1[]): string[] {
  if (!instruction) return [];
  const targets = targetedPrimaryClips(instruction, transcripts, primaryClips);
  const gainDb = explicitGainDb(instruction);
  const pitchSemitones = explicitPitchSemitones(instruction);
  const notes: string[] = [];
  for (const clip of targets) {
    if (MONOCHROME_EFFECT.test(instruction)) clip.effect = "monochrome";
    if (!clip.audio.enabled) continue;
    if (gainDb !== undefined) clip.audio.gainDb = gainDb;
    if (VOICE_ENHANCE.test(instruction)) clip.audio.eqMode = "voice_enhance";
    if (VOICE_DEEPER.test(instruction)) clip.audio.eqMode = "bass_boost";
    if (VOICE_BRIGHTER.test(instruction)) clip.audio.eqMode = "treble_boost";
    if (NOISE_REDUCTION.test(instruction)) clip.audio.noiseReductionAmount = 35;
    if (NORMALIZE_LOUDNESS.test(instruction)) clip.audio.loudness = { amount: 6, uniformity: 0.5 };
    if (pitchSemitones !== undefined) clip.audio.pitchSemitones = pitchSemitones;
  }
  if (MONOCHROME_EFFECT.test(instruction)) notes.push(`Applied monochrome to ${targets.length} prompt-targeted clip(s)`);
  if (gainDb !== undefined) notes.push(`Set prompt-targeted voice gain to ${gainDb >= 0 ? "+" : ""}${gainDb} dB`);
  if (VOICE_ENHANCE.test(instruction) || VOICE_DEEPER.test(instruction) || VOICE_BRIGHTER.test(instruction)) notes.push("Applied prompt-directed voice EQ");
  if (pitchSemitones !== undefined) notes.push(`Applied prompt-directed pitch shift of ${pitchSemitones} semitone(s)`);
  if (NOISE_REDUCTION.test(instruction)) notes.push("Applied 35% dialogue noise reduction");
  if (NORMALIZE_LOUDNESS.test(instruction)) notes.push("Applied dialogue loudness normalization");
  return notes;
}

function applySmartTransitions(
  instruction: string,
  primaryClips: EditClipV1[],
  pacing: AutomaticEditOptions["pacing"],
  sources: Map<string, SourceRecord>,
): string[] {
  if (NO_TRANSITIONS.test(instruction)) return ["Prompt disabled automatic transitions"];
  const explicit = EXPLICIT_SMOOTH_TRANSITIONS.test(instruction);
  let count = 0;
  for (let index = 1; index < primaryClips.length; index += 1) {
    const previous = primaryClips[index - 1]!;
    const current = primaryClips[index]!;
    const sameContinuousTake = previous.sourceId === current.sourceId && Math.abs(current.sourceStart - previous.sourceEnd) <= 0.18;
    const abrupt = !sameContinuousTake;
    if (!abrupt && !explicit) continue;
    const previousHandle = Math.max(0, (sources.get(previous.sourceId)?.durationSeconds ?? previous.sourceEnd) - previous.sourceEnd);
    const currentHandle = Math.max(0, current.sourceStart);
    const desired = pacing === "fast" ? 0.12 : pacing === "slow" ? 0.4 : explicit ? 0.3 : 0.2;
    const duration = Math.min(desired, currentHandle, previousHandle);
    if (!Number.isFinite(duration) || duration < 0.08) continue;
    current.transitionIn = { type: "cross_dissolve", durationSeconds: duration };
    count += 1;
  }
  return [count > 0
    ? `Inserted ${count} handle-safe cross dissolve transition(s) at abrupt cuts`
    : "No abrupt cut had enough media handles for a safe transition"];
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
    transitionIn: null,
    transitionOut: null,
  };
}

function imageTimelineWindow(anchor: TranscriptAnchor | undefined, primaryClips: EditClipV1[], timelineDuration: number): TimeRange {
  if (anchor) {
    const primary = primaryClips.find((clip) =>
      clip.sourceId === anchor.sourceId
      && anchor.start < clip.sourceEnd
      && anchor.end > clip.sourceStart,
    );
    if (primary) {
      const sourceStart = Math.max(primary.sourceStart, anchor.start);
      const timelineStart = primary.timelineStart + (sourceStart - primary.sourceStart) / primary.speed;
      const available = Math.max(0, primary.timelineEnd - timelineStart);
      const duration = Math.min(3, Math.max(0.75, anchor.end - anchor.start + 0.8), available);
      if (duration >= 0.5) return { start: timelineStart, end: timelineStart + duration };
    }
  }
  const start = Math.max(0, Math.min(5, timelineDuration - 0.75));
  return { start, end: Math.min(timelineDuration, start + 3) };
}

export function buildAutomaticEditPlan(
  projectId: string,
  manifest: SourceManifest,
  analyses: SourceAnalysis[],
  transcripts: TranscriptV1[],
  options: AutomaticEditOptions,
): EditPlanV1 {
  const sourceAnalyses = new Map(analyses.map((analysis) => [analysis.sourceId, analysis]));
  const instruction = imageInstruction(options);
  const images = manifest.entries.filter((source) => source.kind === "image");
  const requestedImages = IMAGE_REQUEST.test(instruction) ? selectInstructionImages(images, instruction) : [];
  const transcriptAnchor = requestedImages.length > 0 ? findTranscriptAnchor(instruction, transcripts) : undefined;
  const effectiveOptions: AutomaticEditOptions = transcriptAnchor
    ? {
        ...options,
        protectedSegments: [
          ...(options.protectedSegments ?? []),
          { sourceId: transcriptAnchor.sourceId, start: transcriptAnchor.start, end: transcriptAnchor.end },
        ],
      }
    : options;
  const spoken = manifest.entries.filter((source) => source.kind === "video" && source.audioStreams.length > 0 && source.durationSeconds > 0);
  const primarySources = spoken.length > 0 ? spoken : manifest.entries.filter((source) => source.kind === "video" && source.durationSeconds > 0).slice(0, 1);
  if (primarySources.length === 0) throw new Error("No video source is available for the primary timeline");

  const allCandidates = primarySources.flatMap((source) => buildCandidates(source, sourceAnalyses.get(source.id), transcriptFor(source.id, transcripts), effectiveOptions));
  const candidates = selectForTarget(allCandidates, effectiveOptions.targetDurationSeconds);
  if (candidates.length === 0) throw new Error("Automatic editing rejected every source range; adjust banned/protected segments or aggressiveness");

  const primaryTrackId = "track_primary_video";
  let timelineCursor = 0;
  const primaryClips = candidates.map((candidate) => {
    const clip = makeClip(candidate.source, candidate.start, candidate.end, timelineCursor, primaryTrackId, candidate.source.audioStreams.length > 0);
    timelineCursor = clip.timelineEnd;
    return clip;
  });
  const promptEffectRationale = applyPromptAudioAndVideoEffects(instruction, transcripts, primaryClips);
  const transitionRationale = applySmartTransitions(instruction, primaryClips, options.pacing, new Map(manifest.entries.map((source) => [source.id, source])));
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

  if (requestedImages.length > 0) {
    const trackId = "track_images";
    const clips: EditClipV1[] = [];
    for (const source of requestedImages) {
      const window = imageTimelineWindow(transcriptAnchor, primaryClips, timelineCursor);
      const duration = window.end - window.start;
      if (duration < 0.5) continue;
      const imageSource = { ...source, durationSeconds: Math.max(source.durationSeconds, duration) };
      const clip = makeClip(imageSource, 0, duration, window.start, trackId, false);
      clip.transform = imageTransformForInstruction(instruction);
      clip.transitionIn = null;
      clip.transitionOut = null;
      clips.push(clip);
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
    tracks.some((track) => track.kind === "images")
      ? `Placed the requested image near transcript cue "${transcriptAnchor?.text ?? "fallback timeline position"}" with prompt-directed transform`
      : "No prompt-directed image overlay was requested",
    ...transitionRationale,
    ...promptEffectRationale,
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
