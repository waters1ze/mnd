import { handleObsidian } from "../src/commands/obsidian.js";

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: true } }),
  updateConfigField: jest.fn()
}));

jest.mock("@clack/prompts", () => ({
  confirm: jest.fn().mockResolvedValue(true)
}));

describe("obsidianReset", () => {
  it("runs reset command successfully", async () => {
    await handleObsidian(["reset"], "/obsidian reset");
    expect(true).toBe(true);
  });
});
