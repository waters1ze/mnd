import { registerVaultSafely } from "../src/integrations/obsidian.js";

jest.mock("node:child_process", () => ({
  exec: jest.fn((cmd, cb) => cb(null, "INFO: No tasks are running")),
  spawn: jest.fn()
}));

let fileContent = '{"vaults":{}}';

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(() => Promise.resolve(fileContent)),
  writeFile: jest.fn((path, content) => {
    // If it's a temp file, update fileContent when atomicWriteFile renames?
    // Actually, we just update fileContent here to trick the verify step
    fileContent = content.toString();
    return Promise.resolve();
  }),
  rename: jest.fn(() => Promise.resolve()),
  mkdir: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  openSync: jest.fn(),
  closeSync: jest.fn(),
  fsyncSync: jest.fn()
}));

describe("obsidianRegistration", () => {
  it("registers vault safely if not running", async () => {
    const res = await registerVaultSafely("C:\\Fake\\Vault");
    if (!res.success) console.error("Error from registerVaultSafely:", res.error);
    expect(res.success).toBe(true);
    expect(res.vaultId).toBeTruthy();
  });
});
