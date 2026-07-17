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
      await route(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
    }
  }
}
