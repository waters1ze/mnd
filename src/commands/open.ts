// src/commands/open.ts
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listProjects } from "../core/vault.js";
import { session } from "../repl/loop.js";
import { slugify } from "../core/vault.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleOpen: CommandHandler = async (args) => {
  const name = args[0];
  if (!name) {
    console.log(chalk.yellow("Usage: open \"Project Name\""));
    return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const projects = await listProjects(vaultPath);

  const targetSlug = slugify(name);

  // Match by slug or by title (case-insensitive)
  const found = projects.find(
    (p) =>
      p.slug === targetSlug ||
      p.frontmatter.slug === targetSlug ||
      (p.frontmatter.title ?? "").toLowerCase() === name.toLowerCase()
  );

  if (found) {
    session.currentProjectSlug = found.slug;
    console.log(
      chalk.hex(theme.accent)(`✓ Opened project: ${found.frontmatter.title ?? found.slug}`) +
      chalk.gray(` [${found.slug}]`)
    );
    console.log(chalk.gray(`  Status: ${found.frontmatter.status}  Style: ${found.frontmatter.style}`));
  } else {
    console.log(chalk.yellow(`Project "${name}" not found.`));
    const shouldCreate = await confirm({
      message: `Create new project "${name}"?`,
      initialValue: true,
    });
    if (shouldCreate === true) {
      const { handleCreate } = await import("./create.js");
      await handleCreate([name], `create "${name}"`);
    }
  }
};
