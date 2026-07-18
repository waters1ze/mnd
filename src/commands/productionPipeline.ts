import { constants as fsConstants, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, parse, relative, resolve, sep } from "node:path";
import type { CommandHandler } from "../repl/router.js";
import { session } from "../repl/loop.js";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { getProjectPaths, type ProjectPaths } from "../core/projectPaths.js";
import { loadProjectFile } from "../core/projectFile.js";
import {
  discoverSourceFiles,
  hashFileStream,
  loadSourceManifest,
  refreshSourceManifest,
  saveSourceManifest,
  verifySourceRecord,
} from "../core/sourceManifest.js";
import { atomicWriteFile } from "../core/atomic.js";
import { emitProgress, emitResult } from "../core/output.js";
import { resetCancellation, setupSignalHandlers } from "../core/cancellation.js";
import { transcribeSource } from "../pipeline/productionTranscription.js";
import { analyzeSource } from "../pipeline/mediaAnalysis.js";
import { buildAutomaticEditPlan, type AutomaticEditOptions, type SourceRangeInstruction } from "../pipeline/automaticEditor.js";
import { refineEditPlanWithAi } from "../pipeline/aiEditPlan.js";
import { validateEditPlan } from "../pipeline/editPlanValidator.js";
import { compileTimeline } from "../pipeline/timelineCompiler.js";
import { exportResolveBundle } from "../export/fcpxmlExporter.js";
import { validateFcpxmlFile } from "../export/fcpxmlValidator.js";
import { listRules } from "../core/vault.js";
import type {
  EditPlanV1,
  EditProfile,
  OperationRecord,
  SourceAnalysis,
  SourceManifest,
  TranscriptV1,
} from "../types/production.js";

interface ProjectContext {
  vaultPath: string;
  slug: string;
  paths: ProjectPaths;
  project: Awaited<ReturnType<typeof loadProjectFile>>;
}

async function context(slugArg?: string): Promise<ProjectContext> {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const slug = slugArg || session.currentProjectSlug;
  if (!slug) throw new Error("No project is open. Use /open or /create first.");
  const paths = getProjectPaths(vaultPath, slug);
  const project = await loadProjectFile(vaultPath, slug);
  return { vaultPath, slug, paths, project };
}

function inside(root: string, candidate: string): boolean {
  const leftRaw = resolve(root);
  const rightRaw = resolve(candidate);
  const left = process.platform === "win32" ? leftRaw.toLocaleLowerCase("en-US") : leftRaw;
  const right = process.platform === "win32" ? rightRaw.toLocaleLowerCase("en-US") : rightRaw;
  return right === left || right.startsWith(`${left}${sep}`);
}

async function uniqueDestination(source: string, requested: string): Promise<string> {
  if (!existsSync(requested)) return requested;
  const [sourceHash, destinationHash] = await Promise.all([hashFileStream(source), hashFileStream(requested)]);
  if (sourceHash === destinationHash) return requested;
  const parsed = parse(requested);
  const candidate = join(parsed.dir, `${parsed.name}-${sourceHash.slice(0, 10)}${parsed.ext}`);
  if (!existsSync(candidate)) return candidate;
  const candidateHash = await hashFileStream(candidate);
  if (candidateHash === sourceHash) return candidate;
  throw new Error(`Source destination conflict: ${candidate}. Rename the input or remove the conflicting project copy explicitly.`);
}

