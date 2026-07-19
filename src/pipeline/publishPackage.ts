import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { atomicWriteFile } from "../core/atomic.js";
import { runAntigravityPrompt } from "../core/antigravityClient.js";
import type { ProjectPaths } from "../core/projectPaths.js";
import type { SourceAnalysis, SourceManifest, SourceRecord, TranscriptV1 } from "../types/production.js";

interface AntigravityPublishResponse {
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  thumbnail?: {
    sourceId?: unknown;
    atSeconds?: unknown;
    headline?: unknown;
    rationale?: unknown;
  };
}

export interface PublishPackageV1 {
  schemaVersion: 1;
  generatedAt: string;
  provider: "antigravity";
  model: string;
  title: string;
  description: string;
  tags: string[];
  thumbnail: {
    sourceId: string;
    sourceRelativePath: string;
    atSeconds: number;
    headline: string;
    rationale: string;
    fileName: "thumbnail.jpg";
    width: 1280;
    height: 720;
  };
}

export interface PublishPackageResult {
  publish: PublishPackageV1;
  thumbnailPath: string;
  publishJsonPath: string;
  publishMarkdownPath: string;
  titlePath: string;
  descriptionPath: string;
}

function extractJson(raw: string): AntigravityPublishResponse {
  const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("response does not contain a JSON object");
  return JSON.parse(stripped.slice(start, end + 1)) as AntigravityPublishResponse;
}

