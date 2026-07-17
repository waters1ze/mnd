// test/vault.test.ts
// Tests git scoping: only Global_Rules/, Styles/, Skills/ tracked
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureVaultStructure, slugify } from "../src/core/vault.js";
import simpleGit from "simple-git";

let tmpVault: string;

beforeEach(async () => {
  tmpVault = await mkdtemp(join(tmpdir(), "mnd-vault-"));
});

afterEach(async () => {
  await rm(tmpVault, { recursive: true, force: true });
});

describe("ensureVaultStructure()", () => {
  test("creates all required directories", async () => {
    await ensureVaultStructure(tmpVault);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpVault, "Global_Rules"))).toBe(true);
    expect(existsSync(join(tmpVault, "Styles"))).toBe(true);
    expect(existsSync(join(tmpVault, "Skills"))).toBe(true);
    expect(existsSync(join(tmpVault, "Assets"))).toBe(true);
    expect(existsSync(join(tmpVault, "Projects"))).toBe(true);
  });

  test("initializes git repository", async () => {
    await ensureVaultStructure(tmpVault);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpVault, ".git"))).toBe(true);
  });

  test("writes .gitignore that excludes Assets/ and Projects/", async () => {
    await ensureVaultStructure(tmpVault);
    const { readFile } = await import("node:fs/promises");
    const gitignore = await readFile(join(tmpVault, ".gitignore"), "utf-8");
    expect(gitignore).toContain("Assets/");
    expect(gitignore).toContain("Projects/");
  });

  test("git status does NOT track files in Assets/ or Projects/", async () => {
    await ensureVaultStructure(tmpVault);

    // Create a file in Assets/
    await writeFile(join(tmpVault, "Assets", "test.mp4"), "binary data");
    // Create a file in Projects/
    await mkdir(join(tmpVault, "Projects", "test-project"), { recursive: true });
    await writeFile(join(tmpVault, "Projects", "test-project", "project.md"), "---\nslug: test\n---");

    const git = simpleGit(tmpVault);
    const status = await git.status();

    // Neither file should appear as untracked (they're in .gitignore)
    const allFiles = [
      ...status.not_added,
      ...status.created,
      ...status.modified,
      ...status.staged,
    ];

    const hasAsset = allFiles.some((f) => f.includes("Assets/") || f.includes("test.mp4"));
    const hasProject = allFiles.some((f) => f.includes("Projects/") || f.includes("project.md"));

    expect(hasAsset).toBe(false);
    expect(hasProject).toBe(false);
  });

  test("git DOES track files in Global_Rules/", async () => {
    await ensureVaultStructure(tmpVault);

    const rulePath = join(tmpVault, "Global_Rules", "rule-001.md");
    await writeFile(rulePath, "---\nid: rule-001\ncategory: test\n---\n\nA test rule.");

    const git = simpleGit(tmpVault);
    const status = await git.status();

    const hasRule = status.not_added.some((f) => f.includes("Global_Rules"));
    expect(hasRule).toBe(true);
  });

  test("idempotent: calling twice does not throw", async () => {
    await ensureVaultStructure(tmpVault);
    await expect(ensureVaultStructure(tmpVault)).resolves.not.toThrow();
  });
});
