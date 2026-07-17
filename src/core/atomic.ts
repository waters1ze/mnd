import { writeFile, rename, copyFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join, dirname, basename } from "node:path";

/**
 * Writes data atomically by writing to a temporary file in the same directory,
 * fsyncing it, and then renaming it over the target path.
 */
export async function atomicWriteFile(targetPath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `.${basename(targetPath)}.tmp.${Date.now()}`);
  
  await writeFile(tempPath, data);

  // fsync the temp file to ensure it's fully on disk
  const fd = openSync(tempPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Atomic rename over the target
  await rename(tempPath, targetPath);
}

/**
 * Backups a file by copying it to a backup directory with a timestamped label.
 */
export async function backupFile(sourcePath: string, backupDir: string, label: string): Promise<string | null> {
  if (!existsSync(sourcePath)) return null;
  
  await mkdir(backupDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${basename(sourcePath)}.${label}.${timestamp}.bak`;
  const backupPath = join(backupDir, backupName);
  
  await copyFile(sourcePath, backupPath);
  return backupPath;
}

export async function listBackups(backupDir: string): Promise<string[]> {
  if (!existsSync(backupDir)) return [];
  const files = await readdir(backupDir);
  return files.filter(f => f.endsWith(".bak")).sort();
}

export async function restoreFile(backupPath: string, targetPath: string): Promise<void> {
  if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
  
  // Before restoring, take a safety backup of the current state if it exists
  if (existsSync(targetPath)) {
    const safeDir = join(dirname(targetPath), "backups");
    await backupFile(targetPath, safeDir, "pre-restore");
  }
  
  await copyFile(backupPath, targetPath);
}
