// src/sync/conflicts.ts
import { rename, copyFile, mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import type { SyncPlanAction, SyncPlan } from "./types.js";

export type ConflictResolution = "keep_local" | "keep_remote" | "keep_both" | "accept_deletion" | "keep_local_untracked";

export async function resolveConflict(
  action: SyncPlanAction,
  resolution: ConflictResolution,
  plan: SyncPlan,
  localDir: string
): Promise<void> {
  const entry = action.entry;

  // Remove from conflicts
  plan.conflicts = plan.conflicts.filter(c => c.entry.relativePath !== entry.relativePath);

  switch (resolution) {
    case "keep_local":
      plan.actions.push({ type: "push", entry, reason: "Resolved keep local" });
      break;

    case "keep_remote":
      plan.actions.push({ type: "pull", entry, reason: "Resolved keep remote" });
      break;

    case "keep_both":
      // Rename local file with timestamp, then pull remote to original path
      const parsed = parse(entry.relativePath);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const newRelativePath = join(parsed.dir, `${parsed.name}_conflict_${ts}${parsed.ext}`).replace(/\\/g, "/");
      
      await rename(join(localDir, entry.relativePath), join(localDir, newRelativePath));
      
      plan.actions.push({ type: "pull", entry, reason: "Resolved keep both" });
      break;

    case "accept_deletion":
      if (entry.tombstone) {
        // Move to sync-trash
        const ts2 = new Date().toISOString().replace(/[:.]/g, "-");
        const trashDir = join(localDir, ".mnd", "backups", "sync-trash", ts2);
        await mkdir(trashDir, { recursive: true });
        
        try {
          await rename(join(localDir, entry.relativePath), join(trashDir, parse(entry.relativePath).base));
        } catch (e) {
          console.warn(`Could not move ${entry.relativePath} to trash:`, e);
        }
        
        entry.tombstone.resolution = "accept_deletion";
        // Remove from manifest entirely since it's deleted and trashed
        plan.actions.push({ type: "delete_local" as any /* we handle this by just removing it from manifest later or skipping */, entry, reason: "Accepted deletion" });
      }
      break;

    case "keep_local_untracked":
      if (entry.tombstone) {
        entry.tombstone.resolution = "keep_local_untracked";
        delete entry.remoteFileId;
        delete entry.remoteRevision;
        delete entry.tombstone;
        plan.actions.push({ type: "skip", entry, reason: "Keep local untracked" });
      }
      break;
    default:
      throw new Error("Unknown conflict resolution strategy");
  }
}
