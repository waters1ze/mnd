import { buildEditPlanStep } from "../src/pipeline/buildEditPlan.js";
import { getMediaDuration } from "../src/core/ffprobe.js";
import { groqChatWithFallback } from "../src/core/groqClient.js";

jest.mock("../src/core/ffprobe.js", () => ({
  getMediaDuration: jest.fn()
}));

jest.mock("../src/core/groqClient.js", () => ({
  groqChatWithFallback: jest.fn()
}));

jest.mock("../src/core/projectState.js", () => ({
  isStepDone: jest.fn().mockReturnValue(false),
  markStepDone: jest.fn(),
  cacheStepOutput: jest.fn(),
  getCachedStepOutput: jest.fn().mockReturnValue(null),
  saveProjectState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("uuid")
}));

describe("buildEditPlan validations", () => {
  const dummyState = {} as any;
  const dummyCtx = {
    applicableRules: [],
    styleFrontmatter: { id: "test" },
    styleBody: "",
    transcriptSummary: "",
    frameSummary: ""
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws error for negative duration cuts", async () => {
    (getMediaDuration as jest.Mock).mockResolvedValue(100);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts: [{ id: "1", startSec: 10, endSec: 5, reason: "manual" }],
        overlays: [],
        audioTrack: { musicAssetId: null, syncToBeat: false }
      })
    });

    await expect(buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault")).rejects.toThrow(/zero or negative duration/);
  });

  it("throws error for cuts ending beyond source duration", async () => {
    (getMediaDuration as jest.Mock).mockResolvedValue(10);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts: [{ id: "1", startSec: 5, endSec: 15, reason: "manual" }],
        overlays: [],
        audioTrack: { musicAssetId: null, syncToBeat: false }
      })
    });

    await expect(buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault")).rejects.toThrow(/ends beyond source duration/);
  });

  it("throws error for negative duration overlays", async () => {
    (getMediaDuration as jest.Mock).mockResolvedValue(100);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts: [],
        overlays: [{ id: "2", type: "text", startSec: 10, endSec: 10, text: "hi" }],
        audioTrack: { musicAssetId: null, syncToBeat: false }
      })
    });

    await expect(buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault")).rejects.toThrow(/zero or negative duration/);
  });
});
