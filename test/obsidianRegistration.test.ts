import { registerVaultSafely } from "../src/integrations/obsidian.js";

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn((path) => {
    // Return buffer simulating a successful read of an updated obsidian.json
    return Promise.resolve(Buffer.from(JSON.stringify({
      vaults: {
         "mockid": { path: "C:\\Test" }
      }
    })));
  })
}));

jest.mock("../src/core/atomic.js", () => ({
  backupFile: jest.fn().mockResolvedValue("backup"),
  atomicWriteFile: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("node:child_process", () => ({
  exec: jest.fn((cmd, cb) => cb(null, "some other process"))
}));

jest.mock("node:crypto", () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from("mockid", "utf-8"))
}));

describe("obsidianRegistration", () => {
  it("registers a new vault securely", async () => {
    process.env.APPDATA = "C:\\FakeAppData";
    const res = await registerVaultSafely("C:\\Test");
    console.log(res);
    expect(res.success).toBe(true);
    expect(res.vaultId).toBeTruthy();
  });
});
