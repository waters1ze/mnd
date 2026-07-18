import { FSAdapter, FileInfo } from './fs-adapter';

declare global {
  interface Window {
    __TAURI__: any;
  }
}

let tauriFs: any;
// let tauriPath: any;
// let tauriOs: any;

export async function initTauriFs(): Promise<FSAdapter> {
  if (!window.__TAURI__) {
    throw new Error("Tauri API not found");
  }

  // Use dynamic imports to avoid breaking tests when Tauri is not present
  // If @tauri-apps/plugin-fs is installed, these should resolve
  // @ts-ignore
  tauriFs = await import('@tauri-apps/plugin-fs');
  // @ts-ignore
  // tauriPath = await import('@tauri-apps/api/path');

  return {
    async readTextFile(path: string) {
      return tauriFs.readTextFile(path);
    },
    async writeTextFile(path: string, contents: string) {
      const tmpPath = path + '.tmp';
      await tauriFs.writeTextFile(tmpPath, contents);
      // Attempt to rename for atomic write
      if (tauriFs.rename) {
        await tauriFs.rename(tmpPath, path);
      } else {
        // Fallback if rename isn't exported directly
        await tauriFs.copyFile(tmpPath, path);
        await tauriFs.remove(tmpPath);
      }
    },
    async readDir(path: string): Promise<FileInfo[]> {
      const entries = await tauriFs.readDir(path);
      return entries.map((e: any) => ({
        name: e.name,
        isDirectory: e.isDirectory
      }));
    },
    async exists(path: string) {
      return tauriFs.exists(path);
    },
    async mkdir(path: string) {
      await tauriFs.mkdir(path, { recursive: true });
    },
    join(...paths: string[]) {
      return paths.map(p => p.replace(/\\/g, '/')).join('/').replace(/(?<!:)\/+/g, '/');
    },
    basename(path: string) {
      const parts = path.split(/[/\\]/);
      return parts[parts.length - 1];
    },
    extname(path: string) {
      const parts = path.split(/[/\\]/);
      const base = parts[parts.length - 1];
      const idx = base.lastIndexOf('.');
      return idx > 0 ? base.substring(idx) : '';
    }
  };
}

