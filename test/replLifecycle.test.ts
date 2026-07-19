import { shouldExitRepl } from "../src/repl/loop.js";

describe("MND REPL lifecycle", () => {
  test("only an explicit exit command closes the program", () => {
    expect(shouldExitRepl("exit")).toBe(true);
    expect(shouldExitRepl("  QUIT  ")).toBe(true);
    expect(shouldExitRepl(null)).toBe(false);
    expect(shouldExitRepl("")).toBe(false);
    expect(shouldExitRepl("/obsidian")).toBe(false);
    expect(shouldExitRepl("close project")).toBe(false);
  });
});
