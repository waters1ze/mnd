// src/core/runLog.ts
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface RunLogEntry {
  ts: string;
  step: string;
  provider: string;
  model?: string | undefined;
  durationMs: number;
  ok: boolean;
  error?: string | undefined;
}

let _logPath: string | null = null;

export function setLogPath(projectSlug: string, vaultPath: string): void {
  _logPath = join(vaultPath, "Projects", projectSlug, "reports", "run.log");
}

export async function logCall(entry: RunLogEntry): Promise<void> {
  if (!_logPath) return;
  await mkdir(dirname(_logPath), { recursive: true });
  await appendFile(_logPath, JSON.stringify(entry) + "\n", "utf-8");
}

/** Helper to wrap an async call and auto-log it */
export async function withLog<T>(
  step: string,
  provider: string,
  model: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await logCall({ ts: new Date().toISOString(), step, provider, model, durationMs: Date.now() - start, ok: true });
    return result;
  } catch (err) {
    await logCall({
      ts: new Date().toISOString(),
      step,
      provider,
      model,
      durationMs: Date.now() - start,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