function singleLine(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${field} cannot be empty`);
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return normalized;
}

function descriptionText(value: unknown): string {
  if (typeof value !== "string") throw new Error("description must be a string");
  const normalized = value.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!normalized) throw new Error("description cannot be empty");
  if (normalized.length > 5_000) throw new Error("description exceeds 5000 characters");
  return normalized;
}

function publishableSources(manifest: SourceManifest): SourceRecord[] {
  const videos = manifest.entries.filter((entry) => entry.kind === "video" && entry.videoStreams.length > 0);
  if (videos.length > 0) return videos;
  return manifest.entries.filter((entry) => entry.kind === "image");
}

function bestFallbackSource(manifest: SourceManifest, analyses: SourceAnalysis[]): { source: SourceRecord; atSeconds: number } {
  const sources = publishableSources(manifest);
  if (sources.length === 0) throw new Error("A video or image source is required to create thumbnail.jpg");
  const byId = new Map(sources.map((source) => [source.id, source]));
  const bestScene = analyses
    .flatMap((analysis) => analysis.scenes)
    .filter((scene) => byId.has(scene.sourceId))
    .sort((left, right) => right.keepScore - left.keepScore)[0];
  const source = (bestScene && byId.get(bestScene.sourceId)) || sources[0]!;
  const requested = bestScene ? (bestScene.sourceStart + bestScene.sourceEnd) / 2 : Math.min(1, source.durationSeconds / 2);
  return { source, atSeconds: safeTimestamp(source, requested) };
}

function safeTimestamp(source: SourceRecord, requested: number): number {
  if (source.kind === "image") return 0;
  const upper = Math.max(0, source.durationSeconds - 0.05);
  return Number(Math.min(Math.max(0, requested), upper).toFixed(3));
}

export function validatePublishResponse(
  raw: string,
  manifest: SourceManifest,
  analyses: SourceAnalysis[],
): Omit<PublishPackageV1, "schemaVersion" | "generatedAt" | "provider" | "model"> {
  const parsed = extractJson(raw);
  const title = singleLine(parsed.title, "title", 140);
  const description = descriptionText(parsed.description);
  if (!Array.isArray(parsed.tags)) throw new Error("tags must be an array");
  const tags = [...new Set(parsed.tags.map((tag) => singleLine(tag, "tag", 60)))].slice(0, 20);
  if (tags.length < 3) throw new Error("at least three tags are required");

  const allowed = new Map(publishableSources(manifest).map((source) => [source.id, source]));
  if (!parsed.thumbnail || typeof parsed.thumbnail.sourceId !== "string") throw new Error("thumbnail.sourceId is required");
  const source = allowed.get(parsed.thumbnail.sourceId);
  if (!source) throw new Error(`thumbnail.sourceId must reference a video or image source: ${parsed.thumbnail.sourceId}`);
  const requestedAt = Number(parsed.thumbnail.atSeconds);
  if (!Number.isFinite(requestedAt)) throw new Error("thumbnail.atSeconds must be a finite number");
  if (source.kind === "video" && (requestedAt < 0 || requestedAt >= source.durationSeconds)) {
    throw new Error(`thumbnail.atSeconds must be inside 0-${source.durationSeconds}`);
  }
  return {
    title,
    description,
    tags,
    thumbnail: {
      sourceId: source.id,
      sourceRelativePath: source.relativePath,
      atSeconds: safeTimestamp(source, requestedAt),
      headline: singleLine(parsed.thumbnail.headline ?? title, "thumbnail.headline", 60),
      rationale: singleLine(parsed.thumbnail.rationale ?? "Selected by Antigravity", "thumbnail.rationale", 400),
      fileName: "thumbnail.jpg",
      width: 1280,
      height: 720,
    },
  };
}

function headlineFont(): string | undefined {
  const candidates = process.platform === "win32"
    ? ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf"]
    : process.platform === "darwin"
      ? ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"]
      : ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"];
  return candidates.find((candidate) => existsSync(candidate));
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

async function renderThumbnail(source: SourceRecord, atSeconds: number, headline: string, outputPath: string): Promise<void> {
  const executable = ffmpegPath as unknown as string | null;
  if (!executable) throw new Error("Bundled FFmpeg is unavailable");
  const args = ["-y"];
  if (source.kind === "video") args.push("-ss", String(atSeconds));
  const filters = [
    "scale=1280:720:force_original_aspect_ratio=increase",
    "crop=1280:720",
  ];
  const font = headlineFont();
  if (font) {
    const fontSize = Math.max(38, Math.min(68, Math.round(76 - Math.max(0, headline.length - 20) * 0.8)));
    filters.push(
      "drawbox=x=0:y=450:w=1280:h=270:color=black@0.62:t=fill",
      `drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(headline)}':expansion=none:fontcolor=white:fontsize=${fontSize}:x=60:y=h-text_h-82:shadowcolor=black@0.8:shadowx=3:shadowy=3`,
    );
  }
  args.push(
    "-i", source.canonicalPath,
    "-frames:v", "1",
    "-vf", filters.join(","),
    "-q:v", "2",
    outputPath,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg thumbnail render failed (${code}): ${stderr.slice(-2_000)}`)));
  });
  const output = await stat(outputPath);
  if (!output.isFile() || output.size === 0) throw new Error("FFmpeg produced an empty thumbnail");
}

function buildPrompt(
  userPrompt: string,
  manifest: SourceManifest,
  analyses: SourceAnalysis[],
  transcripts: TranscriptV1[],
  previousError?: string,
): string {
  const allowedSources = publishableSources(manifest);
  if (allowedSources.length === 0) throw new Error("A video or image source is required to create a publish package");
  const allowedIds = new Set(allowedSources.map((source) => source.id));
  const scenes = analyses
    .flatMap((analysis) => analysis.scenes)
    .filter((scene) => allowedIds.has(scene.sourceId))
    .sort((left, right) => right.keepScore - left.keepScore)
    .slice(0, 40)
    .map((scene) => ({
      sourceId: scene.sourceId,
      start: scene.sourceStart,
      end: scene.sourceEnd,
      description: scene.description,
      tags: scene.tags,
      keepScore: scene.keepScore,
    }));
  const transcript = transcripts.flatMap((item) => item.segments.slice(0, 40).map((segment) => ({
    sourceId: item.sourceId,
    start: segment.start,
    end: segment.end,
    text: segment.text.slice(0, 300),
  }))).slice(0, 120);
  const sources = allowedSources.map((source) => ({
    sourceId: source.id,
    path: source.relativePath,
    kind: source.kind,
    durationSeconds: source.durationSeconds,
    width: source.width,
    height: source.height,
  }));
  return [
    "You are preparing the publishing package for an already edited video.",
    `User's editing request: ${userPrompt}`,
    "Create a compelling, accurate title and description in the same language as the user's request, plus useful tags.",
    "Choose the best thumbnail source and timestamp using only the supplied source IDs and ranges. Do not invent a source ID.",
    "Return only strict JSON with this exact shape:",
    '{"title":"10-140 chars","description":"plain text up to 5000 chars","tags":["at least 3 tags"],"thumbnail":{"sourceId":"allowed source ID","atSeconds":0,"headline":"short thumbnail phrase","rationale":"why this frame works"}}',
    previousError ? `Your previous response was invalid: ${previousError}. Correct it.` : "",
    `Sources: ${JSON.stringify(sources)}`,
    `Strong scene candidates: ${JSON.stringify(scenes)}`,
    `Transcript excerpts: ${JSON.stringify(transcript)}`,
  ].filter(Boolean).join("\n");
}

