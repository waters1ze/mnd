// src/pipeline/matchStyleRules.ts
// Pure function — no LLM calls. Assembles context for buildEditPlan.

import type { TranscriptSegment, FrameTag } from "../types/pipeline.js";
import type { VaultRule, VaultStyle } from "../types/vault.js";

export interface MatchedContext {
  styleBody: string;
  styleFrontmatter: VaultStyle["frontmatter"];
  applicableRules: Array<{ id: string; category: string; body: string }>;
  transcriptSummary: string;
  frameSummary: string;
}

/**
 * Pure function — collects style + global rules context.
 * No LLM, no I/O. Just assembles the context object that buildEditPlan will use.
 */
export function matchStyleRules(
  style: VaultStyle,
  rules: VaultRule[],
  segments: TranscriptSegment[],
  frameTags: FrameTag[]
): MatchedContext {
  // All rules are potentially applicable — the LLM in buildEditPlan will decide which to apply
  const applicableRules = rules.map((r) => ({
    id: r.frontmatter.id,
    category: r.frontmatter.category,
    body: r.body,
  }));

  // Summarize transcript
  const transcriptSummary = segments
    .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n")
    .slice(0, 8000); // limit context size

  // Summarize frame tags
  const frameSummary = frameTags
    .map((f) => `[${f.atSec.toFixed(1)}s] ${f.tags.join(", ")}: ${f.description}`)
    .join("\n")
    .slice(0, 4000);

  return {
    styleBody: style.body,
    styleFrontmatter: style.frontmatter,
    applicableRules,
    transcriptSummary,
    frameSummary,
  };
}
