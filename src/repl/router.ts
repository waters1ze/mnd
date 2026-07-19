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

export interface CommandAvailability {
  enabled: boolean;
  reason?: string;
  suggestedActions?: string[];
}

export interface CommandContext {
  project?: {
    slug: string;
    hasRawMedia: boolean;
    pipelineStatus: string;
    hasValidPlan: boolean;
    hasValidExport: boolean;
  };
  services: {
    groq: "ready" | "offline" | "unknown";
    ollama: "ready" | "offline" | "unknown";
    antigravity: "ready" | "missing" | "unknown";
    obsidian: "ready" | "setup_required" | "unknown";
  };
}

export function avail(enabled: boolean, reason?: string, suggestedActions?: string[]): CommandAvailability {
  const res: CommandAvailability = { enabled };
  if (reason !== undefined) res.reason = reason;
  if (suggestedActions !== undefined) res.suggestedActions = suggestedActions;
  return res;
}

export type CommandDefinition = {
  name: string;
  slash: string;
  icon: string;
  description: string;
  acceptsArgs: boolean;
  aliases?: string[];
  handler?: CommandHandler;
  availability?: (ctx: CommandContext) => CommandAvailability;
  sensitive?: boolean;
};

// We will construct this context once per prompt in the loop.
export let CURRENT_CONTEXT: CommandContext = {
  services: { groq: "unknown", ollama: "unknown", antigravity: "unknown", obsidian: "unknown" }
};

export function updateCommandContext(ctx: CommandContext) {
  CURRENT_CONTEXT = ctx;
}

