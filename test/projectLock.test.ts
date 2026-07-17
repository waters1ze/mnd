import { acquireProjectLock, releaseProjectLock } from "../src/core/projectLock.js";
import { getProjectPaths } from "../src/core/projectPaths.js";
import { mkdir, unlink, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";

describe("projectLock", () => {
  let vaultPath: string;
  const slug = "lock-test-slug";

  beforeEach(async () => {
    vaultPath = join(tmpdir(), `mnd-lock-test-${Date.now()}`);
    const paths = getProjectPaths(vaultPath, slug);
    await mkdir(paths.root, { recursive: true });
  });

  afterEach(async () => {
    await releaseProjectLock();
    await rm(vaultPath, { recursive: true, force: true });
  });

  test("acquires lock successfully", async () => {
    const success = await acquireProjectLock(vaultPath, slug, "run-123");
    expect(success).toBe(true);

    const paths = getProjectPaths(vaultPath, slug);
    expect(existsSync(paths.lockJson)).toBe(true);
  });

  test("fails to acquire lock if held by live process", async () => {
    const paths = getProjectPaths(vaultPath, slug);
    await mkdir(dirname(paths.lockJson), { recursive: true });
    await writeFile(paths.lockJson, JSON.stringify({
      runId: "run-other",
      pid: process.pid, // using our own PID so isProcessAlive(pid) returns true
      hostname: hostname(),
      timestamp: Date.now()
    }));

    const success = await acquireProjectLock(vaultPath, slug, "run-123");
    expect(success).toBe(false);
  });

  test("clears stale lock if process is dead", async () => {
    const paths = getProjectPaths(vaultPath, slug);
    await mkdir(dirname(paths.lockJson), { recursive: true });
    await writeFile(paths.lockJson, JSON.stringify({
      runId: "run-stale",
      pid: 99999999, // likely dead
      hostname: hostname(),
      createdAt: new Date().toISOString()
    }));

    const success = await acquireProjectLock(vaultPath, slug, "run-123");
    expect(success).toBe(true);
    // the new lock was written
  });

  test("releases lock correctly", async () => {
    await acquireProjectLock(vaultPath, slug, "run-123");
    await releaseProjectLock();
    const paths = getProjectPaths(vaultPath, slug);
    expect(existsSync(paths.lockJson)).toBe(false);
  });
});
