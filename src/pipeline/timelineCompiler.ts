import type {
  CompiledClip,
  CompiledTimelineV1,
  EditPlanV1,
  Rational,
  SourceManifest,
  TrackKind,
} from "../types/production.js";
import { assertValidEditPlan } from "./editPlanValidator.js";

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value)) throw new Error(`Cannot convert non-finite time ${value}`);
  const sign = value < 0 ? -1n : 1n;
  const text = Math.abs(value).toString().toLowerCase();
  const [coefficient = "0", exponentText] = text.split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole = "0", fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  let numerator = BigInt(digits) * sign;
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Rational denominator must be positive");
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

export function secondsToFrames(seconds: number, fps: Rational): number {
  const fraction = decimalFraction(seconds);
  const frames = roundedDivide(
    fraction.numerator * BigInt(fps.numerator),
    fraction.denominator * BigInt(fps.denominator),
  );
  const result = Number(frames);
  if (!Number.isSafeInteger(result)) throw new Error(`Frame position exceeds safe integer range: ${seconds}s`);
  return result;
}

const KIND_ORDER: TrackKind[] = [
  "primary_video", "broll", "images", "overlays", "titles",
  "voice", "music", "sound_effects", "subtitles",
];

function assignLanes(plan: EditPlanV1): Map<string, number> {
  const lanes = new Map<string, number>();
  let videoLane = 1;
  let audioLane = -1;
  const sorted = [...plan.tracks].sort((left, right) => {
    const kindDelta = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    return kindDelta || left.id.localeCompare(right.id);
  });
  let primaryAssigned = false;
  for (const track of sorted) {
    if (track.kind === "primary_video" && !primaryAssigned) {
      lanes.set(track.id, 0);
      primaryAssigned = true;
    } else if (["voice", "music", "sound_effects"].includes(track.kind)) {
      lanes.set(track.id, audioLane--);
    } else {
      lanes.set(track.id, videoLane++);
    }
  }
  return lanes;
}

export function compileTimeline(
  plan: EditPlanV1,
  manifest: SourceManifest,
  projectRoot: string,
): CompiledTimelineV1 {
  assertValidEditPlan(plan, manifest, projectRoot);
  const fps = plan.timeline.fps;
  const lanes = assignLanes(plan);
  const warnings = [...plan.warnings];
  let durationFrames = 0;

  const tracks = [...plan.tracks]
    .sort((left, right) => (lanes.get(left.id) ?? 0) - (lanes.get(right.id) ?? 0) || left.id.localeCompare(right.id))
    .map((track) => {
      const lane = lanes.get(track.id) ?? 0;
      const clips: CompiledClip[] = [...track.clips]
        .filter((clip) => clip.enabled)
        .sort((left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id))
        .map((clip) => {
          let sourceStartFrames = secondsToFrames(clip.sourceStart, fps);
          let sourceEndFrames = secondsToFrames(clip.sourceEnd, fps);
          const timelineStartFrames = secondsToFrames(clip.timelineStart, fps);
          const timelineEndFrames = secondsToFrames(clip.timelineEnd, fps);
          let sourceDurationFrames = sourceEndFrames - sourceStartFrames;
          const timelineDurationFrames = timelineEndFrames - timelineStartFrames;
          
          if (clip.speed === 1 && sourceDurationFrames !== timelineDurationFrames) {
            const exactSourceStart = clip.sourceStart * fps.numerator / fps.denominator;
            const exactSourceEnd = clip.sourceEnd * fps.numerator / fps.denominator;
            const diff = timelineDurationFrames - sourceDurationFrames;
            
            const startError = Math.abs(exactSourceStart - (sourceStartFrames - diff));
            const endError = Math.abs(exactSourceEnd - (sourceEndFrames + diff));
            
            if (startError < endError && sourceStartFrames - diff >= 0) {
              sourceStartFrames -= diff;
            } else {
              sourceEndFrames += diff;
            }
            sourceDurationFrames = timelineDurationFrames;
          }

          if (sourceDurationFrames <= 0 || timelineDurationFrames <= 0) {
            throw new Error(`Clip ${clip.id} collapses to zero frames at ${fps.numerator}/${fps.denominator} fps`);
          }
          durationFrames = Math.max(durationFrames, timelineEndFrames);
          const exactTimelineFrames = (clip.timelineEnd - clip.timelineStart) * fps.numerator / fps.denominator;
          if (Math.abs(exactTimelineFrames - timelineDurationFrames) > 0.25) {
            warnings.push(`Clip ${clip.id} boundaries were rounded to the nearest frame`);
          }
          return {
            ...clip,
            sourceStartFrames,
            sourceDurationFrames,
            timelineStartFrames,
            timelineDurationFrames,
            lane,
          };
        });
      return { ...track, lane, clips };
    });

  const subtitles = [...plan.subtitles]
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
    .map((cue) => {
      const startFrames = secondsToFrames(cue.start, fps);
      const endFrames = secondsToFrames(cue.end, fps);
      if (endFrames <= startFrames) throw new Error(`Subtitle ${cue.id} collapses to zero frames`);
      durationFrames = Math.max(durationFrames, endFrames);
      return { ...cue, startFrames, durationFrames: endFrames - startFrames };
    });

  return {
    schemaVersion: 1,
    projectId: plan.projectId,
    name: plan.timeline.name,
    resolution: { ...plan.timeline.resolution },
    fps: { ...fps },
    frameDuration: { numerator: fps.denominator, denominator: fps.numerator },
    audioSampleRate: plan.timeline.audioSampleRate,
    durationFrames,
    tracks,
    subtitles,
    markers: [...plan.markers].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)),
    sourceManifestHash: plan.sourceManifestHash,
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
  };
}
