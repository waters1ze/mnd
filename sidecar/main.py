"""
sidecar/main.py
Newline-delimited JSON protocol over stdin/stdout.
Runs as a persistent child process managed by Node.js PersistentProcess.

Protocol:
  IN:  {"id": "req-1", "action": "transcribe"|"export_fcpxml", "payload": {...}}
  OUT: {"id": "req-1", "ok": true, "result": {...}}
       {"id": "req-1", "ok": false, "error": "message"}
"""
from __future__ import annotations
import sys
import json
import traceback
import os


def handle(req: dict) -> dict:
    action = req.get("action")
    payload = req.get("payload", {})

    if action == "transcribe":
        from whisper_fallback import transcribe  # type: ignore
        audio_path = payload["audioPath"]
        model_size = payload.get("model", "medium")
        segments = transcribe(audio_path, model_size)
        return {"segments": segments}

    elif action == "export_fcpxml":
        from otio_export import export_fcpxml  # type: ignore
        edit_plan = payload["editPlan"]
        output_path = payload.get("outputPath") or _default_output_path(edit_plan)
        path = export_fcpxml(edit_plan, output_path)
        return {"fcpxmlPath": path}

    elif action == "ping":
        return {"pong": True}

    else:
        raise ValueError(f"Unknown action: {action!r}")


def _default_output_path(edit_plan: dict) -> str:
    slug = edit_plan.get("projectSlug", "unknown")
    from pathlib import Path
    home = Path.home()
    return str(home / "Vaults" / "mnd" / "Projects" / slug / "reports" / f"{slug}.fcpxml")


def main() -> None:
    # Signal readiness
    print("SIDECAR_READY", flush=True)

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        req_id = "unknown"
        try:
            req = json.loads(raw_line)
            req_id = req.get("id", "unknown")
            result = handle(req)
            resp = {"id": req_id, "ok": True, "result": result}
        except Exception as exc:
            resp = {"id": req_id, "ok": False, "error": str(exc)}
            if os.environ.get("MND_DEBUG"):
                traceback.print_exc(file=sys.stderr)

        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
