import { classifyAsset, generateImage, generateThumbnail } from "../src/core/antigravityClient.js";

let response = "{}";

jest.mock("node:fs/promises", () => ({
  realpath: jest.fn(async (value: string) => value),
  stat: jest.fn().mockResolvedValue({ isFile: () => true }),
}));
jest.mock("node:child_process", () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = jest.requireActual("node:events") as typeof import("node:events");
    const child = new EventEmitter() as import("node:child_process").ChildProcessWithoutNullStreams;
    child.stdout = new EventEmitter() as import("node:stream").Readable;
    child.stderr = new EventEmitter() as import("node:stream").Readable;
    child.kill = jest.fn().mockReturnValue(true);
    queueMicrotask(() => { child.stdout.emit("data", Buffer.from(response)); child.emit("close", 0); });
    return child;
  }),
}));
jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({ profile: "hybrid", models: { hybrid: { text: { model: "Gemini 3.5 Flash (Low)" } } } }),
  updateConfigField: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/integrations/antigravityDiscovery.js", () => ({
  getVerifiedAntigravity: jest.fn().mockResolvedValue({
    status: "transport_ready",
    installation: { executablePath: "C:\\mock\\agy.exe", models: [], stage: "transport_ready", verifiedCapabilities: {} },
  }),
}));

describe("Antigravity Client Operations", () => {
  it("refuses malformed classification JSON", async () => {
    response = "{ malformed";
    await expect(classifyAsset("test.mp4")).rejects.toThrow(/does not contain JSON|JSON/);
  });

  it("refuses a classification missing required typed fields", async () => {
    response = JSON.stringify({ type: "video" });
    await expect(classifyAsset("test.mp4")).rejects.toThrow("Invalid Antigravity classification response");
  });

  it("RELEASE_ASSERTION: R09-ANTIGRAVITY-OPERATIONS accepts a valid typed classification response", async () => {
    response = JSON.stringify({ type: "video", tags: ["interview"], description: "Speaker on camera" });
    await expect(classifyAsset("test.mp4")).resolves.toEqual({ type: "video", tags: ["interview"], description: "Speaker on camera" });
  });

  it("honestly rejects image and thumbnail generation because agy exposes no verified file-output contract", async () => {
    await expect(generateImage("poster")).rejects.toThrow("not a verified image-generation output contract");
    await expect(generateThumbnail({ title: "MND" })).rejects.toThrow("not a verified image-generation output contract");
  });
});
