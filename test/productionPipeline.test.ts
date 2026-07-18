import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { XMLValidator } from "fast-xml-parser";
import { buildAutomaticEditPlan } from "../src/pipeline/automaticEditor.js";
import { validateEditPlan } from "../src/pipeline/editPlanValidator.js";
import { compileTimeline } from "../src/pipeline/timelineCompiler.js";
import { generateFcpxml, generateSrt } from "../src/export/fcpxmlExporter.js";
import type { SourceAnalysis, SourceManifest, SourceRecord } from "../src/types/production.js";

describe("production editing pipeline", () => {
  let projectRoot: string;
  let source: SourceRecord;
  let manifest: SourceManifest;

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "mnd-production-"));
    const sourcePath = join(projectRoot, "source.mp4");
    await writeFile(sourcePath, "fixture");
    source = {
      id: "source_primary",
      relativePath: "source.mp4",
      canonicalPath: sourcePath,
      sha256: "a".repeat(64),
      size: 7,
      mtime: "2026-01-01T00:00:00.000Z",
      durationSeconds: 20,
      format: "mp4",
      kind: "video",
      videoStreams: [{ index: 0, codec: "h264", width: 1920, height: 1080, fps: { numerator: 25, denominator: 1 } }],
      audioStreams: [{ index: 1, codec: "aac", sampleRate: 48000, channels: 2 }],
      width: 1920,
      height: 1080,
      fps: { numerator: 25, denominator: 1 },
      timeBase: "1/25",
      sampleRate: 48000,
      channels: 2,
    };
    manifest = {
      schemaVersion: 1,
      projectId: "project_1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      entries: [source],
    };
  });

  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("trims a long scene to the requested duration and keeps short fades valid", () => {
    const analysis: SourceAnalysis = {
      schemaVersion: 1,
      sourceId: source.id,
      sourceHash: source.sha256,
      parametersHash: "parameters",
      scenes: [{
        id: "scene_1",
        sourceId: source.id,
        sourceStart: 0,
        sourceEnd: 20,
        description: "Single continuous take",
        transcriptReferences: [],
        visualQuality: 1,
        audioQuality: 1,
        tags: [],
        people: [],
        objects: [],
        suggestedRole: "primary",
        keepScore: 1,
        rejectScore: 0,
        diagnostics: [],
      }],
      diagnostics: [],
      highlights: [],
      brollOpportunities: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plan = buildAutomaticEditPlan(manifest.projectId, manifest, [analysis], [], {
      profile: "talking_head",
      timelineName: "Targeted edit",
      targetDurationSeconds: 0.2,
      fps: { numerator: 25, denominator: 1 },
    });

    const clip = plan.tracks[0]!.clips[0]!;
    expect(clip.timelineEnd - clip.timelineStart).toBeCloseTo(0.2, 8);
    expect(clip.audio.fadeInSeconds + clip.audio.fadeOutSeconds).toBeLessThanOrEqual(0.2);
    expect(validateEditPlan(plan, manifest, projectRoot).valid).toBe(true);

    const timeline = compileTimeline(plan, manifest, projectRoot);
    expect(timeline.durationFrames).toBe(5);
    const xml = generateFcpxml(timeline, manifest);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<fcpxml version="1.10">');
  });

  test("reports malformed AI plans instead of throwing from validation", () => {
    const malformed = {
      schemaVersion: 1,
      projectId: manifest.projectId,
      tracks: [{ id: "broken", kind: "primary_video", exclusive: true, clips: [{ enabled: true }] }],
    } as never;
    expect(() => validateEditPlan(malformed, manifest, projectRoot)).not.toThrow();
    const report = validateEditPlan(malformed, manifest, projectRoot);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "INVALID_TIMELINE",
      "SOURCE_MISSING",
      "DUPLICATE_CLIP_ID",
      "INVALID_SUBTITLES",
    ]));
  });

  test("renders stable SRT ordering and timestamps", () => {
    expect(generateSrt([
      { id: "later", start: 2, end: 3.25, text: "Second" },
      { id: "first", start: 0.1, end: 1.2, text: "First" },
    ])).toBe("1\n00:00:00,100 --> 00:00:01,200\nFirst\n\n2\n00:00:02,000 --> 00:00:03,250\nSecond\n\n");
  });
});
