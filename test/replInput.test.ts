// test/replInput.test.ts
import { filterCommands, handleSelection } from "../src/ui/replInput.js";
import type { CommandDefinition } from "../src/repl/router.js";

const TEST_REGISTRY: CommandDefinition[] = [
  { name: "analyze", slash: "/analyze", description: "Analyze video", acceptsArgs: false, icon: "A" },
  { name: "approve", slash: "/approve", description: "Approve plan", acceptsArgs: false, icon: "P" },
  { name: "open", slash: "/open", description: "Open project", acceptsArgs: true, icon: "O" },
];

describe("replInput filters", () => {
  test("filterCommands matches prefix without slash", () => {
    const res = filterCommands("an", TEST_REGISTRY);
    expect(res).toHaveLength(1);
    expect(res[0]!.name).toBe("analyze");
  });

  test("filterCommands matches prefix with slash", () => {
    const res = filterCommands("/an", TEST_REGISTRY);
    expect(res).toHaveLength(1);
    expect(res[0]!.name).toBe("analyze");
  });

  test("filterCommands handles typo (levenshtein)", () => {
    const res = filterCommands("/anlyze", TEST_REGISTRY);
    expect(res).toHaveLength(1);
    expect(res[0]!.name).toBe("analyze");
  });

  test("handleSelection appends space if acceptsArgs", () => {
    const cmd = TEST_REGISTRY.find(c => c.name === "open")!;
    const res = handleSelection(cmd);
    expect(res.insertText).toBe("/open ");
    expect(res.submit).toBe(false);
  });

  test("handleSelection submits immediately if no args", () => {
    const cmd = TEST_REGISTRY.find(c => c.name === "analyze")!;
    const res = handleSelection(cmd);
    expect(res.insertText).toBe("/analyze");
    expect(res.submit).toBe(true);
  });
});
