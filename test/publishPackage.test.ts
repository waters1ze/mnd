import { validatePublishResponse } from "../src/pipeline/publishPackage.js";
import type { SourceAnalysis, SourceManifest, SourceRecord } from "../src/types/production.js";

function videoSource(): SourceRecord {
  return {
    id: "source-video",
    relativePath: "sources/clip.mp4",
    canonicalPath: "C:/vault/sources/clip.mp4",
    sha256: "a".repeat(64),
    size: 1024,
    mtime: "2026-07-19T00:00:00.000Z",
    durationSeconds: 12,
    format: "mov,mp4",
    kind: "video",
    videoStreams: [{ index: 0, codec: "h264", width: 1920, height: 1080 }],
    audioStreams: [],
    width: 1920,
    height: 1080,
    fps: { numerator: 25, denominator: 1 },
    timeBase: "1/12800",
    sampleRate: 0,
    channels: 0,
  };
}

const manifest: SourceManifest = {
  schemaVersion: 1,
  projectId: "project",
  generatedAt: "2026-07-19T00:00:00.000Z",
  entries: [videoSource()],
};

const analyses: SourceAnalysis[] = [];

describe("Antigravity publishing package", () => {
  test("validates title, description, tags and a real thumbnail timestamp", () => {
    const result = validatePublishResponse(JSON.stringify({
      title: "A finished video",
      description: "A useful description.",
      tags: ["editing", "video", "MND"],
      thumbnail: {
        sourceId: "source-video",
        atSeconds: 5.25,
        headline: "Watch this",
        rationale: "The strongest scene",
      },
    }), manifest, analyses);
    expect(result.thumbnail.sourceRelativePath).toBe("sources/clip.mp4");
    expect(result.thumbnail.atSeconds).toBe(5.25);
    expect(result.tags).toEqual(["editing", "video", "MND"]);
  });

  test("rejects invented sources and timestamps outside the media", () => {
    const base = {
      title: "A finished video",
      description: "A useful description.",
      tags: ["editing", "video", "MND"],
      thumbnail: { sourceId: "invented", atSeconds: 13, headline: "Watch", rationale: "Strong" },
    };
    expect(() => validatePublishResponse(JSON.stringify(base), manifest, analyses)).toThrow(/sourceId/);
    base.thumbnail.sourceId = "source-video";
    expect(() => validatePublishResponse(JSON.stringify(base), manifest, analyses)).toThrow(/inside/);
  });
});
