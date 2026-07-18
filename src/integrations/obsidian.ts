// src/integrations/obsidian.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
import { spawn } from "node:child_process";
import { backupFile, atomicWriteFile } from "../core/atomic.js";
import { getAppDataDir } from "../core/paths.js";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

import { realpathSync, statSync } from "node:fs";

export function normalizeVaultPath(p: string): string {
  let n = resolve(normalize(p));
  if (n.length > 3 && (n.endsWith("\\") || n.endsWith("/"))) n = n.slice(0, -1);
  if (/^[a-zA-Z]:\\/.test(n)) n = n.charAt(0).toLowerCase() + n.slice(1);
  if (n.startsWith("\\\\")) n = n.toLowerCase(); // UNC
  return n;
}

export function normalizeObsidianVaultInput(input: string): string {
  // Strip quotes
  let p = input.replace(/^["']+|["']+$/g, "");
  
  // Expand %VAR%
  p = p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || "");
  
  p = normalizeVaultPath(p);
  
  if (/^[a-zA-Z]:\\$/.test(p) || p === "\\" || p === "/") {
    throw new Error("Cannot use the root of a drive as a vault");
  }
  
  try {
     const st = statSync(p);
     if (!st.isDirectory()) {
       throw new Error("Vault path must be a directory, not a file");
     }
     p = realpathSync(p);
     p = normalizeVaultPath(p);
  } catch (err: any) {
     if (err.code !== "ENOENT") throw err;
  }
  
  return p;
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
    const rawBuffer = await readFile(obsidianJsonPath);
    const raw = rawBuffer.toString("utf-8");
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

    // Check if Obsidian is running before modifying
    const isRunning = await new Promise<boolean>((resolve) => {
      import("node:child_process").then(({ exec }) => {
        const cmd = process.platform === "win32" ? 'tasklist /FI "IMAGENAME eq Obsidian.exe" /NH' : 'pgrep -x "obsidian"';
        exec(cmd, (err, stdout) => {
          if (err) return resolve(false);
          resolve(stdout.toLowerCase().includes("obsidian"));
        });
      });
    });

    if (isRunning) {
      return { success: false, vaultId: null, error: "Obsidian is currently running. Please close it before registering a new vault." };
    }

    // Check for concurrent modification
    const preWriteBuffer = await readFile(obsidianJsonPath);
    if (!Buffer.from(preWriteBuffer).equals(Buffer.from(rawBuffer))) {
       return { success: false, vaultId: null, error: "obsidian.json was modified concurrently" };
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
    try {
       const readbackBuffer = await readFile(obsidianJsonPath);
       const verData = JSON.parse(readbackBuffer.toString("utf-8"));
       if (!verData.vaults || !verData.vaults[newId] || verData.vaults[newId].path !== targetPath) {
         throw new Error("Verification failed after writing obsidian.json");
       }
    } catch (verErr: any) {
       // Rollback
       try {
         await atomicWriteFile(obsidianJsonPath, rawBuffer);
         const rollbackCheck = await readFile(obsidianJsonPath);
         if (!Buffer.from(rollbackCheck).equals(Buffer.from(rawBuffer))) {
            return { success: false, vaultId: null, error: "Rollback buffer mismatch! obsidian.json may be corrupted." };
         }
       } catch (rbErr: any) {
         return { success: false, vaultId: null, error: `Rollback failed: ${rbErr.message}` };
       }
       return { success: false, vaultId: null, error: verErr.message };
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

export function getWindowsLauncher(uri: string): { exe: string, args: string[] } {
  const obsidianExe = findObsidianExecutable();
  if (obsidianExe) {
    return { exe: obsidianExe, args: [uri] };
  }
  return { exe: "rundll32.exe", args: ["url.dll,FileProtocolHandler", uri] };
}

export function openRegisteredVault(vaultId: string, homeNote: string = "Home"): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const uriObj = new URL("obsidian://open");
    uriObj.searchParams.set("vault", vaultId);
    uriObj.searchParams.set("file", homeNote);
    const uri = uriObj.toString();
    
    import("node:child_process").then(({ spawn }) => {
      let proc;
      if (process.platform === "win32") {
        const launcher = getWindowsLauncher(uri);
        proc = spawn(launcher.exe, launcher.args, { detached: true, stdio: "ignore", shell: false, windowsHide: true });
      } else if (process.platform === "darwin") {
        proc = spawn("open", [uri], { detached: true, stdio: "ignore" });
      } else {
        proc = spawn("xdg-open", [uri], { detached: true, stdio: "ignore" });
      }
      proc.unref();
      resolveFn();
    }).catch(rejectFn);
  });
}

export function launchObsidianApp(): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    if (process.platform === "win32") {
      import("node:child_process").then(({ spawn }) => {
        const launcher = getWindowsLauncher("obsidian://");
        const proc = spawn(launcher.exe, launcher.args, { detached: true, stdio: "ignore", shell: false, windowsHide: true });
        proc.unref();
        resolveFn();
      });
    } else {
      import("node:child_process").then(({ exec }) => {
        exec(process.platform === "darwin" ? "open -a Obsidian" : "obsidian", (err) => (err ? rejectFn(err) : resolveFn()));
      });
    }
  });
}
