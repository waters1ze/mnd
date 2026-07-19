import { homedir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { loadConfig, resolveVaultPath } from "./config.js";
import { session } from "../repl/loop.js";

/**
 * Centralized path resolution for application data.
 * Uses %LOCALAPPDATA%/mnd on Windows, ~/.config/mnd on macOS/Linux.
 */
export function getAppDataDir(): string {
  if (process.env.MND_APP_DATA) {
    return resolve(process.env.MND_APP_DATA);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "mnd");
  }
  return join(homedir(), ".config", "mnd");
}

export function getGlobalLogsDir(): string {
  return join(getAppDataDir(), "logs");
}

export async function getProjectLogsDir(): Promise<string | null> {
  const slug = session.currentProjectSlug;
  if (!slug) return null;
  const cfg = await loadConfig();
  return join(resolveVaultPath(cfg), "Projects", slug, ".mnd");
}
