#!/usr/bin/env node
// src/index.ts — Entry point
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import chalk from "chalk";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";
import { loadConfig, resolveVaultPath, configExists, verifyModelConsistency } from "./core/config.js";
import { ensureVaultStructure } from "./core/vault.js";
import { runSetupWizard } from "./ui/setupWizard.js";
import { registerCommands } from "./repl/router.js";
import { startRepl, session } from "./repl/loop.js";
import { Updater } from "./core/updater.js";

// ─── Import all command handlers ──────────────────────────────────────────────
import { handleConfig } from "./commands/config.js";
import { handleOpen } from "./commands/open.js";
import { handleCreate } from "./commands/create.js";
import { handleSort } from "./commands/sort.js";
import { handlePrompt } from "./commands/prompt.js";
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
import { handleGraph } from "./commands/graph.js";
import {
  handleAdd,
  handleAnalyzeProduction,
  handleEdit,
  handleExport,
  handleProject,
  handleScenes,
  handleTranscribeProduction,
  handleAutoEdit,
} from "./commands/productionPipeline.js";
import { emitResult, isJsonMode, setJsonMode, structuredError } from "./core/output.js";
import { stopSidecar } from "./core/pythonSidecarClient.js";
import { stopAntigravity } from "./core/antigravityClient.js";
const graphCommandHandler = (args: string[], _rawInput: string) => handleGraph(args[0], args.slice(1));

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
    execFileSync(pathStr, ["-version"], { stdio: "ignore" });
    execFileSync(ffprobePathStr, ["-version"], { stdio: "ignore" });
  } catch {
    console.error(chalk.red("✗ FFmpeg or FFprobe not found in PATH. Please install FFmpeg."));
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const requestedJson = cliArgs.includes("--json");
  setJsonMode(requestedJson);
  const commandArgs = cliArgs.filter((arg) => arg !== "--json");
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(chalk.gray([
      "Usage: mnd [command]",
      "",
      "Commands: config, obsidian, open, create, sort, analyze, prompt,",
      "          approve, fix, show history, full new, full show, thumbnail,",
      "          refactor, rules review, status, backup, restore, login, logout, account"
    ].join("\n")));
    process.exit(0);
  }

  checkFFmpeg();

  const hasConfig = await configExists();
  if (!hasConfig && requestedJson) {
    emitResult({
      ok: false,
      status: "action_required",
      error: { code: "SETUP_REQUIRED", message: "MND configuration is missing" },
      suggestedActions: ["mnd /config"],
    });
    process.exitCode = 3;
    return;
  }
  if (!hasConfig) {
    await runSetupWizard();
  }

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
    { name: "project", handler: handleProject },
    { name: "add", handler: handleAdd },
    { name: "sort", handler: handleSort },
    { name: "analyze", aliases: ["analyse"], handler: handleAnalyzeProduction },
    { name: "transcribe", handler: handleTranscribeProduction },
    { name: "scenes", handler: handleScenes },
    { name: "edit", handler: handleEdit },
    { name: "export", handler: handleExport },
    { name: "auto", handler: handleAutoEdit },
    { name: "prompt", handler: handlePrompt },
    { name: "approve", handler: async () => handleExport(["resolve"], "export resolve") },
    { name: "fix", handler: handleFix },
    { name: "show history", handler: handleShowHistory },
    { name: "export validate", handler: async (args) => handleExport(["validate", ...args], "export validate") },
    { name: "export reveal", handler: async (args) => await handleExport(["reveal", ...args], "export reveal") },
    { name: "export retry", handler: async (args) => handleExport(["retry", ...args], "export retry") },
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
          "          refactor, rules review, status, backup, restore, login, logout, account, graph",
        ].join("\n")));
      },
    },
    { name: "graph", handler: graphCommandHandler },
  ]);

  registerAccountCommands();
  registerSyncCommands();
  registerUpdateCommands();

  try {
    if (commandArgs.length > 0) {
      const { route } = await import("./repl/router.js");
      const routed = commandArgs.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
      await route(routed);
      return;
    }

    await startRepl();
  } finally {
    await Promise.allSettled([stopSidecar(), stopAntigravity()]);
  }
}

main().catch((err) => {
  if (isJsonMode()) console.log(JSON.stringify(structuredError(err)));
  else console.error(chalk.red("Fatal:"), err instanceof Error ? err.message : err);
  process.exitCode = /required|missing|no project|does not exist/i.test(err instanceof Error ? err.message : String(err)) ? 3 : 1;
});
