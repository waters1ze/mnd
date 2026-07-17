// src/commands/thumbnail.ts
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { loadProjectState } from "../core/projectState.js";
import { generateThumbnail, generateImage, isAntigravityAvailable } from "../core/antigravityClient.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleThumbnail: CommandHandler = async (args) => {
  const cfg = await loadConfig();
  const cliPath = cfg.connections.antigravity_cli_path;
  if (!isAntigravityAvailable(cliPath)) {
    console.log(chalk.red(`Antigravity CLI not found at <${cliPath}>.`));
    console.log(chalk.gray("Install it or set connections.antigravity_cli_path in config, then retry. 'sort' and 'thumbnail' require it; 'analyze' and 'approve' do not."));
    return;
  }

  const vaultPath = resolveVaultPath(cfg);
  const slug = session.currentProjectSlug;

  if (!slug) {
    console.log(chalk.yellow("No project open. Use `open` or `create` first."));
    return;
  }

  const state = await loadProjectState(vaultPath, slug);
  const hasLayers = args.includes("--layers");
  const hasFull = args.includes("--full") || !hasLayers;

  if (hasFull && !hasLayers) {
    // --full: single auto-generated thumbnail
    console.log(chalk.gray("Generating thumbnail (full auto)..."));
    const { readFrontmatter } = await import("../core/vault.js");
    const { join } = await import("node:path");
    const { data } = await readFrontmatter(join(vaultPath, "Projects", slug, "project.md"));
    const fm = data as { style?: string; title?: string };

    const outputPath = await generateThumbnail({
      title: fm.title ?? slug,
      style: fm.style ?? "default",
    });
    console.log(chalk.hex(theme.accent)(`✓ Thumbnail generated: ${outputPath}`));

  } else if (hasLayers) {
    // --layers: generate separate bg/subject/text layers
    console.log(chalk.gray("Generating thumbnail layers..."));

    const layers = ["background", "subject", "text_overlay"];
    for (const layer of layers) {
      const outputPath = await generateImage(`thumbnail layer: ${layer} for project ${slug}`);
      console.log(chalk.hex(theme.accent)(`  ✓ ${layer}: ${outputPath}`));
    }
    console.log(chalk.gray("\nLayers ready for manual assembly in your preferred compositor."));
  }
};
