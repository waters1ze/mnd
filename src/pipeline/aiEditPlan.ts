import { groqChatWithFallback, type ChatMessage } from "../core/groqClient.js";
import type { EditPlanV1, SourceAnalysis, SourceManifest, TranscriptV1 } from "../types/production.js";
import { validateEditPlan } from "./editPlanValidator.js";

function extractJson(raw: string): unknown {
  const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI response does not contain a JSON object");
  return JSON.parse(stripped.slice(first, last + 1));
}

export interface AiEditContext {
  instructions: string[];
  styleRules: string[];
}

export async function refineEditPlanWithAi(
  baseline: EditPlanV1,
  manifest: SourceManifest,
  analyses: SourceAnalysis[],
  transcripts: TranscriptV1[],
  projectRoot: string,
  context: AiEditContext,
): Promise<EditPlanV1> {
  const sourceSummary = manifest.entries.map((source) => ({
    id: source.id,
    hash: source.sha256,
    kind: source.kind,
    durationSeconds: source.durationSeconds,
    width: source.width,
    height: source.height,
    fps: source.fps,
  }));
  const sceneSummary = analyses.flatMap((analysis) => analysis.scenes.map((scene) => ({
    id: scene.id,
    sourceId: scene.sourceId,
    sourceStart: scene.sourceStart,
    sourceEnd: scene.sourceEnd,
    description: scene.description,
    keepScore: scene.keepScore,
    suggestedRole: scene.suggestedRole,
    diagnostics: scene.diagnostics.map((item) => item.type),
  })));
  const transcriptSummary = transcripts.map((transcript) => ({
    sourceId: transcript.sourceId,
    language: transcript.language,
    segments: transcript.segments.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end, text: segment.text, speaker: segment.speaker })),
  }));

  const system = `You are MND's edit planner. Return exactly one EditPlanV1 JSON object and no prose.
You may only select source IDs and hashes present in SOURCES. Never output commands, executable text, filesystem paths, URLs, or new media identities.
Preserve schemaVersion=1, projectId, sourceManifestHash, the complete timeline object, and every required clip field.
All times are finite seconds. Every source range must satisfy 0 <= start < end <= source duration. timelineEnd-timelineStart must equal (sourceEnd-sourceStart)/speed.
primary_video, images, broll, voice and music tracks are exclusive. Do not overlap clips within an exclusive track.
Keep speech coherent, avoid cutting words, remove sustained pauses and clear repeats, prefer higher-quality scenes, use B-roll sparingly, keep music below speech, and explain material decisions in rationale.
Supported effects are transform, opacity, crop, gain, ducking. Supported transitions are cross_dissolve, fade_to_color, audio_crossfade.`;
  const payload = {
    instructions: context.instructions,
    styleRules: context.styleRules,
    sources: sourceSummary,
    scenes: sceneSummary,
    transcripts: transcriptSummary,
    baseline,
  };
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
  let lastError = "AI did not return a valid plan";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { result } = await groqChatWithFallback(messages, "edit_plan", true);
    try {
      const candidate = extractJson(result) as EditPlanV1;
      const report = validateEditPlan(candidate, manifest, projectRoot);
      if (!report.valid) {
        lastError = report.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.code} ${issue.path}: ${issue.message}`).join("; ");
        throw new Error(lastError);
      }
      return candidate;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      messages.push(
        { role: "assistant", content: result },
        { role: "user", content: `The JSON was rejected by deterministic validation: ${lastError}. Return a corrected complete EditPlanV1 JSON object.` },
      );
    }
  }
  throw new Error(`AI edit plan failed validation after 3 attempts: ${lastError}`);
}
