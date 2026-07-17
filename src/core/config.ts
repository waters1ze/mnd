// src/core/config.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import type { MndConfig, ProfileModels } from "../types/config.js";

const CONFIG_DIR = join(homedir(), ".config", "mnd");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

const DEFAULT_CONFIG: MndConfig = {
  profile: "hybrid",
  vault_path: join(homedir(), "Vaults", "mnd"),
  inbox_path: join(homedir(), "Desktop", "mnd-inbox"),

  connections: {
    groq_api_key_ref: "groq_api_key",
    antigravity_cli_path: process.platform === "win32"
      ? "antigravity"
      : "/usr/local/bin/antigravity",
    ollama_host: "http://localhost:11434",
  },

  models: {
    hybrid: {
      transcription: { provider: "groq", model: "whisper-large-v3" },
      text: { provider: "groq", model: "llama-3.3-70b-versatile" },
      vision: { provider: "groq", model: "llama-3.2-90b-vision-preview" },
      image_gen: { provider: "antigravity" },
    },
    local: {
      transcription: { provider: "sidecar_whisper", model: "medium" },
      text: { provider: "ollama", model: "llama3.1:8b" },
      vision: { provider: "ollama", model: "llava:13b" },
      image_gen: { provider: "antigravity" },
    },
  },

  export: {
    format: "fcpxml",
    target: "davinci_resolve",
  },

  fallback: {
    auto_switch_to_local_on_groq_failure: true,
    max_retries_before_fallback: 3,
  },
};

// In-memory singleton
let _config: MndConfig | null = null;

export async function configExists(): Promise<boolean> {
  return existsSync(CONFIG_PATH);
}

export async function loadConfig(): Promise<MndConfig> {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, YAML.stringify(DEFAULT_CONFIG), "utf-8");
    _config = structuredClone(DEFAULT_CONFIG);
    return _config;
  }

  const raw = await readFile(CONFIG_PATH, "utf-8");
  const parsed = YAML.parse(raw) as Partial<MndConfig>;

  // Deep merge with defaults so missing keys always have a value
  _config = deepMerge(DEFAULT_CONFIG, parsed) as MndConfig;
  return _config;
}

export async function saveConfig(updated: MndConfig): Promise<void> {
  _config = updated;
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, YAML.stringify(updated), "utf-8");
}

export async function updateConfigField(
  updater: (cfg: MndConfig) => void
): Promise<MndConfig> {
  const cfg = await loadConfig();
  updater(cfg);
  await saveConfig(cfg);
  return cfg;
}

/**
 * Returns the active profile's model config.
 * Called fresh on every AI invocation — so profile switches in config
 * take effect immediately without restarting the REPL.
 */
export async function getActiveProfile(): Promise<ProfileModels> {
  const cfg = await loadConfig();
  return cfg.models[cfg.profile];
}

export function resolveVaultPath(cfg: MndConfig): string {
  return resolve(cfg.vault_path.replace(/^~/, homedir()));
}

export function resolveInboxPath(cfg: MndConfig): string {
  const p = cfg.inbox_path ?? join(homedir(), "Desktop", "mnd-inbox");
  return resolve(p.replace(/^~/, homedir()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, override: any): any {
  if (typeof base !== "object" || base === null) return override ?? base;
  if (typeof override !== "object" || override === null) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] !== undefined) {
      result[key] = deepMerge(base[key], override[key]);
    }
  }
  return result;
}

/** Invalidate in-memory cache (used after editing config) */
export function invalidateConfigCache(): void {
  _config = null;
}
