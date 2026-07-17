// src/core/ollamaBootstrap.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_LOCAL_MODELS = {
  text: "llama3.1:8b",
  vision: "llava:7b",
} as const;

function getOllamaPath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    const defaultWinPath = join(localAppData, "Programs", "Ollama", "ollama.exe");
    if (existsSync(defaultWinPath)) {
      return defaultWinPath;
    }
    return "ollama.exe";
  }
  return "ollama";
}

export async function isOllamaInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = getOllamaPath();
    const proc = spawn(cmd, ["--version"]);
    proc.on("exit", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}

export async function listPulledModels(): Promise<string[]> {
  return new Promise((resolve) => {
    const cmd = getOllamaPath();
    const proc = spawn(cmd, ["list"]);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("exit", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      // Ollama list output structure:
      // NAME             ID              SIZE      MODIFIED
      // llama3.1:8b      e8a35b5937a5    4.7 GB    2 days ago
      const lines = out.split(/\r?\n/).filter(Boolean);
      // Skip the header
      const models = lines.slice(1).map((line) => {
        const parts = line.trim().split(/\s+/);
        return parts[0] ?? "";
      }).filter(Boolean);
      resolve(models);
    });
    proc.on("error", () => {
      resolve([]);
    });
  });
}

export async function pullModel(
  modelName: string,
  onProgress: (percent: number, rawLine: string) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const cmd = getOllamaPath();
    const proc = spawn(cmd, ["pull", modelName]);
    let errorOutput = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      // Ollama pull updates progress using carriage returns (\r) to draw in-place.
      // We split by both \r and \n to handle line-by-line updates,
      // and match the percentage from the last line chunk.
      const lines = chunk.toString().split(/[\r\n]+/).filter(Boolean);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1] ?? "";
        const match = lastLine.match(/([0-9.]+)%/);
        if (match && match[1]) {
          const percent = parseFloat(match[1]);
          if (!isNaN(percent)) {
            onProgress(percent, lastLine);
            return;
          }
        }
        // Fallback: report NaN to trigger indeterminate spinner state in UI
        onProgress(NaN, lastLine);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    proc.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: errorOutput.trim() || `Ollama pull failed with exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

export function getInstallInstructions(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "winget install Ollama.Ollama";
  }
  if (platform === "darwin") {
    return "brew install ollama";
  }
  return "Run: curl -fsSL https://ollama.com/install.sh | sh\nOr visit: https://ollama.com/download";
}
