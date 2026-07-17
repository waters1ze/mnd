// src/pipeline/visionAnalyze.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getActiveProfile } from "../core/config.js";
import { groqVisionChat } from "../core/groqClient.js";
import { ollamaVisionChat } from "../core/ollamaClient.js";
import {
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
  saveProjectState,
} from "../core/projectState.js";
import type { KeyframeCandidate, FrameTag, ProjectState } from "../types/pipeline.js";

async function analyzeFrame(
  candidate: KeyframeCandidate,
  provider: "groq" | "ollama"
): Promise<FrameTag> {
  const imageData = await readFile(candidate.thumbnailPath);
  const base64 = imageData.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const messages = [
    {
      role: "user" as const,
      content: [
        {
          type: "image_url" as const,
          image_url: { url: dataUrl },
        },
        {
          type: "text" as const,
          text: "Analyze this video frame. Provide: 1) A comma-separated list of descriptive tags (scene type, objects, mood, lighting, composition). 2) A one-sentence description. Format as JSON: {\"tags\": [...], \"description\": \"...\"}",
        },
      ],
    },
  ];

  let raw: string;
  if (provider === "groq") {
    raw = await groqVisionChat(messages, "vision");
  } else {
    raw = await ollamaVisionChat(messages, "vision");
  }

  try {
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { tags: string[]; description: string };
    return {
      atSec: candidate.atSec,
      tags: parsed.tags ?? [],
      description: parsed.description ?? "",
    };
  } catch {
    return {
      atSec: candidate.atSec,
      tags: [],
      description: raw.slice(0, 200),
    };
  }
}

export async function visionAnalyzeStep(
  candidates: KeyframeCandidate[],
  state: ProjectState,
  vaultPath: string
): Promise<FrameTag[]> {
  if (isStepDone(state, "vision")) {
    const cached = getCachedStepOutput<FrameTag[]>(state, "vision");
    if (cached) return cached;
  }

  const profile = await getActiveProfile();
  const provider = profile.vision.provider === "ollama" ? "ollama" : "groq";

  const frameTags: FrameTag[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate.thumbnailPath)) continue;
    try {
      const tag = await analyzeFrame(candidate, provider);
      frameTags.push(tag);
    } catch (err) {
      // Log but don't fail the entire step
      frameTags.push({
        atSec: candidate.atSec,
        tags: [],
        description: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  cacheStepOutput(state, "vision", frameTags);
  markStepDone(state, "vision");
  await saveProjectState(vaultPath, state);
  return frameTags;
}
