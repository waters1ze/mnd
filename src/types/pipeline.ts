// src/types/pipeline.ts

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

export interface ProjectState {
  projectSlug: string;
  lastCompletedStep: PipelineStep | null;
  editPlan: EditPlan | null;
  stepOutputs: Record<string, unknown>; // cached raw outputs per step
  errors: Array<{ step: string; message: string; at: string }>;
}
