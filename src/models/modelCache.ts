// src/models/modelCache.ts
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAppDataDir } from "../core/config.js";
import { atomicWriteFile } from "../core/atomic.js";
import type { ModelCatalogSchema, DiscoveredModel } from "./types.js";

const CACHE_VERSION = 1;
const TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function getCachePath() {
  const dir = getAppDataDir();
  return join(dir, "model-catalog.json");
}

export async function readModelCache(): Promise<DiscoveredModel[] | null> {
  const p = getCachePath();
  if (!existsSync(p)) return null;

  try {
    const raw = await readFile(p, "utf-8");
    const data = JSON.parse(raw) as ModelCatalogSchema;
    if (data.version !== CACHE_VERSION) return null;

    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (age > TTL_MS) {
      // It's stale, but we can still return it if needed, though here we'll just mark it source = cache
      // The catalog will handle stale logic if needed
    }

    return data.models.map(m => ({ ...m, source: "cache" as const }));
  } catch {
    return null;
  }
}

export async function writeModelCache(models: DiscoveredModel[]): Promise<void> {
  const dir = getAppDataDir();
  await mkdir(dir, { recursive: true });
  
  const payload: ModelCatalogSchema = {
    version: CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    models
  };

  await atomicWriteFile(getCachePath(), JSON.stringify(payload, null, 2));
}
