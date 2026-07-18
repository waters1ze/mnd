// src/sync/planner.ts
import { stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
// Removed globSync
import { readdirSync, statSync } from "node:fs";
import type { SyncManifest, SyncPlan, SyncEntry, SyncActionType, SyncPlanAction } from "./types.js";
import { isFileInScope, type SyncScopeOptions } from "./policy.js";
import { findDriveFoldersByName } from "../integrations/googleDrive/layout.js";
import { driveFetchJson } from "../integrations/googleDrive/client.js";

// Helper to recursively list files in directory
function walkDir(dir: string, baseDir: string, options: SyncScopeOptions, results: string[] = []): string[] {
  let list;
  try {
    list = readdirSync(dir);
  } catch {
    return results; // Directory might not exist
  }
  
  for (const file of list) {
    const fullPath = join(dir, file);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
    
    // Check scope early to avoid descending into excluded dirs
    if (!isFileInScope(relPath, options)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, baseDir, options, results);
    } else if (stat.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

async function computeMd5(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("md5").update(data).digest("hex");
}

export async function createSyncPlan(
  localDir: string,
  remoteFolderId: string,
  manifest: SyncManifest,
  options: SyncScopeOptions
): Promise<SyncPlan> {
  const plan: SyncPlan = { actions: [], conflicts: [] };
  const entries = { ...manifest.entries };

  // 1. Scan Local Files
  const localFiles = walkDir(localDir, localDir, options);
  const localMap = new Map<string, { size: number; mtime: string; hash?: string }>();

  for (const relPath of localFiles) {
    const fullPath = join(localDir, relPath);
    const s = statSync(fullPath);
    localMap.set(relPath, {
      size: s.size,
      mtime: s.mtime.toISOString(),
    });
  }

  // 2. Fetch Remote Files
  const remoteMap = new Map<string, any>();
  let pageToken: string | undefined;
  do {
    const q = `'${remoteFolderId}' in parents and trashed = false`;
    const url = `/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,appProperties,modifiedTime,md5Checksum,headRevisionId)&spaces=drive${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await driveFetchJson<any>(url);
    for (const f of res.files || []) {
      if (f.mimeType !== "application/vnd.google-apps.folder") {
        // Use appProperties for relativePath if available, else name
        const relPath = f.appProperties?.relativePath || f.name;
        if (isFileInScope(relPath, options)) {
          remoteMap.set(relPath, f);
        }
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  // 3. Compare Local vs Remote vs Manifest (3-way merge)
  const allPaths = new Set([...localMap.keys(), ...remoteMap.keys(), ...Object.keys(entries)]);

  for (const relPath of allPaths) {
    if (!isFileInScope(relPath, options)) continue; // skip paths not in scope anymore

    const local = localMap.get(relPath);
    const remote = remoteMap.get(relPath);
    const entry = entries[relPath] || { version: 1, relativePath: relPath, state: "pending" };

    const localExists = !!local;
    const remoteExists = !!remote;

    // Check if local actually changed
    let localChanged = false;
    if (localExists) {
      if (!entry.lastSyncedHash || !entry.localMtime || entry.localMtime !== local.mtime) {
        // Need to check hash
        const hash = await computeMd5(join(localDir, relPath));
        local.hash = hash;
        if (hash !== entry.lastSyncedHash) {
          localChanged = true;
        }
      }
    }

    // Check if remote changed
    let remoteChanged = false;
    if (remoteExists) {
      if (remote.md5Checksum !== entry.remoteMd5Checksum || remote.headRevisionId !== entry.remoteRevision) {
        remoteChanged = true;
      }
    }

    if (!localExists && !remoteExists) {
      // both deleted, clean up manifest
      continue; 
    }

    if (entry.tombstone && entry.tombstone.resolution === "pending") {
      plan.conflicts.push({ type: "conflict", entry, reason: "Pending tombstone conflict" });
      continue;
    }

    if (localExists && !remoteExists) {
      if (entry.lastSyncedHash) {
        // Remote was deleted
        if (localChanged) {
          plan.conflicts.push({ type: "conflict", entry, reason: "Local modified, remote deleted" });
        } else {
          // Never delete automatically. Create a tombstone instead.
          plan.actions.push({ type: "mark_tombstone", entry, reason: "Deleted remotely" });
        }
      } else {
        // New local file
        plan.actions.push({ type: "push", entry, reason: "New local file" });
      }
      continue;
    }

    if (!localExists && remoteExists) {
      if (entry.lastSyncedHash) {
        // Local was deleted
        if (remoteChanged) {
          plan.conflicts.push({ type: "conflict", entry, reason: "Remote modified, local deleted" });
        } else {
          plan.actions.push({ type: "delete_remote", entry, reason: "Deleted locally" });
        }
      } else {
        // New remote file
        plan.actions.push({ type: "pull", entry, reason: "New remote file" });
      }
      continue;
    }

    // Both exist
    if (!localChanged && !remoteChanged) {
      // In sync
      entry.state = "synced";
      continue;
    }

    if (localChanged && !remoteChanged) {
      plan.actions.push({ type: "push", entry, reason: "Local modified" });
    } else if (!localChanged && remoteChanged) {
      plan.actions.push({ type: "pull", entry, reason: "Remote modified" });
    } else {
      // Both changed -> conflict
      plan.conflicts.push({ type: "conflict", entry, reason: "Both modified" });
    }

    // Assign temporary state metadata for the plan
    entry.localHash = local?.hash;
    entry.localSize = local?.size;
    entry.localMtime = local?.mtime;
    entry.remoteFileId = remote?.id;
    entry.remoteRevision = remote?.headRevisionId;
    entry.remoteMd5Checksum = remote?.md5Checksum;
    entry.remoteModifiedTime = remote?.modifiedTime;
  }

  return plan;
}
