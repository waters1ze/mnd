// test/router.test.ts
import { registerCommands, route, parseInput } from "../src/repl/router.js";
import type { CommandHandler } from "../src/repl/router.js";

// ─── Mock @clack/prompts to avoid interactive prompts in tests ────────────────

jest.mock("@clack/prompts", () => ({
  confirm: jest.fn().mockResolvedValue(true), // auto-confirm fuzzy matches
}));

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeHandler(name: string, calls: string[]): CommandHandler {
  return async (_args, raw) => { calls.push(name); };
}

// ─── parseInput() ─────────────────────────────────────────────────────────────

describe("parseInput()", () => {
  test("extracts quoted argument", () => {
    const result = parseInput('open "My Project"');
    expect(result.firstWord).toBe("open");
    expect(result.quotedArgs).toContain("My Project");
  });

  test("extracts multiple quoted args", () => {
    const result = parseInput('fix "Error 1" "Error 2"');
    expect(result.quotedArgs).toEqual(["Error 1", "Error 2"]);
  });

  test("preserves flags and quoted values in their original order", () => {
    const result = parseInput('auto --folder "D:\\My Footage" --prompt "fast edit" --model "Gemini 3.5 Flash (Low)"');
    expect(result.unquotedTokens).toEqual([
      "auto", "--folder", "D:\\My Footage", "--prompt", "fast edit", "--model", "Gemini 3.5 Flash (Low)",
    ]);
  });

  test("first word lowercased", () => {
    const result = parseInput("ANALYZE");
    expect(result.firstWord).toBe("analyze");
  });

  test("fullCommand is first two words", () => {
    const result = parseInput("show history");
    expect(result.fullCommand).toBe("show history");
  });

  test("empty input", () => {
    const result = parseInput("   ");
    expect(result.firstWord).toBe("");
  });
});

// ─── route() ──────────────────────────────────────────────────────────────────

describe("route()", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    registerCommands([
      { name: "config", handler: makeHandler("config", calls) },
      { name: "open", handler: makeHandler("open", calls) },
      { name: "folder", handler: makeHandler("folder", calls) },
      { name: "analyze", aliases: ["analyse"], handler: makeHandler("analyze", calls) },
      { name: "show history", handler: makeHandler("showHistory", calls) },
      { name: "prompt", handler: makeHandler("prompt", calls) },
      { name: "status", handler: makeHandler("status", calls) },
    ]);
  });

  test("exact match dispatches to correct handler", async () => {
    await route("config");
    expect(calls).toEqual(["config"]);
  });

  test("alias match works", async () => {
    await route("analyse");
    expect(calls).toEqual(["analyze"]);
  });

  test("folder command dispatches without requiring a typed path", async () => {
    await route("/folder");
    expect(calls).toEqual(["folder"]);
  });

  test("multi-word command 'show history' dispatched correctly", async () => {
    await route("show history");
    expect(calls).toEqual(["showHistory"]);
  });

  test("fuzzy typo (distance 1) auto-confirmed → dispatches", async () => {
    // "opem" → distance 1 from "open", mock confirm returns true
    await route("opem");
    expect(calls).toEqual(["open"]);
  });

  test("unknown command with distance > 2 falls through to prompt", async () => {
    await route("zzz-unknown");
    expect(calls).toEqual(["prompt"]);
  });

  test("empty input does nothing", async () => {
    await route("   ");
    expect(calls).toHaveLength(0);
  });

  test("quoted arg passed to handler", async () => {
    const argCalls: string[][] = [];
    registerCommands([
      {
        name: "open",
        handler: async (args) => { argCalls.push(args); },
      },
    ]);
    await route('open "My Project"');
    expect(argCalls[0]).toContain("My Project");
  });

  test("ambiguous fuzzy match (two equally close) → falls through to prompt", async () => {
    // "stt" is equidistant from "status" and some other — if ambiguous, goes to prompt
    // Register two commands close to "stt"
    const localCalls: string[] = [];
    registerCommands([
      { name: "sat", handler: makeHandler("sat", localCalls) },
      { name: "sit", handler: makeHandler("sit", localCalls) },
      { name: "prompt", handler: makeHandler("prompt", localCalls) },
    ]);
    // "stt" vs "sat" = 1, "stt" vs "sit" = 1 — two candidates at same distance
    await route("stt");
    // Should fall through to prompt since ambiguous
    expect(localCalls).toContain("prompt");
  });
});
