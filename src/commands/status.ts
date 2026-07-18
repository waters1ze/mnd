// src/commands/status.ts
import Table from "cli-table3";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";
import { session } from "../repl/loop.js";
import { getProjectPaths } from "../core/projectPaths.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { emitResult, isJsonMode } from "../core/output.js";

// Lazy imports to avoid circular deps at startup
let _antigravity: { getStatus: () => { alive: boolean; queueLength: number; state: string } } | null = null;
let _sidecar: { getStatus: () => { alive: boolean; state: string } } | null = null;

export function registerStatusProviders(
  antigravity: typeof _antigravity,
  sidecar: typeof _sidecar
): void {
  _antigravity = antigravity;
  _sidecar = sidecar;
}

function cell(ok: boolean, label: string): string {
  return ok ? chalk.green(label) : chalk.red(label);
}

export const handleStatus: CommandHandler = async () => {
  const cfg = await loadConfig();

  const agStatus = _antigravity?.getStatus() ?? { alive: false, queueLength: 0, state: "unknown" };
  const sidecarStatus = _sidecar?.getStatus() ?? { alive: false, state: "unknown" };
  let project: Record<string, unknown> | null = null;
  if (session.currentProjectSlug) {
    const paths = getProjectPaths(resolveVaultPath(cfg), session.currentProjectSlug);
    let operations: unknown[] = [];
    const operationPath = `${paths.mndDir}/operations.json`;
    if (existsSync(operationPath)) {
      const parsed = JSON.parse(await readFile(operationPath, "utf8")) as { operations?: unknown[] };
      operations = parsed.operations ?? [];
    }
    project = {
      slug: session.currentProjectSlug,
      sourceManifest: existsSync(paths.sourceManifestJson),
      transcript: existsSync(paths.transcriptJson),
      scenes: existsSync(paths.scenesJson),
      editPlan: existsSync(paths.editPlanJson),
      compiledTimeline: existsSync(paths.compiledTimelineJson),
      resolveExport: existsSync(paths.timelineFcpxml),
      operations,
    };
  }
  if (isJsonMode()) {
    emitResult({
      ok: true,
      services: { antigravity: agStatus, sidecar: sidecarStatus },
      profile: cfg.profile,
      project,
    });
    return;
  }

  const table = new Table({
    head: [
      chalk.hex(theme.accent)("Service"),
      chalk.hex(theme.accent)("State"),
      chalk.hex(theme.accent)("Queue"),
      chalk.hex(theme.accent)("Info"),
    ],
    colWidths: [22, 14, 8, 30],
    style: { border: ["gray"], head: [] },
  });

  table.push(
    [
      "Antigravity CLI",
      cell(agStatus.alive, agStatus.state),
      String(agStatus.queueLength),
      cfg.connections.antigravity?.cached_executable_path,
    ],
    [
      "Python Sidecar",
      cell(sidecarStatus.alive, sidecarStatus.state),
      "-",
      "opentimelineio + faster-whisper",
    ],
    [
      "Profile",
      chalk.hex(theme.accent)(cfg.profile),
      "-",
      cfg.profile === "hybrid" ? "Groq cloud" : "Ollama local",
    ]
  );

  console.log(table.toString());
};
