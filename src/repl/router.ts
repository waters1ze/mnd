// src/repl/router.ts
import { confirm } from "@clack/prompts";
import { findClosestCommands } from "./levenshtein.js";

// ─── Command registry ────────────────────────────────────────────────────────

export type CommandHandler = (args: string[], rawInput: string) => Promise<void>;

export interface CommandEntry {
  name: string;     // primary name, e.g. "analyze"
  aliases?: string[];  // e.g. ["analyse"]
  handler: CommandHandler;
}

export type CommandDefinition = {
  name: string;
  slash: string;
  icon: string;
  description: string;
  acceptsArgs: boolean;
  aliases?: string[];
  handler?: CommandHandler;
};

export const COMMAND_REGISTRY: CommandDefinition[] = [
  { name: "open", slash: "/open", icon: "▸", description: "Open an existing project", acceptsArgs: true },
  { name: "create", slash: "/create", icon: "+", description: "Create a new project", acceptsArgs: true },
  { name: "sort", slash: "/sort", icon: "⇄", description: "Sort and tag raw assets", acceptsArgs: false },
  { name: "analyze", slash: "/analyze", icon: "◈", description: "Run the AI analysis pipeline", acceptsArgs: false },
  { name: "prompt", slash: "/prompt", icon: "✎", description: "Edit the edit plan with a text instruction", acceptsArgs: true },
  { name: "approve", slash: "/approve", icon: "✓", description: "Export the approved plan to .fcpxml", acceptsArgs: false },
  { name: "fix", slash: "/fix", icon: "⚒", description: "Fix a described error in the last run", acceptsArgs: true },
  { name: "show history", slash: "/show history", icon: "⏱", description: "Show project run history", acceptsArgs: false },
  { name: "full", slash: "/full", icon: "↻", description: "Full cycle: new or show", acceptsArgs: true },
  { name: "thumbnail", slash: "/thumbnail", icon: "▣", description: "Generate a thumbnail (--full/--layers)", acceptsArgs: true },
  { name: "refactor", slash: "/refactor", icon: "⟲", description: "Refactor a vault rule", acceptsArgs: true },
  { name: "rules review", slash: "/rules review", icon: "☰", description: "Review global rules", acceptsArgs: false },
  { name: "status", slash: "/status", icon: "●", description: "Show current project/profile status", acceptsArgs: false },
  { name: "config", slash: "/config", icon: "⚙", description: "Open the settings screen", acceptsArgs: false },
  { name: "obsidian", slash: "/obsidian", icon: "◆", description: "Open the vault in Obsidian", acceptsArgs: false },
  { name: "backup", slash: "/backup", icon: "💾", description: "Backup config or project", acceptsArgs: true },
  { name: "restore", slash: "/restore", icon: "⏪", description: "Restore config or project", acceptsArgs: true },
  { name: "logs", slash: "/logs", icon: "🖹", description: "View system or project logs", acceptsArgs: true },
  { name: "doctor", slash: "/doctor", icon: "🩺", description: "Run diagnostics", acceptsArgs: true },
  { name: "export validate", slash: "/export validate", icon: "✔", description: "Validate the timeline FCPXML", acceptsArgs: false },
  { name: "export reveal", slash: "/export reveal", icon: "📂", description: "Reveal the exported FCPXML file", acceptsArgs: false },
  { name: "export retry", slash: "/export retry", icon: "🔁", description: "Regenerate FCPXML from last plan", acceptsArgs: false },
];

// Multi-word commands (matched by prefix)
const MULTI_WORD_COMMANDS = ["show history", "full new", "full show", "rules review", "export validate", "export reveal", "export retry"];

let customRegistry: CommandEntry[] = [];

export function registerCommands(commands: CommandEntry[]): void {
  customRegistry = commands;
  // Sync handlers back to COMMAND_REGISTRY
  for (const cmd of commands) {
    const reg = COMMAND_REGISTRY.find((c) => c.name === cmd.name);
    if (reg) {
      reg.handler = cmd.handler;
      if (cmd.aliases) {
        reg.aliases = cmd.aliases;
      }
    }
  }
}

