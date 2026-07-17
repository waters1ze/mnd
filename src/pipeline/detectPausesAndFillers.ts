// src/pipeline/detectPausesAndFillers.ts
import { randomUUID } from "node:crypto";
import {
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
  saveProjectState,
} from "../core/projectState.js";
import type { TranscriptSegment, Cut, ProjectState } from "../types/pipeline.js";

// Default filler words (Russian + English common fillers)
const DEFAULT_FILLERS = [
  "ага", "эм", "э", "короче", "ну", "значит", "вот", "типа", "как бы",
  "собственно", "соответственно", "в общем", "то есть",
  "um", "uh", "like", "you know", "basically", "right",
];

const DEFAULT_PAUSE_THRESHOLD_SEC = 0.5;

export interface PauseDetectionOptions {
  pauseThresholdSec?: number;
  fillerWords?: string[];
}

export async function detectPausesAndFillers(
  segments: TranscriptSegment[],
  state: ProjectState,
  vaultPath: string,
  opts: PauseDetectionOptions = {}
): Promise<Cut[]> {
  if (isStepDone(state, "pauses")) {
    const cached = getCachedStepOutput<Cut[]>(state, "pauses");
    if (cached) return cached;
  }

  const threshold = opts.pauseThresholdSec ?? DEFAULT_PAUSE_THRESHOLD_SEC;
  const fillers = (opts.fillerWords ?? DEFAULT_FILLERS).map((f) => f.toLowerCase());

  const cuts: Cut[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    // Detect pause: gap between end of previous segment and start of this one
    if (i > 0) {
      const prev = segments[i - 1]!;
      const gap = seg.start - prev.end;
      if (gap > threshold) {
        cuts.push({
          id: randomUUID(),
          startSec: prev.end,
          endSec: seg.start,
          reason: "pause",
        });
      }
    }

    // Detect filler words in segment text
    const text = seg.text.toLowerCase().trim();
    const isFiller = fillers.some((f) => {
      // Match exact word or segment is entirely filler
      return (
        text === f ||
        text.startsWith(f + " ") ||
        text.endsWith(" " + f) ||
        text.includes(" " + f + " ")
      );
    });

    if (isFiller) {
      cuts.push({
        id: randomUUID(),
        startSec: seg.start,
        endSec: seg.end,
        reason: "filler_word",
      });
    }
  }

  cacheStepOutput(state, "pauses", cuts);
  markStepDone(state, "pauses");
  await saveProjectState(vaultPath, state);
  return cuts;
}
