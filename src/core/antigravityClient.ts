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

  if ((verifyResult.status !== "operation_verified" && verifyResult.status !== "process_started") || !cliPath) {
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

function recordCapabilityVerified(capability: "classification" | "thumbnail" | "imageGeneration") {
  getVerifiedAntigravity(false).then((result) => {
    if (result.status === "process_started" || result.status === "operation_verified") {
      result.status = "operation_verified";
      if (result.installation) {
        result.installation.stage = "operation_verified";
        result.installation.verifiedCapabilities[capability] = { verifiedAt: new Date().toISOString() };
      }
    }
  }).catch(() => {});
}

export async function classifyAsset(filePath: string): Promise<AssetClassification> {
  const proc = await getProcess();
  
  if (process.env["MND_DEBUG"]) {
    console.warn(chalk.yellow(`[Antigravity] action=classify file=${filePath}`));
  }
  
  const req = JSON.stringify({ action: "classify", payload: { filePath } });
  const resp = await proc.send(req);
  const parsed = JSON.parse(resp) as AssetClassification;
  
  recordCapabilityVerified("classification");
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
  
  recordCapabilityVerified("thumbnail");
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
  
  recordCapabilityVerified("imageGeneration");
  return parsed.outputPath;
}

export async function stopAntigravity(): Promise<void> {
  _process?.stop();
  _process = null;
}
