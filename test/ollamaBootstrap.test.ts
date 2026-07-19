// test/ollamaBootstrap.test.ts
import { isOllamaInstalled, listPulledModels, pullModel } from "../src/core/ollamaBootstrap.js";
import { EventEmitter } from "node:events";

// Mock node:child_process
const mockSpawn = jest.fn();
jest.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

describe("Ollama Bootstrap Utilities", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  test("isOllamaInstalled returns false when binary is missing or error happens", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      setTimeout(() => proc.emit("error", new Error("ENOENT")), 5);
      return proc;
    });

    const installed = await isOllamaInstalled();
    expect(installed).toBe(false);
  });

  test("isOllamaInstalled returns true when binary is present", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      setTimeout(() => proc.emit("exit", 0), 5);
      return proc;
    });

    const installed = await isOllamaInstalled();
    expect(installed).toBe(true);
  });

  test("listPulledModels returns empty array on failure", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      setTimeout(() => proc.emit("exit", 1), 5);
      return proc;
    });

    const models = await listPulledModels();
    expect(models).toEqual([]);
  });

  test("listPulledModels returns list of models when present", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit(
          "data",
          Buffer.from("NAME             ID              SIZE      MODIFIED\nllama3.1:8b      e8a35b5937a5    4.7 GB    2 days ago\nllava:7b         ab12cd34ef56    4.1 GB    1 day ago\n")
        );
        proc.emit("exit", 0);
      }, 5);
      return proc;
    });

    const models = await listPulledModels();
    expect(models).toEqual(["llama3.1:8b", "llava:7b"]);
  });

  test("pullModel parses progress output and reports percent", async () => {
    const progressCalls: number[] = [];
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from("pulling manifest\npulling e8a35b5937a5... 10% 470 MB/4.7 GB\n"));
        proc.stdout.emit("data", Buffer.from("pulling e8a35b5937a5... 100% 4.7 GB/4.7 GB\n"));
        proc.emit("exit", 0);
      }, 5);
      return proc;
    });

    const res = await pullModel("llama3.1:8b", (percent) => {
      progressCalls.push(percent);
    });

    expect(res.ok).toBe(true);
    expect(progressCalls).toEqual([10, 100]);
  });

  test("pullModel returns error when pull fails", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => {
        proc.stderr.emit("data", Buffer.from("error: out of disk space"));
        proc.emit("exit", 1);
      }, 5);
      return proc;
    });

    const res = await pullModel("llama3.1:8b", () => {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe("error: out of disk space");
  });

  test("pullModel handles a missing executable without crashing the process", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => proc.emit("error", Object.assign(new Error("spawn ollama ENOENT"), { code: "ENOENT" })), 5);
      return proc;
    });

    await expect(pullModel("llama3.1:8b", () => {})).resolves.toEqual({
      ok: false,
      error: "spawn ollama ENOENT",
    });
  });
});
