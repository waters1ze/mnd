// src/types/pipeline.ts

export type SourceManifestEntry = {
  sourceId: string;
  canonicalRelativePath: string;
  algorithm: "sha256" | "md5";
  hash: string;
  size: number | null;
  mtime: string | null;
};

export interface TranscriptSegment {
  start: number; // seconds from start
  end: number;   // seconds from start
  text: string;
}

export interface Cut {
  id: string;
  startSec: number;
  endSec: number;
  reason: "pause" | "filler_word" | "manual";
}

export interface Overlay {
  id: string;
  type: "broll" | "subtitle" | "text" | "zoom";
  startSec: number;
  endSec: number;
  assetId?: string;  // for broll — reference to Assets/
  text?: string;     // for subtitle/text
  zoomRect?: { x: number; y: number; w: number; h: number }; // for zoom
}

export interface EditPlan {
  projectSlug: string;
  sourceVideoPath: string;
  transcript: TranscriptSegment[];
  cuts: Cut[];
  overlays: Overlay[];
  audioTrack: {
    musicAssetId: string | null;
    syncToBeat: boolean;
  };
  createdAt: string;
  version: number; // incremented on each prompt/fix
}

export interface KeyframeCandidate {
  atSec: number;
  thumbnailPath: string;
}

export interface FrameTag {
  atSec: number;
  tags: string[];
  description: string;
}

export type PipelineStep =
  | "transcribe"
  | "pauses"
  | "keyframes"
  | "vision"
  | "rules"
  | "plan"
  | "exported";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale";

export interface StepRecord {
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  durationMs?: number;
  attempts: number;
  inputFingerprint?: string;
  cacheKey?: string;
  outputPaths: string[];
  provider?: string;
  model?: string;
  toolVersion?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface ProjectState {
  version: number;
  projectSlug: string;
  runId: string | null;
  sourceManifest: Record<string, SourceManifestEntry | string>; // legacy is string, new is object
  activeProfile: string;
  createdAt: string;
  updatedAt: string;
  lastCompletedStep: PipelineStep | null;
  cancellationState: "none" | "requested" | "force";
  steps: Partial<Record<PipelineStep, StepRecord>>;
  
  // Legacy or simplified data structures that we might migrate inside steps
  editPlan: EditPlan | null;
  stepOutputs: Record<string, unknown>;
}
