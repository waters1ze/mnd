// src/commands/full.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleFull: CommandHandler = async (args) => {
  const subCommand = args[0]?.toLowerCase();

  if (subCommand === "new") {
    await fullNew();
  } else if (subCommand === "show") {
    await fullShow();
  } else {
    console.log(chalk.yellow("Usage: full new | full show"));
    console.log(chalk.gray("  full new  — run full verbose pipeline"));
    console.log(chalk.gray("  full show — display last report"));
  }
};

async function fullNew(): Promise<void> {
  // Enable verbose logging for this run
  process.env["MND_VERBOSE"] = "1";
  console.log(chalk.hex(theme.accent)("Running full verbose pipeline...\n"));
  try {
    const { handleAnalyzeProduction, handleEdit, handleExport } = await import("./productionPipeline.js");
    await handleAnalyzeProduction([], "analyze");
    await handleEdit(["plan"], "edit plan");
    await handleEdit(["build"], "edit build");
    await handleExport(["resolve"], "export resolve");
  } finally {
    delete process.env["MND_VERBOSE"];
  }
}

async function fullShow(): Promise<void> {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const slug = session.currentProjectSlug;

  if (!slug) {
    console.log(chalk.yellow("No project open. Use `open` first."));
    return;
  }

  const reportsDir = join(vaultPath, "Projects", slug, "reports");
  if (!existsSync(reportsDir)) {
    console.log(chalk.gray("No reports found for this project yet."));
    return;
  }

  const files = await readdir(reportsDir);
  const logFile = files.find((f) => f === "run.log");

  if (logFile) {
    const logPath = join(reportsDir, logFile);
    const raw = await readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); }
      catch { return { raw: l }; }
    });

    console.log(chalk.hex(theme.accent)(`\nRun log for ${slug}:\n`));
    for (const entry of entries) {
      if ("raw" in entry) {
        console.log(chalk.gray(String(entry.raw)));
        continue;
      }
      const { ts, step, provider, model, durationMs, ok, error } = entry as {
        ts: string; step: string; provider: string; model?: string;
        durationMs: number; ok: boolean; error?: string;
      };
      const status = ok ? chalk.green("✓") : chalk.red("✗");
      const dur = `${(durationMs / 1000).toFixed(1)}s`;
      const modelStr = model ? `[${model}]` : "";
      console.log(`  ${status} ${chalk.white(step)} ${chalk.gray(provider)} ${chalk.gray(modelStr)} ${chalk.gray(dur)}`);
      if (error) console.log(chalk.red(`    Error: ${error}`));
    }
  }

  // Show fcpxml files
  const fcpxmls = files.filter((f) => f.endsWith(".fcpxml"));
  if (fcpxmls.length > 0) {
    console.log(chalk.hex(theme.accent)("\nExported files:"));
    for (const f of fcpxmls) {
      console.log(chalk.white(`  ${join(reportsDir, f)}`));
    }
  }
}
