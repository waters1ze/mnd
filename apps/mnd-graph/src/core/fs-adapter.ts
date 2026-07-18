export interface FileInfo {
  name: string;
  isDirectory: boolean;
}

export interface FSAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  readDir(path: string): Promise<FileInfo[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  join(...paths: string[]): string;
  basename(path: string): string;
  extname(path: string): string;
}

// In a real app we'd conditionally export the Tauri version or a mock.
// For now, we will assume Tauri is injected, or mock it if window.__TAURI__ is missing.

let adapter: FSAdapter;

export function setAdapter(newAdapter: FSAdapter) {
  adapter = newAdapter;
}

export function getFS(): FSAdapter {
  if (!adapter) {
    throw new Error("FSAdapter not initialized");
  }
  return adapter;
}
