import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { getProjectPaths } from "../core/projectPaths.js";
import { getMediaDuration } from "../core/ffprobe.js";
import { join } from "node:path";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateFcpxml(vaultPath: string, slug: string): Promise<ValidationReport> {
  const paths = getProjectPaths(vaultPath, slug);
  const fcpxmlPath = paths.timelineFcpxml;
  const report: ValidationReport = { valid: true, errors: [], warnings: [] };

  if (!existsSync(fcpxmlPath)) {
    report.errors.push(`FCPXML file not found at ${fcpxmlPath}`);
    report.valid = false;
    return report;
  }

  const rawXml = await readFile(fcpxmlPath, "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  let parsed: any;
  try {
    parsed = parser.parse(rawXml);
  } catch (e: any) {
    report.errors.push(`XML Parsing failed: ${e.message}`);
    report.valid = false;
    return report;
  }

  if (!parsed.fcpxml || !parsed.fcpxml.resources) {
    report.errors.push("Missing <fcpxml> or <resources> root tags.");
    report.valid = false;
    return report;
  }

  // Check resources and files
  const resources = Array.isArray(parsed.fcpxml.resources.asset) 
    ? parsed.fcpxml.resources.asset 
    : [parsed.fcpxml.resources.asset].filter(Boolean);

  const resourceMap = new Map<string, any>();
  for (const res of resources) {
    if (!res["@_id"]) {
      report.errors.push("Asset missing id attribute.");
      continue;
    }
    resourceMap.set(res["@_id"], res);
    
    // Check file exists
    if (!res["@_src"]) {
      report.errors.push(`Asset ${res["@_id"]} missing src attribute.`);
    } else {
      let src = res["@_src"];
      if (src.startsWith("file://")) {
        // Simple unescape for Windows paths (e.g. file:///D:/...)
        // Actually fast-xml-parser might keep it intact, just remove file:///
        src = decodeURI(src.replace(/^file:\/\/\/?/, ""));
      }
      // On windows, it might look like D:/mnd proj/...
      // If it doesn't have a drive letter, it might be relative, but FCPXML usually uses absolute URIs
      if (!existsSync(src)) {
        report.errors.push(`Media file not found for asset ${res["@_id"]}: ${src}`);
      } else {
        // Check duration against FFprobe
        const durationSec = await getMediaDuration(src);
        if (durationSec === null) {
          report.errors.push(`Could not read duration from media file: ${src}`);
        } else {
          // If asset specifies duration, check bounds (simplified check)
          // FCPXML durations are in rational format like "3000/100s" or "30s"
          if (res["@_duration"]) {
            const durStr = res["@_duration"].replace("s", "");
            let statedDur = 0;
            if (durStr.includes("/")) {
              const [num, den] = durStr.split("/");
              statedDur = parseInt(num) / parseInt(den);
            } else {
              statedDur = parseFloat(durStr);
            }
            // Allow 1 second tolerance
            if (statedDur > durationSec + 1) {
              report.errors.push(`Asset ${res["@_id"]} declared duration (${statedDur}s) exceeds actual media duration (${durationSec}s).`);
            }
          }
        }
      }
    }
  }

  // Check timeline / project bounds
  const project = parsed.fcpxml.library?.event?.project;
  if (!project) {
    report.warnings.push("No <project> found in FCPXML (timeline might be empty or formatted differently).");
  } else {
    const sequence = project.sequence;
    if (!sequence) {
      report.warnings.push("No <sequence> found inside <project>.");
    } else {
      const spine = sequence.spine;
      if (!spine) {
        report.errors.push("Timeline sequence has no <spine> (empty timeline).");
      }
    }
  }

  if (report.errors.length > 0) {
    report.valid = false;
  }

  return report;
}
