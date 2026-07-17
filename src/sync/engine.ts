// src/sync/engine.ts
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { uploadFileResumable, updateFileResumable } from "../integrations/googleDrive/upload.js";
import { downloadFile, deleteDriveFile } from "../integrations/googleDrive/download.js";
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

  for (const action of plan.actions) {
    if (signal.aborted) throw new Error("Sync aborted");

    const entry = action.entry;
    const localPath = join(localDir, entry.relativePath);
    const appProps = { relativePath: entry.relativePath };

    try {
      if (action.type === "push") {
        onProgress(`Uploading ${entry.relativePath}...`, "");
        if (entry.remoteFileId) {
          await updateFileResumable(entry.remoteFileId, localPath, { signal, appProperties: appProps });
        } else {
          entry.remoteFileId = await uploadFileResumable(localPath, entry.relativePath, {
            parentId: remoteFolderId,
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

      } else if (action.type === "delete_local") {
        onProgress(`Deleting local ${entry.relativePath}...`, "");
        try {
          await unlink(localPath);
        } catch {}
        delete manifest.entries[entry.relativePath];

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
