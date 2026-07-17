// src/ui/focusFrame.ts
// "Weighted Focus Frame" — the mnd signature interaction style.
// Active panel = HEAVY (thick) borders in accent violet + ▸ marker
// Inactive panel = LIGHT (thin) borders in dim gray
// NO gradient animation. Weight (thickness) is the differentiator.
import chalk from "chalk";
import { LIGHT, HEAVY, pad, INNER_WIDTH, type BoxCharset } from "./box.js";
import { theme } from "./theme.js";

/** Detect if terminal supports Unicode box-drawing above U+2500 */
function supportsHeavyBoxDrawing(): boolean {
  const term = process.env["TERM"] ?? "";
  const lang = process.env["LANG"] ?? "";
  const termProgram = process.env["TERM_PROGRAM"] ?? "";
  // Assume support for modern terminals and UTF-8 locales
  if (lang.includes("UTF") || lang.includes("utf")) return true;
  if (termProgram === "iTerm.app" || termProgram === "vscode") return true;
  if (term.includes("256color") || term.includes("xterm")) return true;
  // Windows Terminal
  if (process.env["WT_SESSION"]) return true;
  return false;
}

const HEAVY_SUPPORTED = supportsHeavyBoxDrawing();

export interface FocusableBoxOptions {
  focused: boolean;
  width?: number;
  /** Internal: during snap animation, show only corner chars as heavy */
  focusTransition?: "snapping" | "settled";
}

/**
 * Render a focusable box.
 * focused=true  → HEAVY charset, accent color (#7C5CFF), ▸ marker before title
 * focused=false → LIGHT charset, dim gray color, no marker
 *
 * This is the SINGLE source of truth for all focusable panels.
 */
export function renderFocusableBox(
  title: string,
  lines: string[],
  opts: FocusableBoxOptions
): string[] {
  const W = opts.width ?? INNER_WIDTH;
  const focused = opts.focused;
  const snapping = opts.focusTransition === "snapping";

  const useHeavy = focused && HEAVY_SUPPORTED;

  // During snap transition: use HEAVY corners only, light sides
  const cs: BoxCharset = useHeavy
    ? snapping
      ? {
          tl: HEAVY.tl, tr: HEAVY.tr, bl: HEAVY.bl, br: HEAVY.br,
          h: LIGHT.h, v: LIGHT.v, ml: LIGHT.ml, mr: LIGHT.mr,
        }
      : HEAVY
    : LIGHT;

  const colorFn = focused
    ? (s: string) => chalk.hex(theme.accent)(s)
    : (s: string) => chalk.gray(s);

  const displayTitle = focused
    ? `${theme.icons.focusMarker} ${title}`
    : title;

  const titleWidth = displayTitle.length + 2; // " title "
  const sideH = Math.max(0, W - titleWidth);
  const leftH = Math.floor(sideH / 2);
  const rightH = sideH - leftH;

  // Top border
  const topBorder =
    colorFn(cs.tl) +
    colorFn(cs.h.repeat(leftH)) +
    colorFn(` ${displayTitle} `) +
    colorFn(cs.h.repeat(rightH)) +
    colorFn(cs.tr);

  const output: string[] = [topBorder];

  // Content lines
  for (const line of lines) {
    const padded = pad(line, W - 2);
    output.push(colorFn(cs.v) + " " + padded + " " + colorFn(cs.v));
  }

  // Bottom border
  output.push(colorFn(cs.bl) + colorFn(cs.h.repeat(W)) + colorFn(cs.br));

  return output;
}

/**
 * Transition helper for ink components:
 * When Tab is pressed, briefly set transition="snapping" for ~130ms,
 * then "settled". This creates the camera-autofocus snap effect.
 */
export function createFocusTransition(
  setTransition: (t: "snapping" | "settled") => void
): void {
  setTransition("snapping");
  setTimeout(() => setTransition("settled"), 130);
}
