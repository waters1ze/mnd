import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { getVerifiedAntigravity } from "../integrations/antigravityDiscovery.js";
import { loadConfig, updateConfigField } from "./config.js";

export interface AntigravityPromptOptions {
  model?: string;
  timeoutMs?: number;
  addDirectories?: string[];
  mode?: "plan" | "accept-edits";
}

export interface AssetClassification {
  type: string;
  tags: string[];
  description: string;
}

let runningOperations = 0;

function extractJson(raw: string): unknown {
  const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error("Antigravity response does not contain JSON");
  return JSON.parse(stripped.slice(objectStart, objectEnd + 1));
}

export async function runAntigravityPrompt(prompt: string, options: AntigravityPromptOptions = {}): Promise<string> {
  if (!prompt.trim()) throw new Error("Antigravity prompt cannot be empty");
  const discovery = await getVerifiedAntigravity(false);
  const executable = discovery.installation?.executablePath;
  if (!executable || (discovery.status !== "transport_ready" && discovery.status !== "operation_verified")) {
    throw new Error("Antigravity CLI (agy) is not installed or its model catalog is unavailable");
  }
  const config = await loadConfig();
  const model = options.model || config.models[config.profile].text.model || discovery.installation?.models[0]?.id;
  const timeoutMs = Math.max(10_000, Math.min(options.timeoutMs ?? 300_000, 900_000));
  const args = ["--print", prompt, "--print-timeout", `${Math.ceil(timeoutMs / 1000)}s`, "--mode", options.mode ?? "plan"];
  if (model) args.push("--model", model);
  for (const directory of options.addDirectories ?? []) args.push("--add-dir", resolve(directory));
  runningOperations += 1;
  try {
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const limit = 24 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finishError = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(message));
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length + stderr.length > limit) {
          child.kill();
          finishError("Antigravity CLI exceeded the 24 MiB output limit");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stdout.length + stderr.length > limit) {
          child.kill();
          finishError("Antigravity CLI exceeded the 24 MiB output limit");
        }
      });
      child.once("error", (error) => finishError(`Antigravity CLI failed: ${error.message}`));
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0) return finishError(`Antigravity CLI failed with code ${code}: ${stderr.trim() || "no diagnostic output"}`);
        const result = stdout.trim();
        if (!result) return finishError(`Antigravity CLI returned no output${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
        settled = true;
        clearTimeout(timer);
        resolveOutput(result);
      });
      const timer = setTimeout(() => {
        child.kill();
        finishError(`Antigravity CLI timed out after ${timeoutMs}ms`);
      }, timeoutMs + 5_000);
      timer.unref();
    });
    const verifiedAt = new Date().toISOString();
    discovery.status = "operation_verified";
    if (discovery.installation) {
      discovery.installation.stage = "operation_verified";
      discovery.installation.verifiedCapabilities.chat = { verifiedAt };
    }
    await updateConfigField((value) => {
      if (value.connections.antigravity) value.connections.antigravity.last_verified_at = verifiedAt;
    });
    return output;
  } finally {
    runningOperations -= 1;
  }
}

export async function listAntigravityModels(): Promise<string[]> {
  const result = await getVerifiedAntigravity(false);
  return result.installation?.models.map((model) => model.id) ?? [];
}

export async function classifyAsset(filePath: string, model?: string): Promise<AssetClassification> {
  const canonical = await realpath(filePath);
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error(`Asset is not a regular file: ${filePath}`);
  const raw = await runAntigravityPrompt(
    `Return only JSON with keys type (string), tags (string array), description (string). Classify this asset without changing files: ${canonical}`,
    { ...(model ? { model } : {}), addDirectories: [dirname(canonical)], mode: "plan" },
  );
  const parsed = extractJson(raw) as Partial<AssetClassification>;
  if (typeof parsed.type !== "string" || !Array.isArray(parsed.tags) || typeof parsed.description !== "string") {
    throw new Error("Invalid Antigravity classification response");
  }
  return parsed as AssetClassification;
}

export async function generateThumbnail(_spec?: unknown): Promise<never> {
  throw new Error("Antigravity CLI provides agent/chat orchestration, not a verified image-generation output contract");
}

export async function generateImage(_prompt?: unknown): Promise<never> {
  throw new Error("Antigravity CLI provides agent/chat orchestration, not a verified image-generation output contract");
}

export function getAntigravityStatus(): { alive: boolean; queueLength: number; state: string } {
  return { alive: runningOperations > 0, queueLength: runningOperations, state: runningOperations > 0 ? "busy" : "ready" };
}

export async function stopAntigravity(): Promise<void> {
  // agy print mode is one-shot; there is no persistent child process to stop.
}
