import { exportTimelineStep } from "../src/pipeline/exportTimeline.js";
import { sidecarExportFcpxml } from "../src/core/pythonSidecarClient.js";
import { existsSync, createReadStream } from "node:fs";

jest.mock("../src/core/pythonSidecarClient.js", () => ({
  sidecarExportFcpxml: jest.fn().mockResolvedValue("/path/to/exported.fcpxml")
}));

jest.mock("../src/core/projectState.js", () => ({
  markStepDone: jest.fn(),
  saveProjectState: jest.fn()
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn(),
  createReadStream: jest.fn()
}));

jest.mock("node:fs/promises", () => ({
  stat: jest.fn().mockResolvedValue({ size: 1000 })
}));

const mockReadStream = (data: Buffer) => {
  return {
    on: jest.fn((event: string, cb: Function) => {
      if (event === "data") cb(data);
      if (event === "end") cb();
      return this;
    })
  };
};

describe("exportTimeline", () => {
  const dummyPlan = {
    projectSlug: "test-slug",
    version: 1,
    sourceVideoPath: "/mock/raw/video.mp4",
    transcript: [],
    cuts: [],
    overlays: [],
    audioTrack: { musicAssetId: null, syncToBeat: false },
    createdAt: ""
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws if file does not exist", async () => {
    (existsSync as jest.Mock).mockReturnValue(false);
    await expect(exportTimelineStep(dummyPlan, {} as any, "/vault")).rejects.toThrow(/missing or offline/);
  });

  it("throws if sourceManifest is missing entry", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    await expect(exportTimelineStep(dummyPlan, { sourceManifest: {} } as any, "/vault")).rejects.toThrow(/missing integrity metadata/);
  });

  it("exports successfully if SHA-256 matches", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    const crypto = require("node:crypto");
    const data = Buffer.from("dummy video content");
    const hash = crypto.createHash("sha256").update(data).digest("hex");
    
    (createReadStream as jest.Mock).mockReturnValue(mockReadStream(data));
    
    const dummyState: any = {
      sourceManifest: {
        "raw/video.mp4": { hash: hash, size: 1000, mtime: "2023-01-01" }
      },
      exports: []
    };
    const result = await exportTimelineStep(dummyPlan, dummyState, "/vault");
    expect(result).toBe("/path/to/exported.fcpxml");
  });

  it("throws if SHA-256 does not match", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    const crypto = require("node:crypto");
    const data = Buffer.from("modified content");
    
    (createReadStream as jest.Mock).mockReturnValue(mockReadStream(data));
    
    await expect(exportTimelineStep(
      dummyPlan,
      { sourceManifest: { "raw/video.mp4": { hash: "abc123expectedhash", size: 1000, mtime: "2023-01-01" } } } as any,
      "/vault"
    )).rejects.toThrow(/SHA-256 hash mismatch/);
  });

  it("migrates MD5 if matched", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    const crypto = require("node:crypto");
    const data = Buffer.from("dummy video content");
    const md5Hash = crypto.createHash("md5").update(data).digest("hex");
    
    (createReadStream as jest.Mock).mockReturnValue(mockReadStream(data));
    
    const dummyState: any = {
      sourceManifest: {
        "raw/video.mp4": { hash: md5Hash, size: 1000, mtime: "2023-01-01" }
      },
      exports: []
    };
    const result = await exportTimelineStep(dummyPlan, dummyState, "/vault");
    expect(result).toBe("/path/to/exported.fcpxml");
  });

  it("throws if MD5 does not match", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    const crypto = require("node:crypto");
    const data = Buffer.from("modified content");
    const expectedMd5Hash = crypto.createHash("md5").update("original content").digest("hex");
    
    (createReadStream as jest.Mock).mockReturnValue(mockReadStream(data));
    
    const dummyState: any = {
      sourceManifest: {
        "raw/video.mp4": { hash: expectedMd5Hash, size: 1000, mtime: "2023-01-01" }
      },
      exports: []
    };
    await expect(exportTimelineStep(dummyPlan, dummyState, "/vault")).rejects.toThrow(/MD5 hash mismatch/);
  });
});
