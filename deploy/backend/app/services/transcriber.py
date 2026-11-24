import subprocess
from typing import Any, Dict, List, Optional
import numpy as np
from faster_whisper import WhisperModel
from ..config import settings

_whisper_instance: Optional[WhisperModel] = None


def _load_audio_ffmpeg(audio_path: str, sample_rate: int = 16000) -> np.ndarray:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-threads",
            "0",
            "-i",
            audio_path,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-ar",
            str(sample_rate),
            "-",
        ],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, np.int16).flatten().astype(np.float32) / 32768.0


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
    waveform = _load_audio_ffmpeg(audio_path, 16000)
    if waveform.size == 0:
        return {
            "language": lang_arg or "en",
            "duration": duration,
            "hasSpeech": False,
            "segments": [],
        }

    segments_iter, info = model.transcribe(
        waveform,
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
