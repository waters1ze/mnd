// src/commands/create.ts
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { createProject, listStyles } from "../core/vault.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";
import { emitResult, isJsonMode } from "../core/output.js";

export const handleCreate: CommandHandler = async (args) => {
  const name = args[0];
  if (!name) {
    emitResult({ ok: false, status: "action_required", error: { code: "PROJECT_NAME_REQUIRED", message: "Usage: /create <project-name>" } }, chalk.yellow("Usage: create \"Project Name\""));
    return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const styles = await listStyles(vaultPath);

  let selectedStyle = "default";

  if (styles.length > 0 && !isJsonMode()) {
    // Use ink selectorWithPreview
    const { SelectorWithPreview } = await import("../ui/selectorWithPreview.js");
    let done = false;
    let chosen: string | null = null;

    const { unmount } = render(
      React.createElement(SelectorWithPreview, {
        title: "Select Style",
        items: styles.map((s) => ({
          label: s.name,
          preview: `${JSON.stringify(s.frontmatter, null, 2)}\n\n${s.body}`,
        })),
        onSelect: (label: string) => {
          chosen = label;
          done = true;
          unmount();
        },
        onCancel: () => {
          done = true;
          unmount();
        },
      })
    );

    // Wait for selection
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (done) { clearInterval(check); resolve(); }
      }, 50);
    });

    if (chosen) selectedStyle = chosen;
  } else if (!isJsonMode()) {
    console.log(chalk.gray("No styles found in vault. Using 'default' style."));
    console.log(chalk.gray(`Create style files in: ${vaultPath}/Styles/*.md`));
  }

  const slug = await createProject(vaultPath, name, selectedStyle);
  session.currentProjectSlug = slug;

  emitResult(
    { ok: true, status: "completed", project: { name, slug, style: selectedStyle }, path: `${vaultPath}/Projects/${slug}/` },
    `${chalk.hex(theme.accent)(`Created project: ${name}`)}\n${chalk.gray(`Slug: ${slug}  Style: ${selectedStyle}`)}\n${chalk.gray(`Path: ${vaultPath}/Projects/${slug}/`)}`,
  );
};
