import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { backupFile, atomicWriteFile } from "./atomic.js";
import { getAppDataDir } from "./paths.js";
import type { MndConfig } from "../types/config.js";

export const LATEST_CONFIG_VERSION = 1;
export const LATEST_VAULT_VERSION = 1;

export async function runConfigMigrations(): Promise<void> {
  const configPath = join(getAppDataDir(), "config.yaml");
  if (!existsSync(configPath)) return;

  const raw = await readFile(configPath, "utf-8");
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
  await backupFile(configPath, backupDir, `pre-migration-v${currentVersion}`);

  let migrated = { ...parsed };

  // Migrations registry
  if (currentVersion < 1) {
    migrated.version = 1;
    // v0 -> v1 changes if any
  }

  await atomicWriteFile(configPath, YAML.stringify(migrated));
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
  await backupFile(vaultMetaPath, backupDir, `pre-migration-vault-v${currentVersion}`);
  
  let migrated = { ...parsed };
  if (currentVersion < 1) {
    migrated.version = 1;
  }
  
  await atomicWriteFile(vaultMetaPath, JSON.stringify(migrated, null, 2));
  console.log(chalk.green("✓ Vault migration successful."));
}
