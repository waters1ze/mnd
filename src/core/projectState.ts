import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ProjectState, PipelineStep } from "../types/pipeline.js";

export async function loadProjectState(vaultPath: string, slug: string): Promise<ProjectState> {
  const { getProjectPaths } = await import("./projectPaths.js");
  const paths = getProjectPaths(vaultPath, slug);
  const p = paths.stateJson;
  if (!existsSync(p)) {
    const now = new Date().toISOString();
    return {
      version: 1,
      projectSlug: slug,
      runId: null,
      sourceManifest: {},
      activeProfile: "hybrid",
      createdAt: now,
      updatedAt: now,
      lastCompletedStep: null,
      cancellationState: "none",
      steps: {},
      editPlan: null,
      stepOutputs: {},
    };
  }
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw) as ProjectState;
}

/** Atomically write state to disk */
export async function saveProjectState(vaultPath: string, state: ProjectState): Promise<void> {
  const { getProjectPaths } = await import("./projectPaths.js");
  const paths = getProjectPaths(vaultPath, state.projectSlug);
  const target = paths.stateJson;
  state.updatedAt = new Date().toISOString();
  const { atomicWriteFile } = await import("./atomic.js");
  await atomicWriteFile(target, JSON.stringify(state, null, 2));
}

export function isStepDone(state: ProjectState, step: PipelineStep): boolean {
  const order: PipelineStep[] = ["transcribe", "pauses", "keyframes", "vision", "rules", "plan", "exported"];
  const lastIdx = state.lastCompletedStep ? order.indexOf(state.lastCompletedStep) : -1;
  const stepIdx = order.indexOf(step);
  return stepIdx <= lastIdx;
}

export function markStepDone(state: ProjectState, step: PipelineStep): void {
  const order: PipelineStep[] = ["transcribe", "pauses", "keyframes", "vision", "rules", "plan", "exported"];
  const stepIdx = order.indexOf(step);
  const lastIdx = state.lastCompletedStep ? order.indexOf(state.lastCompletedStep) : -1;
  if (stepIdx > lastIdx) {
    state.lastCompletedStep = step;
  }
}

export function cacheStepOutput(state: ProjectState, step: string, data: unknown): void {
  state.stepOutputs[step] = data;
}

export function getCachedStepOutput<T>(state: ProjectState, step: string): T | null {
  return (state.stepOutputs[step] as T) ?? null;
}
