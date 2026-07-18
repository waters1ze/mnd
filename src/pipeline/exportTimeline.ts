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

  // Hash check
  const sourceHash = state.sourceManifest?.[editPlan.sourceVideoPath];
  if (sourceHash) {
    const data = await readFile(editPlan.sourceVideoPath);
    const currentHash = createHash("md5").update(data).digest("hex");
    if (currentHash !== sourceHash) {
      throw new Error(`Source video hash mismatch. File has been modified since it was added to the project. Original: ${sourceHash}, Current: ${currentHash}`);
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
