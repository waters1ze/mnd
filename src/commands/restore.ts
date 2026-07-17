import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { session } from "../repl/loop.js";
import { restoreFile } from "../core/atomic.js";

export async function handleRestore(args: string[], rawInput: string): Promise<void> {
  const target = args[0]?.toLowerCase();
  const backupId = args[1];

  if (!backupId) {
    console.log(chalk.red("Usage: restore config <backup-id> | restore project <backup-id>"));
    return;
  }

  if (target === "config") {
    const { getAppDataDir } = await import("../core/paths.js");
    const configPath = join(getAppDataDir(), "config.yaml");
    const backupPath = join(getAppDataDir(), "backups", backupId);
    try {
      await restoreFile(backupPath, configPath);
      console.log(chalk.green("Config restored successfully. Previous config saved as pre-restore backup."));
    } catch (e: any) {
      console.log(chalk.red(`Restore failed: ${e.message}`));
    }
    return;
  }

  if (target === "project") {
    const slug = session.currentProjectSlug;
    if (!slug) {
      console.log(chalk.red("No project open to restore into."));
      return;
    }
    console.log(chalk.yellow(`Project restore for ${slug} from ${backupId} to be fully implemented.`));
    return;
  }

  console.log(chalk.red("Usage: restore config <backup-id> | restore project <backup-id>"));
}
