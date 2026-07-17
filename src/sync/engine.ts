// src/sync/engine.ts
import { resolve, join, relative, isAbsolute } from "node:path";
import { unlink } from "node:fs/promises";
import { uploadFileResumable, updateFileResumable } from "../integrations/googleDrive/upload.js";
import { downloadFile, deleteDriveFile } from "../integrations/googleDrive/download.js";
import { resolveNestedFolder } from "../integrations/googleDrive/layout.js";
import { basename } from "node:path";
import type { SyncPlan, SyncManifest } from "./types.js";
import { getAbortController } from "../core/cancellation.js";

export async function executeSyncPlan(
  plan: SyncPlan,
  localDir: string,
  remoteFolderId: string,
  manifest: SyncManifest,
  onProgress: (action: string, progress: string) => void
): Promise<void> {
  const signal = getAbortController().signal;
  const folderCache: Record<string, string> = {};

  for (const action of plan.actions) {
    if (signal.aborted) throw new Error("Sync aborted");

    const entry = action.entry;
    const root = resolve(localDir);
    const target = resolve(root, entry.relativePath);
    const rel = relative(root, target);

    const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    if (!inside || /^[a-zA-Z]:/.test(entry.relativePath) || entry.relativePath.startsWith("\\\\")) {
      console.warn(`Path traversal detected and blocked: ${entry.relativePath}`);
      entry.state = "error" as any;
      continue;
    }

    const localPath = target;
    const appProps = { relativePath: entry.relativePath };

    try {
      if (action.type === "push") {
        onProgress(`Uploading ${entry.relativePath}...`, "");
        if (entry.remoteFileId) {
          await updateFileResumable(entry.remoteFileId, localPath, { signal, appProperties: appProps });
        } else {
          const actualParentId = await resolveNestedFolder(entry.relativePath, remoteFolderId, folderCache);
          const fileName = basename(entry.relativePath);
          entry.remoteFileId = await uploadFileResumable(localPath, fileName, {
            parentId: actualParentId,
            signal,
            appProperties: appProps,
          });
        }
        
        // Update manifest
        entry.lastSyncedHash = entry.localHash;
        entry.lastSyncedAt = new Date().toISOString();
        entry.state = "synced";
        manifest.entries[entry.relativePath] = entry;

      } else if (action.type === "pull") {
        onProgress(`Downloading ${entry.relativePath}...`, "");
        if (!entry.remoteFileId) throw new Error("Missing remoteFileId for pull");
        await downloadFile(entry.remoteFileId, localPath, { signal });
        
        // Since we downloaded it, the next plan should see it as unchanged.
        // The hash will be calculated next time, but we can assume synced for now.
        entry.lastSyncedHash = entry.remoteMd5Checksum;
        entry.lastSyncedAt = new Date().toISOString();
        entry.state = "synced";
        manifest.entries[entry.relativePath] = entry;

      } else if (action.type === "mark_tombstone") {
        onProgress(`Marking tombstone for ${entry.relativePath}...`, "");
        entry.tombstone = {
          relativePath: entry.relativePath,
          deletedRemoteAt: new Date().toISOString(),
          resolution: "pending",
          ...(entry.remoteFileId ? { remoteFileId: entry.remoteFileId } : {})
        };
        manifest.entries[entry.relativePath] = entry;

      } else if (action.type === "delete_remote") {
        onProgress(`Deleting remote ${entry.relativePath}...`, "");
        if (entry.remoteFileId) {
          await deleteDriveFile(entry.remoteFileId);
        }
        delete manifest.entries[entry.relativePath];
      }
    } catch (err: any) {
      if (err.message === "Sync aborted" || err.name === "AbortError") throw err;
      console.warn(`Failed to execute ${action.type} for ${entry.relativePath}: ${err.message}`);
      // Leave in manifest as pending/conflict depending on logic
      entry.state = "error" as any;
    }
  }
}
