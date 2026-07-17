"""
whisper_fallback.py
Loads faster-whisper model once at sidecar startup and transcribes on demand.
"""
from __future__ import annotations
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from faster_whisper import WhisperModel  # type: ignore

_model: "WhisperModel | None" = None
_loaded_model_size: str | None = None


def get_model(model_size: str = "medium") -> "WhisperModel":
    global _model, _loaded_model_size
    from faster_whisper import WhisperModel  # type: ignore  # noqa: PLC0415

    if _model is None or _loaded_model_size != model_size:
        device = "cuda" if _cuda_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
        _loaded_model_size = model_size
    return _model


def _cuda_available() -> bool:
    try:
        import torch  # type: ignore  # noqa: PLC0415
        return torch.cuda.is_available()
    except ImportError:
        return False


def transcribe(audio_path: str, model_size: str = "medium") -> list[dict]:
    """
    Returns list of segments: [{ "start": float, "end": float, "text": str }, ...]
    """
    model = get_model(model_size)
    segments, _info = model.transcribe(audio_path, beam_size=5)
    return [
        {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
        for seg in segments
    ]
