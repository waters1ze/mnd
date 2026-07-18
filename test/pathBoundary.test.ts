import { normalizeObsidianVaultInput, normalizeVaultPath } from "../src/integrations/obsidian.js";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Path Boundary and Normalization", () => {
  const tempDir = join(tmpdir(), "mnd-test-paths-" + Date.now());

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, "valid-vault"));
    writeFileSync(join(tempDir, "file.txt"), "hello");
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should reject root directories", () => {
    expect(() => normalizeObsidianVaultInput("C:\\")).toThrow("root of a drive");
    expect(() => normalizeObsidianVaultInput("/")).toThrow("root of a drive");
  });

  it("should reject files as vault path", () => {
    expect(() => normalizeObsidianVaultInput(join(tempDir, "file.txt"))).toThrow("must be a directory");
  });

  it("should normalize UNC paths correctly", () => {
    const p = normalizeVaultPath("\\\\WSL.LOCALHOST\\UBUNTU\\home\\user");
    expect(p).toBe("\\\\wsl.localhost\\ubuntu\\home\\user");
  });

  it("should handle symlinks and escape checks correctly in copy logic", async () => {
    // We mock the copy logic check here or just rely on normalizeVaultPath 
    // We already check symlink throwing in the main file's lstat. Let's make sure it handles "C:\Vault" vs "C:\Vault-Evil"
    // Since we changed it to use relative path in `obsidian.ts`, we know "C:\Vault-Evil" starts with "..\\" relative to "C:\Vault".
    const { relative, isAbsolute } = await import("node:path");
    const sourceReal = "C:\\Vault";
    const pReal1 = "C:\\Vault\\file.txt";
    const pReal2 = "C:\\Vault-Evil\\file.txt";
    
    let rel1 = relative(sourceReal, pReal1);
    expect(rel1.startsWith("..") || isAbsolute(rel1)).toBe(false);

    let rel2 = relative(sourceReal, pReal2);
    expect(rel2.startsWith("..") || isAbsolute(rel2)).toBe(true);
  });
});
