// src/core/costEstimate.ts
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { PRICING } from "./pricingTable.js";
import { loadConfig } from "./config.js";

export interface CostEstimate {
  whisperCostUsd: number;
  textCostUsd: number;
  visionCostUsd: number;
  totalUsd: number;
  details: string;
}

/**
 * Estimate cost for an analyze run.
 * @param durationSec — video duration in seconds
 * @param keyframeCount — number of keyframes to vision-analyze
 */
export function estimateAnalyzeCost(durationSec: number, keyframeCount: number): CostEstimate {
  const durationMin = durationSec / 60;

  // Whisper cost
  const whisperCost = durationMin * PRICING.groq.whisper_per_minute;

  // Text (buildEditPlan) — rough estimate based on video duration
  const contextTokens = durationSec * PRICING.context_tokens_per_second;
  const textCost =
    (contextTokens / 1000) * PRICING.groq.llama_70b_per_1k_input +
    (500 / 1000) * PRICING.groq.llama_70b_per_1k_output; // ~500 output tokens

  // Vision cost per keyframe
  const tokensPerFrame = 1200; // rough estimate for image + description
  const visionCost = keyframeCount *
    ((tokensPerFrame / 1000) * PRICING.groq.llama_vision_per_1k_input +
     (200 / 1000) * PRICING.groq.llama_vision_per_1k_output);

  const totalUsd = whisperCost + textCost + visionCost;

  const details = [
    `  Whisper (${durationMin.toFixed(1)} min): $${whisperCost.toFixed(4)}`,
    `  Text (LLM, ~${Math.round(contextTokens)} ctx tokens): $${textCost.toFixed(4)}`,
    `  Vision (${keyframeCount} frames): $${visionCost.toFixed(4)}`,
    `  Total: ~$${totalUsd.toFixed(4)}`,
  ].join("\n");

  return { whisperCostUsd: whisperCost, textCostUsd: textCost, visionCostUsd: visionCost, totalUsd, details };
}

/**
 * Show cost estimate and ask for confirmation before proceeding.
 * Returns false if user cancelled.
 * Skipped entirely in "local" profile.
 */
export async function confirmCostEstimate(
  label: string,
  durationSec: number,
  keyframeCount: number
): Promise<boolean> {
  const cfg = await loadConfig();
  if (cfg.profile === "local") return true; // no cloud costs

  const estimate = estimateAnalyzeCost(durationSec, keyframeCount);

  console.log(chalk.gray(`\n${label} — estimated cloud cost:`));
  console.log(chalk.gray(estimate.details));

  const proceed = await confirm({
    message: `Proceed? (est. $${estimate.totalUsd.toFixed(4)})`,
    initialValue: true,
  });

  return proceed === true;
}

/**
 * Estimate sort cost for N files.
 * @param fileCount — number of files to classify
 */
export async function confirmSortCost(fileCount: number): Promise<boolean> {
  const cfg = await loadConfig();
  if (cfg.profile === "local") return true;
  if (fileCount <= 20) return true; // only show for large batches

  const costPerFile = 0.002; // rough antigravity classify estimate
  const totalUsd = fileCount * costPerFile;

  console.log(chalk.gray(`\nSort ${fileCount} files — estimated cost: ~$${totalUsd.toFixed(2)}`));
  const proceed = await confirm({
    message: `Classify ${fileCount} files? (est. $${totalUsd.toFixed(2)})`,
    initialValue: true,
  });
  return proceed === true;
}
