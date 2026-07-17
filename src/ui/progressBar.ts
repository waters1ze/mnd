// src/ui/progressBar.ts
// Two modes: (1) time-based (transcription/export), (2) count-based (sort)
import cliProgress from "cli-progress";
import chalk from "chalk";
import { theme } from "./theme.js";

let _activeBar: cliProgress.SingleBar | null = null;

function makeBar(format: string): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    {
      format,
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: true,
    },
    cliProgress.Presets.shades_classic
  );
}

/** Mode 1: percentage + elapsed/remaining time */
export function startTimeProgress(label: string, total: number): cliProgress.SingleBar {
  _activeBar?.stop();
  const format =
    chalk.hex(theme.accent)(label) +
    " [{bar}] " +
    chalk.white("{percentage}%") +
    " | " +
    chalk.gray("{duration_formatted} elapsed");
  _activeBar = makeBar(format);
  _activeBar.start(total, 0);
  return _activeBar;
}

/** Mode 2: percentage + item counter */
export function startCountProgress(label: string, total: number): cliProgress.SingleBar {
  _activeBar?.stop();
  const format =
    chalk.hex(theme.accent)(label) +
    " [{bar}] " +
    chalk.white("{value}/{total}") +
    " | " +
    chalk.gray("{percentage}%");
  _activeBar = makeBar(format);
  _activeBar.start(total, 0);
  return _activeBar;
}

export function stopProgress(): void {
  _activeBar?.stop();
  _activeBar = null;
}

/** Simple inline progress bar for quick use in sort */
export function renderProgressBar(current: number, total: number, label = ""): void {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const line = chalk.hex(theme.accent)(`[${bar}]`) + chalk.gray(` ${pct}% ${label}`);
  process.stdout.write(`\r${line}   `);
  if (current === total) process.stdout.write("\n");
}
