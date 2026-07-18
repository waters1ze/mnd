import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { loadConfig, updateConfigField } from "../core/config.js";
import chalk from "chalk";
import { LATEST_CONFIG_VERSION } from "../core/migrations.js";
import { platform } from "node:os";
import { stat } from "node:fs/promises";
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
  source:
    | "cached"
    | "environment"
    | "path"
    | "registry"
    | "common_location"
    | "package_manager"
    | "manual";
  capabilities: string[];
  models: { id: string; capabilities: string[] }[];
  verifiedAt: string;
  executableSize: number;
  executableMtimeMs: number;
  executableSha256: string;
  stage: AntigravityVerificationStage;
  verifiedCapabilities: {
    thumbnail?: { verifiedAt: string };
    imageGeneration?: { verifiedAt: string };
    classification?: { verifiedAt: string };
  };
}

export interface AntigravityDiscoveryResult {
  status: AntigravityVerificationStage;
  installation?: AntigravityInstallation;
  checkedCandidates: Array<{
    path: string;
    source: string;
    result: string;
  }>;
}

let cachedDiscoveryResult: AntigravityDiscoveryResult | null = null;

export function invalidateAntigravityCache() {
  cachedDiscoveryResult = null;
}

function resolveCommand(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = platform() === "win32" ? "where" : "which";
    execFile(finder, [cmd], (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
      } else {
        const firstLine = stdout.trim().split("\n")[0]?.trim();
        resolve(firstLine ?? null);
      }
    });
  });
}

function normalizePath(p: string): string {
  return platform() === "win32" ? p.toLowerCase() : p;
}

async function getWindowsRegistryPaths(): Promise<string[]> {
  if (platform() !== "win32") return [];
  const paths: string[] = [];
  try {
    const appPathsCmd = ["QUERY", "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\antigravity.exe", "/ve"];
    const out = await new Promise<string>((resolve) => {
      execFile("reg.exe", appPathsCmd, { timeout: 2000 }, (err, stdout) => resolve(stdout || ""));
    });
    const match = out.match(/REG_SZ\s+(.+)$/im);
    if (match && match[1]) {
      paths.push(match[1].trim());
    }
  } catch {
  }
  return paths;
}

export async function verifyCandidate(candidate: string): Promise<{
  stage: AntigravityVerificationStage;
  version?: string;
  capabilities: string[];
  models: any[];
  reason?: string;
}> {
  // 1. Identity Check (Bounded stdout/stderr with timeout and size limit)
  const execBounded = (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
    return new Promise((resolve, reject) => {
      const proc = execFile(candidate, args, { timeout: 2000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ stdout: stdout || "", stderr: stderr || "", code: err ? (err as any).code : 0 });
      });
    });
  };

  let versionOut = await execBounded(["--version"]);
  let helpOut = await execBounded(["--help"]);

  const version = (versionOut.stdout + "\n" + versionOut.stderr).trim();
  const help = (helpOut.stdout + "\n" + helpOut.stderr).trim();

  const isAntigravity = version.toLowerCase().includes("antigravity") || help.toLowerCase().includes("antigravity");
  
  if (!isAntigravity) {
    if (!version && !help) return { stage: "unsupported", capabilities: [], models: [], reason: "Silent executable (no CLI)" };
    return { stage: "error", capabilities: [], models: [], reason: "Executable is not Antigravity" };
  }

  // Check for JSON capability documentation
  if (!help.includes("--json-io")) {
    return { stage: "unsupported", capabilities: [], models: [], reason: "JSON protocol unsupported" };
  }

  const handshake = await new Promise<{ ok: boolean; capabilities: string[]; models: { id: string; capabilities: string[] }[] }>((resolve) => {
    const proc = spawn(candidate, ["--non-interactive", "--json-io"], { stdio: ["pipe", "pipe", "pipe"] });
    const requestId = `mnd-handshake-${process.pid}-${Date.now()}`;
    let settled = false;
    let stdout = "";
    const finish = (result: { ok: boolean; capabilities: string[]; models: { id: string; capabilities: string[] }[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.stdin?.end(); } catch {}
      import("../core/cancellation.js").then(({ terminateOwnedProcessTree }) => {
        terminateOwnedProcessTree(proc, { force: true }).catch(() => {});
      });
      resolve(result);
    };
    const parseLines = () => {
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line) as Record<string, unknown>;
          if (response.id !== requestId || response.ok === false) continue;
          const capabilities = Array.isArray(response.capabilities) ? response.capabilities.filter((item): item is string => typeof item === "string") : [];
          const models = Array.isArray(response.models)
            ? response.models.flatMap((item) => {
                if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return [];
                const rawCapabilities = (item as { capabilities?: unknown }).capabilities;
                return [{ id: (item as { id: string }).id, capabilities: Array.isArray(rawCapabilities) ? rawCapabilities.filter((value): value is string => typeof value === "string") : [] }];
              })
            : [];
          const protocolAccepted = response.ok === true || typeof response.protocolVersion === "string" || capabilities.length > 0 || models.length > 0;
          if (protocolAccepted) finish({ ok: true, capabilities, models });
        } catch {
          // Non-JSON output is ignored; a valid correlated response is still required.
        }
      }
    };
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 1024 * 1024) {
        finish({ ok: false, capabilities: [], models: [] });
        return;
      }
      stdout += chunk.toString("utf8");
      parseLines();
    });
    proc.once("error", () => finish({ ok: false, capabilities: [], models: [] }));
    proc.once("exit", () => finish({ ok: false, capabilities: [], models: [] }));
    const timer = setTimeout(() => finish({ ok: false, capabilities: [], models: [] }), 3000);
    proc.stdin?.write(`${JSON.stringify({ id: requestId, type: "handshake", client: "mnd", protocolVersion: "1" })}\n`);
  });

  if (handshake.ok) {
    const verString = version.split("\n")[0];
    return { stage: "transport_ready", ...(verString ? { version: verString } : {}), capabilities: handshake.capabilities, models: handshake.models, reason: "Correlated JSON handshake succeeded." };
  } else {
    return { stage: "protocol_advertised", capabilities: [], models: [], reason: "JSON protocol was advertised but no valid correlated handshake response was received." };
  }
}