async function copyIntoSources(sourcePath: string, sourcesDir: string, projectRoot: string): Promise<string[]> {
  const inputInfo = await lstat(sourcePath);
  if (inputInfo.isSymbolicLink()) throw new Error(`Symbolic links are not accepted as sources: ${sourcePath}`);
  const canonical = await realpath(sourcePath);
  if (inside(projectRoot, canonical)) {
    if (!inside(sourcesDir, canonical) && !inside(join(projectRoot, "raw"), canonical)) {
      throw new Error(`Project-internal source must be inside sources/ or legacy raw/: ${canonical}`);
    }
    return [canonical];
  }

  async function copyEntry(source: string, destination: string): Promise<string[]> {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not accepted as sources: ${source}`);
    if (info.isDirectory()) {
      await mkdir(destination, { recursive: true });
      const entries = await readdir(source, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      const copied: string[] = [];
      for (const entry of entries) copied.push(...await copyEntry(join(source, entry.name), join(destination, entry.name)));
      return copied;
    }
    if (!info.isFile()) throw new Error(`Unsupported source type: ${source}`);
    await mkdir(dirname(destination), { recursive: true });
    const target = await uniqueDestination(source, destination);
    if (!existsSync(target)) await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    return [target];
  }

  return copyEntry(canonical, join(sourcesDir, basename(canonical)));
}

async function existingManifest(paths: ProjectPaths): Promise<SourceManifest | undefined> {
  return existsSync(paths.sourceManifestJson) ? loadSourceManifest(paths.sourceManifestJson) : undefined;
}

async function refreshManifest(ctx: ProjectContext): Promise<{
  manifest: SourceManifest;
  changedSourceIds: string[];
  removedSourceIds: string[];
}> {
  await mkdir(ctx.paths.sourcesDir, { recursive: true });
  await mkdir(ctx.paths.rawDir, { recursive: true });
  const files = await discoverSourceFiles(ctx.paths.root, [ctx.paths.sourcesDir, ctx.paths.rawDir]);
  if (files.length === 0) throw new Error(`No media sources exist in ${ctx.paths.sourcesDir}`);
  const refreshed = await refreshSourceManifest(ctx.project.id, ctx.paths.root, files, await existingManifest(ctx.paths));
  await saveSourceManifest(ctx.paths.sourceManifestJson, refreshed.manifest);
  return refreshed;
}

async function loadTranscripts(paths: ProjectPaths): Promise<TranscriptV1[]> {
  if (!existsSync(paths.transcriptJson)) return [];
  const value = JSON.parse(await readFile(paths.transcriptJson, "utf8")) as { transcripts?: TranscriptV1[] } | TranscriptV1[];
  return Array.isArray(value) ? value : value.transcripts ?? [];
}

async function saveTranscripts(paths: ProjectPaths, projectId: string, transcripts: TranscriptV1[]): Promise<void> {
  const value = { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), transcripts: [...transcripts].sort((left, right) => left.sourceId.localeCompare(right.sourceId)) };
  await atomicWriteFile(paths.transcriptJson, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadAnalyses(paths: ProjectPaths): Promise<SourceAnalysis[]> {
  if (!existsSync(paths.scenesJson)) return [];
  const value = JSON.parse(await readFile(paths.scenesJson, "utf8")) as { analyses?: SourceAnalysis[] } | SourceAnalysis[];
  return Array.isArray(value) ? value : value.analyses ?? [];
}

async function saveAnalyses(paths: ProjectPaths, projectId: string, analyses: SourceAnalysis[]): Promise<void> {
  const value = { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), analyses: [...analyses].sort((left, right) => left.sourceId.localeCompare(right.sourceId)) };
  await atomicWriteFile(paths.scenesJson, `${JSON.stringify(value, null, 2)}\n`);
}

async function saveOperations(paths: ProjectPaths, operations: OperationRecord[]): Promise<void> {
  const operationPath = join(paths.mndDir, "operations.json");
  let existing: OperationRecord[] = [];
  if (existsSync(operationPath)) {
    const parsed = JSON.parse(await readFile(operationPath, "utf8")) as { operations?: OperationRecord[] };
    existing = parsed.operations ?? [];
  }
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of operations) byId.set(record.id, record);
  const value = { schemaVersion: 1, updatedAt: new Date().toISOString(), operations: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)) };
  await atomicWriteFile(operationPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runTranscriptions(ctx: ProjectContext, manifest: SourceManifest, requestedSourceId?: string): Promise<{ transcripts: TranscriptV1[]; operations: OperationRecord[] }> {
  const existing = new Map((await loadTranscripts(ctx.paths)).map((transcript) => [transcript.sourceId, transcript]));
  const operations: OperationRecord[] = [];
  const sources = manifest.entries.filter((source) => source.audioStreams.length > 0 && (!requestedSourceId || source.id === requestedSourceId));
  if (requestedSourceId && sources.length === 0) throw new Error(`Audio source not found: ${requestedSourceId}`);
  for (const source of sources) {
    await verifySourceRecord(ctx.paths.root, source);
    emitProgress(`Transcribing ${source.relativePath}...`);
    const result = await transcribeSource(source, ctx.paths.cacheDir);
    existing.set(source.id, result.transcript);
    operations.push(result.operation);
  }
  const validSourceIds = new Set(manifest.entries.map((source) => source.id));
  const transcripts = [...existing.values()].filter((transcript) => validSourceIds.has(transcript.sourceId));
  await saveTranscripts(ctx.paths, ctx.project.id, transcripts);
  if (operations.length > 0) await saveOperations(ctx.paths, operations);
  return { transcripts, operations };
}

export const handleAdd: CommandHandler = async (args) => {
  const sourceArg = positionalArgs(args, ["--project"])[0];
  if (!sourceArg) throw new Error("Usage: /add <file-or-directory>");
  const ctx = await context(flagValue(args, "--project"));
  const source = resolve(sourceArg);
  if (!existsSync(source)) throw new Error(`Source does not exist: ${source}`);
  const copied = await copyIntoSources(source, ctx.paths.sourcesDir, ctx.paths.root);
  const refreshed = await refreshManifest(ctx);
  emitResult({ ok: true, status: "completed", projectId: ctx.project.id, copied, sourceCount: refreshed.manifest.entries.length, changedSourceIds: refreshed.changedSourceIds, removedSourceIds: refreshed.removedSourceIds }, `Added ${copied.length} source file(s); manifest contains ${refreshed.manifest.entries.length} source(s).`);
};

export const handleProject: CommandHandler = async (args) => {
  const ctx = await context(args[0]);
  const manifest = await existingManifest(ctx.paths);
  emitResult({ ok: true, project: ctx.project, paths: ctx.paths, sourceCount: manifest?.entries.length ?? 0 }, `${ctx.project.name} (${ctx.slug})\nID: ${ctx.project.id}\nSources: ${manifest?.entries.length ?? 0}\nPath: ${ctx.paths.root}`);
};

export const handleTranscribeProduction: CommandHandler = async (args) => {
  resetCancellation();
  setupSignalHandlers();
  const ctx = await context(flagValue(args, "--project"));
  const { manifest } = await refreshManifest(ctx);
  const requested = positionalArgs(args, ["--project"])[0];
  const result = await runTranscriptions(ctx, manifest, requested);
  emitResult({ ok: true, status: "completed", transcriptCount: result.transcripts.length, operations: result.operations }, `Transcription complete for ${result.transcripts.length} source(s).`);
};

export const handleAnalyzeProduction: CommandHandler = async (args) => {
  resetCancellation();
  setupSignalHandlers();
  const ctx = await context(flagValue(args, "--project"));
  const refreshed = await refreshManifest(ctx);
  const manifest = refreshed.manifest;
  const skipTranscription = args.includes("--skip-transcribe");
  const transcription = skipTranscription ? { transcripts: await loadTranscripts(ctx.paths), operations: [] } : await runTranscriptions(ctx, manifest);
  const transcripts = transcription.transcripts;
  const analysesBySource = new Map((await loadAnalyses(ctx.paths)).map((analysis) => [analysis.sourceId, analysis]));
  const operations = [...transcription.operations];
  let cacheHits = 0;
  for (const source of manifest.entries.filter((entry) => entry.kind === "video" || entry.kind === "audio")) {
    await verifySourceRecord(ctx.paths.root, source);
    emitProgress(`Analyzing ${source.relativePath}...`);
    const result = await analyzeSource(source, ctx.paths.cacheDir, transcripts.find((transcript) => transcript.sourceId === source.id));
    analysesBySource.set(source.id, result.analysis);
    operations.push(...result.operations);
    if (result.cacheHit) cacheHits += 1;
  }
  const validSourceIds = new Set(manifest.entries.map((source) => source.id));
  const analyses = [...analysesBySource.values()].filter((analysis) => validSourceIds.has(analysis.sourceId));
  await saveAnalyses(ctx.paths, ctx.project.id, analyses);
  if (operations.length > 0) await saveOperations(ctx.paths, operations);
  const report = {
    schemaVersion: 1,
    projectId: ctx.project.id,
    generatedAt: new Date().toISOString(),
    sourceCount: manifest.entries.length,
    transcriptCount: transcripts.length,
    sceneCount: analyses.reduce((count, analysis) => count + analysis.scenes.length, 0),
    diagnosticCount: analyses.reduce((count, analysis) => count + analysis.diagnostics.length, 0),
    highlightCount: analyses.reduce((count, analysis) => count + analysis.highlights.length, 0),
    brollOpportunityCount: analyses.reduce((count, analysis) => count + analysis.brollOpportunities.length, 0),
    cacheHits,
    changedSourceIds: refreshed.changedSourceIds,
    removedSourceIds: refreshed.removedSourceIds,
  };
  await atomicWriteFile(join(ctx.paths.reportsDir, "analysis-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  emitResult({ ok: true, status: "completed", report, operations }, `Analysis complete: ${report.sceneCount} scenes, ${report.diagnosticCount} diagnostics, ${report.transcriptCount} transcripts.`);
};

export const handleScenes: CommandHandler = async (args) => {
  const ctx = await context(flagValue(args, "--project"));
  const analyses = await loadAnalyses(ctx.paths);
  if (analyses.length === 0) throw new Error("No scene analysis exists. Run /analyze first.");
  const scenes = analyses.flatMap((analysis) => analysis.scenes);
  emitResult({ ok: true, status: "completed", scenes }, scenes.map((scene) => `${scene.id} ${scene.sourceStart.toFixed(2)}-${scene.sourceEnd.toFixed(2)} keep=${scene.keepScore.toFixed(2)} ${scene.description}`).join("\n"));
};

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArgs(args: string[], flagsWithValues: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (flagsWithValues.includes(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) positionals.push(value);
  }
  return positionals;
}

function parseRanges(value: string | undefined): SourceRangeInstruction[] {
  if (!value) return [];
  return value.split(",").map((item) => {
    const match = /^([^:]+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(item.trim());
    if (!match) throw new Error(`Invalid range ${item}; expected sourceId:start-end`);
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (!(start < end)) throw new Error(`Invalid range ${item}`);
    return { sourceId: match[1]!, start, end };
  });
}

function editOptions(args: string[], projectName: string, profile: EditProfile): AutomaticEditOptions {
  const target = flagValue(args, "--target-duration");
  const fpsValue = flagValue(args, "--fps");
  let fps: { numerator: number; denominator: number } | undefined;
  if (fpsValue) {
    const match = /^(\d+)(?:\/(\d+))?$/.exec(fpsValue);
    if (!match) throw new Error(`Invalid FPS ${fpsValue}; use 25 or 30000/1001`);
    fps = { numerator: Number(match[1]), denominator: Number(match[2] ?? 1) };
  }
  const chosenProfile = (flagValue(args, "--profile") ?? profile) as EditProfile;
  if (!["vlog", "talking_head", "tutorial", "interview", "short_vertical", "documentary", "cinematic", "custom"].includes(chosenProfile)) {
    throw new Error(`Unsupported edit profile: ${chosenProfile}`);
  }
  const options: AutomaticEditOptions = {
    profile: chosenProfile,
    timelineName: flagValue(args, "--name") ?? projectName,
    protectedSegments: parseRanges(flagValue(args, "--protect")),
    bannedSegments: parseRanges(flagValue(args, "--ban")),
  };
  if (target) {
    const targetValue = Number(target);
    if (!Number.isFinite(targetValue) || targetValue <= 0) throw new Error(`Invalid target duration: ${target}`);
    options.targetDurationSeconds = targetValue;
  }
  const aspect = flagValue(args, "--aspect");
  if (aspect) {
    if (!["16:9", "9:16", "1:1", "4:5"].includes(aspect)) throw new Error(`Unsupported aspect ratio: ${aspect}`);
    options.aspectRatio = aspect as NonNullable<AutomaticEditOptions["aspectRatio"]>;
  }
  if (fps) options.fps = fps;
  const pacing = flagValue(args, "--pacing");
  if (pacing) {
    if (!["slow", "balanced", "fast"].includes(pacing)) throw new Error(`Unsupported pacing: ${pacing}`);
    options.pacing = pacing as NonNullable<AutomaticEditOptions["pacing"]>;
  }
  const broll = flagValue(args, "--broll");
  if (broll) {
    if (!["none", "low", "medium", "high"].includes(broll)) throw new Error(`Unsupported B-roll frequency: ${broll}`);
    options.brollFrequency = broll as NonNullable<AutomaticEditOptions["brollFrequency"]>;
  }
  const musicLevel = flagValue(args, "--music-level");
  if (musicLevel) {
    const level = Number(musicLevel);
    if (!Number.isFinite(level) || level < -96 || level > 12) throw new Error(`Invalid music level: ${musicLevel}`);
    options.musicLevelDb = level;
  }
  const instruction = flagValue(args, "--instruction");
  if (instruction) options.keepInstructions = [instruction];
  return options;
}

async function loadPlan(paths: ProjectPaths): Promise<EditPlanV1> {
  if (!existsSync(paths.editPlanJson)) throw new Error("No edit plan exists. Run /edit plan first.");
  return JSON.parse(await readFile(paths.editPlanJson, "utf8")) as EditPlanV1;
}

async function createPlan(args: string[]): Promise<{ plan: EditPlanV1; validation: ReturnType<typeof validateEditPlan>; ai: boolean }> {
  const ctx = await context(flagValue(args, "--project"));
  const manifest = await loadSourceManifest(ctx.paths.sourceManifestJson);
  const analyses = await loadAnalyses(ctx.paths);
  if (analyses.length === 0) throw new Error("No analysis exists. Run /analyze first.");
  const transcripts = await loadTranscripts(ctx.paths);
  const options = editOptions(args, ctx.project.name, ctx.project.editProfile);
  const baseline = buildAutomaticEditPlan(ctx.project.id, manifest, analyses, transcripts, options);
  const deterministic = args.includes("--deterministic");
  const instruction = flagValue(args, "--instruction");
  const rules = await listRules(ctx.vaultPath);
  const plan = deterministic
    ? baseline
    : await refineEditPlanWithAi(baseline, manifest, analyses, transcripts, ctx.paths.root, {
        instructions: instruction ? [instruction] : [],
        styleRules: rules.map((rule) => rule.body),
      });
  const validation = validateEditPlan(plan, manifest, ctx.paths.root);
  if (!validation.valid) throw new Error(`Edit plan validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`);
  await atomicWriteFile(ctx.paths.editPlanJson, `${JSON.stringify(plan, null, 2)}\n`);
  await atomicWriteFile(join(ctx.paths.editPlansDir, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`);
  return { plan, validation, ai: !deterministic };
}

