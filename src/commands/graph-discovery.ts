import fs from 'fs';
import path from 'path';

export interface DiscoveryResult {
  path: string | null;
  mode: 'packaged' | 'configured' | 'platform' | 'dev' | null;
}

export function discoverGraphExecutable(isDevMode = false, configuredPath?: string): DiscoveryResult {
  // 1. Packaged companion path adjacent to installed MND CLI.
  const mndCliDir = path.dirname(process.argv[1] || __dirname);
  const packagedPath = process.platform === 'win32' 
    ? path.join(mndCliDir, 'mnd-graph.exe')
    : path.join(mndCliDir, 'mnd-graph');
  
  if (fs.existsSync(packagedPath)) {
    return { path: packagedPath, mode: 'packaged' };
  }

  // 2. Configured executable path.
  if (configuredPath && fs.existsSync(configuredPath)) {
    return { path: configuredPath, mode: 'configured' };
  }

  // 3. Platform install location.
  const platformPath = process.platform === 'win32'
    ? path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'MND Graph Vault', 'mnd-graph.exe')
    : process.platform === 'darwin'
      ? '/Applications/MND Graph Vault.app/Contents/MacOS/mnd-graph'
      : '/usr/local/bin/mnd-graph';
      
  if (fs.existsSync(platformPath)) {
    return { path: platformPath, mode: 'platform' };
  }

  // 4. Repository dev path — explicit dev mode only.
  if (isDevMode) {
    const devPath = process.platform === 'win32'
      ? path.join(__dirname, '..', '..', 'apps', 'mnd-graph', 'src-tauri', 'target', 'release', 'mnd-graph.exe')
      : path.join(__dirname, '..', '..', 'apps', 'mnd-graph', 'src-tauri', 'target', 'release', 'mnd-graph');
    if (fs.existsSync(devPath)) {
      return { path: devPath, mode: 'dev' };
    }
  }

  return { path: null, mode: null };
}
