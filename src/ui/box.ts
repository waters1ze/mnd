// src/ui/box.ts
// Fixed-width box renderer with LIGHT and HEAVY charset support.
// All widths are fixed to INNER_WIDTH — never dynamic.
import chalk from "chalk";
import stringWidth from "string-width";

export const INNER_WIDTH = 50; // fixed inner content width

export interface BoxCharset {
  tl: string; tr: string; bl: string; br: string;
  h: string; v: string; ml: string; mr: string;
}

export const LIGHT: BoxCharset = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│", ml: "├", mr: "┤",
};

export const HEAVY: BoxCharset = {
  tl: "┏", tr: "┓", bl: "┗", br: "┛",
  h: "━", v: "┃", ml: "┣", mr: "┫",
};

/**
 * Pad/truncate string to exactly `width` visible columns,
 * accounting for wide Unicode characters (emoji, CJK, etc.)
 */
export function pad(s: string, width: number): string {
  // Strip ANSI escape codes for width calculation
  const plain = s.replace(/\x1B\[[0-9;]*m/g, "");
  const visWidth = stringWidth(plain);

  if (visWidth === width) return s;
  if (visWidth > width) {
    // Truncate: rebuild character by character until width is met
    let result = "";
    let curr = 0;
    for (const ch of plain) {
      const w = stringWidth(ch);
      if (curr + w > width) break;
      result += ch;
      curr += w;
    }
    return result + " ".repeat(Math.max(0, width - stringWidth(result)));
  }
  // Pad with spaces
  return s + " ".repeat(width - visWidth);
}

export interface BoxOptions {
  width?: number;
  charset?: BoxCharset;
  color?: (s: string) => string;
  titleColor?: (s: string) => string;
}

/**
 * Render a fixed-width box.
 * Returns an array of strings (one per line), ready for console.log.
 */
export function box(
  title: string,
  lines: string[],
  opts: BoxOptions = {}
): string[] {
  const W = opts.width ?? INNER_WIDTH;
  const cs = opts.charset ?? LIGHT;
  const color = opts.color ?? ((s: string) => s);
  const titleFn = opts.titleColor ?? color;

  const titlePadded = title ? ` ${title} ` : "";
  const titleWidth = stringWidth(titlePadded);
  const remainingH = W + 2 - titleWidth; // +2 for v chars
  const leftH = Math.floor((remainingH - 2) / 2); // space for corner chars included in W+2
  const rightH = W + 2 - titleWidth - leftH - 2;

  // Top border
  const topBorder =
    color(cs.tl) +
    color(cs.h.repeat(Math.max(0, leftH))) +
    titleFn(titlePadded) +
    color(cs.h.repeat(Math.max(0, rightH))) +
    color(cs.tr);

  const output: string[] = [topBorder];

  // Content lines
  for (const line of lines) {
    const padded = pad(line, W);
    output.push(color(cs.v) + padded + color(cs.v));
  }

  // Bottom border
  const bottomBorder =
    color(cs.bl) +
    color(cs.h.repeat(W + 2 - 2)) + // W inner + no title on bottom
    color(cs.br);

  output.push(bottomBorder);
  return output;
}

/** Render and print a box directly */
export function printBox(title: string, lines: string[], opts: BoxOptions = {}): void {
  for (const line of box(title, lines, opts)) {
    console.log(line);
  }
}
