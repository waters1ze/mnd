// src/sync/policy.ts
import { join, normalize, relative } from "node:path";

export interface SyncScopeOptions {
  includeRaw: boolean;
}

const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  ".mnd/cache",
  ".mnd/audio",
  ".mnd/frames",
  ".mnd/proxies",
  "secrets",
  "keyring",
  "logs",
  ".partial",
  "update_staging",
];

export function isFileInScope(relativePath: string, options: SyncScopeOptions): boolean {
  const normalized = normalize(relativePath).replace(/\\/g, "/");

  if (normalized.includes("..")) {
    return false; // Path traversal rejection
  }

  // Check excludes
  for (const exclude of DEFAULT_EXCLUDES) {
    if (normalized === exclude || normalized.startsWith(`${exclude}/`)) {
      return false;
    }
  }

  // Check raw/ protection
  if (normalized === "raw" || normalized.startsWith("raw/")) {
    return options.includeRaw;
  }

  return true;
}
