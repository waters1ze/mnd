import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { XMLValidator } from "fast-xml-parser";
import { buildAutomaticEditPlan } from "../src/pipeline/automaticEditor.js";
import { preservePromptedImageOverlays } from "../src/pipeline/aiEditPlan.js";
import { buildEffectFfmpegArgs } from "../src/pipeline/effectMaterializer.js";
import { validateEditPlan } from "../src/pipeline/editPlanValidator.js";
import { compileTimeline } from "../src/pipeline/timelineCompiler.js";
import { generateFcpxml, generateSrt } from "../src/export/fcpxmlExporter.js";
import type { SourceAnalysis, SourceManifest, SourceRecord, TranscriptV1 } from "../src/types/production.js";

describe("production editing pipeline", () => {
  let projectRoot: string;
  let source: SourceRecord;
  let imageSource: SourceRecord;
  let manifest: SourceManifest;

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "mnd-production-"));
    const sourcePath = join(projectRoot, "source.mp4");
    const imagePath = join(projectRoot, "logo.png");
    await writeFile(sourcePath, "fixture");
    await writeFile(imagePath, "image fixture");
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
    imageSource = {
      id: "source_logo",
      relativePath: "logo.png",
      canonicalPath: imagePath,
      sha256: "b".repeat(64),
      size: 13,
      mtime: "2026-01-01T00:00:00.000Z",
      durationSeconds: 0,
      format: "png",
      kind: "image",
      videoStreams: [],
      audioStreams: [],
      width: 1200,
      height: 800,
      fps: { numerator: 25, denominator: 1 },
      timeBase: "1/25",
      sampleRate: 0,
      channels: 0,
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

  test("places a named source image at the matching spoken cue", () => {
    const imageManifest: SourceManifest = { ...manifest, entries: [source, imageSource] };
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
        description: "Talking head",
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
    const transcript: TranscriptV1 = {
      schemaVersion: 1,
      sourceId: source.id,
      sourceHash: source.sha256,
      language: "ru",
      provider: "fixture",
      model: "fixture",
      segments: [
        { id: "intro", start: 0, end: 2, text: "Начинаем рассказ", words: [] },
        { id: "spoken-link", start: 8, end: 9.5, text: "Ссылка находится в описании", words: [] },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plan = buildAutomaticEditPlan(imageManifest.projectId, imageManifest, [analysis], [transcript], {
      profile: "talking_head",
      timelineName: "Prompt image placement",
      fps: { numerator: 25, denominator: 1 },
      keepInstructions: ["Когда говорю «ссылка в описании» и показываю вниз, вставь logo.png между моих рук"],
    });

    const imageTrack = plan.tracks.find((track) => track.kind === "images");
    expect(imageTrack?.clips).toHaveLength(1);
    expect(imageTrack?.clips[0]).toMatchObject({
      sourceId: imageSource.id,
      timelineStart: 8,
      transform: { scale: 0.34, positionX: 0, positionY: -140 },
    });
    expect(validateEditPlan(plan, imageManifest, projectRoot).valid).toBe(true);

    const timeline = compileTimeline(plan, imageManifest, projectRoot);
    const xml = generateFcpxml(timeline, imageManifest);
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('name="logo.png"');
    expect(xml).toContain('<adjust-transform position="0 -140" scale="0.34 0.34"');

    const primaryTrack = plan.tracks.find((track) => track.kind === "primary_video")!;
    const shiftedCandidate = {
      ...plan,
      tracks: plan.tracks
        .filter((track) => track.kind !== "images")
        .map((track) => track.kind !== "primary_video" ? track : {
          ...track,
          clips: track.clips.map((clip) => ({
            ...clip,
            timelineStart: clip.timelineStart + 4,
            timelineEnd: clip.timelineEnd + 4,
          })),
        }),
    };
    expect(primaryTrack.clips[0]!.sourceStart).toBe(0);
    const preserved = preservePromptedImageOverlays(shiftedCandidate, plan);
    const movedOverlay = preserved.tracks.find((track) => track.kind === "images")!.clips[0]!;
    expect(movedOverlay.timelineStart).toBe(12);
    expect(movedOverlay.transform).toEqual(imageTrack!.clips[0]!.transform);
  });

  test("adds handle-safe transitions and prompt-directed video/audio effects", () => {
    const analysis: SourceAnalysis = {
      schemaVersion: 1,
      sourceId: source.id,
      sourceHash: source.sha256,
      parametersHash: "effects",
      scenes: [
        { id: "scene-a", sourceId: source.id, sourceStart: 0, sourceEnd: 5, description: "First take", transcriptReferences: [], visualQuality: 1, audioQuality: 1, tags: [], people: [], objects: [], suggestedRole: "primary", keepScore: 1, rejectScore: 0, diagnostics: [] },
        { id: "scene-b", sourceId: source.id, sourceStart: 7, sourceEnd: 12, description: "Abrupt second take", transcriptReferences: [], visualQuality: 1, audioQuality: 1, tags: [], people: [], objects: [], suggestedRole: "primary", keepScore: 1, rejectScore: 0, diagnostics: [] },
      ],
      diagnostics: [],
      highlights: [],
      brollOpportunities: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    const plan = buildAutomaticEditPlan(manifest.projectId, manifest, [analysis], [], {
      profile: "talking_head",
      timelineName: "Prompt effects",
      keepInstructions: ["Сделай плавный переход при резкой смене кадра, всё видео чб, сделай голос ниже и громче на +4 дБ, убери шум и нормализуй громкость"],
    });
    const clips = plan.tracks.find((track) => track.kind === "primary_video")!.clips;
    expect(clips[1]!.transitionIn).toEqual({ type: "cross_dissolve", durationSeconds: 0.3 });
    expect(clips[0]!.effect).toBe("monochrome");
    expect(clips[0]!.audio).toMatchObject({
      gainDb: 4,
      eqMode: "bass_boost",
      noiseReductionAmount: 35,
      loudness: { amount: 6, uniformity: 0.5 },
      pitchSemitones: -2,
    });
    expect(validateEditPlan(plan, manifest, projectRoot).valid).toBe(true);

    const args = buildEffectFfmpegArgs(clips[0]!, source, join(projectRoot, "rendered.mp4"));
    expect(args).toEqual(expect.arrayContaining(["-vf", "hue=s=0"]));
    expect(args[args.indexOf("-af") + 1]).toContain("asetrate=");

    const nativePlan = structuredClone(plan);
    for (const clip of nativePlan.tracks[0]!.clips) {
      delete clip.effect;
      delete clip.audio.pitchSemitones;
    }
    const xml = generateFcpxml(compileTimeline(nativePlan, manifest, projectRoot), manifest);
    expect(xml).toContain('<transition name="Cross Dissolve"');
    expect(xml).toContain('<adjust-EQ mode="bass_boost"/>');
    expect(xml).toContain('<adjust-noiseReduction amount="35"/>');
    expect(xml).toContain('<adjust-loudness amount="6" uniformity="0.5"/>');
    expect(xml).toContain('<adjust-volume amount="4dB">');
  });
});
