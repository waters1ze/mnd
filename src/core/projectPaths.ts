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
  projectJson: string;
  sourcesDir: string;
  transcriptsDir: string;
  scenesDir: string;
  editPlansDir: string;
  timelinesDir: string;
  assetsDir: string;
  logsDir: string;
  rawDir: string;
  exportsDir: string;
  exportBundleDir: string;
  timelineFcpxml: string;
  editPlanJson: string;
  sourceManifestJson: string;
  transcriptJson: string;
  scenesJson: string;
  compiledTimelineJson: string;
  exportReportJson: string;
  validationReportJson: string;
  subtitlesSrt: string;
  thumbnailJpg: string;
  publishJson: string;
  publishMd: string;
  titleTxt: string;
  descriptionTxt: string;
  importReadme: string;
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
  const sourcesDir = join(root, "sources");
  const rawDir = join(root, "raw");
  const exportsDir = join(root, "exports");
  const exportBundleDir = join(exportsDir, "MND_Export");
  const reportsDir = join(root, "reports");
  const mndDir = join(root, ".mnd");
  const transcriptsDir = join(root, "transcripts");
  const scenesDir = join(root, "scenes");
  const editPlansDir = join(root, "edit-plans");
  const timelinesDir = join(root, "timelines");
  const assetsDir = join(root, "assets");
  const logsDir = join(root, "logs");

  const paths: ProjectPaths = {
    root,
    projectMd: join(root, "project.md"),
    projectJson: join(root, "project.json"),
    sourcesDir,
    transcriptsDir,
    scenesDir,
    editPlansDir,
    timelinesDir,
    assetsDir,
    logsDir,
    rawDir,
    
    exportsDir,
    exportBundleDir,
    timelineFcpxml: join(exportBundleDir, "final-timeline.fcpxml"),
    editPlanJson: join(editPlansDir, "edit-plan.json"),
    sourceManifestJson: join(root, "source-manifest.json"),
    transcriptJson: join(transcriptsDir, "transcript.json"),
    scenesJson: join(scenesDir, "scenes.json"),
    compiledTimelineJson: join(timelinesDir, "compiled-timeline.json"),
    exportReportJson: join(exportBundleDir, "export-report.json"),
    validationReportJson: join(exportBundleDir, "validation-report.json"),
    subtitlesSrt: join(exportBundleDir, "subtitles.srt"),
    thumbnailJpg: join(exportBundleDir, "thumbnail.jpg"),
    publishJson: join(exportBundleDir, "publish.json"),
    publishMd: join(exportBundleDir, "PUBLISH_PACKAGE.md"),
    titleTxt: join(exportBundleDir, "title.txt"),
    descriptionTxt: join(exportBundleDir, "description.txt"),
    importReadme: join(exportBundleDir, "README_IMPORT.txt"),
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
    sourcesDir, transcriptsDir, scenesDir, editPlansDir, timelinesDir, assetsDir,
    logsDir, exportsDir, exportBundleDir, reportsDir, mndDir, paths.cacheDir, paths.audioDir,
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
  const mediaExtensions = /\.(?:3gp|aac|aif|aiff|avi|bmp|flac|gif|heic|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|mxf|ogg|opus|png|tiff?|wav|webm|webp)$/i;
  async function containsMedia(path: string): Promise<boolean> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && mediaExtensions.test(entry.name)) return true;
        if (entry.isDirectory() && await containsMedia(join(path, entry.name))) return true;
      }
    } catch {}
    return false;
  }
  hasRawMedia = await containsMedia(join(folderPath, "sources")) || await containsMedia(join(folderPath, "raw"));

  let hasValidPlan = false;
  try {
    const s = await stat(join(folderPath, "edit-plans", "edit-plan.json"));
    hasValidPlan = s.isFile();
  } catch {}

  let hasValidExport = false;
  try {
    const s = await stat(join(folderPath, "exports", "MND_Export", "final-timeline.fcpxml"));
    hasValidExport = s.isFile();
  } catch {}

  return { hasRawMedia, hasValidPlan, hasValidExport };
}