// ─── Input parsing ────────────────────────────────────────────────────────────

/**
 * Extracts quoted strings and unquoted tokens from input.
 * e.g. `open "My Project"` → { verb: "open", quotedArg: "My Project", tokens: ["open"] }
 */
export function parseInput(raw: string): {
  firstWord: string;
  fullCommand: string; // first two words for multi-word matching
  quotedArgs: string[];
  unquotedTokens: string[];
} {
  const quotedArgs: string[] = [];
  let cleaned = raw.replace(/"([^"]*)"/g, (_, m: string) => {
    quotedArgs.push(m);
    return "";
  });
  // also handle single-quoted
  cleaned = cleaned.replace(/'([^']*)'/g, (_, m: string) => {
    quotedArgs.push(m);
    return "";
  });

  const tokens = cleaned.trim().split(/\s+/).filter(Boolean);
  const firstWord = (tokens[0] ?? "").toLowerCase();
  const fullCommand = tokens.slice(0, 2).join(" ").toLowerCase();

  return { firstWord, fullCommand, quotedArgs, unquotedTokens: tokens };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function route(rawInput: string): Promise<void> {
  let input = rawInput.trim();
  if (input.startsWith("/")) {
    input = input.slice(1);
  }
  if (!input) return;

  const { firstWord, fullCommand, quotedArgs, unquotedTokens } = parseInput(input);

  // 1. Try exact multi-word match first (e.g. "show history", "full new")
  for (const mwc of MULTI_WORD_COMMANDS) {
    if (fullCommand === mwc || input.toLowerCase().startsWith(mwc)) {
      const entry = findEntry(mwc);
      if (entry) {
        const args = [...quotedArgs, ...unquotedTokens.slice(2)];
        await entry.handler(args, input);
        return;
      }
    }
  }

  // 2. Try exact single-word match
  const exactEntry = findEntry(firstWord);
  if (exactEntry) {
    const args = [...quotedArgs, ...unquotedTokens.slice(1)];
    await exactEntry.handler(args, input);
    return;
  }

  // 3. Fuzzy match (Levenshtein ≤ 2) on first word
  const allNames = [
    ...customRegistry.flatMap((e) => [e.name, ...(e.aliases ?? [])]),
    ...COMMAND_REGISTRY.flatMap((e) => [e.name, ...(e.aliases ?? [])]),
  ];
  const uniqueNames = Array.from(new Set(allNames));
  const candidates = findClosestCommands(firstWord, uniqueNames, 2);

  if (candidates.length === 1 && candidates[0] !== undefined) {
    const { command, distance } = candidates[0];
    if (distance > 0) {
      const confirmed = await confirm({
        message: `Имели в виду \`${command}\`?`,
        initialValue: true,
      });
      if (confirmed !== true) {
        // Fall through to prompt handler
        await dispatchPrompt(input);
        return;
      }
      const entry = findEntry(command);
      if (entry) {
        const args = [...quotedArgs, ...unquotedTokens.slice(1)];
        await entry.handler(args, input);
        return;
      }
    }
  }

  // 4. Ambiguous or no candidate — send to free-text prompt handler
  await dispatchPrompt(input);
}

function findEntry(name: string): CommandEntry | undefined {
  const custom = customRegistry.find(
    (e) => e.name === name || (e.aliases ?? []).includes(name)
  );
  if (custom) return custom;

  const def = COMMAND_REGISTRY.find(
    (e) => e.name === name || (e.aliases ?? []).includes(name)
  );
  if (def && def.handler) {
    const entry: CommandEntry = {
      name: def.name,
      handler: def.handler,
    };
    if (def.aliases) {
      entry.aliases = def.aliases;
    }
    return entry;
  }
  return undefined;
}

async function dispatchPrompt(rawInput: string): Promise<void> {
  const entry = findEntry("prompt");
  if (entry) {
    await entry.handler([rawInput], rawInput);
  } else {
    console.log(`Unknown command: "${rawInput}". Type 'help' for available commands.`);
  }
}
