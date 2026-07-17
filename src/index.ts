#!/usr/bin/env node
// src/index.ts — Entry point
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import chalk from "chalk";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";
import { loadConfig, resolveVaultPath, configExists, verifyModelConsistency } from "./core/config.js";
import { ensureVaultStructure } from "./core/vault.js";
import { secretsHasKey } from "./core/secrets.js";
import { runSetupWizard } from "./ui/setupWizard.js";
import { registerCommands } from "./repl/router.js";
import { startRepl, session } from "./repl/loop.js";
import { Updater } from "./core/updater.js";

// ─── Import all command handlers ──────────────────────────────────────────────
import { handleConfig } from "./commands/config.js";
import { handleOpen } from "./commands/open.js";
import { handleCreate } from "./commands/create.js";
import { handleSort } from "./commands/sort.js";
import { handleExportValidate, handleExportReveal, handleExportRetry } from "./commands/exportCommands.js";
import { handleAnalyze } from "./commands/analyze.js";
import { handlePrompt } from "./commands/prompt.js";
import { handleApprove } from "./commands/approve.js";
import { handleFix } from "./commands/fix.js";
import { handleShowHistory } from "./commands/showHistory.js";
import { handleFull } from "./commands/full.js";
import { handleThumbnail } from "./commands/thumbnail.js";
import { handleRefactor } from "./commands/refactor.js";
import { handleRulesReview } from "./commands/rulesReview.js";
import { handleStatus } from "./commands/status.js";
import { handleObsidian } from "./commands/obsidian.js";
import { handleBackup } from "./commands/backup.js";
import { handleRestore } from "./commands/restore.js";
import { handleLogs } from "./commands/logs.js";
import { handleDoctor } from "./commands/doctor.js";
import { registerAccountCommands } from "./commands/account.js";
import { registerSyncCommands } from "./commands/sync.js";
import { registerUpdateCommands } from "./commands/update.js";

// ─── Startup checks ───────────────────────────────────────────────────────────

function checkFFmpeg(): void {
  const pathStr = ffmpegPath as unknown as string;
  const ffprobePathStr = ffprobeStatic.path;
  const paths = [pathStr, ffprobePathStr].filter(Boolean);

  const keys = Object.keys(process.env).filter((k) => k.toLowerCase() === "path");
  for (const p of paths) {
    const dir = dirname(p);
    for (const key of keys) {
      const currentPath = process.env[key] || "";
      const delimiter = process.platform === "win32" ? ";" : ":";
      const parts = currentPath.split(delimiter);
      if (!parts.includes(dir)) {
        process.env[key] = dir + delimiter + currentPath;
      }
    }
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    execSync("ffprobe -version", { stdio: "ignore" });
  } catch {
    console.error(chalk.red("✗ FFmpeg or FFprobe not found in PATH. Please install FFmpeg."));
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  checkFFmpeg();

  const hasConfig = await configExists();
  const hasGroqKey = await secretsHasKey("groq_api_key");
  if (!hasConfig || !hasGroqKey) {
    await runSetupWizard();
  }

  const { runConfigMigrations } = await import("./core/migrations.js");
  await runConfigMigrations();

  const cfg = await loadConfig();
  verifyModelConsistency();
  const vaultPath = resolveVaultPath(cfg);
  await ensureVaultStructure(vaultPath);

  // Verify update health
  const updater = new Updater();
  await updater.checkHealthAndRollback();

  session.currentProjectSlug = null;
  const { runVaultMigrations } = await import("./core/migrations.js");
  await runVaultMigrations(vaultPath);

  // Background fetch model catalog so it's fresh when needed later
  import("./models/modelCatalog.js").then(({ refreshCatalog }) => {
    refreshCatalog().catch(() => {});
  }).catch(() => {});

  // Register all commands
  registerCommands([
    { name: "config", handler: handleConfig },
    { name: "obsidian", handler: handleObsidian },
    { name: "open", handler: handleOpen },
    { name: "create", handler: handleCreate },
    { name: "sort", handler: handleSort },
    { name: "analyze", aliases: ["analyse"], handler: handleAnalyze },
    { name: "prompt", handler: handlePrompt },
    { name: "approve", handler: handleApprove },
    { name: "fix", handler: handleFix },
    { name: "show history", handler: handleShowHistory },
    { name: "export validate", handler: async (args) => await handleExportValidate(args[0] || session.currentProjectSlug || "") },
    { name: "export reveal", handler: async (args) => await handleExportReveal(args[0] || session.currentProjectSlug || "") },
    { name: "export retry", handler: async (args) => await handleExportRetry(args[0] || session.currentProjectSlug || "") },
    { name: "full new", handler: (args, raw) => handleFull(["new", ...args], raw) },
    { name: "full show", handler: (args, raw) => handleFull(["show", ...args], raw) },
    { name: "thumbnail", handler: handleThumbnail },
    { name: "refactor", handler: handleRefactor },
    { name: "rules review", handler: handleRulesReview },
    { name: "status", handler: handleStatus },
    { name: "backup", handler: handleBackup },
    { name: "restore", handler: handleRestore },
    { name: "logs", handler: handleLogs },
    { name: "doctor", handler: handleDoctor },
    {
      name: "help",
      handler: async () => {
        console.log(chalk.gray([
          "Commands: config, obsidian, open, create, sort, analyze, prompt,",
          "          approve, fix, show history, full new, full show, thumbnail,",
          "          refactor, rules review, status, backup, restore, login, logout, account",
        ].join("\n")));
      },
    },
  ]);

  registerAccountCommands();
  registerSyncCommands();
  registerUpdateCommands();

  await startRepl();
}

main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
