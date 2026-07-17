import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { readFile, mkdir, rename } from "node:fs/promises";
import { Buffer } from "node:buffer";
import YAML from "yaml";
import { backupFile, atomicWriteFile } from "./atomic.js";
import { getAppDataDir } from "./paths.js";
import { getProjectPaths } from "./projectPaths.js";
import type { MndConfig } from "../types/config.js";

export const LATEST_CONFIG_VERSION = 2;
export const LATEST_VAULT_VERSION = 1;

export async function runConfigMigrations(): Promise<void> {
  const configPath = join(getAppDataDir(), "config.yaml");
  if (!existsSync(configPath)) return;

  const rawBuffer = await readFile(configPath);
  const raw = rawBuffer.toString("utf-8");
  let parsed: any;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return; // Cannot migrate unparseable config
  }

  const currentVersion = parsed.version || 0;
  if (currentVersion === LATEST_CONFIG_VERSION) return;

  if (currentVersion > LATEST_CONFIG_VERSION) {
    console.log(chalk.red(`\n[!] Config version ${currentVersion} is newer than supported version ${LATEST_CONFIG_VERSION}. Please update MND.`));
    process.exit(1);
  }

  console.log(chalk.yellow(`\n[MIGRATION] Upgrading config from v${currentVersion} to v${LATEST_CONFIG_VERSION}...`));
  const backupDir = join(getAppDataDir(), "backups");
  const backupPath = await backupFile(configPath, backupDir, `pre-migration-v${currentVersion}`);

  let migrated = { ...parsed };

  // Migrations registry
  if (currentVersion < 1) {
    migrated.version = 1;
    // v0 -> v1 changes if any
  }
  if (currentVersion < 2) {
    migrated.version = 2;
    // Migrate Antigravity path
    if (migrated.connections?.antigravity_cli_path) {
      migrated.connections.antigravity = {
        discovery_mode: "auto",
        cached_executable_path: migrated.connections.antigravity_cli_path,
        cached_version: null,
        last_verified_at: null,
      };
      delete migrated.connections.antigravity_cli_path;
    } else if (migrated.connections && !migrated.connections.antigravity) {
      migrated.connections.antigravity = {
        discovery_mode: "auto",
        cached_executable_path: null,
        cached_version: null,
        last_verified_at: null,
      };
    }

    // Initialize Obsidian section
    if (!migrated.obsidian) {
      migrated.obsidian = {
        initialized: false,
        vault_id: null,
        home_note: "Home.md",
        last_verified_at: null,
      };
    }
  }

  await atomicWriteFile(configPath, YAML.stringify(migrated));
  
  try {
    const checkRaw = await readFile(configPath, "utf-8");
    const checkParsed = YAML.parse(checkRaw);
    
    // Strict schema check
    if (checkParsed.version !== LATEST_CONFIG_VERSION) throw new Error("Version mismatch");
    if (typeof checkParsed.profile !== "string") throw new Error("Invalid profile");
    if (typeof checkParsed.vault_path !== "string") throw new Error("Invalid vault_path");
    if (typeof checkParsed.connections !== "object") throw new Error("Invalid connections");
    if ("antigravity_cli_path" in checkParsed.connections) throw new Error("Legacy antigravity_cli_path remains");
    if (typeof checkParsed.connections.antigravity !== "object") throw new Error("Invalid connections.antigravity");
    if (typeof checkParsed.obsidian !== "object") throw new Error("Invalid obsidian");
    if (typeof checkParsed.models?.hybrid?.image_gen !== "object") throw new Error("Missing hybrid image_gen");
    if (typeof checkParsed.models?.local?.image_gen !== "object") throw new Error("Missing local image_gen");

  } catch (e: any) {
    const errorMsg = e.message;
    console.log(chalk.red(`\n[!] Config migration verification failed: ${errorMsg}. Rolling back.`));
    
    // Strict rollback using Buffer
    try {
      await atomicWriteFile(configPath, rawBuffer);
      const rollbackCheck = await readFile(configPath);
      if (!Buffer.from(rollbackCheck).equals(Buffer.from(rawBuffer))) {
         console.log(chalk.bgRed.white(`\n[FATAL] Rollback buffer mismatch! Config may be corrupted.`));
      } else {
         console.log(chalk.yellow(`[MIGRATION] Rollback successful.`));
      }
    } catch (rbErr: any) {
      console.log(chalk.bgRed.white(`\n[FATAL] Rollback failed: ${rbErr.message}`));
    }
    
    throw new Error(`Migration failed: ${errorMsg}`);
  }
  console.log(chalk.green("✓ Config migration successful."));
}

