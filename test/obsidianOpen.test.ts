import { openRegisteredVault } from "../src/integrations/obsidian.js";
import { spawn } from "node:child_process";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() }))
}));

describe("obsidianOpen", () => {
  it("opens registered vault with uri", async () => {
    await openRegisteredVault("abc-123", "Home.md");
    expect(spawn).toHaveBeenCalled();
    const args = (spawn as jest.Mock).mock.calls[0];
    const uriString = args.flat().join(" ");
    expect(uriString).toContain("obsidian://open");
    expect(uriString).toContain("vault=abc-123");
    expect(uriString).toContain("file=Home.md");
  });
});
