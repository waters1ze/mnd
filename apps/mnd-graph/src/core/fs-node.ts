import fs from 'fs';
import path from 'path';
import { FSAdapter, FileInfo } from './fs-adapter';

export const nodeFsAdapter: FSAdapter = {
  async readTextFile(p: string) {
    return fs.promises.readFile(p, 'utf-8');
  },
  async writeTextFile(p: string, contents: string) {
    const tmpPath = p + '.tmp';
    await fs.promises.writeFile(tmpPath, contents, 'utf-8');
    await fs.promises.rename(tmpPath, p);
  },
  async readDir(p: string): Promise<FileInfo[]> {
    const entries = await fs.promises.readdir(p, { withFileTypes: true });
    return entries.map((e: fs.Dirent) => ({
      name: e.name,
      isDirectory: e.isDirectory()
    }));
  },
  async exists(p: string) {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(p: string) {
    await fs.promises.mkdir(p, { recursive: true });
  },
  join(...paths: string[]) {
    return path.join(...paths).replace(/\\/g, '/');
  },
  basename(p: string) {
    return path.basename(p);
  },
  extname(p: string) {
    return path.extname(p);
  }
};
