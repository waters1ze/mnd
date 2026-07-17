import chalk from "chalk";
import { text, confirm, select } from "@clack/prompts";
import { loadConfig, saveConfig, updateConfigField, resolveVaultPath } from "../core/config.js";
import { getRegisteredVaultId, registerVaultSafely, openRegisteredVault, launchObsidianApp } from "../integrations/obsidian.js";
import { writeFileSync, existsSync } from "node:fs";
import { mkdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";
import { homedir } from "node:os";

async function ensureVaultStructure(vaultPath: string): Promise<void> {
  const dirs = [
    ".obsidian",
    "Projects",
    "Assets",
    "Global_Rules",
    "Styles",
    "Skills"
  ];
  for (const d of dirs) {
    if (!existsSync(join(vaultPath, d))) {
      await mkdir(join(vaultPath, d), { recursive: true });
    }
  }

  const homePath = join(vaultPath, "Home.md");
  if (!existsSync(homePath)) {
    const content = `# MND Vault Home\n\nWelcome to your MND vault. Here you can find your projects and assets.\n\n- [[Projects/]]\n- [[Assets/]]\n- [[Global_Rules/]]\n- [[Styles/]]\n- [[Skills/]]\n`;
    try {
      // Use wx flag for exclusive creation to prevent accidental overwrites
      writeFileSync(homePath, content, { encoding: "utf-8", flag: "wx" });
    } catch {}
  }
}

async function performSetup(cfg: any) {
  console.log(chalk.cyan("Obsidian vault setup\n"));

  let defaultPath = cfg.vault_path || join(homedir(), "Vaults", "mnd");

  const newPath = await text({
    message: "Path:",
    initialValue: defaultPath,
    validate: (val) => val.trim().length === 0 ? "Path cannot be empty" : undefined
  });

  if (typeof newPath !== "string") return; // cancelled

  let targetPath = newPath.trim().replace(/^["']|["']$/g, '');
  if (targetPath.startsWith('~')) {
    targetPath = join(homedir(), targetPath.slice(1));
  }

  // Handle conflicting nonempty vault logic if moving from an old path
  if (cfg.vault_path && targetPath !== cfg.vault_path && existsSync(cfg.vault_path)) {
    const choice = await select({
      message: `Vault already exists at ${cfg.vault_path}. How do you want to handle this?`,
      options: [
        { value: "copy", label: `Copy existing vault to ${targetPath}` },
        { value: "empty", label: `Use ${targetPath} as a new empty vault` },
        { value: "cancel", label: "Cancel setup" }
      ]
    });

    if (choice === "cancel") {
      console.log(chalk.gray("Setup cancelled."));
      return;
    }

    if (choice === "copy") {
      console.log(chalk.gray(`Copying vault to ${targetPath}...`));
      
      const stagingPath = `${targetPath}.staging.${Date.now()}`;
      await cp(cfg.vault_path, stagingPath, { recursive: true });
      
      // Atomic promotion (only works if target doesn't exist, which we assume if it's new)
      // If target exists, we'd need to rename it away first.
      if (existsSync(targetPath)) {
        console.log(chalk.yellow(`Target ${targetPath} already exists. Cannot safely copy over non-empty directory.`));
        return;
      }
      import("node:fs/promises").then(({ rename }) => rename(stagingPath, targetPath));
      console.log(chalk.green("✓ Vault copied."));
    }
  } else if (existsSync(targetPath)) {
    import("node:fs").then(({ readdirSync }) => {
      const files = readdirSync(targetPath);
      if (files.length > 0 && !files.includes(".obsidian")) {
         console.log(chalk.yellow(`Warning: ${targetPath} is not empty and does not look like an existing vault.`));
         console.log(chalk.yellow(`MND will create folders inside it, but will not delete your files.`));
      }
    });
  }

  console.log(chalk.white(`\nThe following will be created in ${targetPath}:`));
  console.log(chalk.gray("• .obsidian/\n• Home.md\n• Projects/\n• Assets/\n• Global_Rules/\n• Styles/\n• Skills/\n"));

  const init = await confirm({ message: "Initialize?", initialValue: true });
  if (!init) {
    console.log(chalk.gray("Setup cancelled."));
    return;
  }

  await ensureVaultStructure(targetPath);

  console.log(chalk.green("✓ Vault initialized"));

  // Check Obsidian installation
  const regResult = await registerVaultSafely(targetPath);

  if (regResult.success && regResult.vaultId) {
    console.log(chalk.green("✓ Obsidian installation found"));
    console.log(chalk.green("✓ Vault registered"));
    
    // Update config
    await updateConfigField((c) => {
      c.vault_path = targetPath;
      if (!c.obsidian) c.obsidian = { initialized: true, vault_id: regResult.vaultId, home_note: "Home.md", last_verified_at: null };
      c.obsidian.initialized = true;
      c.obsidian.vault_id = regResult.vaultId;
      c.obsidian.last_verified_at = new Date().toISOString();
    });

    console.log(chalk.green("✓ Opening Home.md"));
    await openRegisteredVault(regResult.vaultId);
  } else {
    // Save path anyway
    await updateConfigField((c) => {
      c.vault_path = targetPath;
      if (!c.obsidian) c.obsidian = { initialized: true, vault_id: null, home_note: "Home.md", last_verified_at: null };
      c.obsidian.initialized = true;
      c.obsidian.vault_id = null;
    });

    console.log(chalk.yellow("! One-time Obsidian registration required\n"));
    console.log(chalk.gray(`Could not auto-register: ${regResult.error}`));
    console.log(chalk.white(`\nObsidian has been opened.`));
    console.log(chalk.white(`Choose “Open folder as vault” and select:`));
    console.log(chalk.cyan(targetPath));
    console.log(chalk.gray(`\nRun /obsidian again afterward.`));
    await launchObsidianApp();
  }
}

export const handleObsidian: CommandHandler = async (args, rawInput) => {
  const cfg = await loadConfig();
  
  if (args[0] === "setup" || (!cfg.obsidian?.initialized)) {
    await performSetup(cfg);
    return;
  }

  if (args[0] === "reset") {
    const ok = await confirm({
      message: "Are you sure you want to reset Obsidian metadata? This will forget the vault registration in MND.",
      initialValue: false
    });
    if (!ok) return;
    await updateConfigField(c => {
      if (c.obsidian) {
        c.obsidian.initialized = false;
        c.obsidian.vault_id = null;
        c.obsidian.last_verified_at = null;
      }
    });
    console.log(chalk.green("✓ Obsidian integration metadata reset."));
    console.log(chalk.gray("Note: Your vault files and .obsidian folder were not deleted."));
    return;
  }

  if (args[0] === "repair") {
    const vp = resolveVaultPath(cfg);
    console.log(chalk.gray(`Repairing vault structure at ${vp}...`));
    await ensureVaultStructure(vp);
    
    const regResult = await registerVaultSafely(vp);
    if (regResult.success && regResult.vaultId) {
      await updateConfigField((c) => {
        if (c.obsidian) c.obsidian.vault_id = regResult.vaultId;
      });
      console.log(chalk.green("✓ Vault structure repaired and registration verified."));
    } else {
      console.log(chalk.yellow(`! Structure repaired, but registration failed: ${regResult.error}`));
    }
    return;
  }

  if (args[0] === "status") {
    console.log(chalk.cyan("Obsidian Integration Status"));
    console.log(`Initialized: ${cfg.obsidian?.initialized ? "Yes" : "No"}`);
    console.log(`Vault Path: ${cfg.vault_path}`);
    console.log(`Vault ID: ${cfg.obsidian?.vault_id || "None"}`);
    return;
  }

  const vaultPath = resolveVaultPath(cfg);
  
  // Standard run (either /obsidian or /obidian)
  let vaultId = cfg.obsidian?.vault_id;
  
  // If no ID or we want to double check
  if (!vaultId) {
    const id = await getRegisteredVaultId(vaultPath);
    if (id) {
      vaultId = id;
      await updateConfigField(c => { if(c.obsidian) c.obsidian.vault_id = id; });
    }
  }

  if (vaultId) {
    try {
      await openRegisteredVault(vaultId, cfg.obsidian?.home_note || "Home");
      console.log(chalk.hex(theme.accent)(`✓ Opened Obsidian vault`));
    } catch (err) {
      console.log(chalk.red("✗ Failed to open vault. Try /obsidian repair"));
    }
  } else {
    // Attempt registration just in case
    const reg = await registerVaultSafely(vaultPath);
    if (reg.success && reg.vaultId) {
      await updateConfigField(c => { if(c.obsidian) c.obsidian.vault_id = reg.vaultId; });
      await openRegisteredVault(reg.vaultId, cfg.obsidian?.home_note || "Home");
      console.log(chalk.hex(theme.accent)(`✓ Opened Obsidian vault`));
    } else {
      console.log(chalk.yellow(`Vault not registered with Obsidian.`));
      console.log(chalk.gray(`Run /obsidian setup or repair.`));
    }
  }
};
