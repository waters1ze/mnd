// src/sync/manifest.ts
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SyncManifest, SyncEntry } from "./types.js";

export async function loadManifest(manifestPath: string): Promise<SyncManifest> {
  if (!existsSync(manifestPath)) {
    return { version: 1, entries: {} };
  }
  try {
    const data = await readFile(manifestPath, "utf-8");
    return JSON.parse(data) as SyncManifest;
  } catch {
    return { version: 1, entries: {} };
  }
}

export async function saveManifest(manifestPath: string, manifest: SyncManifest): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  const { atomicWriteFile } = await import("../core/atomic.js");
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export function createEmptyEntry(relativePath: string): SyncEntry {
  return {
    version: 1,
    relativePath,
    state: "pending",
  };
}
