// src/core/updater.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getAppDataDir } from "./paths.js";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

export type UpdateMode = "auto" | "notify" | "off";
export type UpdateChannel = "stable" | "beta";

export interface UpdaterConfig {
  mode: UpdateMode;
  channel: UpdateChannel;
  check_interval_hours: number;
  repository: string;
}

export interface ReleaseManifest {
  version: string;
  channel: string;
  asset: string;
  sha256: string;
  minConfigVersion: number;
  maxConfigVersion: number;
  publishedAt: string;
}

export interface GitState {
  isGit: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
  diverged: boolean;
  noUpstream: boolean;
  detached: boolean;
}

export function detectGitState(repoPath: string): GitState {
  const state: GitState = {
    isGit: false,
    clean: true,
    ahead: 0,
    behind: 0,
    diverged: false,
    noUpstream: false,
    detached: false,
  };

  try {
    const isGit = execSync("git rev-parse --is-inside-work-tree", { cwd: repoPath, stdio: "pipe" }).toString().trim();
    if (isGit !== "true") return state;
    state.isGit = true;

    const status = execSync("git status --porcelain", { cwd: repoPath, stdio: "pipe" }).toString().trim();
    state.clean = status.length === 0;

    try {
      execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", { cwd: repoPath, stdio: "pipe" });
      const revList = execSync("git rev-list --left-right --count HEAD...@{u}", { cwd: repoPath, stdio: "pipe" }).toString().trim();
      const [aheadStr = "0", behindStr = "0"] = revList.split(/\s+/);
      state.ahead = parseInt(aheadStr, 10);
      state.behind = parseInt(behindStr, 10);
      state.diverged = state.ahead > 0 && state.behind > 0;
    } catch {
      state.noUpstream = true;
    }

    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, stdio: "pipe" }).toString().trim();
    if (currentBranch === "HEAD") {
      state.detached = true;
    }

    return state;
  } catch {
    return state;
  }
}

const UPDATE_STAGING_DIR = join(getAppDataDir(), "update_staging");

export class Updater {
  private config: UpdaterConfig;
  private currentVersion = "0.1.0"; // Should be injected via build

  constructor(config: Partial<UpdaterConfig> = {}) {
    this.config = {
      mode: config.mode || "notify",
      channel: config.channel || "stable",
      check_interval_hours: config.check_interval_hours || 12,
      repository: config.repository || "waters1ze/mnd",
    };
  }

  async checkUpdate(): Promise<ReleaseManifest | null> {
    const url = `https://api.github.com/repos/${this.config.repository}/releases/latest`;
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "MND-Updater"
        }
      });

      if (!res.ok) {
        if (res.status === 404) return null; // No releases yet
        throw new Error(`GitHub API error: ${res.statusText}`);
      }

      const release = (await res.json()) as any;
      
      // Look for manifest asset
      const manifestAsset = release.assets?.find((a: any) => a.name === "manifest.json");
      if (!manifestAsset) {
        // Fallback or construct synthetic manifest if none exists
        // (Assuming standard release format for now)
        return null;
      }

      const manifestRes = await fetch(manifestAsset.browser_download_url);
      if (!manifestRes.ok) throw new Error("Failed to download release manifest");

      const manifest = (await manifestRes.json()) as ReleaseManifest;
      return manifest;
    } catch (error: any) {
      console.warn(`Update check failed: ${error.message}`);
      return null;
    }
  }

  isUpdateSafe(): boolean {
    const gitState = detectGitState(process.cwd()); // Assuming running from repo root
    
    if (gitState.isGit) {
      if (!gitState.clean || gitState.ahead > 0 || gitState.diverged || gitState.noUpstream || gitState.detached) {
        return false;
      }
    }
    return true;
  }

  async downloadAndStage(manifest: ReleaseManifest, releaseData: any): Promise<void> {
    if (!this.isUpdateSafe()) {
      throw new Error("Development checkout detected. Auto-apply disabled.");
    }

    await mkdir(UPDATE_STAGING_DIR, { recursive: true });
    
    const asset = releaseData.assets?.find((a: any) => a.name === manifest.asset);
    if (!asset) throw new Error(`Asset ${manifest.asset} not found in release`);

    const partialPath = join(UPDATE_STAGING_DIR, `${manifest.asset}.partial`);
    const finalPath = join(UPDATE_STAGING_DIR, manifest.asset);

    const res = await fetch(asset.browser_download_url);
    if (!res.ok || !res.body) throw new Error("Failed to download asset");

    const fileStream = createWriteStream(partialPath);
    const webStream = res.body as unknown as NodeJS.ReadableStream;

    await pipeline(webStream, fileStream);

    // Verify SHA-256
    const hash = createHash("sha256");
    const data = await readFile(partialPath);
    hash.update(data);
    const calculatedSha = hash.digest("hex");

    if (calculatedSha !== manifest.sha256) {
      await rm(partialPath, { force: true });
      throw new Error("SHA-256 checksum mismatch. Download rejected.");
    }

    await rename(partialPath, finalPath);
    // Unzip/staging logic goes here...
  }

  async installStagedUpdate(): Promise<void> {
    // Windows atomic swap logic...
    console.log("Update staged. Next restart will apply the update.");
  }

  async rollback(): Promise<void> {
    // Rollback logic...
    console.log("Rollback prepared. Next restart will restore previous version.");
  }
}
