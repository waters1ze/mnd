import chalk from "chalk";
import { getProjectPaths } from "../core/projectPaths.js";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { validateFcpxml } from "../export/fcpxmlValidator.js";
import { backupFile, atomicWriteFile } from "../core/atomic.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "node:child_process";

export async function handleExportValidate(slug: string): Promise<void> {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const report = await validateFcpxml(vaultPath, slug);

  console.log(chalk.blue(`\n[FCPXML VALIDATION] Report for ${slug}`));
  
  if (report.valid) {
    console.log(chalk.green("✓ Timeline is valid."));
  } else {
    console.log(chalk.red("✗ Timeline has validation errors."));
  }

  if (report.errors.length > 0) {
    console.log(chalk.red("Errors:"));
    report.errors.forEach(e => console.log(`  - ${e}`));
  }

  if (report.warnings.length > 0) {
    console.log(chalk.yellow("Warnings:"));
    report.warnings.forEach(w => console.log(`  - ${w}`));
  }
}

export async function handleExportReveal(slug: string): Promise<void> {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const paths = getProjectPaths(vaultPath, slug);
  const fcpxml = paths.timelineFcpxml;

  if (!existsSync(fcpxml)) {
    console.log(chalk.red(`FCPXML not found at ${fcpxml}`));
    return;
  }

  console.log(chalk.gray(`Opening folder containing: ${fcpxml}`));
  const platform = process.platform;
  let cmd = "";
  if (platform === "win32") {
    cmd = `explorer /select,"${fcpxml}"`;
  } else if (platform === "darwin") {
    cmd = `open -R "${fcpxml}"`;
  } else {
    cmd = `xdg-open "${paths.exportsDir}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log(chalk.red(`Failed to reveal file: ${err.message}`));
    }
  });
}

export async function handleExportRetry(slug: string): Promise<void> {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const paths = getProjectPaths(vaultPath, slug);

  console.log(chalk.blue(`\n[EXPORT RETRY] Regenerating FCPXML from last valid plan for ${slug}...`));

  if (!existsSync(paths.editPlanJson)) {
    console.log(chalk.red(`No valid edit plan found at ${paths.editPlanJson}`));
    return;
  }

  const planRaw = await readFile(paths.editPlanJson, "utf-8");
  const editPlan = JSON.parse(planRaw);

  // Backup old FCPXML if exists
  if (existsSync(paths.timelineFcpxml)) {
    await backupFile(paths.timelineFcpxml, paths.backupsDir, "pre-retry");
  }

  // Use the FCPXML generator
  const { exportTimelineStep } = await import("../pipeline/exportTimeline.js");
  const { loadProjectState } = await import("../core/projectState.js");
  const state = await loadProjectState(vaultPath, slug);

  await exportTimelineStep(editPlan, state, vaultPath);
  
  // Validate it
  const report = await validateFcpxml(vaultPath, slug);
  const reportPath = join(paths.validationDir, "report.json");
  await atomicWriteFile(reportPath, JSON.stringify(report, null, 2));

  if (report.valid) {
    console.log(chalk.green("✓ New FCPXML generated and validated successfully."));
  } else {
    console.log(chalk.red("✗ New FCPXML generated but contains validation errors. See report."));
  }
}
