import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nodeFsAdapter } from './fs-node';
import { setAdapter } from './fs-adapter';
import { classifyVault, initializeVault } from './vault';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Vault Management (G02, G03, G04, G05, G17)', () => {
  let tmpDir: string;

  beforeEach(() => {
    setAdapter(nodeFsAdapter);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnd-graph-vault-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('G03: Classifies destination correctly', async () => {
    // Empty directory
    const emptyPath = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyPath);
    expect(await classifyVault(emptyPath)).toBe('empty');

    // Existing MND vault
    const mndVaultPath = path.join(tmpDir, 'mnd-vault');
    fs.mkdirSync(mndVaultPath);
    fs.mkdirSync(path.join(mndVaultPath, '.mnd'));
    expect(await classifyVault(mndVaultPath)).toBe('mnd');

    // Obsidian vault
    const obsVaultPath = path.join(tmpDir, 'obs-vault');
    fs.mkdirSync(obsVaultPath);
    fs.mkdirSync(path.join(obsVaultPath, '.obsidian'));
    expect(await classifyVault(obsVaultPath)).toBe('obsidian');
  });

  it('G04: Vault initialization safety - does not overwrite existing files', async () => {
    const vaultPath = path.join(tmpDir, 'safe-init');
    fs.mkdirSync(vaultPath);
    fs.writeFileSync(path.join(vaultPath, 'Home.md'), 'Existing Home');
    
    // Simulate init
    await initializeVault(vaultPath);
    
    expect(fs.readFileSync(path.join(vaultPath, 'Home.md'), 'utf-8')).toBe('Existing Home');
  });

  it('G05: Creates Obsidian-compatible structure', async () => {
    const vaultPath = path.join(tmpDir, 'new-vault');
    fs.mkdirSync(vaultPath);
    
    await initializeVault(vaultPath);
    
    expect(fs.existsSync(path.join(vaultPath, 'Projects'))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, '.mnd'))).toBe(true);
  });
});
