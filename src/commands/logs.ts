import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { getGlobalLogsDir, getProjectLogsDir } from "../core/paths.js";

export async function handleLogs(args: string[], rawInput: string): Promise<void> {
  const target = args[0]?.toLowerCase();
  
  if (target === "global") {
    await showLogs(join(getGlobalLogsDir(), "app.log"));
    return;
  }
  
  if (target === "project") {
    const dir = await getProjectLogsDir();
    if (!dir) {
      console.log(chalk.red("No project open."));
      return;
    }
    await showLogs(join(dir, "run.log"));
    return;
  }

  // Default to project if open, else global
  const dir = await getProjectLogsDir();
  if (dir && existsSync(join(dir, "run.log"))) {
    console.log(chalk.gray("Showing project logs. Use 'logs global' for app logs."));
    await showLogs(join(dir, "run.log"));
  } else {
    console.log(chalk.gray("Showing global app logs."));
    await showLogs(join(getGlobalLogsDir(), "app.log"));
  }
}

async function showLogs(logPath: string) {
  if (!existsSync(logPath)) {
    console.log(chalk.yellow("Log file is empty or does not exist."));
    return;
  }
  
  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n");
    // Show last 50 lines by default
    const tail = lines.slice(-50);
    console.log(tail.join("\n"));
  } catch (e: any) {
    console.log(chalk.red(`Failed to read logs: ${e.message}`));
  }
}
