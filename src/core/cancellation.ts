import type { ChildProcess } from "node:child_process";
import cp from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(cp.execFile);

export async function terminateOwnedProcessTree(
  child: ChildProcess,
  options?: { force?: boolean; timeoutMs?: number }
): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  const force = options?.force ?? false;
  const timeoutMs = options?.timeoutMs ?? 2000;

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: Math.max(500, Math.min(timeoutMs, 5000)),
      });
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    return;
  }

  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {}

  if (force) return;

  // Wait to see if it exits
  await new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout;
    
    const onExit = () => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolve();
    };
    
    const onError = () => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolve();
    };

    timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      } catch {}
      resolve();
    }, timeoutMs);

    child.on("exit", onExit);
    child.on("error", onError);
  });
}

export interface TrackedProcess {
  pid: number;
  kind: "ffmpeg" | "ffprobe" | "python" | "antigravity" | "ollama";
  process: ChildProcess;
  ownedByRun: boolean;
  fluentCommand?: any; // To call .kill() on fluent-ffmpeg if needed
}

let globalAbortController = new AbortController();
let isCancelling = false;
let cancellationLevel: "none" | "graceful" | "force" = "none";
const processRegistry: TrackedProcess[] = [];

/**
 * Reset cancellation state for a new run.
 */
export function resetCancellation(): AbortController {
  globalAbortController = new AbortController();
  isCancelling = false;
  cancellationLevel = "none";
  processRegistry.length = 0; // Clear registry
  return globalAbortController;
}

export function getAbortController(): AbortController {
  return globalAbortController;
}

export function isCancellationRequested(): boolean {
  return isCancelling;
}

export function registerProcess(proc: TrackedProcess): void {
  processRegistry.push(proc);
}

export function unregisterProcess(pid: number): void {
  const idx = processRegistry.findIndex(p => p.pid === pid);
  if (idx !== -1) {
    processRegistry.splice(idx, 1);
  }
}

/**
 * Attempt graceful termination, wait, then force kill if necessary.
 */
export async function terminateAllOwnedProcesses(): Promise<void> {
  const owned = processRegistry.filter(p => p.ownedByRun);
  if (owned.length === 0) return;

  for (const proc of owned) {
    if (proc.fluentCommand && typeof proc.fluentCommand.kill === "function") {
      try { proc.fluentCommand.kill("SIGTERM"); } catch {}
    } else {
      await terminateOwnedProcessTree(proc.process);
    }
  }
}

/**
 * Triggers cooperative cancellation.
 * Called on first Ctrl+C.
 */
export async function requestGracefulCancellation(): Promise<void> {
  if (cancellationLevel !== "none") return;
  console.log("\n\n[!] Cancellation requested. Stopping HTTP requests and attempting graceful shutdown...");
  cancellationLevel = "graceful";
  isCancelling = true;
  globalAbortController.abort();
  await terminateAllOwnedProcesses();
}

/**
 * Triggers immediate force kill.
 * Called on second Ctrl+C.
 */
export async function requestForceCancellation(): Promise<void> {
  if (cancellationLevel === "force") return;
  console.log("\n\n[!] Force cancellation requested. Stopping owned tasks and returning to MND...");
  cancellationLevel = "force";
  isCancelling = true;
  globalAbortController.abort();
  await terminateAllOwnedProcesses();
}

export function setupSignalHandlers(): void {
  // Remove existing listeners if we are setting them up again
  process.removeAllListeners("SIGINT");
  
  process.on("SIGINT", async () => {
    if (cancellationLevel === "none") {
      await requestGracefulCancellation();
    } else {
      await requestForceCancellation();
    }
  });
}
