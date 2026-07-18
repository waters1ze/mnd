import { resolveConflict } from '../src/sync/conflicts.js';
import type { SyncPlan, SyncPlanAction } from '../src/sync/types.js';

describe('Sync Conflicts', () => {
  it('throws on unhandled resolution strategy', async () => {
    const plan: SyncPlan = { conflicts: [], actions: [] };
    const action: SyncPlanAction = {
      type: "conflict",
      entry: { relativePath: "a", size: 10, mtime: "" }
    };
    await expect(resolveConflict(action, "unknown_strategy" as any, plan, "/local")).rejects.toThrow("Unknown conflict resolution strategy");
  });
});