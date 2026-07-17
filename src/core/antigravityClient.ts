import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { PersistentProcess } from "./persistentProcess.js";
import { getVerifiedAntigravity } from "../integrations/antigravityDiscovery.js";
import chalk from "chalk";

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
import { statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function recordCapabilityVerified(capability: "classification" | "thumbnail" | "imageGeneration", executablePath: string): Promise<void> {
  let mtime_ms = 0;
  let size = 0;
  let sha256 = "";
  try {
     const st = statSync(executablePath);
     mtime_ms = st.mtimeMs;
     size = st.size;
     const fileBuffer = readFileSync(executablePath);
     const hashSum = createHash('sha256');
     hashSum.update(fileBuffer);
     sha256 = hashSum.digest('hex');
  } catch {}

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
       c.connections.antigravity.executable_mtime_ms = mtime_ms;
       c.connections.antigravity.executable_size = size;
       c.connections.antigravity.executable_sha256 = sha256;
       c.connections.antigravity.last_verified_at = new Date().toISOString();
    }
  });
}

export async function classifyAsset(filePath: string): Promise<AssetClassification> {
  const proc = await getProcess();
  
  if (process.env["MND_DEBUG"]) {
    console.warn(chalk.yellow(`[Antigravity] action=classify file=${filePath}`));
  }
  
  const req = JSON.stringify({ action: "classify", payload: { filePath } });
  const resp = await proc.send(req);
  const parsed = JSON.parse(resp) as AssetClassification;
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
  const parsed = JSON.parse(resp) as { outputPath: string };
  if (!parsed || typeof parsed.outputPath !== "string") {
    throw new Error("Invalid response format from Antigravity: missing outputPath");
  }
  
  await recordCapabilityVerified("thumbnail", proc.opts.command);
  return parsed.outputPath;
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
  const parsed = JSON.parse(resp) as { outputPath: string };
  if (!parsed || typeof parsed.outputPath !== "string") {
    throw new Error("Invalid response format from Antigravity: missing outputPath");
  }
  
  await recordCapabilityVerified("imageGeneration", proc.opts.command);
  return parsed.outputPath;
}

export async function stopAntigravity(): Promise<void> {
  _process?.stop();
  _process = null;
}
