// src/ui/thinkingIndicator.ts
// Braille spinner + stopwatch + current substep line
// Implemented outside ink (setInterval + \r) for use in non-ink context
import chalk from "chalk";
import { theme } from "./theme.js";

const FRAMES = ["⠁", "⠉", "⠙", "⠸", "⠴", "⠲", "⠒", "⠂"];

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the thinking indicator.
 * Returns a stop() function.
 */
export function startThinking(label = "Thinking...", subStep?: string): () => void {
  if (_timer) stopThinking();

  let frame = 0;
  const startedAt = Date.now();

  function render(): void {
    const spinner = chalk.hex(theme.accent)(FRAMES[frame % FRAMES.length]!);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0) + "s";
    const sub = subStep ? chalk.gray(`  ${subStep}`) : "";
    process.stdout.write(`\r${spinner} ${label} ${chalk.gray(elapsed)}${sub}   `);
    frame++;
  }

  render();
  _timer = setInterval(render, 100);

  return () => stopThinking();
}

export function stopThinking(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  // Clear the line
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

export function updateSubStep(label: string): void {
  // Can't easily update in place without re-starting, so just log it
  if (process.env["MND_VERBOSE"]) {
    process.stdout.write("\n" + chalk.gray(`  → ${label}\n`));
  }
}
