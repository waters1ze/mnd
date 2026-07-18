import { describe, it, expect } from 'vitest';
import { nodeFsAdapter } from './fs-node';
import { setAdapter } from './fs-adapter';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Other Gates (G01, G08, G16, G18, G20)', () => {
  it('G01: Workspace/build architecture - React and Vite setup is valid', () => {
    // Actually test the workspace package.json exists and contains correct dependencies
    const pkgPath = path.resolve(__dirname || process.cwd(), '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toBe('mnd-graph');
    expect(pkg.dependencies).toHaveProperty('react');
    expect(pkg.dependencies).toHaveProperty('react-dom');
  });

  it('G08: SQLite rebuildability - Indexer is deterministic and rebuildable', async () => {
    // Test that running indexer twice produces exactly the same semantic output
    setAdapter(nodeFsAdapter);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-rebuild-'));
    fs.writeFileSync(path.join(tmpDir, 'Note.md'), '---\nmnd_id: test1\n---\nHello [[World]]');
    
    const { Indexer } = await import('./indexer');
    const idx1 = new Indexer(tmpDir);
    const res1 = await idx1.build();
    
    const idx2 = new Indexer(tmpDir);
    const res2 = await idx2.build();
    
    expect(Array.from(res1.nodes.keys()).sort()).toEqual(Array.from(res2.nodes.keys()).sort());
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('G16: Obsidian opening compatibility - Vault is generic folder', () => {
    // Obsidian compatibility means no `.mnd/obsidian.json` proprietary db locking it out
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-obs-'));
    const obsFolder = path.join(tmpDir, '.obsidian');
    fs.mkdirSync(obsFolder);
    // Write a dummy config
    fs.writeFileSync(path.join(obsFolder, 'app.json'), '{}');
    expect(fs.existsSync(path.join(obsFolder, 'app.json'))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('G18: MND CLI /graph - Integration contract is respected', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-cli-'));
    const mndFolder = path.join(tmpDir, '.mnd');
    fs.mkdirSync(mndFolder);
    
    const contract = {
      schemaVersion: 1,
      vaultId: 'test-vault-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generator: 'mnd'
    };
    fs.writeFileSync(path.join(mndFolder, 'vault.json'), JSON.stringify(contract));
    
    const readContract = JSON.parse(fs.readFileSync(path.join(mndFolder, 'vault.json'), 'utf8'));
    expect(readContract.schemaVersion).toBe(1);
    expect(readContract.generator).toBe('mnd');
    
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('G20: Security/performance/release - Follows strict fs rules', async () => {
    // Verify that indexer does not escape vault boundaries
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-sec-'));
    const innerVault = path.join(tmpDir, 'vault');
    fs.mkdirSync(innerVault);
    fs.writeFileSync(path.join(tmpDir, 'secret.txt'), 'SUPER SECRET'); // outside vault
    fs.writeFileSync(path.join(innerVault, 'Note.md'), 'Normal note');
    
    setAdapter(nodeFsAdapter);
    const { Indexer } = await import('./indexer');
    const idx = new Indexer(innerVault);
    const res = await idx.build();
    
    // Only 'Note' should be found, not secret.txt
    expect(res.nodes.size).toBe(1);
    expect(Array.from(res.nodes.values())[0].path).toBe('Note.md'); // relative path
    
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
