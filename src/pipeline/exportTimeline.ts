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

  const { stat } = await import("node:fs/promises");
  const fstat = await stat(editPlan.sourceVideoPath);
  
  if (expectedSize !== null && fstat.size !== expectedSize) {
     throw new Error(`Source video size mismatch. File has been modified. Expected size: ${expectedSize}, Current: ${fstat.size}. Recovery: replace with original file or create a new project.`);
  }

  const { createReadStream } = await import("node:fs");
  const currentSha256 = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(editPlan.sourceVideoPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

  if (currentSha256 !== expectedHash) {
    // If the hash is MD5 (32 hex chars), we migrate it and accept if it matches MD5
    if (expectedHash.length === 32) {
      const currentMd5 = await new Promise<string>((resolve, reject) => {
        const hash = createHash("md5");
        const stream = createReadStream(editPlan.sourceVideoPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
      });
      if (currentMd5 !== expectedHash) {
        throw new Error(`Source video MD5 hash mismatch. File has been modified since it was added to the project. Original: ${expectedHash}, Current: ${currentMd5}. Recovery: replace with original file or create a new project.`);
      }
      // Migrate it to SHA-256 for future checks (we don't save state here but could)
    } else {
      throw new Error(`Source video SHA-256 hash mismatch. File has been modified since it was added to the project. Original: ${expectedHash}, Current: ${currentSha256}. Recovery: replace with original file or create a new project.`);
    }
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
