import { handleAnalyze } from "../src/commands/analyze.js";

describe("analyze command", () => {
  test("returns undefined if no project slug is active and args are empty", async () => {
    // If we call handleAnalyze with empty args, it will return undefined
    const res = await handleAnalyze([], "");
    expect(res).toBeUndefined();
  });
});
