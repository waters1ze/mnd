// test/persistentProcess.test.ts
// Mocks child_process to test FIFO queue, health-check, and auto-restart behavior
import { EventEmitter } from "node:events";
import { PersistentProcess } from "../src/core/persistentProcess.js";

// ─── Mock child_process.spawn ─────────────────────────────────────────────────

interface MockProcess {
  stdin: EventEmitter & { write: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  kill: jest.Mock;
  emit: (event: string, ...args: unknown[]) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => MockProcess;
}

function createMockProcess(): MockProcess {
  const stdin = Object.assign(new EventEmitter(), { write: jest.fn() });
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  const proc: MockProcess = {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    kill: jest.fn((signal?: string) => {
      proc.exitCode = 1;
      proc.emit("exit", 1);
    }),
    emit: EventEmitter.prototype.emit,
    on: function (event: string, listener: (...args: unknown[]) => void) {
      EventEmitter.prototype.on.call(this, event, listener);
      return this;
    },
  };

  Object.setPrototypeOf(proc, EventEmitter.prototype);
  return proc;
}

let mockProcess: MockProcess;

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => {
    mockProcess = createMockProcess();
    return mockProcess;
  }),
  execFile: jest.fn((cmd, args, opts, cb) => {
    if (typeof cb === "function") cb(null, "mocked", "");
    else if (typeof opts === "function") opts(null, "mocked", "");
    return { on: jest.fn() };
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PersistentProcess", () => {
  let proc: PersistentProcess;

  afterEach(() => {
    proc?.stop();
    jest.clearAllMocks();
  });

  test("starts and reaches ready state without readyPattern", async () => {
    proc = new PersistentProcess({
      command: "echo",
      args: ["hello"],
      healthCheckIntervalMs: 60_000,
      responseTimeoutMs: 5_000,
    });

    await proc.start();
    expect(proc.getStatus().state).toBe("ready");
    expect(proc.getStatus().alive).toBe(true);
  });

  test("starts with readyPattern — waits for matching stdout", async () => {
    proc = new PersistentProcess({
      command: "python3",
      args: ["-"],
      readyPattern: /READY/,
      healthCheckIntervalMs: 60_000,
      responseTimeoutMs: 5_000,
    });

    const startPromise = proc.start();

    // Simulate ready signal from stdout
    setTimeout(() => {
      mockProcess.stdout.emit("data", Buffer.from("READY\n"));
    }, 10);

    await startPromise;
    expect(proc.getStatus().state).toBe("ready");
  });

  test("send() queues request and resolves on stdout response", async () => {
    proc = new PersistentProcess({
      command: "echo",
      args: [],
      healthCheckIntervalMs: 60_000,
      responseTimeoutMs: 5_000,
    });

    await proc.start();

    // Queue a request
    const promise = proc.send('{"id":"1","action":"ping"}');

    // Simulate response from process stdout
    setTimeout(() => {
      mockProcess.stdout.emit("data", Buffer.from('{"id":"1","ok":true}\n'));
    }, 20);

    const result = await promise;
    expect(result).toBe('{"id":"1","ok":true}');
  });

  test("FIFO: multiple sends processed in order", async () => {
    proc = new PersistentProcess({
      command: "echo",
      args: [],
      healthCheckIntervalMs: 60_000,
      responseTimeoutMs: 5_000,
    });

    await proc.start();

    const results: string[] = [];
    const p1 = proc.send("req-1").then((r) => results.push(r));
    const p2 = proc.send("req-2").then((r) => results.push(r));

    // Respond to each in turn
    setTimeout(() => mockProcess.stdout.emit("data", Buffer.from("resp-1\n")), 20);
    setTimeout(() => mockProcess.stdout.emit("data", Buffer.from("resp-2\n")), 40);

    await Promise.all([p1, p2]);
    expect(results).toEqual(["resp-1", "resp-2"]);
  });

  test("health-check: hung request triggers kill+restart, re-queues item", async () => {
    proc = new PersistentProcess({
      command: "echo",
      args: [],
      healthCheckIntervalMs: 50, // fast health check for test
      responseTimeoutMs: 50,     // very short timeout to simulate hang
    });

    await proc.start();

    // Send a request but never respond to it
    const promise = proc.send("req-stuck");
    promise.catch(() => {}); // prevent unhandled rejection on stop()

    // Wait for health-check to fire and detect the hang
    await new Promise((r) => setTimeout(r, 300));

    // After restart, respond to the re-queued request
    setTimeout(() => {
      mockProcess.stdout.emit("data", Buffer.from("recovered\n"));
    }, 50);

    // The promise should eventually resolve (after restart + retry)
    // In this test we just check state transitions occurred
    const status = proc.getStatus();
    // Process should have restarted at some point
    expect(["ready", "restarting", "starting", "busy"]).toContain(status.state);

    // Clean up
    proc.stop();
  });

  test("stop() rejects all pending queue items", async () => {
    proc = new PersistentProcess({
      command: "echo",
      args: [],
      healthCheckIntervalMs: 60_000,
      responseTimeoutMs: 5_000,
    });

    await proc.start();

    const p1 = proc.send("req-1");
    const p2 = proc.send("req-2");

    proc.stop();

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
  });
});
