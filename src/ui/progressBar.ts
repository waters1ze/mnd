// src/ui/progressBar.ts
// Two modes: (1) time-based (transcription/export), (2) count-based (sort)
import chalk from "chalk";
import { theme } from "./theme.js";

let _activeBar: ReturnType<typeof startBar> | null = null;

// ── Step icons (minimal, Lunacy-style mono set) ───────────────────────────
export const ICONS = {
  transcribe:  "◎",  // mic/audio ring
  analyze:     "◈",  // scan diamond
  plan:        "◉",  // plan dot
  export:      "◇",  // export diamond
  import:      "⊕",  // import plus
  publish:     "◆",  // publish filled
  done:        "✦",  // sparkle done
  warn:        "◬",  // warning triangle
  error:       "✖",  // cross
  spin:        ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"],
} as const;

// ── Inline spinner for long tasks ─────────────────────────────────────────
let _spinFrame = 0;
let _spinTimer: ReturnType<typeof setInterval> | null = null;
let _spinLabel = "";

export function startSpinner(label: string): void {
  stopSpinner();
  _spinLabel = label;
  _spinFrame = 0;
  _spinTimer = setInterval(() => {
    const frame = ICONS.spin[_spinFrame % ICONS.spin.length]!;
    process.stdout.write(
      `\r  ${chalk.hex(theme.accent)(frame)}  ${chalk.white(_spinLabel)}   `
    );
    _spinFrame += 1;
  }, 80);
}

export function stopSpinner(finalLine?: string): void {
  if (_spinTimer) { clearInterval(_spinTimer); _spinTimer = null; }
  if (finalLine) {
    process.stdout.write(`\r  ${chalk.hex(theme.accent)(ICONS.done)}  ${chalk.white(finalLine)}\n`);
  } else if (_spinLabel) {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }
  _spinLabel = "";
}

// ── Count progress bar ────────────────────────────────────────────────────
interface ActiveBar {
  update(current: number, label?: string): void;
  stop(finalLine?: string): void;
}

function startBar(icon: string, title: string, total: number): ActiveBar {
  const BAR_WIDTH = 18;
  let current = 0;
  let lastLabel = "";

  function render(val: number, label: string) {
    const pct = total > 0 ? Math.min(1, val / total) : 0;
    const filled = Math.round(pct * BAR_WIDTH);
    const bar =
      chalk.hex(theme.accent)("█".repeat(filled)) +
      chalk.gray("░".repeat(BAR_WIDTH - filled));
    const pctStr = chalk.white(`${Math.round(pct * 100)}%`);
    const counter = chalk.gray(`${val}/${total}`);
    const lbl = label ? chalk.gray(`  ${label}`) : "";
    process.stdout.write(
      `\r  ${chalk.hex(theme.accent)(icon)}  ${chalk.white(title)}  [${bar}] ${pctStr} ${counter}${lbl}   `
    );
  }

  render(0, "");

  return {
    update(val: number, label = "") {
      current = val;
      lastLabel = label;
      render(val, label);
    },
    stop(finalLine?: string) {
      if (finalLine) {
        process.stdout.write(
          `\r  ${chalk.hex(theme.accent)(ICONS.done)}  ${chalk.white(finalLine)}\n`
        );
      } else {
        render(total, lastLabel);
        process.stdout.write("\n");
      }
    },
  };
}

/** Count-based bar: call .update(n) for each completed item */
export function startCountProgress(title: string, total: number, icon = "◈"): ActiveBar {
  _activeBar?.stop();
  const bar = startBar(icon, title, total);
  _activeBar = bar;
  return bar;
}

/** Time-based indeterminate: use startSpinner instead */
export function startTimeProgress(label: string, _total = 100): ReturnType<typeof startSpinner> {
  startSpinner(label);
  return undefined as unknown as ReturnType<typeof startSpinner>;
}

export function stopProgress(finalLine?: string): void {
  stopSpinner(finalLine);
  _activeBar?.stop(finalLine);
  _activeBar = null;
}

/** Simple one-liner for sort/legacy use */
export function renderProgressBar(current: number, total: number, label = ""): void {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round(pct / 5);
  const bar =
    chalk.hex(theme.accent)("█".repeat(filled)) +
    chalk.gray("░".repeat(20 - filled));
  const line = `  ${chalk.hex(theme.accent)("◈")}  [${bar}] ${chalk.white(`${pct}%`)} ${chalk.gray(label)}`;
  process.stdout.write(`\r${line}   `);
  if (current === total) process.stdout.write("\n");
}