export const COMMAND_REGISTRY: CommandDefinition[] = [
  { name: "open", slash: "/open", icon: "▸", description: "Open an existing project", acceptsArgs: true },
  { name: "create", slash: "/create", icon: "+", description: "Create a new project", acceptsArgs: true },
  { name: "project", slash: "/project", icon: "#", description: "Show the active project model", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "add", slash: "/add", icon: "+", description: "Ingest media and rebuild its manifest", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "folder", slash: "/folder", icon: "▣", description: "Choose and attach a media folder", acceptsArgs: false, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined, !ctx.project ? ["/open", "/create"] : undefined) },
  { name: "sort", slash: "/sort", icon: "⇄", description: "Sort and tag raw assets", acceptsArgs: false, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined, !ctx.project ? ["/open", "/create"] : undefined) },
  { name: "analyze", slash: "/analyze", icon: "◈", description: "Run the AI analysis pipeline", acceptsArgs: false, availability: ctx => avail(!!ctx.project && !!ctx.project?.hasRawMedia, !ctx.project ? "No project is open" : (!ctx.project.hasRawMedia ? "No valid media exists" : undefined), !ctx.project ? ["/open", "/create"] : undefined) },
  { name: "transcribe", slash: "/transcribe", icon: "T", description: "Generate timestamped transcripts", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "scenes", slash: "/scenes", icon: "S", description: "Show detected scenes and scores", acceptsArgs: false, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "edit", slash: "/edit", icon: "E", description: "Plan, validate, build, or inspect editing", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "export", slash: "/export", icon: "X", description: "Build a DaVinci Resolve export bundle", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "auto", slash: "/auto", icon: "A", description: "Analyze the active project or create its Resolve edit", acceptsArgs: true },
  { name: "prompt", slash: "/prompt", icon: "✎", description: "Edit the edit plan with a text instruction", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "approve", slash: "/approve", icon: "✓", description: "Export the approved plan to .fcpxml", acceptsArgs: false, availability: ctx => avail(!!ctx.project?.hasValidPlan, !ctx.project?.hasValidPlan ? "No completed valid plan" : undefined) },
  { name: "fix", slash: "/fix", icon: "⚒", description: "Fix a described error in the last run", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "show history", slash: "/show history", icon: "⏱", description: "Show project run history", acceptsArgs: false, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "full", slash: "/full", icon: "↻", description: "Full cycle: new or show", acceptsArgs: true, availability: ctx => avail(!!ctx.project, !ctx.project ? "No project is open" : undefined) },
  { name: "thumbnail", slash: "/thumbnail", icon: "▣", description: "Generate a thumbnail (--full/--layers)", acceptsArgs: true, availability: ctx => avail(!!ctx.project && ctx.services.antigravity === "ready", !ctx.project ? "No project is open" : (ctx.services.antigravity !== "ready" ? "Antigravity not verified" : undefined), ctx.services.antigravity !== "ready" ? ["/doctor", "/config"] : undefined) },
  { name: "refactor", slash: "/refactor", icon: "⟲", description: "Refactor a vault rule", acceptsArgs: true },
  { name: "rules review", slash: "/rules review", icon: "☰", description: "Review global rules", acceptsArgs: false },
  { name: "status", slash: "/status", icon: "●", description: "Show current project/profile status", acceptsArgs: false },
  { name: "config", slash: "/config", icon: "⚙", description: "Open the settings screen", acceptsArgs: false }, // not sensitive
  { name: "obsidian", slash: "/obsidian", icon: "◆", description: "Open the vault in Obsidian", acceptsArgs: true, aliases: ["obidian"] },
  { name: "backup", slash: "/backup", icon: "💾", description: "Backup config or project", acceptsArgs: true, sensitive: true },
  { name: "restore", slash: "/restore", icon: "⏪", description: "Restore config or project", acceptsArgs: true, sensitive: true },
  { name: "logs", slash: "/logs", icon: "🖹", description: "View system or project logs", acceptsArgs: true },
  { name: "doctor", slash: "/doctor", icon: "🩺", description: "Run diagnostics", acceptsArgs: true },
  { name: "skills", slash: "/skills", icon: "✦", description: "List installed MND skills", acceptsArgs: true },
  { name: "export validate", slash: "/export validate", icon: "✔", description: "Validate the timeline FCPXML", acceptsArgs: false, availability: ctx => avail(!!ctx.project?.hasValidExport, !ctx.project?.hasValidExport ? "No export exists" : undefined) },
  { name: "export reveal", slash: "/export reveal", icon: "📂", description: "Reveal the exported FCPXML file", acceptsArgs: false, availability: ctx => avail(!!ctx.project?.hasValidExport, !ctx.project?.hasValidExport ? "No export exists" : undefined) },
  { name: "export retry", slash: "/export retry", icon: "🔁", description: "Regenerate FCPXML from last plan", acceptsArgs: false, availability: ctx => avail(!!ctx.project?.hasValidPlan, !ctx.project?.hasValidPlan ? "No completed valid plan" : undefined) },
];

// Multi-word commands (matched by prefix)
const MULTI_WORD_COMMANDS = [
  "show history", "full new", "full show", "rules review", 
  "export validate", "export reveal", "export retry",
  "sync setup", "sync status", "sync now", "sync push", "sync pull", 
  "sync conflicts", "sync resolve", "sync pause", "sync resume", "sync disconnect",
  "update check", "update status", "update install", "update rollback",
  "obsidian setup", "obsidian repair", "obsidian reset", "obsidian status"
];

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
  const tokens: string[] = [];
  const matcher = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(raw)) !== null) {
    if (match[1] !== undefined) {
      const value = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      quotedArgs.push(value);
      tokens.push(value);
    } else if (match[2] !== undefined) {
      quotedArgs.push(match[2]);
      tokens.push(match[2]);
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }
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

  const { firstWord, fullCommand, unquotedTokens } = parseInput(input);

  // 1. Try exact multi-word match first (e.g. "show history", "full new")
  for (const mwc of MULTI_WORD_COMMANDS) {
    if (fullCommand === mwc || input.toLowerCase().startsWith(mwc)) {
      const entry = findEntry(mwc);
      if (entry) {
        const args = unquotedTokens.slice(2);
        await entry.handler(args, input);
        return;
      }
    }
  }

  // 2. Try exact single-word match
  const exactEntry = findEntry(firstWord);
  if (exactEntry) {
    const args = unquotedTokens.slice(1);
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
        const args = unquotedTokens.slice(1);
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
