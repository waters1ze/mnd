// src/commands/prompt.ts
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { loadProjectState, saveProjectState } from "../core/projectState.js";
import { getProjectPaths } from "../core/projectPaths.js";
import { groqChatWithFallback } from "../core/groqClient.js";
import { runAntigravityPrompt } from "../core/antigravityClient.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import { startThinking, stopThinking } from "../ui/thinkingIndicator.js";
import type { CommandHandler } from "../repl/router.js";
import type { EditPlan } from "../types/pipeline.js";

export const handlePrompt: CommandHandler = async (args) => {
  const text = args.join(" ").trim();
  if (!text) {
    console.log(chalk.yellow("Usage: prompt \"What you want to change\""));
    return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const slug = session.currentProjectSlug;

  if (!slug) {
    console.log(chalk.yellow("No project open. Use `open` or `create` first."));
    return;
  }

  const state = await loadProjectState(vaultPath, slug);
  if (!state.editPlan) {
    console.log(chalk.yellow("No edit plan found. Run `analyze` first."));
    return;
  }

  const currentPlan = state.editPlan;

  const messages = [
    {
      role: "system" as const,
      content: `You are a video editor assistant. The user has an edit plan and wants to modify it.
Return ONLY the updated EditPlan as valid JSON with the same schema. Do not add explanation.

Schema:
{
  "projectSlug": "string",
  "sourceVideoPath": "string",
  "transcript": [...],
  "cuts": [{ "id": "string", "startSec": number, "endSec": number, "reason": "pause|filler_word|manual" }],
  "overlays": [{ "id": "string", "type": "broll|subtitle|text|zoom", "startSec": number, "endSec": number }],
  "audioTrack": { "musicAssetId": null, "syncToBeat": false },
  "createdAt": "string",
  "version": number
}`,
    },
    {
      role: "user" as const,
      content: `Current edit plan:\n${JSON.stringify(currentPlan, null, 2)}\n\nUser request: ${text}`,
    },
  ];

  const stop = startThinking("Updating edit plan...");
  try {
    const activeTextModel = cfg.models[cfg.profile].text;
    const result = activeTextModel.provider === "antigravity"
      ? await runAntigravityPrompt(
          `${messages[0]!.content}\n\n${messages[1]!.content}`,
          { ...(activeTextModel.model ? { model: activeTextModel.model } : {}), addDirectories: [getProjectPaths(vaultPath, slug).root], mode: "plan" },
        )
      : (await groqChatWithFallback(messages, "prompt", true)).result;
    stop();

    // Parse response
    const jsonMatch = result.replace(/```(?:json)?/g, "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const updated = JSON.parse(jsonMatch[0]) as EditPlan;
    updated.version = currentPlan.version + 1;

    state.editPlan = updated;
    state.stepOutputs["plan"] = updated;
    await saveProjectState(vaultPath, state);

    console.log(chalk.hex(theme.accent)(`✓ Edit plan updated (v${updated.version})`));
    console.log(chalk.gray(`  Cuts: ${updated.cuts.length}  Overlays: ${updated.overlays.length}`));
    console.log(chalk.gray("  Use `approve` to export, or `prompt` again to refine."));
  } catch (err) {
    stop();
    throw err;
  }
};
