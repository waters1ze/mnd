// src/repl/loop.ts
import { stdin as input, stdout as output, exit } from "node:process";
import chalk from "chalk";
import gradient from "gradient-string";
import React from "react";
import { render } from "ink";
import { route } from "./router.js";
import { theme } from "../ui/theme.js";

// The REPL keeps a single piece of mutable session state:
// the "current project" slug, set by `open`/`create`
export const session = {
  currentProjectSlug: null as string | null,
};

const BANNER = `
  ███╗   ███╗███╗   ██╗██████╗
  ████╗ ████║████╗  ██║██╔══██╗
  ██╔████╔██║██╔██╗ ██║██║  ██║
  ██║╚██╔╝██║██║╚██╗██║██║  ██║
  ██║ ╚═╝ ██║██║ ╚████║██████╔╝
  ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝
`;

function printBanner(): void {
  // gradient-string is only used here, nowhere else
  console.log(gradient(["#7C5CFF", "#A78BFA"])(BANNER));
  console.log(
    chalk.hex(theme.accent)("  AI-assisted vlog editor") +
    chalk.gray("  →  DaVinci Resolve\n")
  );
}

function prompt(): string {
  const slug = session.currentProjectSlug
    ? chalk.hex(theme.accent)(`[${session.currentProjectSlug}]`) + " "
    : "";
  return `${slug}${chalk.hex(theme.accent)("mnd")} ${chalk.gray("›")} `;
}

export async function promptInput(promptText: string, initialInput: string = ""): Promise<string | null> {
  const { ReplInput } = await import("../ui/replInput.js");
  return new Promise((resolve) => {
    let result: string | null = null;
    const unmount = render(
      React.createElement(ReplInput, {
        promptText,
        initialInput,
        onSubmit: (text: string) => {
          result = text;
        },
        onExit: () => {
          result = null;
        },
      })
    );

    unmount.waitUntilExit().then(() => {
      resolve(result);
    });
  });
}

export async function startRepl(): Promise<void> {
  printBanner();

  let insertOnStart: string = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await promptInput(prompt(), insertOnStart);
    insertOnStart = ""; // reset for next iteration

    if (line === null) {
      // Exit condition
      console.log(chalk.gray("\nGoodbye."));
      exit(0);
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") {
      console.log(chalk.gray("\nGoodbye."));
      exit(0);
      break;
    }

    try {
      // 1. Build and update context
      const { resolveVaultPath, loadConfig } = await import("../core/config.js");
      const { isProjectFolder, analyzeProjectFlags } = await import("../core/projectPaths.js");
      const { getVerifiedAntigravity } = await import("../integrations/antigravityDiscovery.js");
      const { updateCommandContext, COMMAND_REGISTRY, parseInput } = await import("./router.js");
      
      const cfg = await loadConfig();
      const vaultPath = resolveVaultPath(cfg);

      let projectCtx: any = undefined;
      if (session.currentProjectSlug) {
        const pPath = (await import("node:path")).join(vaultPath, "Projects", session.currentProjectSlug);
        const isProj = await isProjectFolder(pPath);
        if (isProj) {
          const flags = await analyzeProjectFlags(pPath);
          projectCtx = {
            slug: session.currentProjectSlug,
            hasRawMedia: flags.hasRawMedia,
            pipelineStatus: "unknown",
            hasValidPlan: flags.hasValidPlan,
            hasValidExport: flags.hasValidExport
          };
        }
      }

      const agReady = (await getVerifiedAntigravity()).status === "ready" ? "ready" : "missing";

      updateCommandContext({
        project: projectCtx,
        services: {
          groq: cfg.connections.groq_api_key_ref ? "ready" : "offline", // simplistic
          ollama: "unknown", // could query /api/tags if fast enough
          antigravity: agReady,
          obsidian: cfg.vault_path ? "ready" : "setup_required"
        }
      });

      // 2. Route
      await route(trimmed);

      // 3. Save to history
      const { appendHistory } = await import("./history.js");
      const parsed = parseInput(trimmed);
      const cmdDef = COMMAND_REGISTRY.find(c => c.name === parsed.firstWord || (c.aliases && c.aliases.includes(parsed.firstWord)) || parsed.fullCommand === c.name);
      await appendHistory(trimmed, cmdDef?.sensitive);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
    }
  }
}
