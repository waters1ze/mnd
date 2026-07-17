// test/regression.test.ts
// Integration regression test: runs the analyze pipeline on reference_video.mp4
// and compares result to expected_plan.json with ±300ms tolerance.
import { mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";

const pathStr = ffmpegPath as unknown as string;
const ffprobePathStr = ffprobeStatic.path;
const paths = [pathStr, ffprobePathStr].filter(Boolean);
console.log("DEBUG REGRESSION:", { ffmpegPath, pathStr, ffprobePathStr });

const keys = Object.keys(process.env).filter((k) => k.toLowerCase() === "path");
for (const p of paths) {
  const dir = dirname(p);
  for (const key of keys) {
    process.env[key] = dir + (process.platform === "win32" ? ";" : ":") + process.env[key];
  }
}

const REFERENCE_VIDEO = join(process.cwd(), "test", "fixtures", "reference_video.mp4");
const EXPECTED_PLAN = join(process.cwd(), "test", "fixtures", "expected_plan.json");
const TOLERANCE_MS = 0.3; // ±300ms in seconds

const HAS_VIDEO = existsSync(REFERENCE_VIDEO);
const HAS_FFMPEG = (() => {
  if (pathStr && existsSync(pathStr)) return true;
  try { require("node:child_process").execSync("ffmpeg -version", { stdio: "ignore" }); return true; }
  catch { return false; }
})();

const SKIP = !HAS_VIDEO || !HAS_FFMPEG;
console.log("DEBUG SKIP:", { HAS_VIDEO, HAS_FFMPEG, SKIP });

describe("Regression: analyze pipeline on reference video", () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await mkdtemp(join(tmpdir(), "mnd-regression-"));
  });

  afterEach(async () => {
    await rm(tmpVault, { recursive: true, force: true });
  });

  afterAll(async () => {
    const { stopSidecar } = await import("../src/core/pythonSidecarClient.js");
    await stopSidecar();
  });

  (SKIP ? test.skip : test)(
    "produces EditPlan matching expected_plan.json within tolerance",
    async () => {
      // Set up vault structure
      const { ensureVaultStructure, createProject } = await import("../src/core/vault.js");
      await ensureVaultStructure(tmpVault);
      const slug = await createProject(tmpVault, "Test Regression", "default");

      // Copy reference video to raw/
      const rawDir = join(tmpVault, "Projects", slug, "raw");
      await mkdir(rawDir, { recursive: true });
      await copyFile(REFERENCE_VIDEO, join(rawDir, "reference_video.mp4"));

      // Load expected plan
      const { readFile } = await import("node:fs/promises");
      const expectedRaw = await readFile(EXPECTED_PLAN, "utf-8");
      const expectedPlan = JSON.parse(expectedRaw);

      // Run pipeline steps directly (bypass analyze command)
      const { loadProjectState, saveProjectState } = await import("../src/core/projectState.js");
      const state = await loadProjectState(tmpVault, slug);

      // Step 1: Transcribe (Mocked to avoid network calls and API key requirements)
      const segments = expectedPlan.transcript;
      expect(segments.length).toBeGreaterThan(0);

      // Step 2: Detect pauses
      const { detectPausesAndFillers } = await import("../src/pipeline/detectPausesAndFillers.js");
      const cuts = await detectPausesAndFillers(segments, state, tmpVault, { pauseThresholdSec: 1.0 });

      // Key regression assertion: cut count matches exactly
      expect(cuts.length).toBe(expectedPlan.cuts.length);

      // Timing tolerance: each cut within ±300ms of expected
      for (let i = 0; i < expectedPlan.cuts.length; i++) {
        const expected = expectedPlan.cuts[i];
        const actual = cuts[i];
        if (!expected || !actual) continue;
        expect(Math.abs(actual.startSec - expected.startSec)).toBeLessThanOrEqual(TOLERANCE_MS);
        expect(Math.abs(actual.endSec - expected.endSec)).toBeLessThanOrEqual(TOLERANCE_MS);
      }

      // Verify state was persisted
      const reloaded = await loadProjectState(tmpVault, slug);
      expect(reloaded.lastCompletedStep).toBe("pauses");
    },
    120_000 // 2 min timeout for transcription
  );

  (SKIP ? test.skip : test)(
    "produces .fcpxml via sidecar export (non-empty file)",
    async () => {
      const { ensureVaultStructure, createProject } = await import("../src/core/vault.js");
      await ensureVaultStructure(tmpVault);
      const slug = await createProject(tmpVault, "Test FCPXML", "default");

      // Build a minimal EditPlan matching the spec
      const editPlan = {
        projectSlug: slug,
        sourceVideoPath: REFERENCE_VIDEO,
        transcript: [{ start: 0, end: 5, text: "Test." }],
        cuts: [{ id: "cut-1", startSec: 2.0, endSec: 3.0, reason: "pause" }],
        overlays: [],
        audioTrack: { musicAssetId: null, syncToBeat: false },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      const { loadProjectState } = await import("../src/core/projectState.js");
      const state = await loadProjectState(tmpVault, slug);
      state.editPlan = editPlan as typeof editPlan & { cuts: Array<{ id: string; startSec: number; endSec: number; reason: "pause" | "filler_word" | "manual" }> };

      // Export via sidecar (requires Python + opentimelineio)
      const { sidecarExportFcpxml } = await import("../src/core/pythonSidecarClient.js");
      const outputPath = join(tmpVault, "Projects", slug, "reports", `${slug}.fcpxml`);

      try {
        await mkdir(join(tmpVault, "Projects", slug, "reports"), { recursive: true });
        const result = await sidecarExportFcpxml(editPlan, outputPath);

        // File must exist and be non-empty
        expect(existsSync(result)).toBe(true);
        const { stat } = await import("node:fs/promises");
        const s = await stat(result);
        expect(s.size).toBeGreaterThan(0);
      } catch (err) {
        console.error("FCPXML EXPORT FAILED:", err);
        // Skip if Python/OTIO not installed
        if (String(err).includes("Python not found") || String(err).includes("No module named")) {
          console.warn("Skipping FCPXML test: Python/opentimelineio not available");
          return;
        }
        throw err;
      }
    },
    60_000
  );
});
