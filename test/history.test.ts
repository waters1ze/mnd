import { appendHistory, loadHistory, clearHistory, navigateHistory } from "../src/repl/history.js";
import { getAppDataDir } from "../src/core/config.js";

jest.mock("../src/core/config.js", () => ({
  getAppDataDir: jest.fn().mockReturnValue("/tmp/mnd-test-history"),
}));

jest.mock("../src/core/atomic.js", () => ({
  atomicWriteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn().mockResolvedValue("[]"),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
}));

describe("history", () => {
  beforeEach(async () => {
    await clearHistory();
  });

  it("appends to history and loads it", async () => {
    await appendHistory("test command");
    const h = await loadHistory();
    expect(h).toContain("test command");
  });

  it("does not append sensitive commands", async () => {
    await appendHistory("backup something", true); // explicitly sensitive
    await appendHistory("export GROQ_API_KEY=gsk_123456789012345678901234567890"); // implicitly sensitive via regex
    const h = await loadHistory();
    expect(h).toHaveLength(0);
  });

  it("navigates history", async () => {
    await appendHistory("cmd 1");
    await appendHistory("cmd 2");

    let current = "typing...";
    current = await navigateHistory("up", current);
    expect(current).toBe("cmd 2");

    current = await navigateHistory("up", current);
    expect(current).toBe("cmd 1");

    current = await navigateHistory("down", current);
    expect(current).toBe("cmd 2");

    current = await navigateHistory("down", current);
    expect(current).toBe("typing...");
  });
});
