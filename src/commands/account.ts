// src/commands/account.ts
import { GoogleAuthProvider } from "../auth/googleAuth.js";
import { registerCommand } from "../repl/registry.js";
import chalk from "chalk";
import { getAccountStateSync } from "../auth/accountState.js";

const googleAuth = new GoogleAuthProvider();

export function registerAccountCommands() {
  registerCommand({
    name: "login",
    description: "Login with Google",
    aliases: ["login google"],
    execute: async () => {
      console.log(chalk.cyan("\n┏━ Connect Google Drive ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓"));
      console.log(chalk.cyan("┃ ") + "A browser window has been opened.");
      console.log(chalk.cyan("┃ ") + "Choose the Google account for MND backups.");
      console.log(chalk.cyan("┃ ") + "MND requests access only to files it creates.");
      console.log(chalk.cyan("┃"));
      console.log(chalk.cyan("┃ ") + chalk.yellow("⠹ Waiting for Google authorization…"));
      console.log(chalk.cyan("┃ ") + chalk.gray("Esc cancel"));
      console.log(chalk.cyan("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛"));

      try {
        await googleAuth.login();
        console.log(chalk.green("✔ Successfully logged in."));
      } catch (err: any) {
        if (err.message.includes("cancelled")) {
          console.log(chalk.yellow("Login cancelled."));
        } else {
          console.error(chalk.red("✖ Login failed: " + err.message));
        }
      }
    },
    getContextAvailability: () => {
      const state = getAccountStateSync();
      return !state || state.status === "logged_out" ? "enabled" : "hidden";
    }
  });

  registerCommand({
    name: "logout",
    description: "Logout from Google",
    aliases: ["logout google"],
    execute: async () => {
      console.log(chalk.yellow("Logging out..."));
      await googleAuth.logout();
      console.log(chalk.green("✔ Logged out successfully."));
    },
    getContextAvailability: () => {
      const state = getAccountStateSync();
      return state && state.status !== "logged_out" ? "enabled" : "hidden";
    }
  });

  registerCommand({
    name: "account",
    description: "Show account status",
    aliases: ["account status"],
    execute: async () => {
      const summary = await googleAuth.getAccountSummary();
      if (!summary || summary.status === "logged_out") {
        console.log(chalk.gray("Not logged in."));
        return;
      }
      
      console.log(chalk.bold("\nGoogle Drive Account"));
      if (summary.status === "connected") {
        console.log(chalk.green(`✓ Connected: ${summary.email || summary.accountId}`));
      } else {
        console.log(chalk.yellow(`! Status: ${summary.status} (${summary.email || summary.accountId})`));
      }
      console.log(`Scope: ${summary.scopes.join(", ")}`);
      if (summary.lastValidatedAt) {
        console.log(`Last validation: ${summary.lastValidatedAt}`);
      }
      console.log("");
    },
    getContextAvailability: () => "enabled"
  });
}

export const accountService = googleAuth;
