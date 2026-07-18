import { isAbsolute, normalize, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import type {
  EditClipV1,
  EditPlanV1,
  EditPlanValidationReport,
  EditTrackV1,
  SourceManifest,
  SourceRecord,
  TrackKind,
  ValidationIssue,
} from "../types/production.js";
import { sourceManifestFingerprint } from "../core/sourceManifest.js";

const TRACK_KINDS = new Set<TrackKind>([
  "primary_video", "broll", "images", "overlays", "titles", "voice", "music",
  "sound_effects", "subtitles",
]);
const EFFECTS = new Set(["transform", "opacity", "crop", "gain", "ducking"]);
const TRANSITIONS = new Set(["cross_dissolve", "fade_to_color", "audio_crossfade"]);
const EDIT_PROFILES = new Set(["vlog", "talking_head", "tutorial", "interview", "short_vertical", "documentary", "cinematic", "custom"]);
const EXCLUSIVE_TRACK_KINDS = new Set<TrackKind>(["primary_video", "broll", "images", "voice", "music"]);

function add(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
  severity: "error" | "warning" = "error",
): void {
  issues.push({ code, severity, path, message });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateRange(
  issues: ValidationIssue[],
  path: string,
  start: unknown,
  end: unknown,
  maximum?: number,
): boolean {
  if (!finite(start) || !finite(end)) {
    add(issues, "NON_FINITE_TIME", path, "Time values must be finite numbers");
    return false;
  }
  if (start < 0 || end < 0) {
    add(issues, "NEGATIVE_TIME", path, "Time values cannot be negative");
    return false;
  }
  if (start >= end) {
    add(issues, "INVALID_RANGE", path, "Range must satisfy start < end");
    return false;
  }
  if (maximum !== undefined && end > maximum + 1e-9) {
    add(issues, "SOURCE_BOUNDS", path, `Range ends at ${end}s but source duration is ${maximum}s`);
    return false;
  }
  return true;
}

function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return false;
  const normalized = normalize(path).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

function within(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const left = process.platform === "win32" ? normalizedRoot.toLocaleLowerCase("en-US") : normalizedRoot;
  const right = process.platform === "win32" ? normalizedCandidate.toLocaleLowerCase("en-US") : normalizedCandidate;
  return right === left || right.startsWith(`${left}${sep}`);
}

function validateClip(
  issues: ValidationIssue[],
  path: string,
  clip: EditClipV1,
  track: EditTrackV1,
  sources: Map<string, SourceRecord>,
  assetIds: Set<string>,
): void {
  const source = sources.get(clip.sourceId);
  if (!source) {
    add(issues, "SOURCE_MISSING", `${path}.sourceId`, `Unknown source ${clip.sourceId}`);
    return;
  }
  if (clip.sourceHash !== source.sha256) {
    add(issues, "SOURCE_STALE", `${path}.sourceHash`, `Source hash no longer matches ${source.relativePath}`);
  }
  const sourceRangeValid = validateRange(issues, `${path}.sourceRange`, clip.sourceStart, clip.sourceEnd, source.durationSeconds || undefined);
  const timelineRangeValid = validateRange(issues, `${path}.timelineRange`, clip.timelineStart, clip.timelineEnd);
  if (clip.trackId !== track.id) add(issues, "TRACK_REFERENCE", `${path}.trackId`, "Clip trackId does not match its containing track");
  if (typeof clip.enabled !== "boolean") add(issues, "INVALID_ENABLED", `${path}.enabled`, "Clip enabled must be a boolean");
  if (!finite(clip.speed) || clip.speed <= 0 || clip.speed > 32) {
    add(issues, "INVALID_SPEED", `${path}.speed`, "Speed must be finite and in the range (0, 32]");
  } else if (sourceRangeValid && timelineRangeValid) {
    const expected = (clip.sourceEnd - clip.sourceStart) / clip.speed;
    const actual = clip.timelineEnd - clip.timelineStart;
    if (Math.abs(expected - actual) > 1 / 1000) {
      add(issues, "DURATION_MISMATCH", path, `Timeline duration ${actual}s does not match source duration at speed ${clip.speed}`);
    }
  }

  const transform = clip.transform;
  const transformValues = [transform?.scale, transform?.positionX, transform?.positionY, transform?.rotation, transform?.opacity];
  if (transformValues.some((value) => !finite(value))) {
    add(issues, "INVALID_TRANSFORM", `${path}.transform`, "Transform values must be finite numbers");
  } else if (transform.scale <= 0 || transform.opacity < 0 || transform.opacity > 1) {
    add(issues, "INVALID_TRANSFORM", `${path}.transform`, "Scale must be positive and opacity must be between 0 and 1");
  }

  const audio = clip.audio;
  const audioValues = [audio?.gainDb, audio?.fadeInSeconds, audio?.fadeOutSeconds];
  if (audioValues.some((value) => !finite(value)) || audio.fadeInSeconds < 0 || audio.fadeOutSeconds < 0) {
    add(issues, "INVALID_AUDIO", `${path}.audio`, "Audio gain and fades must be finite; fades cannot be negative");
  } else if (timelineRangeValid && audio.fadeInSeconds + audio.fadeOutSeconds > clip.timelineEnd - clip.timelineStart + 1e-9) {
    add(issues, "AUDIO_FADE_HANDLES", `${path}.audio`, "Combined audio fades exceed clip duration");
  }
  if (typeof audio?.enabled !== "boolean" || typeof audio?.duckUnderVoice !== "boolean") {
    add(issues, "INVALID_AUDIO", `${path}.audio`, "Audio enabled and duckUnderVoice must be booleans");
  }

  for (const [side, transition] of [["transitionIn", clip.transitionIn], ["transitionOut", clip.transitionOut]] as const) {
    if (!transition) continue;
    if (!TRANSITIONS.has(transition.type)) {
      add(issues, "UNSUPPORTED_TRANSITION", `${path}.${side}.type`, `Transition ${transition.type} is not supported`);
    }
    if (!finite(transition.durationSeconds) || transition.durationSeconds <= 0) {
      add(issues, "INVALID_TRANSITION", `${path}.${side}`, "Transition duration must be positive and finite");
      continue;
    }
    const handle = side === "transitionIn" ? clip.sourceStart : source.durationSeconds - clip.sourceEnd;
    if (transition.durationSeconds > handle + 1e-9) {
      add(issues, "TRANSITION_HANDLES", `${path}.${side}`, `Transition requires ${transition.durationSeconds}s but only ${Math.max(0, handle)}s is available`);
    }
  }

  if (clip.assetId && !assetIds.has(clip.assetId)) {
    add(issues, "ASSET_MISSING", `${path}.assetId`, `Unknown asset ${clip.assetId}`);
  }
  if (clip.effect && !EFFECTS.has(clip.effect)) {
    add(issues, "UNSUPPORTED_EFFECT", `${path}.effect`, `Effect ${clip.effect} is not supported by the Resolve exporter`);
  }
}

export function validateEditPlan(
  plan: EditPlanV1,
  manifest: SourceManifest,
  projectRoot: string,
): EditPlanValidationReport {
  const issues: ValidationIssue[] = [];
  if (!plan || typeof plan !== "object") {
    add(issues, "INVALID_PLAN", "$", "Edit plan must be an object");
    return { valid: false, checkedAt: new Date().toISOString(), issues };
  }
  if (plan.schemaVersion !== 1) add(issues, "SCHEMA_VERSION", "schemaVersion", "Only EditPlan schema version 1 is supported");
  if (!EDIT_PROFILES.has(plan.profile)) add(issues, "EDIT_PROFILE", "profile", `Unsupported edit profile ${plan.profile}`);
  if (plan.projectId !== manifest.projectId) add(issues, "PROJECT_ID", "projectId", "Edit plan belongs to a different project");
  const actualManifestHash = sourceManifestFingerprint(manifest);
  if (plan.sourceManifestHash !== actualManifestHash) {
    add(issues, "MANIFEST_STALE", "sourceManifestHash", "Edit plan was created from a different source manifest");
  }

  const timeline = plan.timeline;
  if (!timeline || typeof timeline !== "object") {
    add(issues, "INVALID_TIMELINE", "timeline", "Timeline must be an object");
  }
  const fps = timeline?.fps;
  if (typeof timeline?.name !== "string" || !timeline.name.trim()) {
    add(issues, "INVALID_TIMELINE_NAME", "timeline.name", "Timeline name must be a non-empty string");
  }
  if (!fps || !Number.isSafeInteger(fps.numerator) || !Number.isSafeInteger(fps.denominator) || fps.numerator <= 0 || fps.denominator <= 0) {
    add(issues, "AMBIGUOUS_FPS", "timeline.fps", "FPS must be a positive integer rational");
  }
  const resolution = timeline?.resolution;
  if (!resolution || !Number.isSafeInteger(resolution.width) || !Number.isSafeInteger(resolution.height) || resolution.width <= 0 || resolution.height <= 0) {
    add(issues, "INVALID_RESOLUTION", "timeline.resolution", "Resolution must contain positive integer dimensions");
  }
  if (!Number.isSafeInteger(timeline?.audioSampleRate) || (timeline?.audioSampleRate ?? 0) <= 0) {
    add(issues, "INVALID_SAMPLE_RATE", "timeline.audioSampleRate", "Audio sample rate must be a positive integer");
  }

  const sourceIds = new Set<string>();
  const sources = new Map<string, SourceRecord>();
  for (const source of manifest.entries) {
    if (sourceIds.has(source.id)) add(issues, "DUPLICATE_SOURCE_ID", "manifest", `Duplicate source ID ${source.id}`);
    sourceIds.add(source.id);
    sources.set(source.id, source);
    if (!within(projectRoot, source.canonicalPath)) {
      add(issues, "UNSAFE_SOURCE_PATH", "manifest", `Source escapes project boundary: ${source.relativePath}`);
    }
  }

  const assetIds = new Set<string>();
  const assets = Array.isArray(plan.assets) ? plan.assets : [];
  if (!Array.isArray(plan.assets)) add(issues, "INVALID_ASSETS", "assets", "Assets must be an array");
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]!;
    const path = `assets[${index}]`;
    if (!asset || typeof asset !== "object") {
      add(issues, "INVALID_ASSET", path, "Asset must be an object");
      continue;
    }
    if (!asset.id || assetIds.has(asset.id)) add(issues, "DUPLICATE_ASSET_ID", `${path}.id`, `Duplicate or empty asset ID ${asset.id}`);
    assetIds.add(asset.id);
    if (!isSafeRelativePath(asset.relativePath)) {
      add(issues, "UNSAFE_ASSET_PATH", `${path}.relativePath`, `Asset path must be project-relative: ${asset.relativePath}`);
    } else {
      const absolute = resolve(projectRoot, asset.relativePath);
      if (!within(projectRoot, absolute)) add(issues, "UNSAFE_ASSET_PATH", `${path}.relativePath`, "Asset escapes project boundary");
      else if (!existsSync(absolute)) add(issues, "ASSET_FILE_MISSING", `${path}.relativePath`, `Asset file does not exist: ${asset.relativePath}`);
    }
    if (asset.sourceId && !sources.has(asset.sourceId)) add(issues, "SOURCE_MISSING", `${path}.sourceId`, `Unknown source ${asset.sourceId}`);
  }

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  if (!Array.isArray(plan.tracks)) add(issues, "INVALID_TRACKS", "tracks", "Tracks must be an array");
  else if (tracks.length === 0) add(issues, "EMPTY_TIMELINE", "tracks", "Edit plan must contain at least one track");
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    const trackPath = `tracks[${trackIndex}]`;
    if (!track || typeof track !== "object") {
      add(issues, "INVALID_TRACK", trackPath, "Track must be an object");
      continue;
    }
    if (!track.id || trackIds.has(track.id)) add(issues, "DUPLICATE_TRACK_ID", `${trackPath}.id`, `Duplicate or empty track ID ${track.id}`);
    trackIds.add(track.id);
    if (!TRACK_KINDS.has(track.kind)) add(issues, "UNSUPPORTED_TRACK", `${trackPath}.kind`, `Unsupported track kind ${track.kind}`);
    if (typeof track.exclusive !== "boolean") add(issues, "INVALID_EXCLUSIVE", `${trackPath}.exclusive`, "Track exclusive must be a boolean");
    else if (EXCLUSIVE_TRACK_KINDS.has(track.kind) && !track.exclusive) add(issues, "EXCLUSIVE_TRACK_REQUIRED", `${trackPath}.exclusive`, `${track.kind} tracks must be exclusive`);
    const clips = Array.isArray(track.clips) ? track.clips : [];
    if (!Array.isArray(track.clips)) add(issues, "INVALID_CLIPS", `${trackPath}.clips`, "Track clips must be an array");
    for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
      const clip = clips[clipIndex]!;
      if (!clip || typeof clip !== "object") {
        add(issues, "INVALID_CLIP", `${trackPath}.clips[${clipIndex}]`, "Clip must be an object");
        continue;
      }
      if (!clip.id || clipIds.has(clip.id)) add(issues, "DUPLICATE_CLIP_ID", `${trackPath}.clips[${clipIndex}].id`, `Duplicate or empty clip ID ${clip.id}`);
      clipIds.add(clip.id);
      validateClip(issues, `${trackPath}.clips[${clipIndex}]`, clip, track, sources, assetIds);
    }
    if (track.exclusive) {
      const enabledClips = [...clips].filter((clip) => clip?.enabled).sort((a, b) => a.timelineStart - b.timelineStart || String(a.id).localeCompare(String(b.id)));
      for (let clipIndex = 1; clipIndex < enabledClips.length; clipIndex += 1) {
        const previous = enabledClips[clipIndex - 1]!;
        const current = enabledClips[clipIndex]!;
        if (previous.timelineEnd > current.timelineStart + 1e-9) {
          add(issues, "EXCLUSIVE_TRACK_OVERLAP", trackPath, `Clips ${previous.id} and ${current.id} overlap on exclusive track ${track.id}`);
        }
      }
    }
  }

  const subtitles = Array.isArray(plan.subtitles) ? plan.subtitles : [];
  if (!Array.isArray(plan.subtitles)) add(issues, "INVALID_SUBTITLES", "subtitles", "Subtitles must be an array");
  const subtitleIds = new Set<string>();
  for (let index = 0; index < subtitles.length; index += 1) {
    const cue = subtitles[index]!;
    if (!cue || typeof cue !== "object") {
      add(issues, "INVALID_SUBTITLE", `subtitles[${index}]`, "Subtitle must be an object");
      continue;
    }
    if (!cue.id || subtitleIds.has(cue.id)) add(issues, "DUPLICATE_SUBTITLE_ID", `subtitles[${index}].id`, `Duplicate or empty subtitle ID ${cue.id}`);
    subtitleIds.add(cue.id);
    validateRange(issues, `subtitles[${index}]`, cue.start, cue.end);
    if (typeof cue.text !== "string" || !cue.text.trim()) add(issues, "EMPTY_SUBTITLE", `subtitles[${index}].text`, "Subtitle text cannot be empty");
  }

  const markers = Array.isArray(plan.markers) ? plan.markers : [];
  if (!Array.isArray(plan.markers)) add(issues, "INVALID_MARKERS", "markers", "Markers must be an array");
  const markerIds = new Set<string>();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const path = `markers[${index}]`;
    if (!marker || typeof marker !== "object") {
      add(issues, "INVALID_MARKER", path, "Marker must be an object");
      continue;
    }
    if (!marker.id || markerIds.has(marker.id)) add(issues, "DUPLICATE_MARKER_ID", `${path}.id`, `Duplicate or empty marker ID ${marker.id}`);
    markerIds.add(marker.id);
    if (!finite(marker.at) || marker.at < 0) add(issues, "INVALID_MARKER_TIME", `${path}.at`, "Marker time must be a finite non-negative number");
    if (typeof marker.name !== "string" || !marker.name.trim()) add(issues, "INVALID_MARKER_NAME", `${path}.name`, "Marker name must be a non-empty string");
  }

  if (!Array.isArray(plan.rationale) || plan.rationale.some((item) => typeof item !== "string")) {
    add(issues, "INVALID_RATIONALE", "rationale", "Rationale must be an array of strings");
  }
  if (!Array.isArray(plan.warnings) || plan.warnings.some((item) => typeof item !== "string")) {
    add(issues, "INVALID_WARNINGS", "warnings", "Warnings must be an array of strings");
  }
  if (typeof plan.createdAt !== "string" || !Number.isFinite(Date.parse(plan.createdAt))) {
    add(issues, "INVALID_CREATED_AT", "createdAt", "createdAt must be an ISO-compatible timestamp");
  }

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    checkedAt: new Date().toISOString(),
    issues,
  };
}

export function assertValidEditPlan(plan: EditPlanV1, manifest: SourceManifest, projectRoot: string): EditPlanValidationReport {
  const report = validateEditPlan(plan, manifest, projectRoot);
  if (!report.valid) {
    const summary = report.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Edit plan validation failed:\n${summary}`);
  }
  return report;
}
