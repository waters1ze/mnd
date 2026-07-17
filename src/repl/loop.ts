// src/repl/loop.ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output, exit } from "node:process";
import chalk from "chalk";
import gradient from "gradient-string";
import React from "react";
import { render } from "ink";
import { route } from "./router.js";
import { theme } from "../ui/theme.js";
import { CommandPalette, handleSelection, type SelectionResult } from "../ui/commandPalette.js";

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

async function runPaletteUI(promptText: string): Promise<SelectionResult | null> {
  return new Promise((resolve) => {
    let result: SelectionResult | null = null;

    const unmount = render(
      React.createElement(CommandPalette, {
        promptText,
        onSelect: (cmd) => {
          result = handleSelection(cmd);
        },
        onCancel: () => {
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

  let insertOnStart: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rl = readline.createInterface({ input, output, terminal: true });

    let line = "";
    let triggerPalette = false;

    // Graceful exit on Ctrl+C / Ctrl+D
    rl.on("close", () => {
      // If we closed because of the palette, do not exit the REPL!
      if (!triggerPalette) {
        console.log(chalk.gray("\nGoodbye."));
        exit(0);
      }
    });

    if (insertOnStart) {
      rl.write(insertOnStart);
      insertOnStart = null;
    }

    const onKeypress = (char: string, key: any) => {
      // Trigger palette if '/' is typed on an empty line
      if (char === "/" && rl.line === "") {
        triggerPalette = true;
        rl.close();
      }
    };

    input.on("keypress", onKeypress);

    try {
      line = await rl.question(prompt());
    } catch {
      if (triggerPalette) {
        // Remove keypress listener and run Ink Palette
        input.removeListener("keypress", onKeypress);
        const result = await runPaletteUI(prompt());
        if (result) {
          if (result.submit) {
            const cmdText = result.insertText.startsWith("/")
              ? result.insertText.slice(1)
              : result.insertText;
            try {
              await route(cmdText);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(chalk.red(`Error: ${msg}`));
            }
          } else {
            insertOnStart = result.insertText;
          }
        }
        continue;
      } else {
        break;
      }
    } finally {
      input.removeListener("keypress", onKeypress);
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") {
      rl.close();
      break;
    }

    try {
      await route(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
    }
  }
}
