import { openRegisteredVault } from "../src/integrations/obsidian.js";

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() }))
}));

describe("obsidianOpen", () => {
  it("opens vault via uri", async () => {
    await expect(openRegisteredVault("test-id")).resolves.toBeUndefined();
  });
});
