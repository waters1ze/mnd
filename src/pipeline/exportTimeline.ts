// src/pipeline/exportTimeline.ts
import { join } from "node:path";
import { sidecarExportFcpxml } from "../core/pythonSidecarClient.js";
import {
  markStepDone,
  saveProjectState,
} from "../core/projectState.js";
import type { EditPlan, ProjectState } from "../types/pipeline.js";

export async function exportTimelineStep(
  editPlan: EditPlan,
  state: ProjectState,
  vaultPath: string
): Promise<string> {
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
