import { discoverAntigravityCli, getVerifiedAntigravity, invalidateAntigravityCache, verifyCandidate } from "../src/integrations/antigravityDiscovery.js";

let mode: "ready" | "wrong" | "no_models" = "ready";

jest.mock("node:fs", () => ({ existsSync: jest.fn().mockReturnValue(true) }));
jest.mock("node:fs/promises", () => ({ stat: jest.fn().mockResolvedValue({ size: 1024, mtimeMs: 12345 }) }));
jest.mock("../src/core/sourceManifest.js", () => ({ hashFileStream: jest.fn().mockResolvedValue("a".repeat(64)) }));
jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ connections: { antigravity: null } }),
  updateConfigField: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("node:child_process", () => ({
  execFile: jest.fn((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (/where(?:\.exe)?$|which$/i.test(command)) return callback(null, "C:\\mock\\agy.exe\n", "");
    if (mode === "wrong") return callback(null, args.includes("--version") ? "1.0" : "Usage: another tool", "");
    if (args.includes("--version")) return callback(null, "1.1.4\n", "");
    if (args.includes("--help")) return callback(null, "Usage: agy [OPTIONS]\n--print <PROMPT>\n--model <MODEL>\n--print-timeout <DURATION>\nAvailable subcommands:\nmodels\nagents\n", "");
    if (args.includes("models")) return callback(null, mode === "no_models" ? "Available models:\n" : "Available models:\nGemini 3.5 Flash (Medium)\nClaude Sonnet 4.6 (Thinking)\n", "");
    return callback(new Error("unexpected command"), "", "");
  }),
  spawn: jest.fn((command: string, args: string[]) => {
    const { EventEmitter } = jest.requireActual("node:events") as typeof import("node:events");
    const child = new EventEmitter() as import("node:child_process").ChildProcessWithoutNullStreams;
    child.stdout = new EventEmitter() as import("node:stream").Readable;
    child.stderr = new EventEmitter() as import("node:stream").Readable;
    child.kill = jest.fn().mockReturnValue(true);
    queueMicrotask(() => {
      let stdout = "";
      if (mode === "wrong") stdout = args.includes("--version") ? "1.0" : "Usage: another tool";
      else if (args.includes("--version")) stdout = "1.1.4\n";
      else if (args.includes("--help")) stdout = "Usage: agy [OPTIONS]\n--print <PROMPT>\n--model <MODEL>\n--print-timeout <DURATION>\nAvailable subcommands:\nmodels\nagents\n";
      else if (args.includes("models")) stdout = mode === "no_models" ? "Available models:\n" : "Available models:\nGemini 3.5 Flash (Medium)\nClaude Sonnet 4.6 (Thinking)\n";
      child.stdout.emit("data", Buffer.from(stdout));
      child.emit("close", 0);
    });
    return child;
  }),
}));

describe("antigravityDiscovery", () => {
  beforeEach(() => {
    mode = "ready";
    invalidateAntigravityCache();
    jest.clearAllMocks();
  });

  it("coalesces simultaneous discovery and parses the real agy model catalog", async () => {
    const first = discoverAntigravityCli();
    const second = discoverAntigravityCli();
    expect(first).toBe(second);
    const result = await first;
    expect(result.status).toBe("transport_ready");
    expect(result.installation?.models.map(item => item.id)).toEqual([
      "Gemini 3.5 Flash (Medium)",
      "Claude Sonnet 4.6 (Thinking)",
    ]);
  });

  it("RELEASE_ASSERTION: R08-ANTIGRAVITY-DISCOVERY verifies the official agy print contract", async () => {
    const result = await getVerifiedAntigravity(true);
    expect(result.status).toBe("transport_ready");
    expect(result.installation?.capabilities).toContain("chat.print");
  });

  it("rejects an executable that does not expose the official agy contract", async () => {
    mode = "wrong";
    const result = await verifyCandidate("C:\\mock\\agy.exe");
    expect(result.stage).toBe("unsupported");
  });

  it("distinguishes verified identity from a usable model transport", async () => {
    mode = "no_models";
    const result = await verifyCandidate("C:\\mock\\agy.exe");
    expect(result.stage).toBe("identity_verified");
    expect(result.models).toEqual([]);
  });
});
