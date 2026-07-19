// src/repl/loop.ts
import { stdin as input } from "node:process";
import chalk from "chalk";
import gradient from "gradient-string";
import React from "react";
import { render } from "ink";
import { route } from "./router.js";
import { theme } from "../ui/theme.js";
import { box, LIGHT } from "../ui/box.js";

// The REPL keeps a single piece of mutable session state:
// the "current project" slug, set by `open`/`create`
export const session = {
  currentProjectSlug: null as string | null,
};

export function shouldExitRepl(line: string | null): boolean {
  if (line === null) return false;
  const command = line.trim().toLocaleLowerCase("en-US");
  return command === "exit" || command === "quit";
}

const BANNER = `  ███╗   ███╗ ███╗   ██╗ ██████╗
  ████╗ ████║ ████╗  ██║ ██╔══██╗
  ██╔████╔██║ ██╔██╗ ██║ ██║  ██║
  ██║╚██╔╝██║ ██║╚██╗██║ ██████╔╝
  ╚═╝     ╚═╝ ╚═╝ ╚═══╝ ╚═════╝`;

function printBanner(): void {
  // gradient-string is only used here, nowhere else
  console.log(gradient(["#22D3EE", "#7C5CFF", "#C084FC"])(BANNER));
  const chrome = box(" MND STUDIO · 0.1 ", [
    `  ${chalk.hex("#A78BFA")("Antigravity")} orchestration  ${chalk.gray("•")}  ${chalk.white("DaVinci")} timelines`,
    `  ${chalk.hex("#22D3EE")("Obsidian")} workspace      ${chalk.gray("•")}  verified media pipeline`,
    `  ${chalk.gray("/")} commands   ${chalk.gray("↑↓")} history   ${chalk.gray("Esc")} clear   ${chalk.gray("exit")} close`,
  ], {
    width: 62,
    charset: LIGHT,
    color: (value) => chalk.hex("#343A52")(value),
    titleColor: (value) => chalk.hex(theme.accent).bold(value),
  });
  console.log(chrome.join("\n"));
  console.log();
}

function prompt(): string {
  const brand = chalk.bgHex(theme.accent).black.bold(" MND ");
  const project = session.currentProjectSlug
    ? ` ${chalk.hex("#C4B5FD")(`◈ ${session.currentProjectSlug}`)}`
    : ` ${chalk.gray("◇ no project")}`;
  return `${brand}${project} ${chalk.hex("#22D3EE")("❯")} `;
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
      })
    );

    import("../ui/tty.js").then(({ releaseInkStdin }) => {
      releaseInkStdin(unmount.waitUntilExit()).then(() => {
        resolve(result);
      }).catch((err) => {
        // If there's an error during unmount/resume, we must still resolve 
        // to prevent hanging, or let the caller handle it. Resolving null mimics onExit.
        console.error("Error releasing Ink stdin:", err);
        resolve(null);
      });
    });
  });
}

async function refreshCommandContext(): Promise<void> {
  const { resolveVaultPath, loadConfig } = await import("../core/config.js");
  const { analyzeProjectFlags } = await import("../core/projectPaths.js");
  const { getVerifiedAntigravity } = await import("../integrations/antigravityDiscovery.js");
  const { listProjects } = await import("../core/vault.js");
  const { updateCommandContext } = await import("./router.js");
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  let projectCtx: any = undefined;
  if (session.currentProjectSlug) {
    const pPath = (await import("node:path")).join(vaultPath, "Projects", session.currentProjectSlug);
    try {
      await (await import("../core/projectFile.js")).loadProjectFile(vaultPath, session.currentProjectSlug);
      const flags = await analyzeProjectFlags(pPath);
      projectCtx = { slug: session.currentProjectSlug, hasRawMedia: flags.hasRawMedia, pipelineStatus: "unknown", hasValidPlan: flags.hasValidPlan, hasValidExport: flags.hasValidExport };
    } catch { /* project was removed outside MND */ }
  }
  const [projects, agStatus] = await Promise.all([
    listProjects(vaultPath),
    getVerifiedAntigravity().then((value) => value.status),
  ]);
  updateCommandContext({
    project: projectCtx,
    projects: projects.map((project) => ({ slug: project.slug, title: project.frontmatter.title ?? project.slug, status: project.frontmatter.status ?? "created" })),
    services: {
      groq: cfg.connections.groq_api_key_ref ? "ready" : "offline",
      ollama: "unknown",
      antigravity: (agStatus === "transport_ready" || agStatus === "operation_verified") ? "ready" : "missing",
      obsidian: cfg.vault_path ? "ready" : "setup_required",
    },
  });
}

export async function startRepl(): Promise<void> {
  printBanner();

  let insertOnStart: string = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await refreshCommandContext();
    const line = await promptInput(prompt(), insertOnStart);
    insertOnStart = ""; // reset for next iteration

    if (line === null) {
      if (!input.isTTY) return;
      const { restoreInteractiveStdin } = await import("../ui/tty.js");
      restoreInteractiveStdin();
      const terminalEnded = input.readableEnded;
      console.log(chalk.gray(terminalEnded
        ? "MND ожидает восстановления терминала · для выхода используйте exit"
        : "MND восстановил интерактивный prompt · для выхода введите exit"));
      await new Promise<void>((resolve) => setTimeout(resolve, terminalEnded ? 500 : 25));
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (shouldExitRepl(trimmed)) {
      console.log(chalk.gray("\nGoodbye."));
      break;
    }

    try {
      const { COMMAND_REGISTRY, parseInput } = await import("./router.js");
      await refreshCommandContext();

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
    } finally {
      const { restoreInteractiveStdin } = await import("../ui/tty.js");
      restoreInteractiveStdin();
    }
  }
}
