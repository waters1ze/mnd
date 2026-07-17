import { handleDoctor } from "../src/commands/doctor.js";

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ 
    profile: "test",
    vault_path: "C:\\Fake\\Vault", 
    models: { test: {} },
    connections: { antigravity: {} }
  }),
  resolveVaultPath: jest.fn().mockReturnValue("C:\\Fake\\Vault")
}));
jest.mock("../src/integrations/antigravityDiscovery.js", () => ({
  getVerifiedAntigravity: jest.fn().mockResolvedValue({ status: "not_found", checkedCandidates: [] })
}));
jest.mock("../src/integrations/obsidian.js", () => ({
  getRegisteredVaultId: jest.fn().mockResolvedValue(null),
  registerVaultSafely: jest.fn().mockResolvedValue({ success: true, vaultId: "test-id" })
}));
jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(false)
}));

describe("doctorIntegrations", () => {
  it("runs without throwing", async () => {
    await handleDoctor(["--json"], "doctor --json");
    expect(true).toBe(true);
  });
});
