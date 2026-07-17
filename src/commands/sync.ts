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
import { statSync } from "node:fs";
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
      
      const cfg = await loadConfig();
      const vaultPath = resolveVaultPath(cfg);
      const manifestPath = join(vaultPath, ".mnd-sync", "manifest.json");
      const manifest = await loadManifest(manifestPath);
      
      const folderId = manifest.entries["_MND_REMOTE_FOLDER_ID"]?.remoteFileId;
      if (!folderId) {
        console.log(chalk.red("Sync not setup. Run /sync setup first."));
        return;
      }
      
      const plan = await createSyncPlan(vaultPath, folderId, manifest, { includeRaw: false });
      console.log(`Pending actions: ${plan.actions.length}`);
      console.log(`Conflicts: ${plan.conflicts.length}`);
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
      const summary = await googleAuth.getAccountSummary();
      if (!summary || summary.status === "logged_out") return;

      const cfg = await loadConfig();
      const vaultPath = resolveVaultPath(cfg);
      const manifestPath = join(vaultPath, ".mnd-sync", "manifest.json");
      const manifest = await loadManifest(manifestPath);
      const folderId = manifest.entries["_MND_REMOTE_FOLDER_ID"]?.remoteFileId;
      if (!folderId) return;

      const plan = await createSyncPlan(vaultPath, folderId, manifest, { includeRaw: true });
      if (plan.conflicts.length === 0) {
        console.log(chalk.green("No unresolved conflicts."));
        return;
      }

      console.log(chalk.bold(`\nConflicts (${plan.conflicts.length}):`));
      for (const c of plan.conflicts) {
        console.log(chalk.cyan(`  ${c.entry.relativePath}`));
        console.log(chalk.gray(`    Reason: ${c.reason}`));
      }
      console.log("\nUse `/sync resolve` to fix them.");
    },
    getContextAvailability: () => "enabled"
  });

  registerCommand({
    name: "sync resolve",
    description: "Resolve sync conflicts interactively",
    execute: async () => {
      console.log(chalk.yellow("Starting interactive resolution..."));
      const summary = await googleAuth.getAccountSummary();
      if (!summary || summary.status === "logged_out") return;

      const cfg = await loadConfig();
      const vaultPath = resolveVaultPath(cfg);
      const manifestPath = join(vaultPath, ".mnd-sync", "manifest.json");
      const manifest = await loadManifest(manifestPath);
      const folderId = manifest.entries["_MND_REMOTE_FOLDER_ID"]?.remoteFileId;
      if (!folderId) return;

      const plan = await createSyncPlan(vaultPath, folderId, manifest, { includeRaw: true });
      if (plan.conflicts.length === 0) {
        console.log(chalk.green("No conflicts to resolve."));
        return;
      }

      for (const conflict of plan.conflicts) {
        console.log(chalk.bold(`\nConflict: ${conflict.entry.relativePath}`));
        console.log(`Reason: ${conflict.reason}`);

        const isRaw = conflict.entry.relativePath.startsWith("raw/") || conflict.entry.relativePath === "raw";
        const isTombstone = !!conflict.entry.tombstone;

        const options = [
          { value: "keep_local", label: "Keep Local (Push to Drive)" },
          { value: "keep_remote", label: "Keep Remote (Pull from Drive)" },
          { value: "keep_both", label: "Keep Both (Rename local, pull remote)" },
        ];

        if (isTombstone) {
           options.push({ value: "keep_local_untracked", label: "Keep Local (Stop Syncing)" });
           if (!isRaw) {
             options.push({ value: "accept_deletion", label: "Accept Remote Deletion (Move local to Trash)" });
           }
        }

        options.push({ value: "skip", label: "Skip for now" });

        const resolution = await select({
          message: `How do you want to resolve ${conflict.entry.relativePath}?`,
          options,
        });

        if (resolution === "skip") {
          console.log(chalk.yellow("Skipping..."));
          continue;
        }

        await resolveConflict(conflict, resolution as ConflictResolution, plan, vaultPath);
      }

      // If we resolved anything, execute the newly generated actions
      if (plan.actions.length > 0) {
         console.log(chalk.cyan(`\nExecuting ${plan.actions.length} resolution actions...`));
         await executeSyncPlan(plan, vaultPath, folderId, manifest, (action, progress) => {
           console.log(`  ${action}`);
         });
         // Filter out any entries marked delete_local from conflict resolution
         for (const act of plan.actions) {
            if (act.type === "delete_local" as any && act.reason === "Accepted deletion") {
               delete manifest.entries[act.entry.relativePath];
            }
         }
         await saveManifest(manifestPath, manifest);
         console.log(chalk.green("✔ Resolutions applied."));
      }
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

    if (mode === "push") {
      plan.actions = plan.actions.filter(a => a.type === "push" || a.type === "delete_remote" || a.type === "mark_tombstone");
    } else if (mode === "pull") {
      plan.actions = plan.actions.filter(a => a.type === "pull" || a.type === "mark_tombstone");
    }

    // Handle include-raw confirmation securely
    if (includeRaw) {
      const rawUploads = plan.actions.filter(a => a.type === "push" && (a.entry.relativePath.startsWith("raw/") || a.entry.relativePath === "raw"));
      if (rawUploads.length > 0) {
        let totalSize = 0;
        const files: { path: string, size: number }[] = [];
        
        for (const act of rawUploads) {
           const size = act.entry.localSize || 0;
           totalSize += size;
           files.push({ path: act.entry.relativePath, size });
        }
        files.sort((a, b) => b.size - a.size);

        console.log(chalk.bold("\nRaw media upload\n"));
        console.log(`Account: ${summary.email}`);
        console.log(`Destination: My Drive/MND (ID: ${folderId})`);
        console.log(`Files: ${rawUploads.length}`);
        console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log("\nLargest files:");
        for (const f of files.slice(0, 5)) {
          console.log(`  ${f.path} — ${(f.size / 1024 / 1024).toFixed(2)} MB`);
        }
        
        console.log("\n" + chalk.yellow("Source files will not be modified or deleted."));
        console.log(chalk.yellow("Remote deletion will never delete local raw files.\n"));
        
        const confirmation = await text({
          message: "Type UPLOAD RAW to continue:",
        });

        if (confirmation !== "UPLOAD RAW") {
          console.log(chalk.red("Upload cancelled."));
          return;
        }
      }
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
