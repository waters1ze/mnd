import { appendFile, stat, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { getGlobalLogsDir, getProjectLogsDir } from "./paths.js";

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  component: string;
  event: string;
  [key: string]: any;
}

export const RedactPatterns = [
  /(gsk_[a-zA-Z0-9]{30,})/g,
  /(Bearer\s+[a-zA-Z0-9-._~+/]+=*)/gi,
];

export function redact(text: string): string {
  let redacted = text;
  for (const pattern of RedactPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function redactObject(obj: any): any {
  if (typeof obj === "string") return redact(obj);
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  
  const res: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes("secret") || k.toLowerCase().includes("token") || k.toLowerCase().includes("key")) {
      res[k] = "[REDACTED]";
    } else {
      res[k] = redactObject(v);
    }
  }
  return res;
}

async function rotateLogIfNeeded(filePath: string) {
  if (!existsSync(filePath)) return;
  const s = await stat(filePath);
  if (s.size > MAX_LOG_SIZE) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(filePath, `${filePath}.${timestamp}.old`);
  }
}

async function appendLog(filePath: string, entry: LogEntry) {
  await mkdir(dirname(filePath), { recursive: true });
  await rotateLogIfNeeded(filePath);
  
  const redactedEntry = redactObject(entry);
  redactedEntry.timestamp = new Date().toISOString();
  
  await appendFile(filePath, JSON.stringify(redactedEntry) + "\n", "utf-8");
}

export const logger = {
  async global(level: LogEntry["level"], component: string, event: string, meta: Record<string, any> = {}) {
    const p = join(getGlobalLogsDir(), "app.log");
    await appendLog(p, { timestamp: "", level, component, event, ...meta });
  },
  
  async project(level: LogEntry["level"], component: string, event: string, meta: Record<string, any> = {}) {
    const dir = await getProjectLogsDir();
    if (dir) {
      const p = join(dir, "run.log");
      await appendLog(p, { timestamp: "", level, component, event, ...meta });
    }
  }
};
