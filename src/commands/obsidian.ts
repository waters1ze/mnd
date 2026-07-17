import chalk from "chalk";
import { confirm } from "@clack/prompts";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { getRegisteredVaultId, openRegisteredVault, launchObsidianApp } from "../integrations/obsidian.js";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

function createHomeNoteIfMissing(vaultPath: string): void {
  const homePath = join(vaultPath, "Home.md");
  if (!existsSync(homePath)) {
    const content = `# MND Vault Home\n\nWelcome to your MND vault. Here you can find your projects and assets.\n\n- [[Projects/]]\n- [[Assets/]]\n- [[Global_Rules/]]\n- [[Styles/]]\n- [[Skills/]]\n`;
    try {
      writeFileSync(homePath, content, "utf-8");
    } catch {
      // ignore
    }
  }
}

export const handleObsidian: CommandHandler = async () => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);

  createHomeNoteIfMissing(vaultPath);

  console.log(chalk.gray(`Checking Obsidian registration for vault: ${vaultPath}`));
  
  const vaultId = await getRegisteredVaultId(vaultPath);

  if (vaultId) {
    try {
      await openRegisteredVault(vaultId);
      console.log(chalk.hex(theme.accent)(`✓ Opened registered Obsidian vault: mnd`));
    } catch (err) {
      console.log(chalk.red("✗ Obsidian is not installed or its protocol handler is unavailable."));
      console.log(chalk.gray(`Error: ${err instanceof Error ? err.message : String(err)}`));
    }
  } else {
    console.log(chalk.yellow(`The mnd folder exists but Obsidian has not registered it as a vault yet.`));
    const shouldOpen = await confirm({
      message: `Offer to open Obsidian now so you can choose "Open folder as vault"?`,
      initialValue: true,
    });
    
    if (shouldOpen) {
      try {
        await launchObsidianApp();
        console.log(chalk.hex(theme.accent)("Obsidian launched. Complete the one-time “Open folder as vault” step:"));
        console.log(chalk.white(vaultPath));
      } catch (err) {
        console.log(chalk.red("✗ Could not launch Obsidian automatically."));
        console.log(chalk.gray(`Error: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }
};
