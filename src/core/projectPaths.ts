import { join, resolve, sep } from "node:path";
import chalk from "chalk";

/**
 * Validates a project slug to prevent path traversal and invalid characters.
 */
export function validateSlug(slug: string): void {
  if (!slug || typeof slug !== "string") {
    throw new Error("Invalid project slug: must be a non-empty string.");
  }
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error(`Invalid project slug: contains invalid characters or path traversal: ${slug}`);
  }
}

export interface ProjectPaths {
  root: string;
  projectMd: string;
  rawDir: string;
  exportsDir: string;
  timelineFcpxml: string;
  editPlanJson: string;
  validationDir: string;
  reportsDir: string;
  transcriptMd: string;
  visionAnalysisMd: string;
  editPlanMd: string;
  mndDir: string;
  stateJson: string;
  runLog: string;
  lockJson: string;
  lockHeartbeatJson: string;
  cacheDir: string;
  audioDir: string;
  framesDir: string;
  proxiesDir: string;
  backupsDir: string;
  syncDir: string;
}

/**
 * Returns canonical paths for all project artifacts.
 * Ensures no derived output can escape into `raw/`.
 */
export function getProjectPaths(vaultPath: string, slug: string): ProjectPaths {
  validateSlug(slug);

  const root = join(vaultPath, "Projects", slug);
  const rawDir = join(root, "raw");
  const exportsDir = join(root, "exports");
  const reportsDir = join(root, "reports");
  const mndDir = join(root, ".mnd");

  const paths: ProjectPaths = {
    root,
    projectMd: join(root, "project.md"),
    rawDir,
    
    exportsDir,
    timelineFcpxml: join(exportsDir, "timeline.fcpxml"),
    editPlanJson: join(exportsDir, "edit-plan.json"),
    validationDir: join(exportsDir, "validation"),
    
    reportsDir,
    transcriptMd: join(reportsDir, "transcript.md"),
    visionAnalysisMd: join(reportsDir, "vision-analysis.md"),
    editPlanMd: join(reportsDir, "edit-plan.md"),
    
    mndDir,
    stateJson: join(mndDir, "state.json"),
    runLog: join(mndDir, "run.log"),
    lockJson: join(mndDir, "lock.json"),
    lockHeartbeatJson: join(mndDir, "lock.heartbeat.json"),
    
    cacheDir: join(mndDir, "cache"),
    audioDir: join(mndDir, "audio"),
    framesDir: join(mndDir, "frames"),
    proxiesDir: join(mndDir, "proxies"),
    backupsDir: join(mndDir, "backups"),
    syncDir: join(mndDir, "sync"),
  };

  // Verify that no derived directory points inside rawDir
  const absoluteRaw = resolve(rawDir) + sep;
  const derivedDirs = [
    exportsDir, reportsDir, mndDir, paths.cacheDir, paths.audioDir, 
    paths.framesDir, paths.proxiesDir, paths.backupsDir, paths.syncDir, paths.validationDir
  ];
  for (const dir of derivedDirs) {
    if (resolve(dir).startsWith(absoluteRaw) || resolve(dir) === resolve(rawDir)) {
      throw new Error(`Critical Error: Derived path ${dir} escapes into immutable raw directory.`);
    }
  }

  return paths;
}

export async function isProjectFolder(folderPath: string): Promise<boolean> {
  const { stat } = await import("node:fs/promises");
  try {
    const s = await stat(folderPath);
    if (!s.isDirectory()) return false;
    const s2 = await stat(join(folderPath, "project.md"));
    return s2.isFile();
  } catch {
    return false;
  }
}

export async function analyzeProjectFlags(folderPath: string): Promise<{hasRawMedia: boolean, hasValidPlan: boolean, hasValidExport: boolean}> {
  const { readdir, stat } = await import("node:fs/promises");
  
  let hasRawMedia = false;
  try {
    const files = await readdir(join(folderPath, "raw"));
    hasRawMedia = files.length > 0;
  } catch {}

  let hasValidPlan = false;
  try {
    const s = await stat(join(folderPath, "exports", "edit-plan.json"));
    hasValidPlan = s.isFile();
  } catch {}

  let hasValidExport = false;
  try {
    const s = await stat(join(folderPath, "exports", "timeline.fcpxml"));
    hasValidExport = s.isFile();
  } catch {}

  return { hasRawMedia, hasValidPlan, hasValidExport };
}
