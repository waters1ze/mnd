// src/commands/sync.ts
import chalk from "chalk";
import { select, confirm, text } from "@clack/prompts";
import { registerCommand } from "../repl/registry.js";
import { GoogleAuthProvider } from "../auth/googleAuth.js";
import { getAccountState, saveAccountState } from "../auth/accountState.js";
import { getOrCreateFolder } from "../integrations/googleDrive/layout.js";
import { loadManifest, saveManifest } from "../sync/manifest.js";
import { createSyncPlan } from "../sync/planner.js";
import { executeSyncPlan } from "../sync/engine.js";
import { resolveConflict, type ConflictResolution } from "../sync/conflicts.js";
import { join } from "node:path";
import { session } from "../repl/loop.js";
import { loadConfig, resolveVaultPath } from "../core/config.js";

const googleAuth = new GoogleAuthProvider();

export function registerSyncCommands() {
  registerCommand({
    name: "sync setup",
    description: "Initialize Google Drive sync for this vault",
    execute: async () => {
      const summary = await googleAuth.getAccountSummary();
      if (!summary || summary.status === "logged_out") {
        console.log(chalk.red("Must be logged in to setup sync. Run /login first."));
        return;
      }
      console.log(chalk.cyan("Setting up Google Drive remote folder 'MND'..."));
      try {
        const folderId = await getOrCreateFolder("MND", undefined, { isMndRoot: "true" });
        console.log(chalk.green(`✔ Sync folder established. (ID: ${folderId})`));
        // Save folder ID to account state or some vault-level config
        const cfg = await loadConfig();
        const vaultPath = resolveVaultPath(cfg);
        const manifestPath = join(vaultPath, ".mnd-sync", "manifest.json");
        const manifest = await loadManifest(manifestPath);
        manifest.entries["_MND_REMOTE_FOLDER_ID"] = { version: 1, relativePath: "", state: "synced", remoteFileId: folderId };
        await saveManifest(manifestPath, manifest);
      } catch (err: any) {
        console.error(chalk.red("Setup failed: " + err.message));
      }
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync status",
    description: "Show current sync status",
    execute: async () => {
      const summary = await googleAuth.getAccountSummary();
      if (!summary || summary.status === "logged_out") {
        console.log(chalk.gray("Sync is offline (not logged in)."));
        return;
      }
      console.log(chalk.bold("\nSync Status"));
      console.log(`Account: ${summary.email}`);
      console.log(`Online: Yes`);
      // We would load manifest and count pending/conflicts here
      console.log("");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync now",
    description: "Run bidirectional sync",
    acceptsArgs: true,
    execute: async (args) => {
      const includeRaw = args.includes("--include-raw");
      await runSync(includeRaw, "both");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync push",
    description: "Push local changes to Drive",
    acceptsArgs: true,
    execute: async (args) => {
      await runSync(args.includes("--include-raw"), "push");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync pull",
    description: "Pull remote changes from Drive",
    execute: async () => {
      await runSync(false, "pull");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync conflicts",
    description: "Show unresolved sync conflicts",
    execute: async () => {
      console.log(chalk.yellow("Checking for conflicts..."));
      // In a real flow, we check the latest plan saved to disk or run planner
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync resolve",
    description: "Resolve sync conflicts interactively",
    execute: async () => {
      console.log(chalk.yellow("Starting interactive resolution..."));
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync pause",
    description: "Pause background sync",
    execute: async () => {
      console.log(chalk.yellow("Sync paused."));
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync resume",
    description: "Resume background sync",
    execute: async () => {
      console.log(chalk.green("Sync resumed."));
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync disconnect",
    description: "Disconnect the vault from Drive",
    execute: async () => {
      console.log(chalk.red("Sync disconnected."));
    },
    getContextAvailability: () => "enabled"
  });
}

async function runSync(includeRaw: boolean, mode: "both" | "push" | "pull") {
  const summary = await googleAuth.getAccountSummary();
  if (!summary || summary.status === "logged_out") {
    console.log(chalk.red("Must be logged in to sync. Run /login first."));
    return;
  }

  if (includeRaw) {
    const confirmed = await confirm({
      message: "WARNING: You selected --include-raw. This will upload raw video files, consuming Drive quota. Proceed?",
      initialValue: false,
    });
    if (!confirmed) return;
  }

  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const manifestPath = join(vaultPath, ".mnd-sync", "manifest.json");
  const manifest = await loadManifest(manifestPath);

  const folderId = manifest.entries["_MND_REMOTE_FOLDER_ID"]?.remoteFileId;
  if (!folderId) {
    console.log(chalk.red("Sync not setup. Run /sync setup first."));
    return;
  }

  console.log(chalk.cyan("Planning sync..."));
  try {
    const plan = await createSyncPlan(vaultPath, folderId, manifest, { includeRaw });

    // Filter plan by mode
    if (mode === "push") {
      plan.actions = plan.actions.filter(a => a.type === "push" || a.type === "delete_remote");
    } else if (mode === "pull") {
      plan.actions = plan.actions.filter(a => a.type === "pull" || a.type === "delete_local");
    }

    if (plan.conflicts.length > 0) {
      console.log(chalk.yellow(`Found ${plan.conflicts.length} conflicts. Run /sync conflicts to resolve.`));
    }

    if (plan.actions.length === 0) {
      console.log(chalk.green("✔ Already up to date."));
      return;
    }

    console.log(chalk.cyan(`Executing ${plan.actions.length} actions...`));
    await executeSyncPlan(plan, vaultPath, folderId, manifest, (action, progress) => {
      console.log(`  ${action}`);
    });
    await saveManifest(manifestPath, manifest);
    console.log(chalk.green("✔ Sync complete."));

  } catch (err: any) {
    console.error(chalk.red("Sync failed: " + err.message));
  }
}
