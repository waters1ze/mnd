"""
otio_export.py
Converts an EditPlan (dict) to an OpenTimelineIO Timeline and exports as FCP XML.
"""
from __future__ import annotations
import os
from pathlib import Path


def generate_fcpxml_manually(edit_plan: dict, output_path: str) -> str:
    """
    Manually generates a Final Cut Pro X XML (FCPXML 1.8) file.
    Used as a robust fallback when opentimelineio adapters (like fcp_xml) are missing.
    """
    slug = edit_plan.get("projectSlug", "mnd_export")
    source_path = edit_plan.get("sourceVideoPath", "")
    cuts = edit_plan.get("cuts", [])
    transcript = edit_plan.get("transcript", [])

    # Calculate video duration
    total_duration = 0.0
    if transcript:
        total_duration = transcript[-1]["end"]
    else:
        total_duration = 60.0  # fallback default

    # Build cuts
    cut_intervals = sorted([(c["startSec"], c["endSec"]) for c in cuts])

    # Calculate non-cut intervals (segments to keep)
    keep_intervals = []
    last_t = 0.0
    for start, end in cut_intervals:
        if start > last_t:
            keep_intervals.append((last_t, start))
        last_t = end
    if total_duration > last_t:
        keep_intervals.append((last_t, total_duration))

    # Convert file path to file:// URL
    abs_source_path = os.path.abspath(source_path)
    file_url = Path(abs_source_path).as_uri()

    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE fcpxml>',
        '<fcpxml version="1.8">',
        '    <resources>',
        '        <format id="r1" name="FFVideoFormat1080p25" frameDuration="100/2500s"/>',
        f'        <asset id="r2" name="{os.path.basename(source_path)}" src="{file_url}" start="0s" duration="{total_duration}s" hasVideo="1" hasAudio="1"/>',
        '    </resources>',
        '    <library>',
        f'        <event name="Event">',
        f'            <project name="{slug}">',
        f'                <sequence duration="{total_duration}s" format="r1" tcStart="0s">',
        '                    <spine>'
    ]

    offset = 0.0
    for idx, (start, end) in enumerate(keep_intervals):
        dur = end - start
        if dur <= 0:
            continue
        xml_lines.append(
            f'                        <asset-clip ref="r2" offset="{offset:.3f}s" name="clip_{idx}" start="{start:.3f}s" duration="{dur:.3f}s"/>'
        )
        offset += dur

    xml_lines.extend([
        '                    </spine>',
        '                </sequence>',
        '            </project>',
        '        </event>',
        '    </library>',
        '</fcpxml>'
    ])

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(xml_lines))

    return output_path


def export_fcpxml(edit_plan: dict, output_path: str) -> str:
    """
    Builds an OTIO timeline from the EditPlan and writes it as FCP XML.
    Falls back to manual FCPXML generation if OTIO fcp_xml adapter is missing.
    """
    try:
        import opentimelineio as otio  # type: ignore

        fps = 25.0
        timeline = otio.schema.Timeline(name=edit_plan.get("projectSlug", "mnd_export"))
        video_track = otio.schema.Track(name="Video", kind=otio.schema.TrackKind.Video)
        timeline.tracks.append(video_track)

        source_path = edit_plan.get("sourceVideoPath", "")
        transcript = edit_plan.get("transcript", [])
        cuts = edit_plan.get("cuts", [])

        cut_intervals = [(c["startSec"], c["endSec"]) for c in cuts]

        total_duration = 0.0
        if transcript:
            total_duration = transcript[-1]["end"]

        cut_points = sorted(set(
            [0.0] + [t for interval in cut_intervals for t in interval] + [total_duration]
        ))

        i = 0
        while i < len(cut_points) - 1:
            seg_start = cut_points[i]
            seg_end = cut_points[i + 1]

            is_cut = any(abs(cs - seg_start) < 0.001 and abs(ce - seg_end) < 0.001
                         for cs, ce in cut_intervals)

            if not is_cut and seg_end > seg_start:
                duration_rt = otio.opentime.RationalTime(
                    (seg_end - seg_start) * fps, fps
                )
                source_range = otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(seg_start * fps, fps),
                    duration=duration_rt,
                )
                ref = otio.schema.ExternalReference(target_url=source_path)
                clip = otio.schema.Clip(
                    name=f"clip_{i}",
                    media_reference=ref,
                    source_range=source_range,
                )
                video_track.append(clip)
            i += 1

        for overlay in edit_plan.get("overlays", []):
            marker_color = otio.schema.MarkerColor.RED
            if overlay.get("type") == "broll":
                marker_color = otio.schema.MarkerColor.BLUE
            elif overlay.get("type") == "subtitle":
                marker_color = otio.schema.MarkerColor.GREEN

            marker = otio.schema.Marker(
                name=f"{overlay.get('type', 'overlay')}:{overlay.get('id', '')}",
                marked_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(overlay["startSec"] * fps, fps),
                    duration=otio.opentime.RationalTime(
                        (overlay["endSec"] - overlay["startSec"]) * fps, fps
                    ),
                ),
                color=marker_color,
                metadata={"mnd": overlay},
            )
            if video_track:
                video_track.markers.append(marker)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        otio.adapters.write_to_file(timeline, output_path, adapter_name="fcp_xml")
        return output_path
    except Exception as e:
        # Fallback to manual FCPXML generation if OTIO or its fcp_xml adapter fails
        return generate_fcpxml_manually(edit_plan, output_path)
