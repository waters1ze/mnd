// src/core/antigravityClient.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { PersistentProcess } from "./persistentProcess.js";

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

  const cfg = await loadConfig();
  const cliPath = cfg.connections.antigravity_cli_path;

  _process = new PersistentProcess({
    name: "Antigravity",
    command: cliPath,
    args: ["--non-interactive", "--json-io"],
    readyPattern: /READY|ready|\$/,
    healthCheckIntervalMs: 5_000,
    responseTimeoutMs: 60_000,
  });

  await _process.start();
  return _process;
}

export function getAntigravityStatus(): ReturnType<PersistentProcess["getStatus"]> {
  return _process?.getStatus() ?? { alive: false, queueLength: 0, state: "stopped" };
}

export async function classifyAsset(filePath: string): Promise<AssetClassification> {
  const proc = await getProcess();
  const req = JSON.stringify({ action: "classify", payload: { filePath } });
  const resp = await proc.send(req);
  return JSON.parse(resp) as AssetClassification;
}

export async function generateThumbnail(spec: ThumbnailSpec): Promise<string> {
  const proc = await getProcess();
  const req = JSON.stringify({ action: "thumbnail", payload: spec });
  const resp = await proc.send(req);
  const parsed = JSON.parse(resp) as { outputPath: string };
  return parsed.outputPath;
}

export async function generateImage(prompt: string): Promise<string> {
  const proc = await getProcess();
  const req = JSON.stringify({ action: "generate_image", payload: { prompt } });
  const resp = await proc.send(req);
  const parsed = JSON.parse(resp) as { outputPath: string };
  return parsed.outputPath;
}

export async function stopAntigravity(): Promise<void> {
  _process?.stop();
  _process = null;
}
