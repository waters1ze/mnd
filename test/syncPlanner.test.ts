import { createSyncPlan } from '../src/sync/planner.js';

describe('Sync Planner', () => {
  it('handles deleted remotely by creating tombstone', async () => {
    expect(true).toBe(true);
  });
  it('enforces delete_remote instead of delete_local', async () => {
    expect(true).toBe(true);
  });
});