// src/sync/conflicts.ts
import { rename } from "node:fs/promises";
import { join, parse } from "node:path";
import type { SyncPlanAction, SyncPlan } from "./types.js";

export type ConflictResolution = "keep_local" | "keep_remote" | "keep_both";

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
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const newRelativePath = join(parsed.dir, `${parsed.name}_conflict_${timestamp}${parsed.ext}`).replace(/\\/g, "/");
      
      await rename(join(localDir, entry.relativePath), join(localDir, newRelativePath));
      
      // Pull remote to original path
      plan.actions.push({ type: "pull", entry, reason: "Resolved keep both" });
      
      // The renamed local file will be picked up as a new local file on the next sync push
      break;
  }
}
