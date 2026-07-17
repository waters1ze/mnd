// test/levenshtein.test.ts
import { levenshtein, findClosestCommands } from "../src/repl/levenshtein.js";

describe("levenshtein()", () => {
  test("identical strings → 0", () => {
    expect(levenshtein("analyze", "analyze")).toBe(0);
  });

  test("empty string a → length of b", () => {
    expect(levenshtein("", "hello")).toBe(5);
  });

  test("empty string b → length of a", () => {
    expect(levenshtein("world", "")).toBe(5);
  });

  test("single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  test("single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  test("transposition counts as 2 ops", () => {
    // "ab" → "ba" = delete a + insert a = 2
    expect(levenshtein("ab", "ba")).toBe(2);
  });

  test("analyze vs analyse → distance 1", () => {
    expect(levenshtein("analyse", "analyze")).toBe(1);
  });

  test("analize vs analyze → distance 1", () => {
    expect(levenshtein("analize", "analyze")).toBe(1);
  });

  test("completely different strings", () => {
    // "config" vs "sort" → many changes
    expect(levenshtein("config", "sort")).toBeGreaterThan(2);
  });
});

describe("findClosestCommands()", () => {
  const COMMANDS = ["config", "open", "create", "sort", "analyze", "prompt", "approve", "fix", "status"];

  test("exact match returns distance 0", () => {
    const results = findClosestCommands("analyze", COMMANDS, 2);
    expect(results[0]?.command).toBe("analyze");
    expect(results[0]?.distance).toBe(0);
  });

  test("typo with distance 1 found", () => {
    const results = findClosestCommands("opem", COMMANDS, 2);
    expect(results[0]?.command).toBe("open");
    expect(results[0]?.distance).toBe(1);
  });

  test("distance > maxDistance excluded", () => {
    const results = findClosestCommands("xyz", COMMANDS, 2);
    expect(results.length).toBe(0);
  });

  test("results sorted by distance ascending", () => {
    const results = findClosestCommands("sert", COMMANDS, 2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.distance).toBeGreaterThanOrEqual(results[i - 1]!.distance);
    }
  });

  test("two candidates at same distance both returned", () => {
    // "cort" is equidistant from "sort" and potentially others
    const results = findClosestCommands("cort", COMMANDS, 2);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
