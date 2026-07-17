// src/commands/sort.ts
import { readdir, copyFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { select, confirm } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, resolveVaultPath, resolveInboxPath } from "../core/config.js";
import { writeAssetSidecar } from "../core/vault.js";
import { ensureAntigravityCli } from "../integrations/antigravityDiscovery.js";
import { classifyAsset } from "../core/antigravityClient.js";
import { confirmSortCost } from "../core/costEstimate.js";
import { session } from "../repl/loop.js";
import { renderProgressBar } from "../ui/progressBar.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleSort: CommandHandler = async () => {
  const ok = await ensureAntigravityCli();
  if (!ok) return;

  const cfg = await loadConfig();

  const vaultPath = resolveVaultPath(cfg);
  const inboxPath = resolveInboxPath(cfg);

  let files: string[];
  try {
    const all = await readdir(inboxPath, { withFileTypes: true });
    files = all.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    console.log(chalk.yellow(`Inbox not found: ${inboxPath}`));
    console.log(chalk.gray("Set inbox_path in config or create the folder."));
    return;
  }

  if (files.length === 0) {
    console.log(chalk.gray(`Inbox is empty: ${inboxPath}`));
    return;
  }

  // Cost estimate for large batches
  const costOk = await confirmSortCost(files.length);
  if (!costOk) { console.log(chalk.gray("Cancelled.")); return; }

  console.log(chalk.hex(theme.accent)(`Sorting ${files.length} files from inbox...\n`));

  const assetsDir = join(vaultPath, "Assets");
  await mkdir(assetsDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const srcPath = join(inboxPath, file);

    renderProgressBar(i + 1, files.length, `Classifying: ${file}`);

    let classification = { type: "unknown", tags: [] as string[], description: "" };
    try {
      classification = await classifyAsset(srcPath);
    } catch {
      console.log(chalk.yellow(`  ⚠ Could not classify ${file}, using defaults`));
    }

    // Ask user where to put it
    const choices = [
      { value: "assets", label: `Assets/ (${classification.type})` },
      ...(session.currentProjectSlug
        ? [{ value: "raw", label: `Projects/${session.currentProjectSlug}/raw/` }]
        : []),
      { value: "skip", label: "Skip this file" },
    ];

    const dest = await select({
      message: `${file} [${classification.tags.slice(0, 3).join(", ")}]`,
      options: choices,
    });

    if (dest === "skip" || typeof dest !== "string") continue;

    let destDir: string;
    if (dest === "assets") {
      destDir = assetsDir;
    } else {
      destDir = join(vaultPath, "Projects", session.currentProjectSlug!, "raw");
    }

    await mkdir(destDir, { recursive: true });
    await copyFile(srcPath, join(destDir, basename(file)));

    // Create sidecar note for assets
    if (dest === "assets") {
      await writeAssetSidecar(vaultPath, file, classification.tags, classification.description);
    }

    console.log(chalk.green(`  ✓ ${file} → ${dest}`));
  }

  console.log(chalk.hex(theme.accent)("\nSort complete."));
};
