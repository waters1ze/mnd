export interface Rational {
  numerator: number;
  denominator: number;
}

export interface MediaStream {
  index: number;
  codec: string;
  codecLongName?: string;
  profile?: string;
  timeBase?: string;
  durationSeconds?: number;
  bitRate?: number;
  width?: number;
  height?: number;
  fps?: Rational;
  pixelFormat?: string;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  tags?: Record<string, string>;
}

export type MediaKind = "video" | "audio" | "image" | "subtitle" | "document" | "unknown";

export interface SourceRecord {
  id: string;
  relativePath: string;
  canonicalPath: string;
  sha256: string;
  size: number;
  mtime: string;
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
}

export interface SourceManifest {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  entries: SourceRecord[];
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: string;
}

export interface TranscriptSegmentV1 {
  id: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  confidence?: number;
  speaker?: string;
}

export interface TranscriptV1 {
  schemaVersion: 1;
  sourceId: string;
  sourceHash: string;
  language: string;
  provider: string;
  model: string;
  segments: TranscriptSegmentV1[];
  generatedAt: string;
}

export type OperationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "action_required";

export interface OperationRecord {
  id: string;
  kind: string;
  sourceId?: string;
  status: OperationStatus;
  inputFingerprint: string;
  startedAt?: string;
  completedAt?: string;
  outputPaths: string[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface AnalysisDiagnostic extends TimeRange {
  type: "black" | "silence" | "loudness" | "low_quality" | "duplicate";
  severity: "info" | "warning" | "error";
  message: string;
  value?: number;
}

export interface SceneV1 {
  id: string;
  sourceId: string;
  sourceStart: number;
  sourceEnd: number;
  description: string;
  transcriptReferences: string[];
  visualQuality: number;
  audioQuality: number;
  tags: string[];
  people: string[];
  objects: string[];
  suggestedRole: "primary" | "broll" | "intro" | "outro" | "reject";
  keepScore: number;
  rejectScore: number;
  diagnostics: AnalysisDiagnostic[];
}

export interface SourceAnalysis {
  schemaVersion: 1;
  sourceId: string;
  sourceHash: string;
  parametersHash: string;
  scenes: SceneV1[];
  diagnostics: AnalysisDiagnostic[];
  highlights: TimeRange[];
  brollOpportunities: TimeRange[];
  loudness?: { integratedLufs?: number; truePeakDb?: number; loudnessRange?: number };
  generatedAt: string;
}

export type TrackKind =
  | "primary_video"
  | "broll"
  | "images"
  | "overlays"
  | "titles"
  | "voice"
  | "music"
  | "sound_effects"
  | "subtitles";

export interface EditTransform {
  scale: number;
  positionX: number;
  positionY: number;
  rotation: number;
  opacity: number;
}

export interface EditAudio {
  enabled: boolean;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  duckUnderVoice: boolean;
  eqMode?: "flat" | "voice_enhance" | "music_enhance" | "loudness" | "hum_reduction" | "bass_boost" | "bass_reduce" | "treble_boost" | "treble_reduce";
  noiseReductionAmount?: number;
  loudness?: { amount: number; uniformity: number };
  pitchSemitones?: number;
}

export interface EditTransition {
  type: "cross_dissolve";
  durationSeconds: number;
}

export interface EditClipV1 {
  id: string;
  sourceId: string;
  sourceHash: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  timelineEnd: number;
  trackId: string;
  enabled: boolean;
  speed: number;
  transform: EditTransform;
  audio: EditAudio;
  transitionIn: EditTransition | null;
  transitionOut: EditTransition | null;
  effect?: string;
  assetId?: string;
}

export interface EditTrackV1 {
  id: string;
  kind: TrackKind;
  name: string;
  exclusive: boolean;
  clips: EditClipV1[];
}

export interface SubtitleCue extends TimeRange {
  id: string;
  text: string;
  speaker?: string;
}

export type EditProfile =
  | "vlog"
  | "talking_head"
  | "tutorial"
  | "interview"
  | "short_vertical"
  | "documentary"
  | "cinematic"
  | "custom";

export interface EditPlanV1 {
  schemaVersion: 1;
  projectId: string;
  profile: EditProfile;
  timeline: {
    name: string;
    resolution: { width: number; height: number };
    fps: Rational;
    audioSampleRate: number;
  };
  tracks: EditTrackV1[];
  markers: Array<{ id: string; at: number; name: string; note?: string }>;
  subtitles: SubtitleCue[];
  assets: Array<{ id: string; sourceId?: string; relativePath: string; kind: string }>;
  rationale: string[];
  warnings: string[];
  sourceManifestHash: string;
  createdAt: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface EditPlanValidationReport {
  valid: boolean;
  checkedAt: string;
  issues: ValidationIssue[];
}

export interface CompiledClip extends EditClipV1 {
  sourceStartFrames: number;
  sourceDurationFrames: number;
  timelineStartFrames: number;
  timelineDurationFrames: number;
  lane: number;
}

export interface CompiledTimelineV1 {
  schemaVersion: 1;
  projectId: string;
  name: string;
  resolution: { width: number; height: number };
  fps: Rational;
  frameDuration: Rational;
  audioSampleRate: number;
  durationFrames: number;
  tracks: Array<Omit<EditTrackV1, "clips"> & { lane: number; clips: CompiledClip[] }>;
  subtitles: Array<SubtitleCue & { startFrames: number; durationFrames: number }>;
  markers: EditPlanV1["markers"];
  sourceManifestHash: string;
  warnings: string[];
}

export interface ProjectFileV1 {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  style: string;
  editProfile: EditProfile;
  createdAt: string;
  updatedAt: string;
}
