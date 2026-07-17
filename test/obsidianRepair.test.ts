import { handleObsidian } from "../src/commands/obsidian.js";

let mockExistsSyncReturn = true;

jest.mock("node:fs", () => ({
  existsSync: jest.fn(() => mockExistsSyncReturn),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));
jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: true } }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault"),
  updateConfigField: jest.fn()
}));
jest.mock("../src/integrations/obsidian.js", () => ({
  registerVaultSafely: jest.fn().mockResolvedValue({ success: true, vaultId: "test-id" }),
  getRegisteredVaultId: jest.fn().mockResolvedValue(null),
  openRegisteredVault: jest.fn().mockResolvedValue(undefined)
}));

describe("obsidianRepair", () => {
  it("repairs vault without overwriting home", async () => {
    mockExistsSyncReturn = true; // home exists
    await handleObsidian(["repair"], "/obsidian repair");
    const fs = require("node:fs");
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(expect.stringContaining("Home.md"), expect.anything(), expect.anything());
  });
});
