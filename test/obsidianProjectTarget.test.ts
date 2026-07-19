import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureObsidianProjectTarget } from "../src/commands/obsidian.js";
import { ensureVaultStructure } from "../src/core/vault.js";
import { session } from "../src/repl/loop.js";

describe("Obsidian project target", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "mnd-obsidian-project-"));
    await ensureVaultStructure(vaultPath);
    session.currentProjectSlug = null;
  });

  afterEach(async () => {
    session.currentProjectSlug = null;
    await rm(vaultPath, { recursive: true, force: true });
  });

  test("creates the first MND project and reuses it on the next open", async () => {
    const created = await ensureObsidianProjectTarget(vaultPath);
    expect(created.created).toBe(true);
    expect(existsSync(join(vaultPath, created.notePath))).toBe(true);
    expect(session.currentProjectSlug).toBe(created.slug);

    const reopened = await ensureObsidianProjectTarget(vaultPath);
    expect(reopened).toEqual({ ...created, created: false });
  });
});
