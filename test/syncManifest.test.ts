import { loadManifest, saveManifest, createEmptyEntry } from '../src/sync/manifest.js';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('Sync Manifest', () => {
  it('handles corruption by throwing SYNC_MANIFEST_CORRUPTED', async () => {
    const p = join(tmpdir(), 'test-manifest.json');
    await writeFile(p, '{ invalid json');
    await expect(loadManifest(p)).rejects.toThrow('SYNC_MANIFEST_CORRUPTED');
    await rm(p, { force: true });
  });
});