export async function runVaultMigrations(vaultPath: string): Promise<void> {
  const vaultMetaPath = join(vaultPath, ".mnd-vault.json");
  if (!existsSync(vaultMetaPath)) return;
  
  const raw = await readFile(vaultMetaPath, "utf-8");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  
  const currentVersion = parsed.version || 0;
  if (currentVersion === LATEST_VAULT_VERSION) return;
  
  if (currentVersion > LATEST_VAULT_VERSION) {
    console.log(chalk.red(`\n[!] Vault version ${currentVersion} is newer than supported version ${LATEST_VAULT_VERSION}. Please update MND.`));
    process.exit(1);
  }
  
  console.log(chalk.yellow(`\n[MIGRATION] Upgrading vault from v${currentVersion} to v${LATEST_VAULT_VERSION}...`));
  const backupDir = join(getAppDataDir(), "backups");
  const backupPath = await backupFile(vaultMetaPath, backupDir, `pre-migration-vault-v${currentVersion}`);
  
  let migrated = { ...parsed };
  if (currentVersion < 1) {
    migrated.version = 1;
    // Execute v0 -> v1 layout migration for all projects
    const { listProjects } = await import("./vault.js");
    const projects = await listProjects(vaultPath);
    for (const proj of projects) {
      await migrateProjectLayoutV1(vaultPath, proj.slug);
    }
  }

  await atomicWriteFile(vaultMetaPath, JSON.stringify(migrated, null, 2));
  
  try {
    const checkRaw = await readFile(vaultMetaPath, "utf-8");
    const checkParsed = JSON.parse(checkRaw);
    if (checkParsed.version !== LATEST_VAULT_VERSION) throw new Error("Version mismatch after write");
  } catch (e: any) {
    console.log(chalk.red(`\n[!] Vault migration verification failed: ${e.message}. Rolling back.`));
    if (backupPath && existsSync(backupPath)) {
      const backupRaw = await readFile(backupPath, "utf-8");
      await atomicWriteFile(vaultMetaPath, backupRaw);
    }
    process.exit(1);
  }
  console.log(chalk.green("✓ Vault migration successful."));
}

async function migrateProjectLayoutV1(vaultPath: string, slug: string): Promise<void> {
  const paths = getProjectPaths(vaultPath, slug);
  const dirs = [
    paths.exportsDir, paths.validationDir, paths.reportsDir, paths.mndDir,
    paths.cacheDir, paths.audioDir, paths.framesDir, paths.proxiesDir,
    paths.backupsDir, paths.syncDir
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  const legacyStatePath = join(vaultPath, "Projects", slug, ".mnd", "project_state.json");
  if (existsSync(legacyStatePath) && paths.stateJson !== legacyStatePath) {
    console.log(chalk.gray(`  Migrating project state for ${slug}...`));
    // Backup
    await backupFile(legacyStatePath, paths.backupsDir, "pre-migration-state-v0");
    // Read & Validate
    const raw = await readFile(legacyStatePath, "utf-8");
    let state;
    try {
      state = JSON.parse(raw);
    } catch (e) {
      console.log(chalk.red(`  Failed to parse legacy state for ${slug}. Skipping state migration.`));
      return;
    }
    // Transform schema
    state.version = 1;
    if (!state.runId) state.runId = null;
    if (!state.sourceManifest) state.sourceManifest = {};
    if (!state.activeProfile) state.activeProfile = "hybrid";
    if (!state.createdAt) state.createdAt = new Date().toISOString();
    if (!state.updatedAt) state.updatedAt = new Date().toISOString();
    if (!state.cancellationState) state.cancellationState = "none";
    if (!state.steps) state.steps = {};
    // Atomic Write
    await atomicWriteFile(paths.stateJson, JSON.stringify(state, null, 2));
    // Reread verification
    const newRaw = await readFile(paths.stateJson, "utf-8");
    JSON.parse(newRaw);
    // Archive old file
    await rename(legacyStatePath, `${legacyStatePath}.archived`);
  }
}
