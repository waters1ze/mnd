// test/pythonSidecar.smoke.test.ts
// Smoke test: starts the real Python sidecar (if python3 available) and sends a ping
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PersistentProcess } from "../src/core/persistentProcess.js";

const SIDECAR_MAIN = join(process.cwd(), "sidecar", "main.py");

function isPythonAvailable(): boolean {
  try {
    const { execSync } = require("node:child_process");
    execSync("python3 --version", { stdio: "ignore" });
    return true;
  } catch {
    try {
      const { execSync } = require("node:child_process");
      execSync("python --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function getPythonBin(): string {
  try {
    const { execSync } = require("node:child_process");
    execSync("python3 --version", { stdio: "ignore" });
    return "python3";
  } catch {
    return "python";
  }
}

const SKIP = !isPythonAvailable() || !existsSync(SIDECAR_MAIN);

describe("Python sidecar smoke test", () => {
  let proc: PersistentProcess | null = null;

  afterEach(() => {
    proc?.stop();
    proc = null;
  });

  (SKIP ? test.skip : test)("starts Python sidecar and receives SIDECAR_READY", async () => {
    const pythonBin = getPythonBin();
    proc = new PersistentProcess({
      name: "SidecarSmoke",
      command: pythonBin,
      args: [SIDECAR_MAIN],
      readyPattern: /SIDECAR_READY/,
      healthCheckIntervalMs: 30_000,
      responseTimeoutMs: 30_000,
      env: {
        ...process.env,
        PYTHONPATH: join(process.cwd(), "sidecar"),
        PYTHONUNBUFFERED: "1",
      },
    });

    await proc.start();
    expect(proc.getStatus().alive).toBe(true);
    expect(proc.getStatus().state).toBe("transport_ready");
  }, 30_000);

  (SKIP ? test.skip : test)("responds to ping action with valid JSON", async () => {
    const pythonBin = getPythonBin();
    proc = new PersistentProcess({
      name: "SidecarSmoke",
      command: pythonBin,
      args: [SIDECAR_MAIN],
      readyPattern: /SIDECAR_READY/,
      healthCheckIntervalMs: 30_000,
      responseTimeoutMs: 30_000,
      env: {
        ...process.env,
        PYTHONPATH: join(process.cwd(), "sidecar"),
        PYTHONUNBUFFERED: "1",
      },
    });

    await proc.start();

    const reqId = "smoke-ping-1";
    const raw = await proc.send(JSON.stringify({ id: reqId, action: "ping", payload: {} }));

    let response: { id: string; ok: boolean; result?: { pong: boolean } };
    expect(() => {
      response = JSON.parse(raw);
    }).not.toThrow();

    expect(response!.id).toBe(reqId);
    expect(response!.ok).toBe(true);
    expect(response!.result?.pong).toBe(true);
  }, 30_000);
});
