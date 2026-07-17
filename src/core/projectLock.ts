import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { getProjectPaths } from "./projectPaths.js";
import { atomicWriteFile } from "./atomic.js";

export interface ProjectLockData {
  runId: string;
  pid: number;
  hostname: string;
  createdAt: string;
}

export interface LockHeartbeat {
  runId: string;
  updatedAt: string;
}

let activeLockInterval: NodeJS.Timeout | null = null;
let ownedRunId: string | null = null;
let ownedSlug: string | null = null;
let ownedVaultPath: string | null = null;

function isProcessAlive(pid: number): boolean | "unknown" {
  try {
    process.kill(pid, 0);
    return true; // Signal sent successfully, process exists
  } catch (e: any) {
    if (e.code === "EPERM") {
      // Access denied means process exists but we don't have permission to signal
      return "unknown"; 
    }
    if (e.code === "ESRCH") {
      return false; // Process does not exist
    }
    return "unknown";
  }
}

export async function acquireProjectLock(vaultPath: string, slug: string, runId: string): Promise<boolean> {
  const paths = getProjectPaths(vaultPath, slug);
  const lockData: ProjectLockData = {
    runId,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
  };

  // Check if stale lock exists
  if (existsSync(paths.lockJson)) {
    try {
      const existingRaw = await readFile(paths.lockJson, "utf-8");
      const existing = JSON.parse(existingRaw) as ProjectLockData;
      
      // If it's on this machine, check PID
      if (existing.hostname === lockData.hostname) {
        const alive = isProcessAlive(existing.pid);
        if (alive === false) {
          // Process is definitively dead, we can clear the stale lock
          await releaseStaleLock(vaultPath, slug, existing.runId);
        } else {
          return false; // Lock held by live/unknown process
        }
      } else {
        // Different machine, rely on heartbeat
        if (existsSync(paths.lockHeartbeatJson)) {
          const hbRaw = await readFile(paths.lockHeartbeatJson, "utf-8");
          const hb = JSON.parse(hbRaw) as LockHeartbeat;
          if (hb.runId === existing.runId) {
            const hbTime = new Date(hb.updatedAt).getTime();
            const now = Date.now();
            if (now - hbTime > 30000) {
              // Heartbeat older than 30s, assume stale
              await releaseStaleLock(vaultPath, slug, existing.runId);
            } else {
              return false; // Lock held by active process
            }
          } else {
            // Heartbeat mismatch, stale
            await releaseStaleLock(vaultPath, slug, existing.runId);
          }
        } else {
          // No heartbeat, check if lock is older than 30s
          const lockTime = new Date(existing.createdAt).getTime();
          if (Date.now() - lockTime > 30000) {
            await releaseStaleLock(vaultPath, slug, existing.runId);
          } else {
            return false;
          }
        }
      }
    } catch {
      // Unparseable lock file, might be corrupt. We'll try to override, but if 'wx' fails it fails.
      await releaseStaleLock(vaultPath, slug, "force");
    }
  }

  try {
    const handle = await open(paths.lockJson, "wx");
    try {
      await handle.writeFile(JSON.stringify(lockData, null, 2), "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Success! We own the lock.
    ownedRunId = runId;
    ownedSlug = slug;
    ownedVaultPath = vaultPath;

    // Start heartbeat
    await updateHeartbeat();
    activeLockInterval = setInterval(updateHeartbeat, 10000); // 10s
    activeLockInterval.unref();

    return true;
  } catch (e: any) {
    if (e.code === "EEXIST") {
      return false;
    }
    throw e;
  }
}

async function updateHeartbeat() {
  if (!ownedRunId || !ownedVaultPath || !ownedSlug) return;
  const paths = getProjectPaths(ownedVaultPath, ownedSlug);
  const hb: LockHeartbeat = {
    runId: ownedRunId,
    updatedAt: new Date().toISOString()
  };
  try {
    await atomicWriteFile(paths.lockHeartbeatJson, JSON.stringify(hb, null, 2));
  } catch {
    // Ignore heartbeat write errors
  }
}

async function releaseStaleLock(vaultPath: string, slug: string, runId: string) {
  const paths = getProjectPaths(vaultPath, slug);
  try { await unlink(paths.lockJson); } catch {}
  try { await unlink(paths.lockHeartbeatJson); } catch {}
}

export async function releaseProjectLock(): Promise<void> {
  if (!ownedRunId || !ownedVaultPath || !ownedSlug) return;
  
  if (activeLockInterval) {
    clearInterval(activeLockInterval);
    activeLockInterval = null;
  }

  const paths = getProjectPaths(ownedVaultPath, ownedSlug);
  if (existsSync(paths.lockJson)) {
    try {
      const existingRaw = await readFile(paths.lockJson, "utf-8");
      const existing = JSON.parse(existingRaw) as ProjectLockData;
      if (existing.runId === ownedRunId) {
        await unlink(paths.lockJson);
        if (existsSync(paths.lockHeartbeatJson)) {
          await unlink(paths.lockHeartbeatJson);
        }
      }
    } catch {
      // If we can't read it, we don't delete it
    }
  }

  ownedRunId = null;
  ownedSlug = null;
  ownedVaultPath = null;
}
