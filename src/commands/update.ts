// src/commands/update.ts
import chalk from "chalk";
import { registerCommand } from "../repl/registry.js";
import { Updater, detectGitState } from "../core/updater.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const updater = new Updater();

export function registerUpdateCommands() {
  registerCommand({
    name: "update check",
    description: "Check for MND updates",
    execute: async () => {
      console.log(chalk.cyan("Checking for updates..."));
      
      const gitState = detectGitState(process.cwd());
      if (gitState.isGit && (!gitState.clean || gitState.ahead > 0 || gitState.diverged || gitState.noUpstream || gitState.detached)) {
        console.log(chalk.yellow("\nDevelopment checkout detected"));
        console.log(chalk.yellow("Auto-apply disabled"));
        console.log(chalk.yellow("Update mode: notify only\n"));
      }

      try {
        const manifest = await updater.checkUpdate();
        if (!manifest) {
          console.log(chalk.gray("No published MND releases found."));
          console.log(chalk.gray("Current development build will not be modified."));
          return;
        }

        console.log(chalk.green(`New version available: ${manifest.version}`));
        if (updater.isUpdateSafe()) {
            console.log(chalk.cyan("Run /update install to apply."));
        } else {
            console.log(chalk.yellow("Local repository is dirty or ahead. Update cannot be applied."));
        }
      } catch (err: any) {
        console.error(chalk.red("Failed to check for updates: " + err.message));
      }
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "update status",
    description: "Show updater status",
    execute: async () => {
      console.log(chalk.bold("\nUpdater Status"));
      console.log(`Channel: stable`);
      const gitState = detectGitState(process.cwd());
      if (gitState.isGit) {
        console.log(`Git checkout: ${gitState.clean ? "Clean" : "Dirty/Ahead"} (Auto-apply ${gitState.clean && gitState.ahead === 0 ? "enabled" : "disabled"})`);
      }
      console.log("");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "update install",
    description: "Install staged update",
    execute: async () => {
      console.log(chalk.cyan("Installing update..."));
      if (!updater.isUpdateSafe()) {
        console.log(chalk.red("Cannot install update: Development checkout is not clean."));
        return;
      }
      await updater.installStagedUpdate();
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "update rollback",
    description: "Rollback to previous version",
    execute: async () => {
      console.log(chalk.yellow("Rolling back..."));
      await updater.rollback();
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "version",
    description: "Show MND version details",
    execute: async () => {
      let version = "0.1.0"; // default
      try {
          const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
          version = pkg.version;
      } catch {}
      console.log(chalk.bold(`MND v${version}`));
      console.log(`Node: ${process.version}`);
      console.log(`Platform: ${process.platform} ${process.arch}`);
      
      const gitState = detectGitState(process.cwd());
      if (gitState.isGit) {
        console.log(`Install mode: Development Checkout`);
      } else {
        console.log(`Install mode: Packaged Release`);
      }
    },
    getContextAvailability: () => "enabled"
  });
}
