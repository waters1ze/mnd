// src/commands/analyze.ts
import { join } from "node:path";
import chalk from "chalk";
import { loadConfig, resolveVaultPath } from "../core/config.js";
import { loadProjectState, saveProjectState } from "../core/projectState.js";
import { setLogPath } from "../core/runLog.js";
import { confirmCostEstimate } from "../core/costEstimate.js";
import { transcribeStep } from "../pipeline/transcribe.js";
import { detectPausesAndFillers } from "../pipeline/detectPausesAndFillers.js";
import { selectKeyframesStep } from "../pipeline/selectKeyframes.js";
import { visionAnalyzeStep } from "../pipeline/visionAnalyze.js";
import { matchStyleRules } from "../pipeline/matchStyleRules.js";
import { buildEditPlanStep } from "../pipeline/buildEditPlan.js";
import { listStyles, listRules } from "../core/vault.js";
import { runTaskList } from "../ui/taskList.js";
import { session } from "../repl/loop.js";
import { theme } from "../ui/theme.js";
import type { CommandHandler } from "../repl/router.js";
import { runAnalyzePreflight } from "../pipeline/preflight.js";
import { acquireProjectLock, releaseProjectLock } from "../core/projectLock.js";
import { resetCancellation, isCancellationRequested, setupSignalHandlers } from "../core/cancellation.js";
import { getProjectPaths } from "../core/projectPaths.js";
import crypto from "node:crypto";
import type { PipelineStep } from "../types/pipeline.js";

const PIPELINE_ORDER: PipelineStep[] = ["transcribe", "pauses", "keyframes", "vision", "rules", "plan"];

function parseFlags(args: string[]) {
  const flags = {
    preflightOnly: false,
    yes: false,
    offline: false,
    profile: "hybrid", // Default or let config decide
    resume: false,
    restart: false,
    from: null as PipelineStep | null,
    only: null as PipelineStep | null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--preflight-only") flags.preflightOnly = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--offline") { flags.offline = true; flags.profile = "local"; }
    else if (a === "--resume") flags.resume = true;
    else if (a === "--restart") flags.restart = true;
    else if (a === "--profile" && args[i + 1]) {
      flags.profile = args[i + 1] as string;
      i++;
    }
    else if (a === "--from" && args[i + 1]) {
      flags.from = args[i + 1] as PipelineStep;
      i++;
    }
    else if (a === "--only" && args[i + 1]) {
      flags.only = args[i + 1] as PipelineStep;
      i++;
    }
  }

  return flags;
}

