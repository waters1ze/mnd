import { groqChatWithFallback, type ChatMessage } from "../core/groqClient.js";
import { runAntigravityPrompt } from "../core/antigravityClient.js";
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
  provider?: "antigravity" | "groq";
  model?: string;
}

export function preservePromptedImageOverlays(candidate: EditPlanV1, baseline: EditPlanV1): EditPlanV1 {
  const required = baseline.tracks.filter((track) => track.kind === "images" && track.clips.length > 0);
  if (required.length === 0 || !Array.isArray(candidate.tracks)) return candidate;
  const baselinePrimaryClips = baseline.tracks
    .filter((track) => track.kind === "primary_video")
    .flatMap((track) => track.clips);
  const candidatePrimaryClips = candidate.tracks
    .filter((track) => track.kind === "primary_video")
    .flatMap((track) => track.clips)
    .sort((left, right) => left.timelineStart - right.timelineStart);
  if (baselinePrimaryClips.length === 0 || candidatePrimaryClips.length === 0) return baseline;

  const adapted = required.map((track) => {
    const clips = track.clips.flatMap((clip) => {
      const baselinePrimary = baselinePrimaryClips.find((primary) =>
        clip.timelineStart >= primary.timelineStart && clip.timelineStart < primary.timelineEnd,
      );
      if (!baselinePrimary) return [];
      const cueSourceTime = baselinePrimary.sourceStart
        + (clip.timelineStart - baselinePrimary.timelineStart) * baselinePrimary.speed;
      const candidatePrimary = candidatePrimaryClips.find((primary) =>
        primary.sourceId === baselinePrimary.sourceId
        && cueSourceTime >= primary.sourceStart
        && cueSourceTime < primary.sourceEnd,
      );
      if (!candidatePrimary) return [];
      const start = candidatePrimary.timelineStart
        + (cueSourceTime - candidatePrimary.sourceStart) / candidatePrimary.speed;
      const requestedDuration = clip.timelineEnd - clip.timelineStart;
      const safeDuration = Math.min(requestedDuration, candidatePrimary.timelineEnd - start);
      if (safeDuration < 0.5) return [];
      return [{
        ...clip,
        sourceStart: 0,
        sourceEnd: safeDuration,
        timelineStart: start,
        timelineEnd: start + safeDuration,
      }];
    });
    return { ...track, clips };
  }).filter((track) => track.clips.length > 0);
  const requiredClipCount = required.reduce((count, track) => count + track.clips.length, 0);
  const adaptedClipCount = adapted.reduce((count, track) => count + track.clips.length, 0);
  if (adaptedClipCount !== requiredClipCount) {
    return {
      ...baseline,
      rationale: [...baseline.rationale, "Kept the deterministic plan because the AI removed a requested image cue"],
    };
  }
  return {
    ...candidate,
    tracks: [...candidate.tracks.filter((track) => track.kind !== "images"), ...adapted],
    rationale: [...(Array.isArray(candidate.rationale) ? candidate.rationale : []), "Preserved prompt-directed image overlays from the deterministic plan"],
  };
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
    relativePath: source.relativePath,
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
All times are finite seconds. Every non-image source range must satisfy 0 <= start < end <= source duration. For still images, durationSeconds=0 means unbounded and sourceEnd equals the requested display duration. timelineEnd-timelineStart must equal (sourceEnd-sourceStart)/speed.
primary_video, images, broll, voice and music tracks are exclusive. Do not overlap clips within an exclusive track.
Keep speech coherent, avoid cutting words, remove sustained pauses and clear repeats, prefer higher-quality scenes, use B-roll sparingly, keep music below speech, and explain material decisions in rationale.
If the baseline contains an images track, it represents an explicit user request. Preserve its source, the matching spoken source range, transcript-aligned timing, scale and position. Image clips are connected visual overlays, not replacements for primary video.
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
    const result = context.provider === "antigravity"
      ? await runAntigravityPrompt(
          `${system}\n\nINPUT JSON:\n${JSON.stringify(payload)}${attempt > 0 ? `\n\nThe previous response failed deterministic validation: ${lastError}. Return a corrected complete EditPlanV1 JSON object.` : ""}`,
          { ...(context.model ? { model: context.model } : {}), timeoutMs: 420_000, mode: "plan" },
        )
      : (await groqChatWithFallback(messages, "edit_plan", true)).result;
    try {
      const candidate = preservePromptedImageOverlays(extractJson(result) as EditPlanV1, baseline);
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
