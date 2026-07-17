import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadConfig, updateConfigField } from "../core/config.js";
import chalk from "chalk";

/**
 * Executes a candidate CLI path with `--version` and a timeout.
 * Returns true if it outputs something resembling an antigravity version or successfully runs.
 */
export function verifyAntigravityCli(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = execFile(candidate, ["--version"], { timeout: 2000 }, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        const out = stdout.toLowerCase();
        if (out.trim().length > 0) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      proc.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

function resolveCommand(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === "win32" ? "where" : "which";
    execFile(finder, [cmd], (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
      } else {
        const firstLine = stdout.trim().split("\n")[0]?.trim();
        resolve(firstLine ?? null);
      }
    });
  });
}

/**
 * Discovers the Antigravity CLI executable path.
 * Searches in config, ENV, PATH, and common installation locations.
 */
export async function discoverAntigravityCli(configPath?: string): Promise<string | null> {
  const candidates: string[] = [];

  if (configPath) {
    if (configPath.includes("/") || configPath.includes("\\")) {
      if (existsSync(configPath)) candidates.push(configPath);
    } else {
      const resolved = await resolveCommand(configPath);
      if (resolved) candidates.push(resolved);
    }
  }

  if (process.env["ANTIGRAVITY_CLI_PATH"]) {
    candidates.push(process.env["ANTIGRAVITY_CLI_PATH"]);
  }

  const pathResolved = await resolveCommand("antigravity");
  if (pathResolved) candidates.push(pathResolved);

  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    const appData = process.env["APPDATA"];
    const userProfile = process.env["USERPROFILE"];
    
    if (localAppData) {
      candidates.push(join(localAppData, "antigravity", "antigravity.exe"));
      candidates.push(join(localAppData, "Programs", "antigravity", "antigravity.exe"));
    }
    if (appData) {
      candidates.push(join(appData, "npm", "antigravity.cmd"));
      candidates.push(join(appData, "npm", "antigravity.exe"));
    }
    if (userProfile) {
      candidates.push(join(userProfile, ".local", "bin", "antigravity.exe"));
    }
  } else {
    candidates.push("/usr/local/bin/antigravity");
    candidates.push("/opt/homebrew/bin/antigravity");
    candidates.push(join(process.env["HOME"] || "", ".local", "bin", "antigravity"));
  }

  // Deduplicate and filter existing paths
  const uniquePaths = Array.from(new Set(candidates)).filter((p) => existsSync(p));

  // Verify
  for (const p of uniquePaths) {
    const ok = await verifyAntigravityCli(p);
    if (ok) return p;
  }

  return null;
}

/**
 * Ensures the Antigravity CLI is available, discovering it if necessary,
 * saving the discovered path to config, and alerting the user if absent.
 */
export async function ensureAntigravityCli(): Promise<boolean> {
  const cfg = await loadConfig();
  const configuredPath = cfg.connections.antigravity_cli_path;
  
  const discovered = await discoverAntigravityCli(configuredPath);
  
  if (discovered) {
    if (discovered !== configuredPath) {
      await updateConfigField((c) => { c.connections.antigravity_cli_path = discovered; });
      console.log(chalk.green(`✓ Antigravity found: ${discovered}`));
    }
    return true;
  }
  
  console.log(chalk.red(`✗ Antigravity CLI not found.`));
  console.log(chalk.gray(`Searched PATH, ENV, config, and common install locations.`));
  console.log(chalk.gray(`'sort' and 'thumbnail' require it. You can install it manually and set connections.antigravity_cli_path in config.`));
  return false;
}
