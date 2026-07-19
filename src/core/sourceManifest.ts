import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { SourceManifest, SourceRecord } from "../types/production.js";
import { probeMedia } from "./ffprobe.js";
import { atomicWriteFile } from "./atomic.js";

export type SourceManifestEntry = {
  sourceId: string;
  canonicalRelativePath: string;
  algorithm: "sha256" | "md5";
  hash: string;
  size: number | null;
  mtime: string | null;
};

export async function hashFileStream(filePath: string, algorithm: "sha256" | "md5" = "sha256"): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function assertWithinBoundary(boundary: string, candidate: string): void {
  if (!isAbsolute(candidate)) throw new Error(`Path must be absolute: ${candidate}`);
  const root = comparablePath(boundary);
  const target = comparablePath(candidate);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe path outside project boundary: ${candidate}`);
  }
}

function portableRelative(projectRoot: string, canonicalPath: string): string {
  const rel = relative(projectRoot, canonicalPath).replace(/\\/g, "/");
  if (!rel || rel === "." || rel.startsWith("../") || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Unable to create safe project-relative path for ${canonicalPath}`);
  }
  return rel;
}

function stableSourceId(relativePath: string): string {
  const key = process.platform === "win32" ? relativePath.toLocaleLowerCase("en-US") : relativePath;
  return `src_${createHash("sha256").update(key.normalize("NFC")).digest("hex").slice(0, 24)}`;
}

export async function buildSourceRecord(projectRoot: string, filePath: string): Promise<SourceRecord> {
  const canonicalProject = await realpath(projectRoot);
  const canonicalPath = await realpath(filePath);
  assertWithinBoundary(canonicalProject, canonicalPath);
  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) throw new Error(`Source is not a regular file: ${filePath}`);

  const relativePath = portableRelative(canonicalProject, canonicalPath);
  const [sha256, media] = await Promise.all([
    hashFileStream(canonicalPath, "sha256"),
    probeMedia(canonicalPath),
  ]);

  return {
    id: stableSourceId(relativePath),
    relativePath,
    canonicalPath,
    sha256,
    size: fileStat.size,
    mtime: fileStat.mtime.toISOString(),
    durationSeconds: media.durationSeconds,
    format: media.format,
    kind: mediaKindForPath(canonicalPath, media.kind),
    videoStreams: media.videoStreams,
    audioStreams: media.audioStreams,
    width: media.width,
    height: media.height,
    fps: media.fps,
    timeBase: media.timeBase,
    sampleRate: media.sampleRate,
    channels: media.channels,
  };
}

const MEDIA_EXTENSIONS = new Set([
  ".3gp", ".aac", ".aif", ".aiff", ".avi", ".bmp", ".flac", ".gif", ".heic",
  ".jpeg", ".jpg", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4", ".mxf",
  ".ogg", ".opus", ".png", ".tif", ".tiff", ".wav", ".webm", ".webp",
]);

// ffprobe exposes still images as one-frame video streams. For editing they
// must remain images so overlays get a real, user-controlled duration.
const IMAGE_EXTENSIONS = new Set([
  ".bmp", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp",
]);

function extensionOf(path: string): string {
  const match = /(?:^|[\\/])[^\\/]*(\.[^.\\/]+)$/.exec(path);
  return match?.[1]?.toLocaleLowerCase("en-US") ?? "";
}

function mediaKindForPath(path: string, probedKind: SourceRecord["kind"]): SourceRecord["kind"] {
  return IMAGE_EXTENSIONS.has(extensionOf(path)) ? "image" : probedKind;
}