export async function generatePublishPackage(input: {
  userPrompt: string;
  model: string;
  manifest: SourceManifest;
  analyses: SourceAnalysis[];
  transcripts: TranscriptV1[];
  paths: ProjectPaths;
}): Promise<PublishPackageResult> {
  let previousError: string | undefined;
  let content: Omit<PublishPackageV1, "schemaVersion" | "generatedAt" | "provider" | "model"> | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await runAntigravityPrompt(
      buildPrompt(input.userPrompt, input.manifest, input.analyses, input.transcripts, previousError),
      { model: input.model, mode: "plan", timeoutMs: 300_000 },
    );
    try {
      content = validatePublishResponse(raw, input.manifest, input.analyses);
      break;
    } catch (error) {
      previousError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!content) throw new Error(`Antigravity could not produce a valid publishing package: ${previousError}`);

  const selected = input.manifest.entries.find((source) => source.id === content!.thumbnail.sourceId)
    ?? bestFallbackSource(input.manifest, input.analyses).source;
  await renderThumbnail(selected, content.thumbnail.atSeconds, content.thumbnail.headline, input.paths.thumbnailJpg);
  const publish: PublishPackageV1 = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider: "antigravity",
    model: input.model,
    ...content,
  };
  const markdown = [
    `# ${publish.title}`,
    "",
    publish.description,
    "",
    `Tags: ${publish.tags.join(", ")}`,
    "",
    "## Thumbnail",
    "",
    `- File: ${publish.thumbnail.fileName}`,
    `- Source: ${publish.thumbnail.sourceRelativePath}`,
    `- Time: ${publish.thumbnail.atSeconds}s`,
    `- Headline: ${publish.thumbnail.headline}`,
    `- Selection: ${publish.thumbnail.rationale}`,
    `- AI: Antigravity / ${publish.model}`,
    "",
  ].join("\n");
  await Promise.all([
    atomicWriteFile(input.paths.publishJson, `${JSON.stringify(publish, null, 2)}\n`),
    atomicWriteFile(input.paths.publishMd, markdown),
    atomicWriteFile(input.paths.titleTxt, `${publish.title}\n`),
    atomicWriteFile(input.paths.descriptionTxt, `${publish.description}\n`),
  ]);
  if (existsSync(input.paths.exportReportJson)) {
    const exportReport = JSON.parse(await readFile(input.paths.exportReportJson, "utf8")) as { files?: string[] };
    exportReport.files = [...new Set([
      ...(exportReport.files ?? []),
      input.paths.thumbnailJpg,
      input.paths.publishJson,
      input.paths.publishMd,
      input.paths.titleTxt,
      input.paths.descriptionTxt,
    ])];
    await atomicWriteFile(input.paths.exportReportJson, `${JSON.stringify(exportReport, null, 2)}\n`);
  }
  return {
    publish,
    thumbnailPath: input.paths.thumbnailJpg,
    publishJsonPath: input.paths.publishJson,
    publishMarkdownPath: input.paths.publishMd,
    titlePath: input.paths.titleTxt,
    descriptionPath: input.paths.descriptionTxt,
  };
}
