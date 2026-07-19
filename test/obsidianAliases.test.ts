import { handleObsidian } from "../src/commands/obsidian.js";
import { openRegisteredVault } from "../src/integrations/obsidian.js";
import { session } from "../src/repl/loop.js";

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

jest.mock("../src/core/vault.js", () => ({
  ensureVaultStructure: jest.fn().mockResolvedValue(undefined),
  listProjects: jest.fn().mockResolvedValue([{
    slug: "current-project",
    filePath: "C:\\Fake\\Vault\\Projects\\current-project\\project.md",
    frontmatter: { created: "2026-01-01T00:00:00.000Z", updated: "2026-01-02T00:00:00.000Z" }
  }]),
  createProject: jest.fn().mockResolvedValue("first-mnd-project")
}));

jest.mock("../src/core/projectPaths.js", () => ({
  getProjectPaths: jest.fn().mockReturnValue({ projectMd: "C:\\Fake\\Vault\\Projects\\current-project\\project.md" })
}));

describe("obsidianAliases", () => {
  beforeEach(() => {
    session.currentProjectSlug = null;
    jest.clearAllMocks();
  });

  it("runs default /obidian correctly", async () => {
    await handleObsidian([], "/obidian");
    expect(openRegisteredVault).toHaveBeenCalledWith("test-id", "Projects/current-project/project.md");
  });
});
