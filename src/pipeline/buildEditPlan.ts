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

  state.editPlan = editPlan;
  cacheStepOutput(state, "plan", editPlan);
  markStepDone(state, "plan");
  await saveProjectState(vaultPath, state);
  return editPlan;
}
