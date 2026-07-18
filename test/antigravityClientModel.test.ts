import { generateImage, stopAntigravity } from "../src/core/antigravityClient.js";

let mockModel: string | undefined = undefined;

jest.mock("node:fs/promises", () => ({
  realpath: jest.fn(async (value: string) => value),
  stat: jest.fn().mockResolvedValue({ isFile: () => true, mtimeMs: 12345, size: 1024 })
}));

jest.mock("../src/core/sourceManifest.js", () => ({
  hashFileStream: jest.fn().mockResolvedValue("b".repeat(64))
}));

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockImplementation(async () => {
    return {
      profile: "test",
      models: {
        test: {
          image_gen: { model: mockModel }
        }
      }
    };
  }),
  updateConfigField: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../src/integrations/antigravityDiscovery.js", () => ({
  getVerifiedAntigravity: jest.fn().mockResolvedValue({
    status: "operation_verified",
    installation: { executablePath: "antigravity.exe", verifiedCapabilities: {} }
  })
}));

let sentPayload: string | null = null;

jest.mock("../src/core/persistentProcess.js", () => {
  return {
    PersistentProcess: jest.fn().mockImplementation((opts) => ({
      opts,
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
      send: jest.fn().mockImplementation(async (req) => {
        sentPayload = req;
        return JSON.stringify({ outputPath: "test.png" });
      })
    }))
  };
});

describe("antigravityClientModel", () => {
  beforeEach(() => {
    mockModel = undefined;
    sentPayload = null;
  });

  afterEach(async () => {
    await stopAntigravity();
  });

  it("omits model property when Auto is selected", async () => {
    mockModel = undefined; // Auto
    await generateImage("test prompt");
    expect(sentPayload).not.toBeNull();
    const parsed = JSON.parse(sentPayload!);
    expect(parsed.payload).not.toHaveProperty("model");
    expect(parsed.payload.prompt).toBe("test prompt");
  });

  it("includes model property when explicitly selected", async () => {
    mockModel = "custom-model-id";
    await generateImage("test prompt");
    expect(sentPayload).not.toBeNull();
    const parsed = JSON.parse(sentPayload!);
    expect(parsed.payload).toHaveProperty("model", "custom-model-id");
    expect(parsed.payload.prompt).toBe("test prompt");
  });
});
