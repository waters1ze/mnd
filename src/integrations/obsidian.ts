// src/integrations/obsidian.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
import { spawn } from "node:child_process";
import { backupFile, atomicWriteFile } from "../core/atomic.js";
import { getAppDataDir } from "../core/paths.js";
import crypto from "node:crypto";

export function normalizeVaultPath(p: string): string {
  let n = resolve(normalize(p));
  if (n.endsWith("\\") || n.endsWith("/")) n = n.slice(0, -1);
  if (/^[a-zA-Z]:\\/.test(n)) n = n.charAt(0).toLowerCase() + n.slice(1);
  return n;
}

export async function getRegisteredVaultId(targetPath: string): Promise<string | null> {
  const appData = process.env["APPDATA"];
  if (!appData) return null;
  const obsidianJsonPath = join(appData, "obsidian", "obsidian.json");
  if (!existsSync(obsidianJsonPath)) return null;
  try {
    const raw = await readFile(obsidianJsonPath, "utf-8");
    const data = JSON.parse(raw);
    if (!data.vaults) return null;
    const normalizedTarget = normalizeVaultPath(targetPath);
    for (const [id, vault] of Object.entries<any>(data.vaults)) {
      if (vault && typeof vault.path === "string" && normalizeVaultPath(vault.path) === normalizedTarget) {
        return id;
      }
    }
  } catch {}
  return null;
}

export async function registerVaultSafely(targetPath: string): Promise<{ success: boolean; vaultId: string | null; error?: string }> {
  const appData = process.env["APPDATA"];
  if (!appData) return { success: false, vaultId: null, error: "No APPDATA directory found" };

  const obsidianDir = join(appData, "obsidian");
  const obsidianJsonPath = join(obsidianDir, "obsidian.json");

  if (!existsSync(obsidianJsonPath)) {
    return { success: false, vaultId: null, error: "obsidian.json not found, manual setup required" };
  }

  try {
    const raw = await readFile(obsidianJsonPath, "utf-8");
    let data;
    try {
       data = JSON.parse(raw);
    } catch {
       return { success: false, vaultId: null, error: "obsidian.json is corrupt" };
    }

    if (!data || typeof data !== "object") return { success: false, vaultId: null, error: "Invalid obsidian.json schema" };
    if (!data.vaults) data.vaults = {};

    const normalizedTarget = normalizeVaultPath(targetPath);

    // Check if already registered
    for (const [id, vault] of Object.entries<any>(data.vaults)) {
      if (vault && typeof vault.path === "string" && normalizeVaultPath(vault.path) === normalizedTarget) {
        return { success: true, vaultId: id };
      }
    }

    // Backup before write
    const backupDir = join(getAppDataDir(), "backups");
    await backupFile(obsidianJsonPath, backupDir, "obsidian_pre_reg");

    // Generate safe ID
    let newId = "";
    do {
      newId = crypto.randomBytes(4).toString("hex");
    } while (data.vaults[newId]);

    data.vaults[newId] = {
      path: targetPath,
      ts: Date.now()
    };

    await atomicWriteFile(obsidianJsonPath, JSON.stringify(data, null, 2));

    // Reread verification
    const readback = await readFile(obsidianJsonPath, "utf-8");
    const verData = JSON.parse(readback);
    if (!verData.vaults || !verData.vaults[newId] || verData.vaults[newId].path !== targetPath) {
      return { success: false, vaultId: null, error: "Verification failed after writing obsidian.json" };
    }

    return { success: true, vaultId: newId };
  } catch (err: any) {
    return { success: false, vaultId: null, error: err.message };
  }
}

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

export function openRegisteredVault(vaultId: string, homeNote: string = "Home"): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const uriObj = new URL("obsidian://open");
    uriObj.searchParams.set("vault", vaultId);
    uriObj.searchParams.set("file", homeNote);
    const uri = uriObj.toString();
    
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
