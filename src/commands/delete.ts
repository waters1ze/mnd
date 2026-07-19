import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { getProjectPaths, validateSlug } from "../core/projectPaths.js";
import { session } from "../repl/loop.js";
import type { CommandHandler } from "../repl/router.js";

/** Permanently removes one MND project after an explicit confirmation. */
export const handleDelete: CommandHandler = async (args) => {
  const slug = args[0] ?? session.currentProjectSlug;
  if (!slug) {
    console.log(chalk.yellow("Open a project first or use /delete <project-slug>."));
    return;
  }
  validateSlug(slug);
  const cfg = await loadConfig();
  const paths = getProjectPaths(resolveVaultPath(cfg), slug);
  if (!existsSync(paths.root)) {
    console.log(chalk.yellow(`Project not found: ${slug}`));
    return;
  }
  const accepted = await confirm({
    message: `Delete project "${slug}" and all imported media, analyses, and exports? This cannot be undone.`,
    initialValue: false,
  });
  if (accepted !== true) {
    console.log(chalk.gray("Project deletion cancelled."));
    return;
  }
  await rm(paths.root, { recursive: true, force: false });
  if (session.currentProjectSlug === slug) session.currentProjectSlug = null;
  console.log(chalk.green(`Deleted project: ${slug}`));
};
