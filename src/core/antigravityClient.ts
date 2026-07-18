import { loadConfig } from "./config.js";
import { PersistentProcess } from "./persistentProcess.js";
import { getVerifiedAntigravity } from "../integrations/antigravityDiscovery.js";
import chalk from "chalk";
import { realpath, stat } from "node:fs/promises";
import { hashFileStream } from "./sourceManifest.js";

let _process: PersistentProcess | null = null;

export interface AssetClassification {
  type: string;
  tags: string[];
  description: string;
}

export interface ThumbnailSpec {
  title: string;
  style: string;
  keyframePath?: string;
  plan?: string;
}

async function getProcess(): Promise<PersistentProcess> {
  if (_process) return _process;

  const verifyResult = await getVerifiedAntigravity(false);
  const cliPath = verifyResult.installation?.executablePath;

  if ((verifyResult.status !== "operation_verified" && verifyResult.status !== "transport_ready") || !cliPath) {
    throw new Error("Antigravity CLI is not verified or not configured.");
  }

  _process = new PersistentProcess({
    name: "Antigravity",
    command: cliPath,
    args: ["--non-interactive", "--json-io"],
    healthCheckIntervalMs: 5_000,
    responseTimeoutMs: 60_000,
    // Do not guess readyPattern. We just assume it's ready once the process is started.
  });

  await _process.start();
  return _process;
}

export function getAntigravityStatus(): ReturnType<PersistentProcess["getStatus"]> {
  return _process?.getStatus() ?? { alive: false, queueLength: 0, state: "stopped" };
}

import { updateConfigField } from "./config.js";
async function recordCapabilityVerified(capability: "classification" | "thumbnail" | "imageGeneration", executablePath: string): Promise<void> {
  const executableStat = await stat(executablePath);
  const sha256 = await hashFileStream(executablePath);

  const result = await getVerifiedAntigravity(false);
  if (result.status === "transport_ready" || result.status === "operation_verified") {
    result.status = "operation_verified";
    if (result.installation) {
      result.installation.stage = "operation_verified";
      result.installation.verifiedCapabilities[capability] = { verifiedAt: new Date().toISOString() };
    }
  }

  await updateConfigField(c => {
    if (c.connections.antigravity) {
       c.connections.antigravity.executable_mtime_ms = executableStat.mtimeMs;
       c.connections.antigravity.executable_size = executableStat.size;
       c.connections.antigravity.executable_sha256 = sha256;
       c.connections.antigravity.last_verified_at = new Date().toISOString();
    }
  });
}

export async function classifyAsset(filePath: string): Promise<AssetClassification> {
  const canonicalInput = await realpath(filePath);
  const inputStat = await stat(canonicalInput);
  if (!inputStat.isFile()) throw new Error(`Antigravity classification input is not a regular file: ${filePath}`);
  const proc = await getProcess();
  
  if (process.env["MND_DEBUG"]) {
    console.warn(chalk.yellow(`[Antigravity] action=classify file=${filePath}`));
  }
  
  const req = JSON.stringify({ action: "classify", payload: { filePath: canonicalInput } });
  const resp = await proc.send(req);
  let parsed: any;
  try {
    parsed = JSON.parse(resp);
  } catch (err) {
    throw new Error("Invalid JSON response from Antigravity: " + (err as Error).message);
  }
  if (!parsed || typeof parsed.type !== "string" || !Array.isArray(parsed.tags)) {
    throw new Error("Invalid response format from Antigravity: missing type or tags");
  }
  
  await recordCapabilityVerified("classification", proc.opts.command);
  return parsed;
}

export async function generateThumbnail(spec: ThumbnailSpec): Promise<string> {
  const proc = await getProcess();
  const cfg = await loadConfig();
  const activeProfile = cfg.models[cfg.profile];
  
  const payload: any = { ...spec };
  if (activeProfile?.image_gen?.model) {
    payload.model = activeProfile.image_gen.model;
  }
  
  if (process.env["MND_DEBUG"]) {
    console.warn(chalk.yellow(`[Antigravity] action=thumbnail model=${payload.model || "auto"}`));
  }
  
  const req = JSON.stringify({ action: "thumbnail", payload });
  const resp = await proc.send(req);
  let parsed: any;
  try {
    parsed = JSON.parse(resp);
  } catch (err) {
    throw new Error("Invalid JSON response from Antigravity: " + (err as Error).message);
  }
  if (!parsed || typeof parsed.outputPath !== "string") {
    throw new Error("Invalid response format from Antigravity: missing outputPath");
  }
  const canonicalOutput = await realpath(parsed.outputPath);
  const outputStat = await stat(canonicalOutput);
  if (!outputStat.isFile()) throw new Error("Antigravity thumbnail output is not a regular file");
  await hashFileStream(canonicalOutput);
  
  await recordCapabilityVerified("thumbnail", proc.opts.command);
  return canonicalOutput;
}

export async function generateImage(prompt: string): Promise<string> {
  const proc = await getProcess();
  const cfg = await loadConfig();
  const activeProfile = cfg.models[cfg.profile];
  
  const payload: any = { prompt };
  if (activeProfile?.image_gen?.model) {
    payload.model = activeProfile.image_gen.model;
  }
  
  if (process.env["MND_DEBUG"]) {
    console.warn(chalk.yellow(`[Antigravity] action=generate_image model=${payload.model || "auto"}`));
  }
  
  const req = JSON.stringify({ action: "generate_image", payload });
  const resp = await proc.send(req);
  let parsed: any;
  try {
    parsed = JSON.parse(resp);
  } catch (err) {
    throw new Error("Invalid JSON response from Antigravity: " + (err as Error).message);
  }
  if (!parsed || typeof parsed.outputPath !== "string") {
    throw new Error("Invalid response format from Antigravity: missing outputPath");
  }
  const canonicalOutput = await realpath(parsed.outputPath);
  const outputStat = await stat(canonicalOutput);
  if (!outputStat.isFile()) throw new Error("Antigravity image output is not a regular file");
  await hashFileStream(canonicalOutput);
  
  await recordCapabilityVerified("imageGeneration", proc.opts.command);
  return canonicalOutput;
}

export async function stopAntigravity(): Promise<void> {
  await _process?.stop();
  _process = null;
}
