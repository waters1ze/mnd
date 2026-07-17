import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TrackedProcess {
  pid: number;
  kind: "ffmpeg" | "ffprobe" | "python" | "antigravity";
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

  // 1. Graceful termination
  for (const proc of owned) {
    if (proc.fluentCommand && typeof proc.fluentCommand.kill === "function") {
      try { proc.fluentCommand.kill("SIGTERM"); } catch {}
    } else {
      try { proc.process.kill("SIGTERM"); } catch {}
    }
  }

  // 2. Wait up to 3 seconds for them to exit
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Force kill any remaining
  for (const proc of owned) {
    if (proc.process.exitCode === null && proc.process.signalCode === null) {
      try {
        if (process.platform === "win32") {
          // Windows process tree kill fallback
          await execFileAsync("taskkill", ["/PID", proc.pid.toString(), "/T", "/F"]);
        } else {
          proc.process.kill("SIGKILL");
        }
      } catch (e) {
        // Process might already be dead or access denied
      }
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
  console.log("\n\n[!] Force cancellation requested. Terminating immediately...");
  cancellationLevel = "force";
  isCancelling = true;
  globalAbortController.abort();
  await terminateAllOwnedProcesses();
  process.exit(1);
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
