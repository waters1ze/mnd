// src/integrations/obsidian.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, normalize, basename } from "node:path";
import { spawn } from "node:child_process";

/**
 * Normalizes a Windows path for strict string comparison
 */
export function normalizeVaultPath(p: string): string {
  // resolve ensures absolute, normalize fixes slashes
  let n = resolve(normalize(p));
  // remove trailing slash if any
  if (n.endsWith("\\") || n.endsWith("/")) {
    n = n.slice(0, -1);
  }
  // lowercase drive letter to avoid C:\ vs c:\
  if (/^[a-zA-Z]:\\/.test(n)) {
    n = n.charAt(0).toLowerCase() + n.slice(1);
  }
  return n;
}

interface ObsidianJson {
  vaults?: Record<string, {
    path: string;
    ts?: number;
    open?: boolean;
  }>;
}

/**
 * Checks if a specific folder is registered as a vault in the user's obsidian.json.
 * Returns the vault ID if it is registered, or null otherwise.
 */
export async function getRegisteredVaultId(targetPath: string): Promise<string | null> {
  const appData = process.env["APPDATA"];
  if (!appData) return null;

  const obsidianJsonPath = join(appData, "obsidian", "obsidian.json");
  if (!existsSync(obsidianJsonPath)) return null;

  try {
    const raw = await readFile(obsidianJsonPath, "utf-8");
    const data = JSON.parse(raw) as ObsidianJson;
    if (!data.vaults) return null;

    const normalizedTarget = normalizeVaultPath(targetPath);

    for (const [id, vault] of Object.entries(data.vaults)) {
      if (vault && typeof vault.path === "string") {
        if (normalizeVaultPath(vault.path) === normalizedTarget) {
          return id;
        }
      }
    }
  } catch {
    // If we fail to read or parse obsidian.json, we safely treat it as not found.
  }
  return null;
}

/**
 * Finds the obsidian executable path on Windows.
 */
export function findObsidianExecutable(): string | null {
  const paths = [
    process.env["LOCALAPPDATA"] ? join(process.env["LOCALAPPDATA"], "Obsidian", "Obsidian.exe") : null,
    process.env["LOCALAPPDATA"] ? join(process.env["LOCALAPPDATA"], "Programs", "Obsidian", "Obsidian.exe") : null,
    process.env["PROGRAMFILES"] ? join(process.env["PROGRAMFILES"], "Obsidian", "Obsidian.exe") : null,
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Obsidian", "Obsidian.exe") : null,
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Opens a registered vault using obsidian://open?vault=<ID>
 */
export function openRegisteredVault(vaultId: string): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const uri = `obsidian://open?vault=${encodeURIComponent(vaultId)}`;
    const platform = process.platform;
    let cmd: string;
    if (platform === "win32") {
      cmd = `cmd /c start "" "${uri}"`;
    } else if (platform === "darwin") {
      cmd = `open "${uri}"`;
    } else {
      cmd = `xdg-open "${uri}"`;
    }
    
    import("node:child_process").then(({ exec }) => {
      exec(cmd, (err) => (err ? rejectFn(err) : resolveFn()));
    });
  });
}

/**
 * Opens the Obsidian app without a specific vault, letting the user do manual setup.
 */
export function launchObsidianApp(): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    if (process.platform === "win32") {
      const exe = findObsidianExecutable();
      if (exe) {
        const proc = spawn(exe, [], { detached: true, stdio: "ignore" });
        proc.unref();
        resolveFn();
        return;
      }
      // fallback to URI
      import("node:child_process").then(({ exec }) => {
        exec(`cmd /c start "" "obsidian://"`, (err) => (err ? rejectFn(err) : resolveFn()));
      });
    } else {
      import("node:child_process").then(({ exec }) => {
        exec(process.platform === "darwin" ? "open -a Obsidian" : "obsidian", (err) => (err ? rejectFn(err) : resolveFn()));
      });
    }
  });
}
