import { handleObsidian } from "../src/commands/obsidian.js";

jest.mock("chalk", () => {
  const m = jest.fn((str) => str) as any;
  m.cyan = m;
  m.green = m;
  m.yellow = m;
  m.red = m;
  m.gray = m;
  m.bold = m;
  m.white = m;

  return m;
});

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: false } }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault"),
  updateConfigField: jest.fn()
}));
jest.mock("node:child_process", () => ({
  exec: jest.fn((cmd, cb) => cb(null, ""))
}));
jest.mock("@clack/prompts", () => ({
  text: jest.fn().mockResolvedValue("C:\\Fake\\Vault"),
  isCancel: jest.fn().mockReturnValue(false),
  confirm: jest.fn().mockResolvedValue(true)
}));
jest.mock("../src/integrations/obsidian.js", () => {
  const original = jest.requireActual("../src/integrations/obsidian.js");
  return {
    ...original,
    registerVaultSafely: jest.fn().mockResolvedValue({ success: true, vaultId: "test-id" }),
    getRegisteredVaultId: jest.fn().mockResolvedValue(null),
    openRegisteredVault: jest.fn().mockResolvedValue(undefined)
  };
});
jest.mock("node:fs", () => {
  const original = jest.requireActual("node:fs");
  return {
    ...original,
    existsSync: jest.fn().mockReturnValue(false),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn().mockReturnValue([]),
    statSync: jest.fn((p: string) => ({ isDirectory: () => true })),
    realpathSync: jest.fn((p: string) => p)
  };
});
jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined)
}));

describe("obsidianSetup", () => {
  it("RELEASE_ASSERTION: R11-OBSIDIAN-SETUP initializes vault and saves config", async () => {
    await handleObsidian([], "/obsidian");
    const config = require("../src/core/config.js");
    expect(config.updateConfigField).toHaveBeenCalled();
  });
});
