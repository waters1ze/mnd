import { getFS } from './fs-adapter';

export async function classifyVault(vaultPath: string): Promise<'empty' | 'mnd' | 'obsidian' | 'unknown'> {
  const adapter = getFS();
  
  if (!(await adapter.exists(vaultPath))) {
    return 'unknown';
  }

  const entries = await adapter.readDir(vaultPath);
  if (entries.length === 0) {
    return 'empty';
  }

  const hasMnd = entries.some(e => e.name === '.mnd' && e.isDirectory);
  if (hasMnd) {
    return 'mnd';
  }

  const hasObsidian = entries.some(e => e.name === '.obsidian' && e.isDirectory);
  if (hasObsidian) {
    return 'obsidian';
  }

  return 'unknown';
}

export async function initializeVault(vaultPath: string): Promise<void> {
  const adapter = getFS();
  
  const dirs = ['Projects', 'Assets/Images', 'Transcripts', 'Styles', 'Templates', '.mnd'];
  
  if (!(await adapter.exists(vaultPath))) {
    await adapter.mkdir(vaultPath);
  }

  for (const dir of dirs) {
    const parts = dir.split('/');
    let currentPath = vaultPath;
    for (const part of parts) {
      currentPath = adapter.join(currentPath, part);
      if (!(await adapter.exists(currentPath))) {
        await adapter.mkdir(currentPath);
      }
    }
  }

  const homePath = adapter.join(vaultPath, 'Home.md');
  if (!(await adapter.exists(homePath))) {
    await adapter.writeTextFile(homePath, '# Home\n\nWelcome to your MND Vault.');
  }
}
