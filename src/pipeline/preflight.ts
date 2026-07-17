import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { getProjectPaths } from "../core/projectPaths.js";
import { loadConfig } from "../core/config.js";

export interface PreflightOptions {
  profile?: string;
}

export async function runAnalyzePreflight(vaultPath: string, slug: string, options: PreflightOptions = {}): Promise<void> {
  const paths = getProjectPaths(vaultPath, slug);

  console.log(chalk.blue(`\n[PREFLIGHT] Starting preflight checks for project '${slug}'...`));

  // 1. Check layout and immutable raw directory
  if (!existsSync(paths.rawDir)) {
    throw new Error(`Preflight failed: raw directory missing at ${paths.rawDir}`);
  }

  const rawFiles = await readdir(paths.rawDir);
  const mediaFiles = rawFiles.filter(f => f.endsWith(".mp4") || f.endsWith(".mov"));
  if (mediaFiles.length === 0) {
    throw new Error(`Preflight failed: no .mp4 or .mov files found in raw directory.`);
  }

  // 2. Check config
  const config = await loadConfig();
  const profileName = options.profile || config.profile || "local";
  const profile = config.models?.[profileName as "hybrid" | "local"];
  if (!profile) {
    throw new Error(`Preflight failed: Profile '${profileName}' not found in configuration.`);
  }

  // 3. Check providers based on profile
  console.log(chalk.gray(`  Profile: ${profileName}`));
  
  if (profile.transcription.provider === "groq") {
    const { secretsHasKey } = await import("../core/secrets.js");
    if (!secretsHasKey("groq_api_key")) {
      throw new Error(`Preflight failed: Profile uses Groq for transcription, but GROQ_API_KEY is missing.`);
    }
  }

  if (profile.vision.provider === "ollama") {
    // Check if Ollama is running
    try {
      const resp = await fetch("http://127.0.0.1:11434/api/tags");
      if (!resp.ok) throw new Error();
      const data: any = await resp.json();
      const model = profile.vision.model || "llava:7b";
      const hasModel = data.models?.some((m: any) => m.name === model || m.name.startsWith(model + ":"));
      if (!hasModel) {
        throw new Error(`Preflight failed: Ollama is running but missing the required vision model '${model}'. Run 'mnd setup' or 'ollama pull ${model}'.`);
      }
    } catch {
      throw new Error(`Preflight failed: Profile uses Ollama for vision, but Ollama is not running on 127.0.0.1:11434.`);
    }
  }

  // 4. Dummy check for disk space (can be implemented with a library, but OS builtins are complex for cross-platform)
  // For now we assume we have at least some basic sanity.
  
  console.log(chalk.green("✓ Preflight passed."));
}
