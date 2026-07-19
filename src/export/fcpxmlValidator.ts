import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { getProjectPaths } from "../core/projectPaths.js";
import { probeMedia } from "../core/ffprobe.js";
import { resetCancellation } from "../core/cancellation.js";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ParsedNode {
  [key: string]: unknown;
  "@_id"?: string;
  "@_ref"?: string;
  "@_src"?: string;
  "@_start"?: string;
  "@_offset"?: string;
  "@_duration"?: string;
  "@_format"?: string;
  "@_frameDuration"?: string;
  "@_lane"?: string;
}

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\/(\d+))?s$/.exec(value);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function children(node: unknown, name: string): ParsedNode[] {
  if (!node || typeof node !== "object") return [];
  return array((node as Record<string, ParsedNode | ParsedNode[] | undefined>)[name]);
}

function walk(node: unknown, visitor: (name: string, value: ParsedNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visitor);
    return;
  }
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    if (name.startsWith("@_")) continue;
    for (const item of array(value)) {
      if (item && typeof item === "object") visitor(name, item as ParsedNode);
      walk(item, visitor);
    }
  }
}

function mediaSource(asset: ParsedNode): string | null {
  const direct = asset["@_src"];
  if (typeof direct === "string") return direct;
  const mediaRep = children(asset, "media-rep")[0];
  return typeof mediaRep?.["@_src"] === "string" ? mediaRep["@_src"] : null;
}

export async function validateFcpxmlFile(fcpxmlPath: string): Promise<ValidationReport> {
  const report: ValidationReport = { valid: true, errors: [], warnings: [] };
  if (!existsSync(fcpxmlPath)) {
    report.errors.push(`FCPXML file not found at ${fcpxmlPath}`);
    report.valid = false;
    return report;
  }
  const rawXml = await readFile(fcpxmlPath, "utf8");
  const syntax = XMLValidator.validate(rawXml);
  if (syntax !== true) {
    report.errors.push(`XML parsing failed: ${syntax.err.msg} at line ${syntax.err.line}`);
    report.valid = false;
    return report;
  }
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseAttributeValue: false });
  const parsed = parser.parse(rawXml) as { fcpxml?: ParsedNode };
  const root = parsed.fcpxml;
  if (!root) {
    report.errors.push("Missing <fcpxml> root element");
    report.valid = false;
    return report;
  }
  const version = root["@_version"];
  if (typeof version !== "string" || !/^1\.(?:8|9|10|11|12)$/.test(version)) {
    report.errors.push(`Unsupported FCPXML version: ${String(version)}`);
  }
  const resources = children(root, "resources")[0];
  if (!resources) report.errors.push("Missing <resources> element");
  const formats = new Map<string, ParsedNode>();
  const assets = new Map<string, { node: ParsedNode; duration: number; path: string | null }>();

  for (const format of children(resources, "format")) {
    const id = format["@_id"];
    if (!id) report.errors.push("Format resource is missing id");
    else if (formats.has(id)) report.errors.push(`Duplicate resource id ${id}`);
    else formats.set(id, format);
    if (parseTime(format["@_frameDuration"]) === null) report.errors.push(`Format ${id ?? "?"} has invalid frameDuration`);
  }
  for (const asset of children(resources, "asset")) {
    const id = asset["@_id"];
    if (!id) {
      report.errors.push("Asset resource is missing id");
      continue;
    }
    if (assets.has(id) || formats.has(id)) report.errors.push(`Duplicate resource id ${id}`);
    const duration = parseTime(asset["@_duration"]);
    if (duration === null || duration <= 0) report.errors.push(`Asset ${id} has invalid duration`);
    const uri = mediaSource(asset);
    let path: string | null = null;
    if (!uri) {
      report.errors.push(`Asset ${id} has no original-media URI`);
    } else {
      try {
        const url = new URL(uri);
        if (url.protocol !== "file:") throw new Error("only file URIs are allowed");
        path = fileURLToPath(url);
        if (!existsSync(path)) report.errors.push(`Media is offline for asset ${id}: ${path}`);
      } catch (error) {
        report.errors.push(`Asset ${id} has invalid file URI: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assets.set(id, { node: asset, duration: duration ?? 0, path });
    const formatRef = asset["@_format"];
    if (formatRef && !formats.has(formatRef)) report.errors.push(`Asset ${id} references unknown format ${formatRef}`);
  }

  // Reset any stale cancellation state before the probe loop; a previous
  // Ctrl-C may have left the flag set while the FCPXML was already written.
  resetCancellation();

  for (const [id, asset] of assets) {
    if (!asset.path || !existsSync(asset.path)) continue;
    try {
      const probe = await probeMedia(asset.path);
      if (probe.durationSeconds > 0 && asset.duration > probe.durationSeconds + 1) {
        report.errors.push(`Asset ${id} duration ${asset.duration}s exceeds media duration ${probe.durationSeconds}s`);
      }
    } catch (error) {
      // Probe failures (e.g. cancelled signal, permission) are non-fatal;
      // the asset file was already confirmed to exist above.
      report.warnings.push(`Unable to probe asset ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const libraries = children(root, "library");
  if (libraries.length !== 1) report.errors.push(`Expected one library, found ${libraries.length}`);
  const projects: ParsedNode[] = [];
  walk(libraries, (name, node) => { if (name === "project") projects.push(node); });
  if (projects.length !== 1) report.errors.push(`Expected one project, found ${projects.length}`);
  const sequences: ParsedNode[] = [];
  for (const project of projects) sequences.push(...children(project, "sequence"));
  if (sequences.length !== 1) report.errors.push(`Expected one sequence, found ${sequences.length}`);
  const sequence = sequences[0];
  if (sequence) {
    const format = sequence["@_format"];
    if (!format || !formats.has(format)) report.errors.push(`Sequence references unknown format ${String(format)}`);
    const duration = parseTime(sequence["@_duration"]);
    if (duration === null || duration <= 0) report.errors.push("Sequence has invalid duration");
    const spines = children(sequence, "spine");
    if (spines.length !== 1) report.errors.push(`Expected one spine, found ${spines.length}`);
    let clipCount = 0;
    walk(spines, (name, node) => {
      if (name !== "asset-clip") return;
      clipCount += 1;
      const ref = node["@_ref"];
      const asset = ref ? assets.get(ref) : undefined;
      if (!asset) {
        report.errors.push(`asset-clip references unknown asset ${String(ref)}`);
        return;
      }
      const start = parseTime(node["@_start"]);
      const clipDuration = parseTime(node["@_duration"]);
      const offset = parseTime(node["@_offset"]);
      if (start === null || clipDuration === null || clipDuration <= 0 || offset === null) {
        report.errors.push(`asset-clip for ${ref} has invalid rational time attributes`);
      } else if (start + clipDuration > asset.duration + 1 / 1000) {
        report.errors.push(`asset-clip for ${ref} exceeds declared source duration`);
      }
      if (node["@_lane"] !== undefined && !/^-?\d+$/.test(String(node["@_lane"]))) {
        report.errors.push(`asset-clip for ${ref} has invalid lane ${String(node["@_lane"])}`);
      }
    });
    if (clipCount === 0) report.errors.push("Timeline spine contains no media clips");
  }
  report.errors = [...new Set(report.errors)].sort();
  report.warnings = [...new Set(report.warnings)].sort();
  report.valid = report.errors.length === 0;
  return report;
}

export async function validateFcpxml(vaultPath: string, slug: string): Promise<ValidationReport> {
  return validateFcpxmlFile(getProjectPaths(vaultPath, slug).timelineFcpxml);
}
