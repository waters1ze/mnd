// test/commandPalette.test.ts
import { filterCommands, handleSelection } from "../src/ui/replInput.js";
import type { CommandDefinition } from "../src/repl/router.js";

const TEST_REGISTRY: CommandDefinition[] = [
  { name: "open", slash: "/open", icon: "▸", description: "Open project", acceptsArgs: true },
  { name: "analyze", slash: "/analyze", icon: "◈", description: "Analyze video", acceptsArgs: false },
  { name: "create", slash: "/create", icon: "+", description: "Create project", acceptsArgs: true },
];

function getNextIndex(current: number, direction: 'up' | 'down', total: number): number {
  if (total === 0) return 0;
  if (direction === 'up') {
    return (current - 1 + total) % total;
  } else {
    return (current + 1) % total;
  }
}

describe("Command Palette Logic", () => {
  describe("filterCommands", () => {
    test("returns full registry on empty query", () => {
      const results = filterCommands("", TEST_REGISTRY);
      expect(results).toEqual(TEST_REGISTRY);
    });

    test("filters by prefix match", () => {
      const results = filterCommands("op", TEST_REGISTRY);
      expect(results.map(r => r.name)).toEqual(["open"]);
    });

    test("filters by prefix match with leading slash", () => {
      const results = filterCommands("/cre", TEST_REGISTRY);
      expect(results.map(r => r.name)).toEqual(["create"]);
    });

    test("filters by Levenshtein distance <= 2 (fuzzy)", () => {
      // "opem" is distance 1 from "open"
      const results = filterCommands("opem", TEST_REGISTRY);
      expect(results.map(r => r.name)).toEqual(["open"]);
    });

    test("excludes commands with Levenshtein distance > 2", () => {
      // "xyz" is distance 4+ from all
      const results = filterCommands("xyz", TEST_REGISTRY);
      expect(results).toHaveLength(0);
    });
  });

  describe("Index wrap-around logic", () => {
    test("wraps around from 0 to last item when going UP", () => {
      const next = getNextIndex(0, "up", 3);
      expect(next).toBe(2);
    });

    test("wraps around from last item to 0 when going DOWN", () => {
      const next = getNextIndex(2, "down", 3);
      expect(next).toBe(0);
    });

    test("handles zero total gracefully", () => {
      const next = getNextIndex(0, "down", 0);
      expect(next).toBe(0);
    });
  });

  describe("acceptsArgs branching", () => {
    test("returns correct result when acceptsArgs is true", () => {
      const cmd = TEST_REGISTRY.find(c => c.name === "open")!;
      const result = handleSelection(cmd);
      expect(result).toEqual({
        insertText: "/open ",
        closePalette: true,
        submit: false,
      });
    });

    test("returns correct result when acceptsArgs is false", () => {
      const cmd = TEST_REGISTRY.find(c => c.name === "analyze")!;
      const result = handleSelection(cmd);
      expect(result).toEqual({
        insertText: "/analyze",
        closePalette: true,
        submit: true,
      });
    });
  });
});
