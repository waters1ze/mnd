import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { platform } from "node:os";
import { stat } from "node:fs/promises";
import chalk from "chalk";
import { loadConfig, updateConfigField } from "../core/config.js";
import { hashFileStream } from "../core/sourceManifest.js";

export type AntigravityVerificationStage =
  | "not_found"
  | "identity_verified"
  | "protocol_advertised"
  | "transport_ready"
  | "operation_verified"
  | "unsupported"
  | "error";

export interface AntigravityInstallation {
  executablePath: string;
  version?: string;
  installRoot?: string;
  source: "cached" | "environment" | "path" | "registry" | "common_location" | "package_manager" | "manual";
  capabilities: string[];
  models: { id: string; capabilities: string[] }[];
  verifiedAt: string;
  executableSize: number;
  executableMtimeMs: number;
  executableSha256: string;
  stage: AntigravityVerificationStage;
  verifiedCapabilities: {
    chat?: { verifiedAt: string };
    classification?: { verifiedAt: string };
  };
}

export interface AntigravityDiscoveryResult {
  status: AntigravityVerificationStage;
  installation?: AntigravityInstallation;
  checkedCandidates: Array<{ path: string; source: string; result: string }>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

let cachedDiscoveryResult: AntigravityDiscoveryResult | null = null;
let scanPromise: Promise<AntigravityDiscoveryResult> | null = null;

export function invalidateAntigravityCache(): void {
  cachedDiscoveryResult = null;
}

function runBounded(executable: string, args: string[], timeout = 8_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const limit = 4 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length + stderr.length > limit) {
        stderr += "\nOUTPUT_LIMIT_EXCEEDED";
        child.kill();
        finish(1);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > limit) {
        child.kill();
        finish(1);
      }
    });
    child.once("error", (error) => { stderr += error.message; finish(1); });
    child.once("close", (code) => finish(code ?? 1));
    const timer = setTimeout(() => {
      stderr += `\nTIMEOUT_AFTER_${timeout}MS`;
      child.kill();
      finish(1);
    }, timeout);
    timer.unref();
  });
}

function resolveCommand(command: string): Promise<string | null> {
  const finder = platform() === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(finder, [command], { timeout: 3_000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(null);
      resolve(stdout.trim().split(/\r?\n/)[0]?.trim() ?? null);
    });
  });
}

function parseModels(raw: string): { id: string; capabilities: string[] }[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^available models:?$/i.test(line))
    .map((id) => ({ id, capabilities: ["chat"] }));
}

export async function verifyCandidate(candidate: string): Promise<{
  stage: AntigravityVerificationStage;
  version?: string;
  capabilities: string[];
  models: { id: string; capabilities: string[] }[];
  reason?: string;
}> {
  // agy serializes access to parts of its local state. Running these probes in
  // parallel can make `models` wait on the other processes and hit the timeout.
  const versionResult = await runBounded(candidate, ["--version"]);
  const helpResult = await runBounded(candidate, ["--help"]);
  const modelsResult = await runBounded(candidate, ["models"], 30_000);
  const help = `${helpResult.stdout}\n${helpResult.stderr}`;
  const executableName = basename(candidate).toLocaleLowerCase("en-US");
  const hasPrint = help.includes("--print") && help.includes("--model") && help.includes("--print-timeout");
  const hasExpectedCommands = /Available subcommands:/i.test(help) && /\bmodels\b/i.test(help) && /\bagents?\b/i.test(help);
  const identityMatches = /^agy(?:\.exe|\.cmd)?$/i.test(executableName) && hasPrint && hasExpectedCommands;
  if (!identityMatches || versionResult.code !== 0) {
    return { stage: "unsupported", capabilities: [], models: [], reason: "Not the official agy CLI contract" };
  }
  const version = versionResult.stdout.trim().split(/\r?\n/)[0] ?? "";
  const models = modelsResult.code === 0 ? parseModels(modelsResult.stdout) : [];
  const capabilities = ["chat.print", "models.list", "agents.list", "workspace.add-dir", "plan-mode"];
  if (models.length === 0) {
    return {
      stage: "identity_verified",
      ...(version ? { version } : {}),
      capabilities,
      models,
      reason: "agy identity verified, but no models were returned",
    };
  }
  return {
    stage: "transport_ready",
    ...(version ? { version } : {}),
    capabilities,
    models,
    reason: "agy print contract and model catalog verified",
  };
}

