import { handleObsidian } from "../src/commands/obsidian.js";
import { updateConfigField } from "../src/core/config.js";

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ vault_path: "C:\\Fake\\Vault", obsidian: { initialized: true } }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault"),
  updateConfigField: jest.fn().mockImplementation(cb => {
     const cfg = { obsidian: { initialized: true, vault_id: "xyz" } };
     cb(cfg);
     return Promise.resolve(cfg);
  })
}));
jest.mock("@clack/prompts", () => ({
  confirm: jest.fn().mockResolvedValue(true),
  isCancel: jest.fn().mockReturnValue(false)
}));

describe("obsidianReset", () => {
  it("resets metadata upon confirmation", async () => {
    await handleObsidian(["reset-metadata"], "/obsidian reset-metadata");
    expect(updateConfigField).toHaveBeenCalled();
  });
});
