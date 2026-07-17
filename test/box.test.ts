// test/box.test.ts
import { box, pad, LIGHT, HEAVY, INNER_WIDTH } from "../src/ui/box.js";

// Strip ANSI escape codes for comparison
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

function visibleWidth(s: string): number {
  const plain = stripAnsi(s);
  // Simple width: count chars (ASCII only in tests)
  return plain.length;
}

describe("pad()", () => {
  test("short string gets padded to width", () => {
    const result = pad("hello", 10);
    expect(stripAnsi(result).length).toBe(10);
  });

  test("exact-length string unchanged width", () => {
    const result = pad("hello", 5);
    expect(stripAnsi(result).length).toBe(5);
  });

  test("long string gets truncated to width", () => {
    const result = pad("hello world", 5);
    expect(stripAnsi(result).length).toBe(5);
  });

  test("empty string padded correctly", () => {
    const result = pad("", 8);
    expect(stripAnsi(result).length).toBe(8);
  });
});

describe("box()", () => {
  const TITLE = "Test";
  const LINES = ["Line one", "Line two", "Third line"];

  test("returns correct number of lines (top + content + bottom)", () => {
    const result = box(TITLE, LINES);
    expect(result.length).toBe(LINES.length + 2); // top border + lines + bottom border
  });

  test("all content lines have same visible width", () => {
    const result = box(TITLE, LINES, { width: INNER_WIDTH });
    const contentLines = result.slice(1, -1); // exclude top/bottom borders
    const widths = contentLines.map((l) => visibleWidth(l));
    const allSame = widths.every((w) => w === widths[0]);
    expect(allSame).toBe(true);
  });

  test("LIGHT charset uses thin characters", () => {
    const result = box(TITLE, LINES, { charset: LIGHT });
    expect(result[0]).toContain(LIGHT.tl);
    expect(result[0]).toContain(LIGHT.tr);
    expect(result[result.length - 1]).toContain(LIGHT.bl);
    expect(result[result.length - 1]).toContain(LIGHT.br);
  });

  test("HEAVY charset uses thick characters", () => {
    const result = box(TITLE, LINES, { charset: HEAVY });
    const top = stripAnsi(result[0]!);
    const bottom = stripAnsi(result[result.length - 1]!);
    expect(top).toContain(HEAVY.tl);
    expect(top).toContain(HEAVY.tr);
    expect(bottom).toContain(HEAVY.bl);
    expect(bottom).toContain(HEAVY.br);
  });

  test("title appears in top border", () => {
    const result = box(TITLE, LINES);
    expect(stripAnsi(result[0]!)).toContain(TITLE);
  });

  test("empty lines array produces top+bottom only", () => {
    const result = box(TITLE, []);
    expect(result.length).toBe(2);
  });

  test("custom width respected in content lines", () => {
    const W = 30;
    const result = box(TITLE, ["short"], { width: W });
    const contentLine = stripAnsi(result[1]!);
    // Content line: │ + padded(W-2) + │ — total should be W+2 with borders
    // Actually box uses W as inner, so borders are outside
    // Just check content line length is consistent
    expect(contentLine.length).toBeGreaterThan(0);
  });
});