function normalizePath(value: string): string {
  return platform() === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function candidatePaths(cached?: string | null): Array<{ path: string; source: AntigravityInstallation["source"] }> {
  const candidates: Array<{ path: string; source: AntigravityInstallation["source"] }> = [];
  if (cached) candidates.push({ path: cached, source: "cached" });
  for (const variable of ["ANTIGRAVITY_CLI_PATH", "AGY_CLI_PATH"]) {
    const value = process.env[variable];
    if (value) candidates.push({ path: value, source: "environment" });
  }
  if (platform() === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) candidates.push({ path: join(localAppData, "agy", "bin", "agy.exe"), source: "common_location" });
    const userProfile = process.env["USERPROFILE"];
    if (userProfile) candidates.push({ path: join(userProfile, "AppData", "Local", "agy", "bin", "agy.exe"), source: "common_location" });
  } else {
    candidates.push({ path: "/usr/local/bin/agy", source: "common_location" });
    candidates.push({ path: "/opt/homebrew/bin/agy", source: "package_manager" });
    candidates.push({ path: join(process.env["HOME"] ?? "", ".local", "bin", "agy"), source: "common_location" });
  }
  return candidates;
}

export function discoverAntigravityCli(): Promise<AntigravityDiscoveryResult> {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    try {
      const config = await loadConfig();
      const candidates = candidatePaths(config.connections.antigravity?.cached_executable_path);
      const pathResolved = await resolveCommand("agy");
      if (pathResolved) candidates.splice(1, 0, { path: pathResolved, source: "path" });
      const unique = new Map<string, { path: string; source: AntigravityInstallation["source"] }>();
      for (const candidate of candidates) {
        if (candidate.path && existsSync(candidate.path)) unique.set(normalizePath(candidate.path), candidate);
      }
      const checkedCandidates: AntigravityDiscoveryResult["checkedCandidates"] = [];
      for (const candidate of unique.values()) {
        const verification = await verifyCandidate(candidate.path);
        checkedCandidates.push({ path: candidate.path, source: candidate.source, result: verification.stage });
        if (verification.stage !== "transport_ready" && verification.stage !== "operation_verified") continue;
        const executableStat = await stat(candidate.path);
        const verifiedAt = new Date().toISOString();
        const installation: AntigravityInstallation = {
          executablePath: candidate.path,
          ...(verification.version ? { version: verification.version } : {}),
          installRoot: dirname(dirname(candidate.path)),
          source: candidate.source,
          capabilities: verification.capabilities,
          models: verification.models,
          verifiedAt,
          executableSize: executableStat.size,
          executableMtimeMs: executableStat.mtimeMs,
          executableSha256: await hashFileStream(candidate.path),
          stage: verification.stage,
          verifiedCapabilities: {},
        };
        const result: AntigravityDiscoveryResult = { status: verification.stage, installation, checkedCandidates };
        cachedDiscoveryResult = result;
        await updateConfigField((value) => {
          value.connections.antigravity ??= { discovery_mode: "auto", cached_executable_path: null, cached_version: null, last_verified_at: null };
          value.connections.antigravity.cached_executable_path = candidate.path;
          value.connections.antigravity.cached_version = verification.version ?? null;
          value.connections.antigravity.last_verified_at = verifiedAt;
          value.connections.antigravity.executable_size = installation.executableSize;
          value.connections.antigravity.executable_mtime_ms = installation.executableMtimeMs;
          value.connections.antigravity.executable_sha256 = installation.executableSha256;
          value.connections.antigravity.cached_capabilities = installation.capabilities;
          value.connections.antigravity.cached_models = installation.models;
        });
        return result;
      }
      const result: AntigravityDiscoveryResult = { status: checkedCandidates.length > 0 ? "unsupported" : "not_found", checkedCandidates };
      cachedDiscoveryResult = result;
      return result;
    } finally {
      scanPromise = null;
    }
  })();
  return scanPromise;
}

export async function getVerifiedAntigravity(forceRescan = false): Promise<AntigravityDiscoveryResult> {
  if (!forceRescan && cachedDiscoveryResult) return cachedDiscoveryResult;
  return discoverAntigravityCli();
}

export async function ensureAntigravityCli(): Promise<boolean> {
  const result = await getVerifiedAntigravity();
  if ((result.status === "transport_ready" || result.status === "operation_verified") && result.installation) {
    console.log(chalk.green(`✓ Antigravity CLI ${result.installation.version ?? ""}: ${result.installation.executablePath}`));
    return true;
  }
  console.log(chalk.red("✗ Antigravity CLI (agy) not found or unsupported."));
  console.log(chalk.gray("Install it with: irm https://antigravity.google/cli/install.ps1 | iex"));
  return false;
}