export const handleEdit: CommandHandler = async (args) => {
  const subcommand = args[0]?.toLocaleLowerCase("en-US") ?? "status";
  if (subcommand === "plan") {
    const result = await createPlan(args.slice(1));
    emitResult({ ok: true, status: "completed", ai: result.ai, plan: result.plan, validation: result.validation }, `Edit plan created and validated: ${result.plan.tracks.reduce((count, track) => count + track.clips.length, 0)} clips.`);
    return;
  }
  const ctx = await context(flagValue(args, "--project"));
  const manifest = await loadSourceManifest(ctx.paths.sourceManifestJson);
  const plan = await loadPlan(ctx.paths);
  if (subcommand === "validate") {
    const validation = validateEditPlan(plan, manifest, ctx.paths.root);
    await atomicWriteFile(join(ctx.paths.editPlansDir, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`);
    if (!validation.valid) throw new Error(`Edit plan is invalid: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    emitResult({ ok: true, status: "completed", validation }, "Edit plan is valid.");
    return;
  }
  if (subcommand === "build") {
    const validation = validateEditPlan(plan, manifest, ctx.paths.root);
    if (!validation.valid) throw new Error(`Edit plan is invalid: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const timeline = compileTimeline(plan, manifest, ctx.paths.root);
    await atomicWriteFile(ctx.paths.compiledTimelineJson, `${JSON.stringify(timeline, null, 2)}\n`);
    emitResult({ ok: true, status: "completed", timeline }, `Compiled timeline: ${timeline.durationFrames} frames across ${timeline.tracks.length} tracks.`);
    return;
  }
  if (subcommand === "status") {
    const validation = validateEditPlan(plan, manifest, ctx.paths.root);
    emitResult({ ok: true, status: validation.valid ? "completed" : "failed", validation, compiled: existsSync(ctx.paths.compiledTimelineJson) }, `Edit plan: ${validation.valid ? "valid" : "invalid"}; compiled: ${existsSync(ctx.paths.compiledTimelineJson) ? "yes" : "no"}.`);
    return;
  }
  throw new Error("Usage: /edit plan|validate|build|status");
};

async function exportResolve(replace: boolean, slugArg?: string): Promise<{ report: Awaited<ReturnType<typeof exportResolveBundle>>; validation: unknown }> {
  const ctx = await context(slugArg);
  const manifest = await loadSourceManifest(ctx.paths.sourceManifestJson);
  for (const source of manifest.entries) await verifySourceRecord(ctx.paths.root, source);
  const plan = await loadPlan(ctx.paths);
  const planValidation = validateEditPlan(plan, manifest, ctx.paths.root);
  if (!planValidation.valid) throw new Error(`Edit plan is invalid: ${planValidation.issues.map((issue) => issue.message).join("; ")}`);
  const timeline = compileTimeline(plan, manifest, ctx.paths.root);
  await atomicWriteFile(ctx.paths.compiledTimelineJson, `${JSON.stringify(timeline, null, 2)}\n`);
  const report = await exportResolveBundle(ctx.paths, manifest, plan, timeline, planValidation, { replace });
  const fcpxmlValidation = await validateFcpxmlFile(ctx.paths.timelineFcpxml);
  const validation = { valid: planValidation.valid && fcpxmlValidation.valid, checkedAt: new Date().toISOString(), editPlan: planValidation, fcpxml: fcpxmlValidation };
  await atomicWriteFile(ctx.paths.validationReportJson, `${JSON.stringify(validation, null, 2)}\n`);
  if (!fcpxmlValidation.valid) throw new Error(`Generated FCPXML failed validation: ${fcpxmlValidation.errors.join("; ")}`);
  return { report, validation };
}

export const handleExport: CommandHandler = async (args) => {
  const subcommand = args[0]?.toLocaleLowerCase("en-US") ?? "resolve";
  if (subcommand === "resolve") {
    const result = await exportResolve(false, flagValue(args, "--project"));
    emitResult({ ok: true, status: "completed", ...result }, `Resolve export ready: ${result.report.files[0]}`);
    return;
  }
  if (subcommand === "retry") {
    const result = await exportResolve(true, flagValue(args, "--project"));
    emitResult({ ok: true, status: "completed", ...result }, `Resolve export regenerated with backups: ${result.report.files[0]}`);
    return;
  }
  if (subcommand === "validate") {
    const ctx = await context(flagValue(args, "--project"));
    const validation = await validateFcpxmlFile(ctx.paths.timelineFcpxml);
    if (!validation.valid) throw new Error(`FCPXML is invalid: ${validation.errors.join("; ")}`);
    emitResult({ ok: true, status: "completed", validation }, "FCPXML is valid and all media are online.");
    return;
  }
  if (subcommand === "reveal") {
    const ctx = await context(flagValue(args, "--project"));
    if (!existsSync(ctx.paths.timelineFcpxml)) throw new Error(`FCPXML does not exist: ${ctx.paths.timelineFcpxml}`);
    const executable = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const revealArgs = process.platform === "win32"
      ? [`/select,${ctx.paths.timelineFcpxml}`]
      : process.platform === "darwin"
        ? ["-R", ctx.paths.timelineFcpxml]
        : [ctx.paths.exportBundleDir];
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(executable, revealArgs, { shell: false, detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", rejectPromise);
      child.once("spawn", () => {
        child.unref();
        resolvePromise();
      });
    });
    emitResult({ ok: true, status: "completed", path: ctx.paths.timelineFcpxml }, `Revealed ${ctx.paths.timelineFcpxml}`);
    return;
  }
  throw new Error("Usage: /export resolve|validate|reveal|retry");
};
