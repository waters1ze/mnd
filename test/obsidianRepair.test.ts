import { handleObsidian } from "../src/commands/obsidian.js";

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: true } }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault"),
  updateConfigField: jest.fn()
}));

jest.mock("../src/integrations/obsidian.js", () => ({
  registerVaultSafely: jest.fn().mockResolvedValue({ success: true, vaultId: "repair-id" }),
  getRegisteredVaultId: jest.fn().mockResolvedValue(null)
}));

describe("obsidianRepair", () => {
  it("runs repair command successfully", async () => {
    // Should not throw
    await handleObsidian(["repair"], "/obsidian repair");
    expect(true).toBe(true);
  });
});
