// src/core/projectState.ts
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ProjectState, PipelineStep } from "../types/pipeline.js";

function statePath(vaultPath: string, slug: string): string {
  return join(vaultPath, "Projects", slug, ".mnd", "project_state.json");
}

function tmpPath(vaultPath: string, slug: string): string {
  return join(vaultPath, "Projects", slug, ".mnd", "project_state.json.tmp");
}

export async function loadProjectState(vaultPath: string, slug: string): Promise<ProjectState> {
  const p = statePath(vaultPath, slug);
  if (!existsSync(p)) {
    return {
      projectSlug: slug,
      lastCompletedStep: null,
      editPlan: null,
      stepOutputs: {},
      errors: [],
    };
  }
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw) as ProjectState;
}

/** Atomically write: tmp file → rename */
export async function saveProjectState(vaultPath: string, state: ProjectState): Promise<void> {
  const tmp = tmpPath(vaultPath, state.projectSlug);
  const target = statePath(vaultPath, state.projectSlug);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, target);
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
