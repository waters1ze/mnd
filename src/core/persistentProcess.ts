// src/core/persistentProcess.ts
import {
  spawn,
  ChildProcess,
  SpawnOptionsWithoutStdio,
} from "node:child_process";
import chalk from "chalk";
import { registerProcess, unregisterProcess, terminateOwnedProcessTree } from "./cancellation.js";

export interface PersistentProcessOptions {
  command: string;
  args: string[];
  readyPattern?: RegExp;        // Detect readiness from stdout
  healthCheckIntervalMs: number;
  responseTimeoutMs: number;    // Kill + restart if response exceeds this
  name?: string;                // For logging
  env?: NodeJS.ProcessEnv;
}

interface QueueItem {
  payload: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

export type ProcessState = "stopped" | "starting" | "transport_ready" | "busy" | "restarting";

export class PersistentProcess {
  private child: ChildProcess | null = null;
  private queue: QueueItem[] = [];
  private busy = false;
  private state: ProcessState = "stopped";
  private stdoutBuffer = "";
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private currentItem: QueueItem | null = null;
  private currentItemStartedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimeoutId: NodeJS.Timeout | null = null;

  constructor(public readonly opts: PersistentProcessOptions) {}

  get name(): string {
    return this.opts.name ?? this.opts.command;
  }

  getChild(): ChildProcess | null {
    return this.child;
  }

  getStatus(): { alive: boolean; queueLength: number; state: ProcessState } {
    return {
      alive: this.child !== null && this.child.exitCode === null,
      queueLength: this.queue.length + (this.currentItem ? 1 : 0),
      state: this.state,
    };
  }

  async start(): Promise<void> {
    if (this.state === "transport_ready" || this.state === "starting") return;
    this.state = "starting";

    await new Promise<void>((resolve, reject) => {
      const spawnOpts: SpawnOptionsWithoutStdio = {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.opts.env ?? process.env,
        shell: false,
      };

      this.child = spawn(this.opts.command, this.opts.args, spawnOpts);
      if (this.child.pid) {
        registerProcess({
          pid: this.child.pid,
          kind: "python", // or general tracked process type
          process: this.child,
          ownedByRun: true
        });
      }
      
      this.stdoutBuffer = "";

      this.child.stdout?.on("data", (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString("utf8");
        
        if (this.state === "starting" && this.opts.readyPattern) {
          const match = this.opts.readyPattern.exec(this.stdoutBuffer);
          if (match) {
            const afterMatch = match.index + match[0].length;
            const nl = this.stdoutBuffer.indexOf("\n", afterMatch);
            if (nl !== -1) {
              this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
            } else {
              this.stdoutBuffer = this.stdoutBuffer.slice(afterMatch);
            }
            this.state = "transport_ready";
            if (this.readyTimeoutId) clearTimeout(this.readyTimeoutId);
            this.startHealthCheck();
            resolve();
          }
        }

        this.onStdout();
      });

      this.child.stderr?.on("data", (chunk: Buffer) => {
        if (process.env["MND_DEBUG"]) {
          console.warn(chalk.yellow(`[${this.name} stderr] ${chunk.toString("utf8").trim()}`));
        }
      });

      this.child.on("error", (err) => {
        console.error(chalk.red(`[${this.name}] Process error: ${err.message}`));
        if (this.child) terminateOwnedProcessTree(this.child, { force: true }).catch(() => {});
      });

      this.child.on("exit", (code) => {
        if (this.child?.pid) unregisterProcess(this.child.pid);

        if (this.state !== "stopped") {
          if (process.env["MND_DEBUG"]) {
            console.warn(chalk.yellow(`[${this.name}] exited with code ${code}, scheduling restart`));
          }
          if (this.child) terminateOwnedProcessTree(this.child, { force: true }).catch(() => {});
          this.child = null;
          this.scheduleRestart();
        }
      });

      if (!this.opts.readyPattern) {
        // No ready pattern — consider transport available immediately
        this.state = "transport_ready";
        this.startHealthCheck();
        resolve();
        return;
      }

      // Timeout for readiness
      this.readyTimeoutId = setTimeout(() => {
        if (this.state === "starting") {
          reject(new Error(`[${this.name}] timed out waiting for ready pattern`));
        }
      }, 30_000);
    });
  }

  send(payload: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject, enqueuedAt: Date.now() });
      this.processQueue();
    });
  }

  private onStdout(): void {
    // Check if we have a complete newline-delimited response
    const newlineIdx = this.stdoutBuffer.indexOf("\n");
    if (newlineIdx === -1) return;

    const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
    this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);

    if (line === "") {
      this.onStdout();
      return;
    }

    if (this.currentItem) {
      const item = this.currentItem;
      this.currentItem = null;
      this.busy = false;
      this.state = "transport_ready";
      item.resolve(line);
      // Process remaining buffer recursively
      this.onStdout();
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.busy || this.queue.length === 0 || this.state !== "transport_ready") return;
    if (!this.child || this.child.exitCode !== null) {
      this.scheduleRestart();
      return;
    }

    const item = this.queue.shift()!;
    this.currentItem = item;
    this.currentItemStartedAt = Date.now();
    this.busy = true;
    this.state = "busy";

    try {
      this.child.stdin?.write(item.payload + "\n");
    } catch (err) {
      this.currentItem = null;
      this.busy = false;
      this.state = "transport_ready";
      item.reject(err);
      this.scheduleRestart();
    }
  }

  private startHealthCheck(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => this.healthCheck(), this.opts.healthCheckIntervalMs);
  }

  private healthCheck(): void {
    // Check if child is still alive
    if (!this.child || this.child.exitCode !== null) {
      this.scheduleRestart();
      return;
    }

    // Check if current request has been hanging too long
    if (this.currentItem && (Date.now() - this.currentItemStartedAt) > this.opts.responseTimeoutMs) {
      console.warn(chalk.yellow(`[${this.name}] response timeout — restarting`));
      const stuck = this.currentItem;
      this.currentItem = null;
      // Put stuck item back at front of queue for retry
      this.queue.unshift(stuck);
      this.busy = false;
      terminateOwnedProcessTree(this.child, { force: true }).catch(() => {});
      this.child = null;
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (this.state === "restarting" || this.state === "starting") return;
    this.state = "restarting";
    if (this.restartTimer) clearTimeout(this.restartTimer);
    // Small delay before restart
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restart().catch((err) => {
        console.error(chalk.red(`[${this.name}] restart failed: ${err}`));
      });
    }, 500);
  }

  async restart(): Promise<void> {
    await this.stop(false);
    await this.start();
    this.processQueue();
  }

  async stop(clearQueue = true): Promise<void> {
    this.state = "stopped";
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.readyTimeoutId) {
      clearTimeout(this.readyTimeoutId);
      this.readyTimeoutId = null;
    }
    const child = this.child;
    this.child = null;
    if (clearQueue) {
      for (const item of this.queue) {
        item.reject(new Error(`[${this.name}] process stopped`));
      }
      if (this.currentItem) {
        this.currentItem.reject(new Error(`[${this.name}] process stopped`));
        this.currentItem = null;
      }
      this.queue = [];
    }
    this.busy = false;
    if (child) {
      await terminateOwnedProcessTree(child, { force: true });
      if (child.pid) unregisterProcess(child.pid);
    }
  }
}
