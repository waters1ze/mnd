// src/pipeline/buildEditPlan.ts
import { randomUUID } from "node:crypto";
import { groqChatWithFallback, type ChatMessage } from "../core/groqClient.js";
import {
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
  saveProjectState,
} from "../core/projectState.js";
import type { EditPlan, TranscriptSegment, Cut, ProjectState } from "../types/pipeline.js";
import type { MatchedContext } from "./matchStyleRules.js";
import { getMediaDuration } from "../core/ffprobe.js";

const SYSTEM_PROMPT = `You are an expert video editor assistant. Given a transcript, frame analysis, style guide, and editing rules, produce an EditPlan JSON object.

The EditPlan must follow this exact schema:
{
  "cuts": [{ "id": "string", "startSec": number, "endSec": number, "reason": "pause|filler_word|manual" }],
  "overlays": [{ "id": "string", "type": "broll|subtitle|text|zoom", "startSec": number, "endSec": number, "assetId": "string|null", "text": "string|null" }],
  "audioTrack": { "musicAssetId": null, "syncToBeat": false }
}

Rules:
- All times are in seconds (floating point), not timecode strings
- Cuts remove unwanted segments (pauses, fillers, mistakes)
- Overlays add elements on top of the video
- Return ONLY valid JSON, no markdown, no explanation`;

function buildUserPrompt(
  ctx: MatchedContext,
  existingCuts: Cut[],
  transcript: TranscriptSegment[],
  slug: string,
  videoPath: string
): string {
  const rulesText = ctx.applicableRules
    .map((r) => `[${r.category}] ${r.body}`)
    .join("\n\n");

  return `PROJECT: ${slug}
VIDEO: ${videoPath}

STYLE GUIDE (${ctx.styleFrontmatter.id}):
${ctx.styleBody}

GLOBAL RULES:
${rulesText}

TRANSCRIPT:
${ctx.transcriptSummary}

FRAME ANALYSIS:
${ctx.frameSummary}

PRE-DETECTED CUTS (already found pauses/fillers — include these and add any additional cuts):
${JSON.stringify(existingCuts, null, 2)}

Produce the EditPlan JSON:`;
}

function parseEditPlanResponse(raw: string): Partial<EditPlan> {
  // Strip markdown code fences if present
  const stripped = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in LLM response");
  return JSON.parse(jsonMatch[0]) as Partial<EditPlan>;
}

