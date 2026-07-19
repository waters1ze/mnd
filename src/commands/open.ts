// src/commands/open.ts
import { confirm } from "@clack/prompts";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listProjects } from "../core/vault.js";
import { session } from "../repl/loop.js";
import { slugify } from "../core/vault.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleOpen: CommandHandler = async (args) => {
  const name = args[0];
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const projects = await listProjects(vaultPath);

  if (!name) {
    if (projects.length === 0) {
      console.log(chalk.yellow("No projects yet. Use /create \"Project Name\" first."));
      return;
    }
    const { SelectorWithPreview } = await import("../ui/selectorWithPreview.js");
    let selectedSlug: string | null = null;
    let done = false;
    const { unmount } = render(
      React.createElement(SelectorWithPreview, {
        title: "Open project",
        items: projects.map((project) => ({
          label: project.slug,
          preview: [
            `Name: ${project.frontmatter.title ?? project.slug}`,
            `Status: ${project.frontmatter.status ?? "created"}`,
            `Style: ${project.frontmatter.style ?? "default"}`,
            `Path: ${project.filePath}`,
          ].join("\n"),
        })),
        onSelect: (slug: string) => { selectedSlug = slug; done = true; unmount(); },
        onCancel: () => { done = true; unmount(); },
      }),
    );
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (done) { clearInterval(timer); resolve(); }
      }, 50);
    });
    if (!selectedSlug) return;
    session.currentProjectSlug = selectedSlug;
    const selected = projects.find((project) => project.slug === selectedSlug)!;
    console.log(chalk.hex(theme.accent)(`Opened project: ${selected.frontmatter.title ?? selected.slug}`) + chalk.gray(` [${selected.slug}]`));
    return;
  }

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
