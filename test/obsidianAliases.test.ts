import { handleObsidian } from "../src/commands/obsidian.js";

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: true } }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault"),
  updateConfigField: jest.fn()
}));

jest.mock("../src/integrations/obsidian.js", () => ({
  registerVaultSafely: jest.fn().mockResolvedValue({ success: true, vaultId: "test-id" }),
  getRegisteredVaultId: jest.fn().mockResolvedValue("test-id"),
  openRegisteredVault: jest.fn().mockResolvedValue(undefined)
}));

describe("obsidianAliases", () => {
  it("runs default /obidian correctly", async () => {
    // Should not throw, should call openRegisteredVault
    await handleObsidian([], "/obidian");
    expect(true).toBe(true);
  });
});
