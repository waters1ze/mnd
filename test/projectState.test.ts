// test/projectState.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadProjectState,
  saveProjectState,
  isStepDone,
  markStepDone,
  cacheStepOutput,
  getCachedStepOutput,
} from "../src/core/projectState.js";
import type { ProjectState } from "../src/types/pipeline.js";

let tmpVault: string;

beforeEach(async () => {
  tmpVault = await mkdtemp(join(tmpdir(), "mnd-test-"));
});

afterEach(async () => {
  await rm(tmpVault, { recursive: true, force: true });
});

import { mkdir } from "node:fs/promises";

function makeState(slug = "test-slug"): ProjectState {
  return {
    version: 1,
    projectSlug: slug,
    runId: null,
    sourceManifest: {},
    activeProfile: "hybrid",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastCompletedStep: null,
    cancellationState: "none",
    steps: {},
    editPlan: null,
    stepOutputs: {},
  };
}

describe("loadProjectState()", () => {
  test("returns default state when file does not exist", async () => {
    const state = await loadProjectState(tmpVault, "nonexistent");
    expect(state.lastCompletedStep).toBeNull();
    expect(state.editPlan).toBeNull();
  });
});

describe("saveProjectState() + loadProjectState()", () => {
  test("round-trip: save then load recovers state", async () => {
    const state = makeState();
    state.lastCompletedStep = "transcribe";
    
    // Ensure dir exists
    await mkdir(join(tmpVault, "Projects", "test-slug", ".mnd"), { recursive: true });
    await saveProjectState(tmpVault, state);

    const loaded = await loadProjectState(tmpVault, "test-slug");
    expect(loaded.lastCompletedStep).toBe("transcribe");
    expect(loaded.projectSlug).toBe("test-slug");
  });

  test("atomic write: state is valid JSON after save", async () => {
    const state = makeState();
    state.lastCompletedStep = "vision";
    await mkdir(join(tmpVault, "Projects", "test-slug", ".mnd"), { recursive: true });
    await saveProjectState(tmpVault, state);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(
      join(tmpVault, "Projects", "test-slug", ".mnd", "state.json"),
      "utf-8"
    );
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("isStepDone()", () => {
  test("null lastCompletedStep → no step done", () => {
    const state = makeState();
    expect(isStepDone(state, "transcribe")).toBe(false);
    expect(isStepDone(state, "vision")).toBe(false);
  });

  test("lastCompletedStep=transcribe → transcribe is done, pauses not", () => {
    const state = makeState();
    state.lastCompletedStep = "transcribe";
    expect(isStepDone(state, "transcribe")).toBe(true);
    expect(isStepDone(state, "pauses")).toBe(false);
  });

  test("lastCompletedStep=vision → all prior steps are done", () => {
    const state = makeState();
    state.lastCompletedStep = "vision";
    expect(isStepDone(state, "transcribe")).toBe(true);
    expect(isStepDone(state, "pauses")).toBe(true);
    expect(isStepDone(state, "keyframes")).toBe(true);
    expect(isStepDone(state, "vision")).toBe(true);
    expect(isStepDone(state, "rules")).toBe(false);
    expect(isStepDone(state, "plan")).toBe(false);
  });
});

describe("markStepDone()", () => {
  test("advances lastCompletedStep forward", () => {
    const state = makeState();
    markStepDone(state, "transcribe");
    expect(state.lastCompletedStep).toBe("transcribe");
    markStepDone(state, "pauses");
    expect(state.lastCompletedStep).toBe("pauses");
  });

  test("does not regress lastCompletedStep backward", () => {
    const state = makeState();
    state.lastCompletedStep = "vision";
    markStepDone(state, "transcribe"); // earlier step
    expect(state.lastCompletedStep).toBe("vision"); // unchanged
  });
});

describe("cacheStepOutput() + getCachedStepOutput()", () => {
  test("stores and retrieves arbitrary data", () => {
    const state = makeState();
    const data = [{ start: 0, end: 5, text: "hello" }];
    cacheStepOutput(state, "transcribe", data);
    const retrieved = getCachedStepOutput<typeof data>(state, "transcribe");
    expect(retrieved).toEqual(data);
  });

  test("returns null for missing key", () => {
    const state = makeState();
    expect(getCachedStepOutput(state, "nonexistent")).toBeNull();
  });

  test("idempotent: re-caching same step does not duplicate", () => {
    const state = makeState();
    cacheStepOutput(state, "transcribe", [1, 2, 3]);
    cacheStepOutput(state, "transcribe", [4, 5, 6]);
    const val = getCachedStepOutput<number[]>(state, "transcribe");
    expect(val).toEqual([4, 5, 6]); // latest wins
  });
});
