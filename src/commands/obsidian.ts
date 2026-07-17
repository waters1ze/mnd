import { exec } from "node:child_process";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";

function buildObsidianUri(vaultPath: string): string {
  // Obsidian supports opening (and, if needed, creating/registering) a vault
  // directly by absolute path via the `path` URI parameter — no need for the
  // vault to already be known to Obsidian by name.
  return `obsidian://open?path=${encodeURIComponent(vaultPath)}`;
}

function openUri(uri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    if (platform === "win32") {
      // 'start' needs an empty title arg when the URL is quoted.
      // We use cmd /c start explicitly under Windows to ensure the URI handler starts cleanly.
      cmd = `cmd /c start "" "${uri}"`;
    } else if (platform === "darwin") {
      cmd = `open "${uri}"`;
    } else {
      cmd = `xdg-open "${uri}"`;
    }
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

export const handleObsidian: CommandHandler = async () => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const uri = buildObsidianUri(vaultPath);

  console.log(chalk.gray(`Opening vault in Obsidian: ${vaultPath}`));

  try {
    await openUri(uri);
    console.log(chalk.hex(theme.accent)("✓ Sent open request to Obsidian."));
  } catch (err) {
    console.log(chalk.red("✗ Could not launch Obsidian automatically."));
    console.log(chalk.gray("Make sure Obsidian is installed and its obsidian:// URI handler is registered."));
    console.log(chalk.gray(`You can also open it manually: Obsidian → "Open folder as vault" → ${vaultPath}`));
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.gray(`(${msg})`));
  }
};