export const handleAnalyze: CommandHandler = async (args, rawInput) => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const slug = session.currentProjectSlug;

  if (!slug) {
    console.log(chalk.yellow("No project open. Use `open` or `create` first."));
    return;
  }

  const flags = parseFlags(args);

  // If both restart and resume provided, error
  if (flags.restart && flags.resume) {
    console.log(chalk.red("Cannot specify both --resume and --restart."));
    return;
  }

  // Set up cancellation registry for this run
  resetCancellation();
  setupSignalHandlers();

  const runId = crypto.randomUUID();
  const locked = await acquireProjectLock(vaultPath, slug, runId);
  if (!locked) {
    console.log(chalk.red(`\n[!] Project '${slug}' is currently locked by another analyze process.`));
    console.log(chalk.yellow("If you are sure no other process is running, you can manually delete the .mnd/lock.json file."));
    return;
  }

  try {
    const paths = getProjectPaths(vaultPath, slug);

    // Load state
    const state = await loadProjectState(vaultPath, slug);
    state.runId = runId;
    if (flags.restart) {
      state.lastCompletedStep = null;
      state.steps = {};
      state.editPlan = null;
      state.stepOutputs = {};
    }
    setLogPath(slug, vaultPath);

    try {
      await runAnalyzePreflight(vaultPath, slug, { profile: flags.profile });
    } catch (e: any) {
      console.log(chalk.red(e.message));
      return;
    }

    if (flags.preflightOnly) {
      return;
    }

    // Find video
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(paths.rawDir).catch(() => []);
    const videoExt = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
    const videoFile = files.find((f) => videoExt.some((e) => f.toLowerCase().endsWith(e)));
    if (!videoFile) return;

    const videoPath = join(paths.rawDir, videoFile);
    const relVideoPath = join("raw", videoFile);

    if (!state.sourceManifest) {
      state.sourceManifest = {};
    }

    if (!state.sourceManifest[relVideoPath]) {
      const { createReadStream } = await import("node:fs");
      const { stat } = await import("node:fs/promises");
      const hash = crypto.createHash("sha256");
      const fstat = await stat(videoPath);
      
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(videoPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => {
          state.sourceManifest[relVideoPath] = {
             hash: hash.digest("hex"),
             size: fstat.size,
             mtime: fstat.mtime.toISOString()
          };
          resolve();
        });
        stream.on("error", reject);
      });
      await saveProjectState(vaultPath, state);
    }

    // Cost estimate
    const VIDEO_THRESHOLD_SEC = 600;
    let videoLength = 999;
    try {
      const { getMediaDuration } = await import("../core/ffprobe.js");
      const dur = await getMediaDuration(videoPath);
      if (dur !== null) videoLength = dur;
    } catch { /* ignore */ }

    if (!flags.yes && flags.profile === "hybrid" && videoLength > VIDEO_THRESHOLD_SEC) {
      const ok = await confirmCostEstimate(`analyze ${slug}`, videoLength, 20);
      if (!ok) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    // Determine steps to run
    let stepsToRun = PIPELINE_ORDER;
    if (flags.only) {
      stepsToRun = [flags.only];
    } else if (flags.from) {
      const fromIdx = PIPELINE_ORDER.indexOf(flags.from);
      if (fromIdx !== -1) {
        stepsToRun = PIPELINE_ORDER.slice(fromIdx);
      }
    } else if (flags.resume) {
      const lastIdx = state.lastCompletedStep ? PIPELINE_ORDER.indexOf(state.lastCompletedStep) : -1;
      stepsToRun = PIPELINE_ORDER.slice(lastIdx + 1);
    }

    // Load style + rules
    const styles = await listStyles(vaultPath);
    const { readFrontmatter: rf } = await import("../core/vault.js");
    const { data: projFm } = await rf(paths.projectMd);
    const style = styles.find((s) => s.name === (projFm as { style?: string }).style) ?? styles[0];
    const rules = await listRules(vaultPath);

    // Helper to wrap tasks
    const wrapTask = (step: PipelineStep, taskFn: () => Promise<void>) => async () => {
      if (isCancellationRequested()) return;
      if (!stepsToRun.includes(step)) return;
      
      state.steps[step] = {
        status: "running",
        updatedAt: new Date().toISOString(),
        attempts: (state.steps[step]?.attempts || 0) + 1,
        outputPaths: []
      };
      await saveProjectState(vaultPath, state);

      try {
        await taskFn();
        if (isCancellationRequested()) {
          state.steps[step]!.status = "cancelled";
        } else {
          state.steps[step]!.status = "completed";
          state.lastCompletedStep = step;
        }
      } catch (e: any) {
        state.steps[step]!.status = "failed";
        state.steps[step]!.error = { code: "ERROR", message: e.message, retryable: true };
        await saveProjectState(vaultPath, state);
        throw e;
      }
      await saveProjectState(vaultPath, state);
    };

    // Run pipeline via task list
    await runTaskList("Analyzing video", [
      {
        title: "Transcribing audio",
        task: wrapTask("transcribe", async () => {
          const segs = await transcribeStep(videoPath, state, vaultPath);
          state.stepOutputs["transcribe"] = segs;
        }),
      },
      {
        title: "Detecting pauses & fillers",
        task: wrapTask("pauses", async () => {
          const segs = (state.stepOutputs["transcribe"] as unknown[]) ?? [];
          await detectPausesAndFillers(segs as any, state, vaultPath);
        }),
      },
      {
        title: "Selecting keyframes",
        task: wrapTask("keyframes", async () => {
          const segs = (state.stepOutputs["transcribe"] ?? []) as any;
          await selectKeyframesStep(videoPath, segs, state, vaultPath, paths.framesDir);
        }),
      },
      {
        title: "Analyzing frames (vision)",
        task: wrapTask("vision", async () => {
          const frames = (state.stepOutputs["keyframes"] ?? []) as any;
          await visionAnalyzeStep(frames, state, vaultPath);
        }),
      },
      {
        title: "Matching style & rules",
        task: wrapTask("rules", async () => {
          if (style) {
            const segs = (state.stepOutputs["transcribe"] ?? []) as any;
            const frames = (state.stepOutputs["vision"] ?? []) as any;
            const ctx = matchStyleRules(style, rules, segs, frames);
            state.stepOutputs["rules"] = ctx;
          }
        }),
      },
      {
        title: "Building edit plan (LLM)",
        task: wrapTask("plan", async () => {
          const segs = (state.stepOutputs["transcribe"] ?? []) as any;
          const cuts = (state.stepOutputs["pauses"] ?? []) as any;
          const ctx = (state.stepOutputs["rules"] ?? { styleBody: "", styleFrontmatter: { id: "default", skills: [], updated: "" }, applicableRules: [], transcriptSummary: "", frameSummary: "" }) as any;
          const version = (state.editPlan?.version ?? 0) + 1;
          await buildEditPlanStep(slug, videoPath, segs, cuts, ctx, state, vaultPath, version);
        }),
      },
    ]);

    if (isCancellationRequested()) {
      console.log(chalk.yellow("\n[!] Analysis cancelled."));
      return;
    }

    const plan = state.editPlan;
    if (!plan) {
      console.log(chalk.red("✗ Pipeline failed to produce an edit plan."));
      return;
    }

    // Print summary report
    console.log("\n" + chalk.hex(theme.accent)("─── Edit Plan Summary ───────────────────────────"));
    console.log(chalk.white(`  Project: ${plan.projectSlug}  v${plan.version}`));
    console.log(chalk.white(`  Cuts: ${plan.cuts.length}  (${plan.cuts.filter((c) => c.reason === "pause").length} pauses, ${plan.cuts.filter((c) => c.reason === "filler_word").length} fillers)`));
    console.log(chalk.white(`  Overlays: ${plan.overlays.length}`));
    console.log(chalk.gray(`\n  Use \`prompt "..."\` to refine, \`approve\` to export.`));

  } finally {
    await releaseProjectLock();
  }
};
