import { classifyAsset, generateThumbnail, generateImage } from "../src/core/antigravityClient.js";
import { PersistentProcess } from "../src/core/persistentProcess.js";

jest.mock("../src/integrations/antigravityDiscovery.js", () => ({
  getVerifiedAntigravity: jest.fn().mockResolvedValue({
    status: "transport_ready",
    installation: { executablePath: "mock_path", stage: "transport_ready", verifiedCapabilities: {} }
  })
}));

let mockSendResponse = "{}";

export const mockSetResponse = (res: string) => { mockSendResponse = res; };

jest.mock("../src/core/persistentProcess.js", () => {
  return {
    PersistentProcess: jest.fn().mockImplementation(() => {
      return {
        start: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockImplementation(async (req) => mockSendResponse),
        getStatus: jest.fn().mockReturnValue({ alive: true, queueLength: 0, state: "transport_ready" }),
        opts: { command: "mock_path" }
      };
    })
  };
});

describe("Antigravity Client Operations", () => {
  it("should refuse malformed JSON as success for classification", async () => {
    mockSetResponse("{ malformed json");

    await expect(classifyAsset("test.mp4")).rejects.toThrow("Invalid JSON response from Antigravity");
  });

  it("should refuse valid JSON missing required fields for classification", async () => {
    mockSetResponse(JSON.stringify({ type: "video" })); // missing tags

    await expect(classifyAsset("test.mp4")).rejects.toThrow("Invalid response format from Antigravity: missing type or tags");
  });

  it("should accept valid JSON for classification", async () => {
    mockSetResponse(JSON.stringify({ type: "video", tags: ["a"], description: "b" }));

    const res = await classifyAsset("test.mp4");
    expect(res.type).toBe("video");
  });

  it("RELEASE_ASSERTION: R09-ANTIGRAVITY-OPERATIONS should refuse malformed JSON as success for generateThumbnail", async () => {
    mockSetResponse("{ malformed json");

    await expect(generateThumbnail({ title: "A", style: "B" })).rejects.toThrow("Invalid JSON response from Antigravity");
  });

  it("RELEASE_ASSERTION: R09-ANTIGRAVITY-OPERATIONS should refuse valid JSON missing required fields for generateThumbnail", async () => {
    mockSetResponse(JSON.stringify({ someField: "test" })); // missing outputPath

    await expect(generateThumbnail({ title: "A", style: "B" })).rejects.toThrow("Invalid response format from Antigravity: missing outputPath");
  });
  
  it("RELEASE_ASSERTION: R09-ANTIGRAVITY-OPERATIONS should accept valid JSON for generateThumbnail", async () => {
    mockSetResponse(JSON.stringify({ outputPath: "/valid/path.jpg" }));
    const res = await generateThumbnail({ title: "A", style: "B" });
    expect(res).toBe("/valid/path.jpg");
  });
});
