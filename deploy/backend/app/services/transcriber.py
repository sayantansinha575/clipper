from typing import Any, Dict, List, Optional
from faster_whisper import WhisperModel
from ..config import settings

_whisper_instance: Optional[WhisperModel] = None


def get_whisper_model() -> WhisperModel:
    """Lazy-initialize and reuse a single CPU INT8 faster-whisper instance across jobs."""
    global _whisper_instance
    if _whisper_instance is None:
        _whisper_instance = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
            cpu_threads=settings.whisper_cpu_threads,
        )
    return _whisper_instance


def transcribe_audio_file(audio_path: str, duration: float, language: Optional[str] = None) -> Dict[str, Any]:
    model = get_whisper_model()
    lang_arg = None if not language or language == "auto" else language

    segments_iter, info = model.transcribe(
        audio_path,
        language=lang_arg,
        word_timestamps=True,
        vad_filter=True,
        beam_size=3,
    )

    segments: List[Dict[str, Any]] = []
    for seg in segments_iter:
        words = [
            {
                "word": w.word.strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
            }
            for w in (seg.words or [])
            if w.word.strip()
        ]
        segments.append(
            {
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": seg.text.strip(),
                "words": words,
            }
        )

    return {
        "language": info.language or "en",
        "duration": duration,
        "hasSpeech": len(segments) > 0,
        "segments": segments,
    }
