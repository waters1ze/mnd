// src/core/pythonSidecarClient.ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { PersistentProcess } from "./persistentProcess.js";

let _process: PersistentProcess | null = null;
let _requestCounter = 0;

function nextId(): string {
  return `sidecar-${++_requestCounter}`;
}

async function getPythonBin(): Promise<string> {
  // Try python3 first, then python
  const { execSync } = await import("node:child_process");
  for (const bin of ["python3", "python"]) {
    try {
      execSync(`${bin} --version`, { stdio: "ignore" });
      return bin;
    } catch { /* try next */ }
  }
  throw new Error("Python not found in PATH. Install Python 3.10+ to use sidecar features.");
}

export async function getSidecarProcess(): Promise<PersistentProcess> {
  if (_process) return _process;

  const pythonBin = await getPythonBin();
  // sidecar/ is relative to the project root (dist/ at runtime)
  let sidecarDir: string;
  try {
    const metaUrl = new Function("return import.meta.url")();
    sidecarDir = fileURLToPath(new URL("../../sidecar", metaUrl));
  } catch {
    // Fallback for CommonJS/Jest testing environment
    sidecarDir = join(process.cwd(), "sidecar");
  }
  const mainPy = join(sidecarDir, "main.py");

  if (!existsSync(mainPy)) {
    throw new Error(`Python sidecar not found at: ${mainPy}`);
  }

  _process = new PersistentProcess({
    name: "PythonSidecar",
    command: pythonBin,
    args: [mainPy],
    readyPattern: /SIDECAR_READY/,
    healthCheckIntervalMs: 10_000,
    responseTimeoutMs: 120_000, // transcription can take a while
    env: {
      ...process.env,
      PYTHONPATH: sidecarDir,
      PYTHONUNBUFFERED: "1",
    },
  });

  await _process.start();
  return _process;
}

export function getSidecarStatus(): ReturnType<PersistentProcess["getStatus"]> {
  return _process?.getStatus() ?? { alive: false, queueLength: 0, state: "stopped" };
}

interface SidecarResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

async function sidecarCall<T>(action: string, payload: unknown): Promise<T> {
  const proc = await getSidecarProcess();
  const id = nextId();
  const req = JSON.stringify({ id, action, payload });
  const raw = await proc.send(req);
  const resp = JSON.parse(raw) as SidecarResponse<T>;
  if (!resp.ok) {
    throw new Error(`Sidecar error (${action}): ${resp.error}`);
  }
  return resp.result as T;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export async function sidecarTranscribe(
  audioPath: string,
  modelSize = "medium"
): Promise<TranscriptSegment[]> {
  const result = await sidecarCall<{ segments: TranscriptSegment[] }>(
    "transcribe",
    { audioPath, model: modelSize }
  );
  return result.segments;
}

export async function sidecarExportFcpxml(
  editPlan: unknown,
  outputPath: string
): Promise<string> {
  const result = await sidecarCall<{ fcpxmlPath: string }>(
    "export_fcpxml",
    { editPlan, outputPath }
  );
  return result.fcpxmlPath;
}

export async function sidecarPing(): Promise<boolean> {
  try {
    await sidecarCall<{ pong: boolean }>("ping", {});
    return true;
  } catch {
    return false;
  }
}

export async function stopSidecar(): Promise<void> {
  _process?.stop();
  _process = null;
}
