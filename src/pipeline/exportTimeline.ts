// src/pipeline/exportTimeline.ts
import { join } from "node:path";
import { sidecarExportFcpxml } from "../core/pythonSidecarClient.js";
import {
  markStepDone,
  saveProjectState,
} from "../core/projectState.js";
import type { EditPlan, ProjectState } from "../types/pipeline.js";

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hashFileStream } from "../core/sourceManifest.js";

export async function exportTimelineStep(
  editPlan: EditPlan,
  state: ProjectState,
  vaultPath: string
): Promise<string> {
  if (!existsSync(editPlan.sourceVideoPath)) {
    throw new Error(`Cannot export timeline: source video file is missing or offline at ${editPlan.sourceVideoPath}`);
  }

  // Find canonical relative path by looking at paths
  let relPath = editPlan.sourceVideoPath;
  const rawIdx = editPlan.sourceVideoPath.lastIndexOf("raw");
  if (rawIdx !== -1) {
    relPath = editPlan.sourceVideoPath.substring(rawIdx);
    relPath = relPath.replace(/\\/g, "/"); // normalize
  }

  // Find manifest entry. In our app, they are stored under raw/filename.ext or similar
  let sourceEntry = state.sourceManifest?.[relPath];
  if (!sourceEntry) {
     // fallback to checking basename if exact path not matched
     const base = editPlan.sourceVideoPath.split(/[\/\\]/).pop();
     if (base && state.sourceManifest) {
        const found = Object.keys(state.sourceManifest).find(k => k.endsWith(base));
        if (found) sourceEntry = state.sourceManifest[found];
     }
  }

  if (!sourceEntry) {
    throw new Error(`Cannot export timeline: missing integrity metadata in sourceManifest for ${editPlan.sourceVideoPath}. Recovery: run 'analyze' again to re-ingest.`);
  }

  const expectedHash = typeof sourceEntry === "string" ? sourceEntry : sourceEntry.hash;
  const expectedSize = typeof sourceEntry === "string" ? null : sourceEntry.size;
  const expectedAlgorithm = typeof sourceEntry === "string" ? (expectedHash.length === 32 ? "md5" : "sha256") : sourceEntry.algorithm;

  const { stat } = await import("node:fs/promises");
  const fstat = await stat(editPlan.sourceVideoPath);
  
  if (expectedSize !== null && fstat.size !== expectedSize) {
     throw new Error(`Source video size mismatch. File has been modified. Expected size: ${expectedSize}, Current: ${fstat.size}. Recovery: replace with original file or create a new project.`);
  }

  const currentHash = await hashFileStream(editPlan.sourceVideoPath, expectedAlgorithm);

  if (currentHash !== expectedHash) {
    throw new Error(`Source video ${expectedAlgorithm.toUpperCase()} hash mismatch. File has been modified since it was added to the project. Original: ${expectedHash}, Current: ${currentHash}. Recovery: replace with original file or create a new project.`);
  }
  
  const outputPath = join(
    vaultPath,
    "Projects",
    editPlan.projectSlug,
    "reports",
    `${editPlan.projectSlug}_v${editPlan.version}.fcpxml`
  );

  const fcpxmlPath = await sidecarExportFcpxml(editPlan, outputPath);

  markStepDone(state, "exported");
  await saveProjectState(vaultPath, state);

  return fcpxmlPath;
}
