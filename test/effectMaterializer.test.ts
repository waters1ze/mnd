import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { getProjectPaths } from "../src/core/projectPaths.js";
import { buildSourceRecord } from "../src/core/sourceManifest.js";
import { buildAutomaticEditPlan } from "../src/pipeline/automaticEditor.js";
import { materializeEditPlanEffects } from "../src/pipeline/effectMaterializer.js";
import { validateEditPlan } from "../src/pipeline/editPlanValidator.js";
import { compileTimeline } from "../src/pipeline/timelineCompiler.js";
import { generateFcpxml } from "../src/export/fcpxmlExporter.js";
import type { SourceManifest } from "../src/types/production.js";

const fixture = join(process.cwd(), "test", "fixtures", "reference_video.mp4");

describe("prompt effect materialization", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "mnd-effects-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  (existsSync(fixture) ? test : test.skip)("renders monochrome/pitch derivatives that remain valid editable timeline media", async () => {
    const paths = getProjectPaths(vaultPath, "effects-test");
    await mkdir(paths.sourcesDir, { recursive: true });
    const copied = join(paths.sourcesDir, "reference_video.mp4");
    await copyFile(fixture, copied);
    const source = await buildSourceRecord(paths.root, copied);
    const manifest: SourceManifest = {
      schemaVersion: 1,
      projectId: "effects-project",
      generatedAt: new Date().toISOString(),
      entries: [source],
    };
    const plan = buildAutomaticEditPlan(manifest.projectId, manifest, [], [], {
      profile: "talking_head",
      timelineName: "Rendered prompt effects",
      keepInstructions: ["Сделай видео чб и голос немного ниже"],
    });
    expect(plan.tracks[0]!.clips[0]!.effect).toBe("monochrome");

    const materialized = await materializeEditPlanEffects(plan, manifest, paths);
    expect(materialized.generatedFiles).toHaveLength(1);
    expect(existsSync(materialized.generatedFiles[0]!)).toBe(true);
    expect(materialized.manifest.entries).toHaveLength(2);
    const renderedClip = materialized.plan.tracks[0]!.clips[0]!;
    expect(renderedClip.sourceId).not.toBe(source.id);
    expect(renderedClip.effect).toBeUndefined();
    expect(renderedClip.audio.pitchSemitones).toBeUndefined();
    expect(validateEditPlan(materialized.plan, materialized.manifest, paths.root).valid).toBe(true);
    const timeline = compileTimeline(materialized.plan, materialized.manifest, paths.root);
    expect(generateFcpxml(timeline, materialized.manifest)).toContain(basename(materialized.generatedFiles[0]!));
  }, 60_000);
});
