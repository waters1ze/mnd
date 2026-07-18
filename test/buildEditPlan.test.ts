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

  async function testValidation(cuts: any[], overlays: any[], errorMessage: RegExp | string, duration = 100, audioTrack: any = { musicAssetId: null, syncToBeat: false }) {
    (getMediaDuration as jest.Mock).mockResolvedValue(duration);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts,
        overlays,
        audioTrack
      })
    });
    await expect(buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault"))
      .rejects.toThrow(errorMessage);
  }

  it("throws error for negative start", () => testValidation([{ id: "1", startSec: -1, endSec: 5, reason: "manual" }], [], /negative duration or start time/));
  it("throws error for negative end", () => testValidation([{ id: "1", startSec: 1, endSec: -5, reason: "manual" }], [], /negative duration or start time/));
  it("throws error for zero duration", () => testValidation([{ id: "1", startSec: 5, endSec: 5, reason: "manual" }], [], /zero or reversed duration/));
  it("throws error for reversed range", () => testValidation([{ id: "1", startSec: 10, endSec: 5, reason: "manual" }], [], /zero or reversed duration/));
  it("throws error for NaN", () => testValidation([{ id: "1", startSec: NaN, endSec: 5, reason: "manual" }], [], /not a finite number/));
  it("throws error for Infinity", () => testValidation([{ id: "1", startSec: 0, endSec: Infinity, reason: "manual" }], [], /not a finite number/));
  it("throws error for string instead of number", () => testValidation([{ id: "1", startSec: "0", endSec: 5, reason: "manual" }], [], /not a finite number/));
  it("throws error for end beyond source duration", () => testValidation([{ id: "1", startSec: 5, endSec: 15, reason: "manual" }], [], /ends beyond source duration/, 10));
  
  it("throws error for missing ffprobe duration (null)", async () => {
    (getMediaDuration as jest.Mock).mockResolvedValue(null);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts: [{ id: "1", startSec: 5, endSec: 10, reason: "manual" }],
        overlays: [],
        audioTrack: { musicAssetId: null, syncToBeat: false }
      })
    });
    await expect(buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault"))
      .rejects.toThrow(/source duration cannot be determined/);
  });

  it("accepts valid boundary exactly equal to duration", async () => {
    (getMediaDuration as jest.Mock).mockResolvedValue(10);
    (groqChatWithFallback as jest.Mock).mockResolvedValue({
      result: JSON.stringify({
        cuts: [{ id: "1", startSec: 0, endSec: 10, reason: "manual" }],
        overlays: [],
        audioTrack: { musicAssetId: null, syncToBeat: false }
      })
    });
    const result = await buildEditPlanStep("test", "dummy.mp4", [], [], dummyCtx, dummyState, "vault");
    expect(result.cuts[0].endSec).toBe(10);
  });

  it("throws error for overlays negative start", () => testValidation([], [{ id: "2", type: "text", startSec: -10, endSec: 10, text: "hi" }], /negative duration or start time/));
  it("throws error for overlays zero duration", () => testValidation([], [{ id: "2", type: "text", startSec: 10, endSec: 10, text: "hi" }], /zero or reversed duration/));
  
  it("throws error for unknown asset type broll missing assetId", () => testValidation([], [{ id: "2", type: "broll", startSec: 1, endSec: 5 }], /referenced source\/asset ID is unknown/));

  it("RELEASE_ASSERTION: R05-PLAN-VALIDATION (cut reason enum)", () => testValidation([{ id: "1", startSec: 0, endSec: 5, reason: "invalid_reason" }], [], /unsupported reason/));
  it("RELEASE_ASSERTION: R05-PLAN-VALIDATION (missing text)", () => testValidation([], [{ id: "2", type: "subtitle", startSec: 0, endSec: 5, text: null }], /missing required text content/));
  it("RELEASE_ASSERTION: R05-PLAN-VALIDATION (invalid audio track)", () => testValidation([], [], /referenced source\/asset ID unknown_asset is unknown/, 100, { musicAssetId: "unknown_asset", syncToBeat: false }));
});