let scanPromise: Promise<AntigravityDiscoveryResult> | null = null;

export function discoverAntigravityCli(): Promise<AntigravityDiscoveryResult> {
  if (scanPromise) return scanPromise;
  
  scanPromise = (async () => {
    try {
      const cfg = await loadConfig();
      const cached = cfg.connections.antigravity?.cached_executable_path;

      const candidates: Array<{ path: string; source: string }> = [];

      if (cached && existsSync(cached)) {
        candidates.push({ path: cached, source: "cached" });
      }

      if (process.env["ANTIGRAVITY_CLI_PATH"]) {
        candidates.push({ path: process.env["ANTIGRAVITY_CLI_PATH"], source: "environment" });
      }

      const pathResolved = await resolveCommand("antigravity");
      if (pathResolved) candidates.push({ path: pathResolved, source: "path" });

      const winRegPaths = await getWindowsRegistryPaths();
      for (const p of winRegPaths) candidates.push({ path: p, source: "registry" });

      if (platform() === "win32") {
        const localAppData = process.env["LOCALAPPDATA"];
        const appData = process.env["APPDATA"];
        const programFiles = process.env["PROGRAMFILES"];
        const programFiles86 = process.env["PROGRAMFILES(X86)"];
        
        if (localAppData) {
          candidates.push({ path: join(localAppData, "Programs", "Antigravity", "antigravity.exe"), source: "common_location" });
          candidates.push({ path: join(localAppData, "Programs", "Antigravity", "resources", "app.asar.unpacked", "bin", "antigravity.exe"), source: "common_location" });
          candidates.push({ path: join(localAppData, "Antigravity", "antigravity.exe"), source: "common_location" });
        }
        if (programFiles) {
          candidates.push({ path: join(programFiles, "Antigravity", "antigravity.exe"), source: "common_location" });
        }
        if (programFiles86) {
          candidates.push({ path: join(programFiles86, "Antigravity", "antigravity.exe"), source: "common_location" });
        }
        if (appData) {
          candidates.push({ path: join(appData, "npm", "antigravity.cmd"), source: "package_manager" });
          candidates.push({ path: join(appData, "npm", "antigravity.exe"), source: "package_manager" });
        }
      } else {
        candidates.push({ path: "/usr/local/bin/antigravity", source: "common_location" });
        candidates.push({ path: "/opt/homebrew/bin/antigravity", source: "package_manager" });
      }

      const uniquePaths = new Map<string, string>();
      for (const c of candidates) {
        if (existsSync(c.path)) {
          const norm = normalizePath(c.path);
          if (!uniquePaths.has(norm)) {
            uniquePaths.set(norm, c.path);
          }
        }
      }

      const checkedCandidates: any[] = [];
      
      for (const [_, p] of uniquePaths) {
        const source = candidates.find(c => normalizePath(c.path) === normalizePath(p))?.source || "manual";
        const res = await verifyCandidate(p);
        checkedCandidates.push({ path: p, source, result: res.stage === "error" ? res.reason || "error" : res.stage });
        
        if (res.stage === "transport_ready" || res.stage === "operation_verified") {
          const executableStat = await stat(p);
          const executableSha256 = await hashFileStream(p);
          const inst: AntigravityInstallation = {
            executablePath: p,
            ...(res.version ? { version: res.version } : {}),
            source: source as any,
            capabilities: res.capabilities,
            models: res.models,
            verifiedAt: new Date().toISOString(),
            executableSize: executableStat.size,
            executableMtimeMs: executableStat.mtimeMs,
            executableSha256,
            stage: res.stage,
            verifiedCapabilities: {}
          };
          
          const result: AntigravityDiscoveryResult = {
            status: res.stage,
            installation: inst,
            checkedCandidates
          };
          
          cachedDiscoveryResult = result;

          await updateConfigField(c => {
            if (!c.connections.antigravity) {
              c.connections.antigravity = { discovery_mode: "auto", cached_executable_path: null, cached_version: null, last_verified_at: null };
            }
            c.connections.antigravity.cached_executable_path = p;
            c.connections.antigravity.cached_version = res.version || null;
            c.connections.antigravity.last_verified_at = inst.verifiedAt;
            c.connections.antigravity.executable_size = inst.executableSize;
            c.connections.antigravity.executable_mtime_ms = inst.executableMtimeMs;
            c.connections.antigravity.executable_sha256 = inst.executableSha256;
            c.connections.antigravity.cached_capabilities = inst.capabilities;
            c.connections.antigravity.cached_models = inst.models;
          });

          return result;
        } else if (res.stage === "unsupported") {
          checkedCandidates[checkedCandidates.length - 1].result = "unsupported_desktop_app";
        }
      }

      const hasUnsupported = checkedCandidates.some(c => c.result === "unsupported_desktop_app");
      const hasAdvertisedProtocol = checkedCandidates.some(c => c.result === "protocol_advertised");
      
      const result: AntigravityDiscoveryResult = {
        status: hasAdvertisedProtocol ? "protocol_advertised" : hasUnsupported ? "unsupported" : "not_found",
        checkedCandidates
      };
      cachedDiscoveryResult = result;
      
      await updateConfigField(c => {
        if (c.connections.antigravity) {
          c.connections.antigravity.cached_executable_path = null;
          c.connections.antigravity.last_verified_at = null;
        }
      });

      return result;
    } finally {
      scanPromise = null;
    }
  })();
  return scanPromise;
}

export async function getVerifiedAntigravity(forceRescan = false): Promise<AntigravityDiscoveryResult> {
  if (!forceRescan && cachedDiscoveryResult && cachedDiscoveryResult.status !== "not_found" && cachedDiscoveryResult.status !== "error") {
    return cachedDiscoveryResult;
  }
  return await discoverAntigravityCli();
}

export async function ensureAntigravityCli(): Promise<boolean> {
  const result = await getVerifiedAntigravity();
  if (result.status === "transport_ready" || result.status === "operation_verified") {
    console.log(chalk.green(`✓ Antigravity found: ${result.installation?.executablePath}`));
    if (result.status === "transport_ready") {
      console.log(chalk.yellow(`  Protocol advertised, transport ready, but operations not yet verified.`));
    }
    return true;
  }
  
  if (result.status === "unsupported") {
    console.log(chalk.red(`✗ Antigravity application found, but CLI protocol unavailable.`));
  } else {
    console.log(chalk.red(`✗ Antigravity CLI not found.`));
  }
  console.log(chalk.gray(`'sort' and 'thumbnail' require it. You can install it manually and set connections.antigravity.cached_executable_path in config (Advanced).`));
  return false;
}
