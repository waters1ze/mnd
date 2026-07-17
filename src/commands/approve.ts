// src/commands/approve.ts
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { loadProjectState } from "../core/projectState.js";
import { exportTimelineStep } from "../pipeline/exportTimeline.js";
import { updateProjectFrontmatter } from "../core/vault.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleApprove: CommandHandler = async () => {
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

  console.log(chalk.gray("Exporting timeline..."));

  const fcpxmlPath = await exportTimelineStep(state.editPlan, state, vaultPath);
  await updateProjectFrontmatter(vaultPath, slug, (fm) => {
    fm.status = "exported";
  });

  console.log(chalk.hex(theme.accent)("✓ Timeline exported!"));
  console.log(chalk.white(`  File: ${fcpxmlPath}`));
  console.log(chalk.gray("\n  Import into DaVinci Resolve:"));
  console.log(chalk.gray("  File → Import → Timeline → select the .fcpxml file"));
};
