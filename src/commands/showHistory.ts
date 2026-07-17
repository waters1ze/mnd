// src/commands/showHistory.ts
import Table from "cli-table3";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { listProjects } from "../core/vault.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

export const handleShowHistory: CommandHandler = async () => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const projects = await listProjects(vaultPath);

  if (projects.length === 0) {
    console.log(chalk.gray("No projects found. Use `create` to start one."));
    return;
  }

  const table = new Table({
    head: [
      chalk.hex(theme.accent)("Project"),
      chalk.hex(theme.accent)("Style"),
      chalk.hex(theme.accent)("Status"),
      chalk.hex(theme.accent)("Created"),
    ],
    colWidths: [30, 20, 12, 22],
    style: { border: ["gray"], head: [] },
  });

  for (const p of projects) {
    const fm = p.frontmatter;
    const statusColor = fm.status === "exported"
      ? chalk.green(fm.status)
      : fm.status === "analyzed"
        ? chalk.yellow(fm.status)
        : chalk.gray(fm.status);
    table.push([
      fm.title ?? p.slug,
      fm.style ?? "-",
      statusColor,
      fm.created ? fm.created.slice(0, 10) : "-",
    ]);
  }

  console.log(table.toString());
};
