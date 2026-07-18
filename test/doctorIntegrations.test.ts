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
jest.mock("../src/core/pythonSidecarClient.js", () => ({
  sidecarPing: jest.fn().mockResolvedValue(false)
}));
jest.mock("../src/core/secrets.js", () => ({
  secretsHasKey: jest.fn().mockReturnValue(false)
}));

describe("doctorIntegrations", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("produces valid json without unrelated stdout and accurately reflects states", async () => {
    await handleDoctor(["--json"], "doctor --json");
    
    // Exactly one call to console.log is expected with JSON
    expect(logSpy).toHaveBeenCalledTimes(1);
    
    const output = logSpy.mock.calls[0][0];
    const data = JSON.parse(output);
    
    // Assert on some statuses based on the mocks above
    expect(data.runtime.find((r: any) => r.name === "Node.js").status).toBe("PASS");
    
    // Obsidian Existence should be FAIL because existsSync is false
    expect(data.integrations.find((r: any) => r.name === "Obsidian Vault Existence").status).toBe("FAIL");
    
    // Antigravity should be FAIL since we mock not_found
    expect(data.integrations.find((r: any) => r.name === "Antigravity Identity").status).toBe("FAIL");
    
    // Python Sidecar FAIL
    expect(data.integrations.find((r: any) => r.name === "Python Sidecar").status).toBe("FAIL");
  });
});
