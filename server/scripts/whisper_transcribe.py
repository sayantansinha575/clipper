#!/usr/bin/env python3
import json
import sys
from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 8:
        print("Usage: whisper_transcribe.py <audio_path> <output_json> <model_size> <device> <compute_type> <cpu_threads> <language>", file=sys.stderr)
        return 1

    audio_path = sys.argv[1]
    output_json = sys.argv[2]
    model_size = sys.argv[3] or "small"
    device = sys.argv[4] or "cpu"
    compute_type = sys.argv[5] or "int8"
    cpu_threads = max(1, int(sys.argv[6] or "4"))
    language_raw = sys.argv[7]
    duration_hint = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0

    lang_arg = None if not language_raw or language_raw == "auto" else language_raw

    print(f"STATUS:Loading Whisper {model_size} ({device}/{compute_type}, {cpu_threads} threads)...", flush=True)
    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
    )

    segments_iter, info = model.transcribe(
        audio_path,
        language=lang_arg,
        word_timestamps=True,
        vad_filter=True,
        beam_size=3,
    )

    total_duration = float(getattr(info, "duration", 0.0) or duration_hint or 1.0)
    segments = []
    last_pct = -1

    for seg in segments_iter:
        text = (seg.text or "").strip()
        if not text:
            continue

        words = []
        for w in (seg.words or []):
            w_str = (w.word or "").strip()
            if not w_str:
                continue
            words.append({
                "word": w_str,
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
            })

        segments.append({
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": text,
            "words": words,
        })

        pct = min(99, max(1, int((float(seg.end) / max(1.0, total_duration)) * 100)))
        if pct >= last_pct + 5:
            last_pct = pct
            print(f"PROGRESS:{pct}", flush=True)

    payload = {
        "language": getattr(info, "language", None) or (lang_arg or "en"),
        "duration": round(total_duration, 3),
        "hasSpeech": len(segments) > 0,
        "segments": segments,
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print("PROGRESS:100", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
