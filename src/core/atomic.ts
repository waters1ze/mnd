import { writeFile, rename, copyFile, readdir, unlink, mkdir, stat, readFile } from "node:fs/promises";
import { existsSync, openSync, closeSync, fsyncSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname, basename } from "node:path";

/**
 * Writes data atomically by writing to a temporary file in the same directory,
 * fsyncing it, and then renaming it over the target path.
 */
export interface FileIdentity {
  size: number;
  mtimeMs: number;
  sha256?: string;
}

export interface AtomicWriteOptions {
  expectedIdentity?: FileIdentity | null;
  overwrite?: boolean;
}

export async function getFileIdentity(path: string, includeHash = false): Promise<FileIdentity | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    const identity: FileIdentity = { size: info.size, mtimeMs: info.mtimeMs };
    if (includeHash) {
      identity.sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    }
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function identitiesMatch(expected: FileIdentity | null, actual: FileIdentity | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs) return false;
  return expected.sha256 === undefined || expected.sha256 === actual.sha256;
}

export async function atomicWriteFile(targetPath: string, data: string | Buffer, options: AtomicWriteOptions = {}): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });

  const expected = options.expectedIdentity;
  const needsHash = expected?.sha256 !== undefined;
  const before = await getFileIdentity(targetPath, needsHash);
  if (expected !== undefined && !identitiesMatch(expected, before)) {
    throw new Error(`Write conflict: ${targetPath} changed after it was opened`);
  }
  if (options.overwrite === false && before !== null) {
    throw new Error(`Refusing to overwrite existing file: ${targetPath}`);
  }

  const tempPath = join(dir, `.${basename(targetPath)}.tmp.${process.pid}.${randomUUID()}`);

  await writeFile(tempPath, data, { flag: "wx" });

  // fsync the temp file to ensure it's fully on disk
  const fd = openSync(tempPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Atomic rename over the target
  try {
    if (expected !== undefined) {
      const immediatelyBeforeRename = await getFileIdentity(targetPath, needsHash);
      if (!identitiesMatch(expected, immediatelyBeforeRename)) {
        throw new Error(`Write conflict: ${targetPath} changed while the replacement was being prepared`);
      }
    }
    await rename(tempPath, targetPath);
  } catch (err: any) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath);
    } catch {
      // ignore unlink error
    }
    throw err;
  }
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
