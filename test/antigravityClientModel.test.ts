import { runAntigravityPrompt, stopAntigravity } from "../src/core/antigravityClient.js";
import { spawn } from "node:child_process";

let configuredModel: string | undefined;

jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = jest.requireActual("node:events") as typeof import("node:events");
    const child = new EventEmitter() as import("node:child_process").ChildProcessWithoutNullStreams;
    child.stdout = new EventEmitter() as import("node:stream").Readable;
    child.stderr = new EventEmitter() as import("node:stream").Readable;
    child.kill = jest.fn().mockReturnValue(true);
    queueMicrotask(() => { child.stdout.emit("data", Buffer.from("MND_OK\n")); child.emit("close", 0); });
    return child;
  }),
}));
jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockImplementation(async () => ({ profile: "hybrid", models: { hybrid: { text: { model: configuredModel } } } })),
  updateConfigField: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/integrations/antigravityDiscovery.js", () => ({
  getVerifiedAntigravity: jest.fn().mockResolvedValue({
    status: "transport_ready",
    installation: { executablePath: "C:\\mock\\agy.exe", models: [{ id: "Default Model" }], verifiedCapabilities: {}, stage: "transport_ready" },
  }),
}));

describe("antigravityClientModel", () => {
  beforeEach(() => { configuredModel = undefined; jest.clearAllMocks(); });
  afterEach(async () => { await stopAntigravity(); });

  it("uses the first discovered model when configuration is automatic", async () => {
    await expect(runAntigravityPrompt("reply exactly")).resolves.toBe("MND_OK");
    expect(jest.mocked(spawn).mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["--model", "Default Model"]));
  });

  it("passes the explicitly selected conversation model to agy without a shell", async () => {
    configuredModel = "Claude Sonnet 4.6 (Thinking)";
    await runAntigravityPrompt("reply exactly");
    const [command, args, options] = jest.mocked(spawn).mock.calls[0]!;
    expect(command).toBe("C:\\mock\\agy.exe");
    expect(args).toEqual(expect.arrayContaining(["--print", "reply exactly", "--model", configuredModel, "--mode", "plan"]));
    expect(options).toMatchObject({ windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  });
});