export async function discoverSourceFiles(projectRoot: string, sourceRoots: string[]): Promise<string[]> {
  const canonicalProject = await realpath(projectRoot);
  const found: string[] = [];

  async function visit(candidate: string): Promise<void> {
    const canonical = await realpath(candidate);
    assertWithinBoundary(canonicalProject, canonical);
    const info = await lstat(canonical);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not accepted as media sources: ${candidate}`);
    if (info.isDirectory()) {
      const entries = await readdir(canonical, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
      for (const entry of entries) await visit(resolve(canonical, entry.name));
      return;
    }
    if (info.isFile() && MEDIA_EXTENSIONS.has(extensionOf(canonical))) found.push(canonical);
  }

  for (const sourceRoot of sourceRoots) {
    if (!existsSync(sourceRoot)) continue;
    await visit(sourceRoot);
  }
  return found.sort((a, b) => a.localeCompare(b, "en"));
}

export async function createSourceManifest(
  projectId: string,
  projectRoot: string,
  sourceFiles: string[],
): Promise<SourceManifest> {
  const entries: SourceRecord[] = [];
  for (const sourceFile of [...sourceFiles].sort((a, b) => a.localeCompare(b, "en"))) {
    entries.push(await buildSourceRecord(projectRoot, sourceFile));
  }
  return { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), entries };
}

export async function refreshSourceManifest(
  projectId: string,
  projectRoot: string,
  sourceFiles: string[],
  previous?: SourceManifest,
): Promise<{ manifest: SourceManifest; changedSourceIds: string[]; removedSourceIds: string[] }> {
  const previousByPath = new Map((previous?.entries ?? []).map((entry) => [comparablePath(entry.canonicalPath), entry]));
  const entries: SourceRecord[] = [];
  const changedSourceIds: string[] = [];
  for (const sourceFile of [...sourceFiles].sort((a, b) => a.localeCompare(b, "en"))) {
    const canonical = await realpath(sourceFile);
    const prior = previousByPath.get(comparablePath(canonical));
    const info = await stat(canonical);
    if (
      prior
      && prior.size === info.size
      && prior.mtime === info.mtime.toISOString()
      // Re-index legacy manifests where ffprobe classified a PNG/JPEG as a
      // one-frame video, even if the media file itself did not change.
      && prior.kind === mediaKindForPath(canonical, prior.kind)
    ) {
      entries.push(prior);
    } else {
      const next = await buildSourceRecord(projectRoot, canonical);
      entries.push(next);
      changedSourceIds.push(next.id);
    }
    previousByPath.delete(comparablePath(canonical));
  }
  const removedSourceIds = [...previousByPath.values()].map((entry) => entry.id).sort();
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  return {
    manifest: { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), entries },
    changedSourceIds: changedSourceIds.sort(),
    removedSourceIds,
  };
}

export async function saveSourceManifest(path: string, manifest: SourceManifest): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function loadSourceManifest(path: string): Promise<SourceManifest> {
  const { readFile } = await import("node:fs/promises");
  const parsed = JSON.parse(await readFile(path, "utf8")) as SourceManifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || !parsed.projectId) {
    throw new Error(`Unsupported or corrupt source manifest: ${path}`);
  }
  return parsed;
}

export async function verifySourceRecord(projectRoot: string, entry: SourceRecord): Promise<void> {
  assertWithinBoundary(await realpath(projectRoot), await realpath(entry.canonicalPath));
  const current = await stat(entry.canonicalPath);
  if (!current.isFile()) throw new Error(`Source is no longer a regular file: ${entry.relativePath}`);
  if (current.size !== entry.size || current.mtime.toISOString() !== entry.mtime) {
    const currentHash = await hashFileStream(entry.canonicalPath, "sha256");
    if (currentHash !== entry.sha256) {
      throw new Error(`Source changed since indexing: ${entry.relativePath}. Run /add or /analyze to reindex it.`);
    }
  }
}

export function sourceManifestFingerprint(manifest: SourceManifest): string {
  const stable = manifest.entries
    .map((entry) => ({ id: entry.id, relativePath: entry.relativePath, sha256: entry.sha256, size: entry.size }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify({ projectId: manifest.projectId, entries: stable })).digest("hex");
}
