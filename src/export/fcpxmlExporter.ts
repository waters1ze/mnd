import { constants as fsConstants, existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CompiledClip,
  CompiledTimelineV1,
  EditPlanV1,
  EditPlanValidationReport,
  SourceManifest,
  SourceRecord,
  SubtitleCue,
  TrackKind,
} from "../types/production.js";
import type { ProjectPaths } from "../core/projectPaths.js";
import { atomicWriteFile, backupFile } from "../core/atomic.js";
import { hashFileStream } from "../core/sourceManifest.js";

export interface ResolveExportOptions {
  replace?: boolean;
}

export interface ResolveExportReport {
  schemaVersion: 1;
  createdAt: string;
  fcpxmlVersion: "1.10";
  projectId: string;
  timelineName: string;
  timelineDurationFrames: number;
  mediaCount: number;
  clipCount: number;
  subtitleCount: number;
  files: string[];
  warnings: string[];
}

function xml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function frameTime(frames: number, timeline: CompiledTimelineV1): string {
  if (!Number.isSafeInteger(frames)) throw new Error(`Unsafe FCPXML frame value ${frames}`);
  if (frames === 0) return "0s";
  const numerator = BigInt(frames) * BigInt(timeline.fps.denominator);
  const denominator = BigInt(timeline.fps.numerator);
  const divisor = gcd(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}s`;
}

function parseTimecodeToFrames(tc: string, fps: { numerator: number, denominator: number }): number | null {
  const parts = tc.split(":");
  if (parts.length < 4) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = Number(parts[2]);
  const ff = Number(parts[3]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ff)) return null;
  const fpsNum = Math.round(fps.numerator / fps.denominator);
  return (hh * 3600 + mm * 60 + ss) * fpsNum + ff;
}

function sourceDurationFrames(source: SourceRecord, timeline: CompiledTimelineV1, minFrames = 0): number {
  if (source.kind === "image") return Math.max(timeline.durationFrames, 1);
  const frames = Math.ceil(source.durationSeconds * timeline.fps.numerator / timeline.fps.denominator - 1e-9);
  return Math.max(frames, minFrames, 1);
}

function audioRole(kind: TrackKind): string {
  if (kind === "music") return "music";
  if (kind === "sound_effects") return "effects";
  return "dialogue";
}

function resourceId(index: number): string {
  return `r${index + 2}`;
}

function clipAdjustments(clip: CompiledClip, timeline: CompiledTimelineV1): string[] {
  const lines: string[] = [];
  if (clip.speed !== 1) {
    lines.push("<timeMap>");
    lines.push(`<timept time="0s" value="${frameTime(clip.sourceStartFrames, timeline)}" interp="linear"/>`);
    lines.push(`<timept time="${frameTime(clip.timelineDurationFrames, timeline)}" value="${frameTime(clip.sourceStartFrames + clip.sourceDurationFrames, timeline)}" interp="linear"/>`);
    lines.push("</timeMap>");
  }
  if (clip.audio.enabled) {
    if (clip.audio.loudness) {
      lines.push(`<adjust-loudness amount="${xml(clip.audio.loudness.amount)}" uniformity="${xml(clip.audio.loudness.uniformity)}"/>`);
    }
    if (clip.audio.noiseReductionAmount !== undefined && clip.audio.noiseReductionAmount > 0) {
      lines.push(`<adjust-noiseReduction amount="${xml(clip.audio.noiseReductionAmount)}"/>`);
    }
    if (clip.audio.eqMode && clip.audio.eqMode !== "flat") {
      lines.push(`<adjust-EQ mode="${xml(clip.audio.eqMode)}"/>`);
    }
  }
  const transform = clip.transform;
  if (transform.scale !== 1 || transform.positionX !== 0 || transform.positionY !== 0 || transform.rotation !== 0) {
    lines.push(`<adjust-transform position="${xml(`${transform.positionX} ${transform.positionY}`)}" scale="${xml(`${transform.scale} ${transform.scale}`)}" rotation="${xml(transform.rotation)}"/>`);
  }
  if (transform.opacity !== 1) lines.push(`<adjust-opacity amount="${xml(transform.opacity)}"/>`);
  if (clip.audio.enabled) {
    const hasFades = clip.audio.fadeInSeconds > 0 || clip.audio.fadeOutSeconds > 0;
    if (!hasFades) {
      if (clip.audio.gainDb !== 0) lines.push(`<adjust-volume amount="${xml(clip.audio.gainDb)}dB"/>`);
    } else {
      const duration = clip.timelineDurationFrames;
      const fadeInFrames = Math.min(duration, Math.round(clip.audio.fadeInSeconds * timeline.fps.numerator / timeline.fps.denominator));
      const fadeOutFrames = Math.min(duration, Math.round(clip.audio.fadeOutSeconds * timeline.fps.numerator / timeline.fps.denominator));
      const steadyEnd = Math.max(fadeInFrames, duration - fadeOutFrames);
      lines.push(`<adjust-volume amount="${xml(clip.audio.gainDb)}dB">`);
      lines.push("<keyframeAnimation>");
      if (fadeInFrames > 0) {
        lines.push('<keyframe time="0s" value="-96dB" interp="easeIn"/>');
        lines.push(`<keyframe time="${frameTime(fadeInFrames, timeline)}" value="${xml(clip.audio.gainDb)}dB" interp="easeOut"/>`);
      }
      if (fadeOutFrames > 0) {
        lines.push(`<keyframe time="${frameTime(steadyEnd, timeline)}" value="${xml(clip.audio.gainDb)}dB" interp="easeIn"/>`);
        lines.push(`<keyframe time="${frameTime(duration, timeline)}" value="-96dB" interp="easeOut"/>`);
      }
      lines.push("</keyframeAnimation>");
      lines.push("</adjust-volume>");
    }
  }
  return lines;
}

function renderAssetClip(
  clip: CompiledClip,
  kind: TrackKind,
  source: SourceRecord,
  ref: string,
  timeline: CompiledTimelineV1,
  connected: boolean,
  children: string[] = [],
): string[] {
  const tcTimecode = source.tags?.timecode;
  const tcFrames = tcTimecode ? parseTimecodeToFrames(tcTimecode, timeline.fps) ?? 0 : 0;
  
  const attributes = [
    `name="${xml(basename(source.canonicalPath))}"`,
    `ref="${ref}"`,
    `offset="${frameTime(clip.timelineStartFrames, timeline)}"`,
    `start="${frameTime(clip.sourceStartFrames + tcFrames, timeline)}"`,
    `duration="${frameTime(clip.timelineDurationFrames, timeline)}"`,
    `audioRole="${audioRole(kind)}"`,
  ];
  if (connected && clip.lane !== 0) attributes.push(`lane="${clip.lane}"`);
  const nested = [...clipAdjustments(clip, timeline), ...children];
  if (nested.length === 0) return [`<asset-clip ${attributes.join(" ")}/>`];
  return [`<asset-clip ${attributes.join(" ")}>`, ...nested, "</asset-clip>"];
}

function attachConnectedClips(
  primary: CompiledClip,
  connected: Array<{ clip: CompiledClip; kind: TrackKind }>,
  sources: Map<string, SourceRecord>,
  refs: Map<string, string>,
  timeline: CompiledTimelineV1,
): string[] {
  const children: string[] = [];
  for (const item of connected) {
    if (item.clip.timelineStartFrames < primary.timelineStartFrames || item.clip.timelineStartFrames >= primary.timelineStartFrames + primary.timelineDurationFrames) continue;
    const source = sources.get(item.clip.sourceId)!;
    const ref = refs.get(item.clip.sourceId)!;
    children.push(...renderAssetClip(item.clip, item.kind, source, ref, timeline, true));
  }
  return children;
}

export function generateFcpxml(
  timeline: CompiledTimelineV1,
  manifest: SourceManifest,
): string {
  const sources = new Map(manifest.entries.map((source) => [source.id, source]));
  const orderedSources = [...manifest.entries].sort((left, right) => left.id.localeCompare(right.id));
  const refs = new Map(orderedSources.map((source, index) => [source.id, resourceId(index)]));
  const hasTransitions = timeline.tracks.some((track) => track.clips.some((clip) => clip.transitionIn || clip.transitionOut));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '<resources>',
    `<format id="r1" name="FFVideoFormat${timeline.resolution.height}p" frameDuration="${frameTime(1, timeline)}" width="${timeline.resolution.width}" height="${timeline.resolution.height}" colorSpace="1-1-1 (Rec. 709)"/>`,
  ];
  // Pre-compute the maximum sourceEnd (in frames) actually used from each source
  // across all tracks. This ensures the asset duration always covers what's cut,
  // even if the manifest's durationSeconds is stale or underreported by ffprobe.
  const maxSourceEndFrames = new Map<string, number>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const prev = maxSourceEndFrames.get(clip.sourceId) ?? 0;
      maxSourceEndFrames.set(clip.sourceId, Math.max(prev, clip.sourceStartFrames + clip.sourceDurationFrames));
    }
  }

  for (const [index, source] of orderedSources.entries()) {
    const ref = resourceId(index);
    const minFrames = maxSourceEndFrames.get(source.id) ?? 0;
    const tcTimecode = source.tags?.timecode;
    const tcFrames = tcTimecode ? parseTimecodeToFrames(tcTimecode, timeline.fps) ?? 0 : 0;
    
    const attributes = [
      `id="${ref}"`, `name="${xml(basename(source.canonicalPath))}"`, `uid="${xml(source.sha256)}"`,
      `start="${frameTime(tcFrames, timeline)}"`, `duration="${frameTime(sourceDurationFrames(source, timeline, minFrames), timeline)}"`,
      `hasVideo="${source.videoStreams.length > 0 || source.kind === "image" ? 1 : 0}"`,
      `hasAudio="${source.audioStreams.length > 0 ? 1 : 0}"`,
    ];
    if (tcFrames > 0) attributes.push(`tcStart="${frameTime(tcFrames, timeline)}"`, `tcFormat="NDF"`);
    if (source.videoStreams.length > 0 || source.kind === "image") attributes.push('format="r1"');
    if (source.audioStreams.length > 0) {
      attributes.push(`audioSources="1"`, `audioChannels="${Math.max(1, source.channels)}"`, `audioRate="${source.sampleRate || timeline.audioSampleRate}"`);
    }
    lines.push(`<asset ${attributes.join(" ")}>`);
    lines.push(`<media-rep kind="original-media" sig="${xml(source.sha256)}" src="${xml(pathToFileURL(source.canonicalPath).href)}"/>`);
    lines.push("</asset>");
  }
  if (hasTransitions) {
    lines.push('<effect id="r-transition-cross" name="Cross Dissolve" uid=".../Transitions.localized/Dissolves.localized/Cross Dissolve.localized/Cross Dissolve.motn"/>');
  }
  lines.push("</resources>", `<library location="${xml(pathToFileURL(resolve(".")).href)}">`, '<event name="MND Export">', `<project name="${xml(timeline.name)}">`);
  lines.push(`<sequence format="r1" duration="${frameTime(timeline.durationFrames, timeline)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="${timeline.audioSampleRate >= 96000 ? "96k" : "48k"}">`, "<spine>");

  const primaryTrack = timeline.tracks.find((track) => track.kind === "primary_video" && track.lane === 0);
  const connected = timeline.tracks
    .filter((track) => track.lane !== 0)
    .flatMap((track) => track.clips.map((clip) => ({ clip, kind: track.kind })))
    .sort((left, right) => left.clip.timelineStartFrames - right.clip.timelineStartFrames || left.clip.lane - right.clip.lane || left.clip.id.localeCompare(right.clip.id));

  if (!primaryTrack || primaryTrack.clips.length === 0) {
    lines.push(`<gap name="MND Timeline" offset="0s" start="0s" duration="${frameTime(Math.max(timeline.durationFrames, 1), timeline)}">`);
    for (const item of connected) {
      const source = sources.get(item.clip.sourceId);
      const ref = refs.get(item.clip.sourceId);
      if (!source || !ref) throw new Error(`Compiled clip ${item.clip.id} references unavailable source ${item.clip.sourceId}`);
      lines.push(...renderAssetClip(item.clip, item.kind, source, ref, timeline, true));
    }
    lines.push("</gap>");
  } else {
    let cursor = 0;
    let previousClip: CompiledClip | undefined;
    for (const clip of primaryTrack.clips) {
      if (clip.timelineStartFrames > cursor) {
        lines.push(`<gap name="Gap" offset="${frameTime(cursor, timeline)}" start="0s" duration="${frameTime(clip.timelineStartFrames - cursor, timeline)}"/>`);
      }
      if (previousClip && previousClip.timelineStartFrames + previousClip.timelineDurationFrames === clip.timelineStartFrames) {
        const transition = clip.transitionIn?.type === "cross_dissolve" ? clip.transitionIn : previousClip.transitionOut?.type === "cross_dissolve" ? previousClip.transitionOut : null;
        if (transition) {
          const transitionFrames = Math.max(1, Math.round(transition.durationSeconds * timeline.fps.numerator / timeline.fps.denominator));
          const transitionStart = Math.max(0, clip.timelineStartFrames - Math.floor(transitionFrames / 2));
          lines.push(`<transition name="Cross Dissolve" offset="${frameTime(transitionStart, timeline)}" duration="${frameTime(transitionFrames, timeline)}"><filter-video ref="r-transition-cross"/></transition>`);
        }
      }
      const source = sources.get(clip.sourceId);
      const ref = refs.get(clip.sourceId);
      if (!source || !ref) throw new Error(`Compiled clip ${clip.id} references unavailable source ${clip.sourceId}`);
      const children = attachConnectedClips(clip, connected, sources, refs, timeline);
      lines.push(...renderAssetClip(clip, primaryTrack.kind, source, ref, timeline, false, children));
      cursor = clip.timelineStartFrames + clip.timelineDurationFrames;
      previousClip = clip;
    }
  }
  lines.push("</spine>", "</sequence>", "</project>", "</event>", "</library>", "</fcpxml>");
  return `${lines.map((line, index) => `${"  ".repeat(Math.min(index > 2 ? 2 : index, 2))}${line}`).join("\n")}\n`;
}

function srtTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function generateSrt(cues: SubtitleCue[]): string {
  return `${[...cues]
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text.trim()}\n`)
    .join("\n")}\n`;
}

async function safeWrite(path: string, data: string, replace: boolean, backupDir: string): Promise<void> {
  if (existsSync(path)) {
    // if (!replace) throw new Error(`Export file already exists: ${path}. Use /export retry to replace it with a backup.`);
    await backupFile(path, backupDir, "pre-export");
  }
  await atomicWriteFile(path, data, { overwrite: true });
}

async function copyReferencedAssets(plan: EditPlanV1, paths: ProjectPaths, replace: boolean): Promise<string[]> {
  const copied: string[] = [];
  for (const asset of [...plan.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = resolve(paths.root, asset.relativePath);
    const category = asset.kind === "title" ? "titles" : asset.kind === "overlay" ? "overlays" : asset.kind === "audio" ? "audio" : "images";
    const destination = join(paths.exportBundleDir, "Assets", category, basename(source));
    await mkdir(join(paths.exportBundleDir, "Assets", category), { recursive: true });
    if (existsSync(destination)) {
      const [sourceHash, destinationHash] = await Promise.all([hashFileStream(source), hashFileStream(destination)]);
      if (sourceHash === destinationHash) {
        copied.push(destination);
        continue;
      }
      if (!replace) throw new Error(`Export asset conflict: ${destination}`);
      await backupFile(destination, paths.backupsDir, "pre-export");
    }
    await copyFile(source, destination, replace ? 0 : fsConstants.COPYFILE_EXCL);
    copied.push(destination);
  }
  return copied;
}

async function copyArtifactIfPresent(source: string, destination: string, replace: boolean, backupDir: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  const content = await readFile(source);
  // if (existsSync(destination) && !replace) throw new Error(`Export file already exists: ${destination}`);
  if (existsSync(destination)) await backupFile(destination, backupDir, "pre-export");
  await atomicWriteFile(destination, content, { overwrite: true });
  return true;
}

export async function exportResolveBundle(
  paths: ProjectPaths,
  manifest: SourceManifest,
  plan: EditPlanV1,
  timeline: CompiledTimelineV1,
  validation: EditPlanValidationReport,
  options: ResolveExportOptions = {},
): Promise<ResolveExportReport> {
  if (!validation.valid) throw new Error("Cannot export an invalid edit plan");
  const replace = options.replace ?? false;
  await mkdir(paths.exportBundleDir, { recursive: true });
  for (const category of ["titles", "overlays", "images", "thumbnails", "audio"]) {
    await mkdir(join(paths.exportBundleDir, "Assets", category), { recursive: true });
  }

  const files: string[] = [];
  const fcpxml = generateFcpxml(timeline, manifest);
  await safeWrite(paths.timelineFcpxml, fcpxml, replace, paths.backupsDir);
  files.push(paths.timelineFcpxml);
  await safeWrite(paths.subtitlesSrt, generateSrt(plan.subtitles), replace, paths.backupsDir);
  files.push(paths.subtitlesSrt);
  const artifacts: Array<[string, string]> = [
    [paths.transcriptJson, join(paths.exportBundleDir, "transcript.json")],
    [paths.scenesJson, join(paths.exportBundleDir, "scenes.json")],
    [paths.compiledTimelineJson, join(paths.exportBundleDir, "compiled-timeline.json")],
  ];
  await safeWrite(join(paths.exportBundleDir, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, replace, paths.backupsDir);
  files.push(join(paths.exportBundleDir, "source-manifest.json"));
  await safeWrite(join(paths.exportBundleDir, "edit-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, replace, paths.backupsDir);
  files.push(join(paths.exportBundleDir, "edit-plan.json"));
  for (const [source, destination] of artifacts) {
    if (await copyArtifactIfPresent(source, destination, replace, paths.backupsDir)) files.push(destination);
  }
  await safeWrite(paths.validationReportJson, `${JSON.stringify(validation, null, 2)}\n`, replace, paths.backupsDir);
  files.push(paths.validationReportJson);
  files.push(...await copyReferencedAssets(plan, paths, replace));
  const effectsRoot = resolve(paths.exportBundleDir, "Assets", "effects");
  for (const source of manifest.entries) {
    const canonical = resolve(source.canonicalPath);
    if (canonical === effectsRoot || canonical.startsWith(`${effectsRoot}${process.platform === "win32" ? "\\" : "/"}`)) files.push(source.canonicalPath);
  }

  const readme = [
    "MND Resolve Import", "", "1. Open DaVinci Resolve and create or open a project.",
    "2. Choose File > Import > Timeline.", "3. Select final-timeline.fcpxml from this directory.",
    "4. Leave media location matching enabled. All source URIs are absolute and percent-encoded.",
    "5. If captions were not imported by your Resolve version, import subtitles.srt into the media pool and subtitle track.",
    "6. Review the validation-report.json warnings before delivery.", "",
    `Timeline: ${timeline.name}`, `Frames: ${timeline.durationFrames}`, `FPS: ${timeline.fps.numerator}/${timeline.fps.denominator}`,
  ].join("\r\n");
  await safeWrite(paths.importReadme, `${readme}\r\n`, replace, paths.backupsDir);
  files.push(paths.importReadme);

  const report: ResolveExportReport = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    fcpxmlVersion: "1.10",
    projectId: timeline.projectId,
    timelineName: timeline.name,
    timelineDurationFrames: timeline.durationFrames,
    mediaCount: manifest.entries.length,
    clipCount: timeline.tracks.reduce((count, track) => count + track.clips.length, 0),
    subtitleCount: timeline.subtitles.length,
    files: files.map((file) => file.replace(/\\/g, "/")),
    warnings: timeline.warnings,
  };
  await safeWrite(paths.exportReportJson, `${JSON.stringify(report, null, 2)}\n`, replace, paths.backupsDir);
  return report;
}
