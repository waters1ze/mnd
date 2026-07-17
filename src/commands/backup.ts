import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { backupFile, listBackups } from "../core/atomic.js";
import { configExists, loadConfig } from "../core/config.js";

import { session } from "../repl/loop.js";

export async function handleBackup(args: string[], rawInput: string): Promise<void> {
  const target = args[0]?.toLowerCase();
  const nameArgIdx = args.indexOf("--name");
  const label = nameArgIdx >= 0 && args[nameArgIdx + 1] ? args[nameArgIdx + 1] : "manual";

  if (target === "config") {
    await backupConfig(label!);
    return;
  }

  if (target === "project") {
    await backupProject(label!);
    return;
  }

  if (target === "backups" || rawInput.includes("backups")) {
    await listAllBackups();
    return;
  }

  console.log(chalk.red("Usage: backup project [--name label] | backup config [--name label] | backups"));
}

async function backupConfig(label: string) {
  if (!(await configExists())) {
    console.log(chalk.red("No config found."));
    return;
  }
  const { getAppDataDir } = await import("../core/paths.js");
  const configPath = join(getAppDataDir(), "config.yaml");
  const backupDir = join(getAppDataDir(), "backups");
  const res = await backupFile(configPath, backupDir, label);
  if (res) {
    console.log(chalk.green(`Config backed up to: ${res}`));
  }
}

async function backupProject(label: string) {
  const slug = session.currentProjectSlug;
  if (!slug) {
    console.log(chalk.red("No project open to backup."));
    return;
  }
  console.log(chalk.yellow(`Project backup for ${slug} to be fully implemented. Excludes raw/ by default.`));
}

async function listAllBackups() {
  console.log(chalk.yellow("List backups to be implemented."));
}
