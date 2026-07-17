import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAppDataDir } from "../core/config.js";
import { atomicWriteFile } from "../core/atomic.js";

const MAX_HISTORY = 500;

let historyCache: string[] | null = null;
let historyDraft: string = "";
let historyIndex: number = -1; // -1 means typing a new draft, 0 means newest history item

export function getHistoryPath(): string {
  return join(getAppDataDir(), "history.json");
}

export async function loadHistory(): Promise<string[]> {
  if (historyCache) return historyCache;
  const p = getHistoryPath();
  if (existsSync(p)) {
    try {
      const raw = await readFile(p, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        historyCache = data.slice(-MAX_HISTORY);
        return historyCache;
      }
    } catch {
      // Corrupted, reset
    }
  }
  historyCache = [];
  return historyCache;
}

export async function saveHistory(entries: string[]): Promise<void> {
  historyCache = entries.slice(-MAX_HISTORY);
  const p = getHistoryPath();
  await mkdir(getAppDataDir(), { recursive: true });
  await atomicWriteFile(p, JSON.stringify(historyCache, null, 2));
}

// Basic redaction fallback logic
const REDACT_PATTERNS = [
  /gsk_[a-zA-Z0-9]{20,}/i,
  /api_key=[a-zA-Z0-9]+/i,
  /bearer\s+[a-zA-Z0-9\-._~+/]+=*/i,
  /authorization:\s*[a-zA-Z0-9\-._~+/]+=*/i
];

function isSensitive(input: string): boolean {
  for (const pattern of REDACT_PATTERNS) {
    if (pattern.test(input)) return true;
  }
  // Hardcoded known sensitive setup commands are handled at router level with metadata,
  // but here we can add basic string checks if we want.
  return false;
}

export async function appendHistory(input: string, isCommandSensitive = false): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;
  if (isCommandSensitive) return;
  if (isSensitive(trimmed)) return;

  const h = await loadHistory();
  // Don't append if it's identical to the very last command
  if (h.length > 0 && h[h.length - 1] === trimmed) {
    return;
  }

  h.push(trimmed);
  await saveHistory(h);
  // Reset navigation
  historyIndex = -1;
  historyDraft = "";
}

export async function clearHistory(): Promise<void> {
  await saveHistory([]);
  historyIndex = -1;
  historyDraft = "";
}

export async function navigateHistory(direction: "up" | "down", currentInput: string): Promise<string> {
  const h = await loadHistory();
  if (h.length === 0) return currentInput;

  // If we are at the bottom and moving up, save the draft
  if (historyIndex === -1 && direction === "up") {
    historyDraft = currentInput;
  }

  if (direction === "up") {
    // move older
    if (historyIndex < h.length - 1) {
      historyIndex++;
      return h[h.length - 1 - historyIndex]!;
    }
  } else {
    // move newer
    if (historyIndex > 0) {
      historyIndex--;
      return h[h.length - 1 - historyIndex]!;
    } else if (historyIndex === 0) {
      // reached the bottom, restore draft
      historyIndex = -1;
      return historyDraft;
    }
  }

  return currentInput;
}
