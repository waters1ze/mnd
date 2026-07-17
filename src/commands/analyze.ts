// src/commands/analyze.ts
import { join } from "node:path";
import chalk from "chalk";
import { loadConfig, resolveVaultPath, getActiveProfile } from "../core/config.js";
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

export const handleAnalyze: CommandHandler = async (_args, rawInput) => {
  const cfg = await loadConfig();
  const vaultPath = resolveVaultPath(cfg);
  const slug = session.currentProjectSlug;

  if (!slug) {
    console.log(chalk.yellow("No project open. Use `open` or `create` first."));
    return;
  }

  const projectDir = join(vaultPath, "Projects", slug);
  const rawDir = join(projectDir, "raw");
  const framesDir = join(projectDir, ".mnd", "frames");

  // Find first video in raw/
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(rawDir).catch(() => []);
  const videoExt = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
  const videoFile = files.find((f) => videoExt.some((e) => f.toLowerCase().endsWith(e)));

  if (!videoFile) {
    console.log(chalk.yellow(`No video file found in ${rawDir}`));
    console.log(chalk.gray("Place your source video in the project's raw/ folder first."));
    return;
  }

  const videoPath = join(rawDir, videoFile);

  // Load state
  const state = await loadProjectState(vaultPath, slug);
  setLogPath(slug, vaultPath);

  // Load style + rules
  const styles = await listStyles(vaultPath);
  const { readFrontmatter: rf } = await import("../core/vault.js");
  const projectMd = join(projectDir, "project.md");
  const { data: projFm } = await rf(projectMd);
  const style = styles.find((s) => s.name === (projFm as { style?: string }).style) ?? styles[0];

  const rules = await listRules(vaultPath);

  // Cost estimate (only for hybrid profile + long videos)
  const VIDEO_THRESHOLD_SEC = 600; // 10 min
  let videoLength = 999;
  try {
    const { execSync } = await import("node:child_process");
    const dur = execSync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: "utf-8" }
    ).trim();
    videoLength = parseFloat(dur) || 999;
  } catch { /* estimate unavailable */ }

  if (videoLength > VIDEO_THRESHOLD_SEC) {
    const ok = await confirmCostEstimate(`analyze ${slug}`, videoLength, 20);
    if (!ok) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  // Run pipeline via task list
  await runTaskList("Analyzing video", [
    {
      title: "Transcribing audio",
      task: async () => {
        const segs = await transcribeStep(videoPath, state, vaultPath);
        state.stepOutputs["transcribe"] = segs;
      },
    },
    {
      title: "Detecting pauses & fillers",
      task: async () => {
        const segs = (state.stepOutputs["transcribe"] as typeof state.editPlan extends null ? never : unknown[]) ?? [];
        await detectPausesAndFillers(segs as Parameters<typeof detectPausesAndFillers>[0], state, vaultPath);
      },
    },
    {
      title: "Selecting keyframes",
      task: async () => {
        const segs = (state.stepOutputs["transcribe"] ?? []) as Parameters<typeof selectKeyframesStep>[1];
        await selectKeyframesStep(videoPath, segs, state, vaultPath, framesDir);
      },
    },
    {
      title: "Analyzing frames (vision)",
      task: async () => {
        const frames = (state.stepOutputs["keyframes"] ?? []) as Parameters<typeof visionAnalyzeStep>[0];
        await visionAnalyzeStep(frames, state, vaultPath);
      },
    },
    {
      title: "Matching style & rules",
      task: async () => {
        if (style) {
          const segs = (state.stepOutputs["transcribe"] ?? []) as Parameters<typeof matchStyleRules>[2];
          const frames = (state.stepOutputs["vision"] ?? []) as Parameters<typeof matchStyleRules>[3];
          const ctx = matchStyleRules(style, rules, segs, frames);
          state.stepOutputs["rules"] = ctx;
        }
      },
    },
    {
      title: "Building edit plan (LLM)",
      task: async () => {
        const segs = (state.stepOutputs["transcribe"] ?? []) as Parameters<typeof buildEditPlanStep>[2];
        const cuts = (state.stepOutputs["pauses"] ?? []) as Parameters<typeof buildEditPlanStep>[3];
        const ctx = (state.stepOutputs["rules"] ?? { styleBody: "", styleFrontmatter: { id: "default", skills: [], updated: "" }, applicableRules: [], transcriptSummary: "", frameSummary: "" }) as Parameters<typeof buildEditPlanStep>[4];
        const version = (state.editPlan?.version ?? 0) + 1;
        await buildEditPlanStep(slug, videoPath, segs, cuts, ctx, state, vaultPath, version);
      },
    },
  ]);

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
  console.log(chalk.gray(`\n  Use \`prompt "..."\ to refine, \`approve\` to export.`));
};