export async function buildEditPlanStep(
  slug: string,
  videoPath: string,
  transcript: TranscriptSegment[],
  existingCuts: Cut[],
  ctx: MatchedContext,
  state: ProjectState,
  vaultPath: string,
  version = 1
): Promise<EditPlan> {
  if (isStepDone(state, "plan") && state.editPlan) {
    const cached = getCachedStepOutput<EditPlan>(state, "plan");
    if (cached) return cached;
    return state.editPlan;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildUserPrompt(ctx, existingCuts, transcript, slug, videoPath),
    },
  ];

  let parsed: Partial<EditPlan> | null = null;
  let lastError: unknown;

  // Retry up to 3 times if JSON is invalid
  for (let attempt = 0; attempt < 3; attempt++) {
    const { result } = await groqChatWithFallback(messages, "buildEditPlan", true);
    try {
      parsed = parseEditPlanResponse(result);
      break;
    } catch (err) {
      lastError = err;
      messages.push(
        { role: "assistant", content: result },
        {
          role: "user",
          content: `Invalid JSON. Error: ${err instanceof Error ? err.message : err}. Please return only valid JSON.`,
        }
      );
    }
  }

  if (!parsed) throw new Error(`Failed to parse EditPlan after 3 attempts: ${lastError}`);

  const editPlan: EditPlan = {
    projectSlug: slug,
    sourceVideoPath: videoPath,
    transcript,
    cuts: (parsed.cuts ?? existingCuts).map((c) => ({
      ...c,
      id: c.id ?? randomUUID(),
    })),
    overlays: (parsed.overlays ?? []).map((o) => ({
      ...o,
      id: o.id ?? randomUUID(),
    })),
    audioTrack: parsed.audioTrack ?? { musicAssetId: null, syncToBeat: false },
    createdAt: new Date().toISOString(),
    version,
  };

  const duration = await getMediaDuration(videoPath);
  
  // Validate cuts
  for (const cut of editPlan.cuts) {
    if (!Number.isFinite(cut.startSec) || !Number.isFinite(cut.endSec)) {
      throw new Error(`Invalid cut ${cut.id}: start or end is not a finite number`);
    }
    if (cut.startSec < 0 || cut.endSec < 0) {
      throw new Error(`Invalid cut ${cut.id}: negative duration or start time`);
    }
    if (cut.startSec >= cut.endSec) {
      throw new Error(`Invalid cut ${cut.id}: zero or reversed duration (${cut.startSec} to ${cut.endSec})`);
    }
    if (duration === null) {
      throw new Error(`Invalid cut ${cut.id}: source duration cannot be determined for bounds verification`);
    }
    if (cut.endSec > duration) {
      throw new Error(`Invalid cut ${cut.id}: ends beyond source duration (${cut.endSec} > ${duration})`);
    }
    if (!["pause", "filler_word", "manual"].includes(cut.reason)) {
      throw new Error(`Invalid cut ${cut.id}: unsupported reason ${cut.reason}`);
    }
  }

  // Validate overlays
  const validTypes = ["broll", "subtitle", "text", "zoom"];
  for (const overlay of editPlan.overlays) {
    if (!Number.isFinite(overlay.startSec) || !Number.isFinite(overlay.endSec)) {
      throw new Error(`Invalid overlay ${overlay.id}: start or end is not a finite number`);
    }
    if (overlay.startSec < 0 || overlay.endSec < 0) {
      throw new Error(`Invalid overlay ${overlay.id}: negative duration or start time`);
    }
    if (overlay.startSec >= overlay.endSec) {
      throw new Error(`Invalid overlay ${overlay.id}: zero or reversed duration (${overlay.startSec} to ${overlay.endSec})`);
    }
    if (duration === null) {
      throw new Error(`Invalid overlay ${overlay.id}: source duration cannot be determined for bounds verification`);
    }
    if (overlay.endSec > duration) {
      throw new Error(`Invalid overlay ${overlay.id}: ends beyond source duration (${overlay.endSec} > ${duration})`);
    }
    if (!validTypes.includes(overlay.type)) {
      throw new Error(`Invalid overlay ${overlay.id}: unsupported type ${overlay.type}`);
    }
    if (overlay.type === "broll" && (!overlay.assetId || !state.sourceManifest?.[overlay.assetId])) {
      throw new Error(`Invalid overlay ${overlay.id}: referenced source/asset ID is unknown`);
    }
    if ((overlay.type === "subtitle" || overlay.type === "text") && !overlay.text) {
      throw new Error(`Invalid overlay ${overlay.id}: missing required text content`);
    }
  }
  
  if (editPlan.audioTrack) {
    if (editPlan.audioTrack.musicAssetId && !state.sourceManifest?.[editPlan.audioTrack.musicAssetId]) {
      throw new Error(`Invalid audio track: referenced source/asset ID ${editPlan.audioTrack.musicAssetId} is unknown`);
    }
  }

  // Validate overlap policy for overlays
  const overlaysByType = new Map<string, typeof editPlan.overlays>();
  for (const overlay of editPlan.overlays) {
    const arr = overlaysByType.get(overlay.type) || [];
    arr.push(overlay);
    overlaysByType.set(overlay.type, arr);
  }
  for (const [type, arr] of overlaysByType.entries()) {
    arr.sort((a, b) => a.startSec - b.startSec);
    for (let i = 0; i < arr.length - 1; i++) {
      const current = arr[i];
      const next = arr[i+1];
      if (current && next && current.endSec > next.startSec) {
        throw new Error(`Invalid overlay overlap for type ${type}: ${current.id} overlaps with ${next.id}`);
      }
    }
  }

  state.editPlan = editPlan;
  cacheStepOutput(state, "plan", editPlan);
  markStepDone(state, "plan");
  await saveProjectState(vaultPath, state);
  return editPlan;
}
