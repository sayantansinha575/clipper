import json
import re
import time
from typing import Any, Dict, List
import httpx
from google import genai
from google.genai import types
from ..config import settings


def _extract_json_text(raw: str) -> str:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.IGNORECASE).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    return cleaned


def _call_ollama_json(prompt: str) -> Dict[str, Any]:
    url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
    payload = {
        "model": settings.ollama_model,
        "stream": False,
        "think": False,
        "format": "json",
        "options": {"temperature": 0.2, "num_ctx": 2048, "num_predict": 700},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a short-form video editor. Return ONLY valid JSON matching: "
                    '{"notes": "string", "clips": [{"start": 0.0, "end": 30.0, "title": "string", '
                    '"hook": "string", "reason": "string", "category": "string", "score": 90}]}.'
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    resp = httpx.post(url, json=payload, timeout=180.0)
    if resp.status_code == 400 and "think" in resp.text.lower():
        payload.pop("think", None)
        resp = httpx.post(url, json=payload, timeout=180.0)
    resp.raise_for_status()
    data = resp.json()
    msg = data.get("message") or {}
    content = msg.get("content") or data.get("response") or msg.get("thinking") or "{}"
    return json.loads(_extract_json_text(content))


def _compact_segments(segments: List[Dict[str, Any]], target_sec: float = 18.0) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    cur: Dict[str, Any] | None = None
    for seg in segments:
        txt = str(seg.get("text", "")).strip()
        if not txt:
            continue
        start, end = float(seg["start"]), float(seg["end"])
        if cur is None:
            cur = {"start": start, "end": end, "text": txt}
        elif start - cur["end"] <= 2.0 and end - cur["start"] <= target_sec and len(cur["text"]) + len(txt) < 340:
            cur["end"] = max(cur["end"], end)
            cur["text"] = f"{cur['text']} {txt}"
        else:
            blocks.append(cur)
            cur = {"start": start, "end": end, "text": txt}
    if cur is not None:
        blocks.append(cur)
    return blocks


def _is_rate_limit_or_missing_key(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(
        k in msg
        for k in (
            "429",
            "503",
            "502",
            "504",
            "unavailable",
            "high demand",
            "overloaded",
            "resource_exhausted",
            "rate limit",
            "quota",
            "api_key",
            "permission_denied",
        )
    )


def select_clips_gemini(
    transcript: Dict[str, Any],
    scenes: List[float],
    video_duration: float,
    clip_count: int = 20,
    min_duration: float = 20.0,
    max_duration: float = 60.0,
    instructions: str = "",
) -> Dict[str, Any]:
    use_ollama = settings.ai_provider == "ollama_only" or not settings.gemini_api_key
    client = genai.Client(api_key=settings.gemini_api_key) if not use_ollama else None

    raw_segments = transcript.get("segments", [])
    segments = _compact_segments(raw_segments) if use_ollama else raw_segments
    chunk_size = 18 if use_ollama else 100
    overlap = 2 if use_ollama else 12
    chunks: List[List[Dict[str, Any]]] = []
    idx = 0
    while idx < max(1, len(segments)):
        chunks.append(segments[idx : idx + chunk_size])
        if idx + chunk_size >= len(segments):
            break
        idx += max(1, chunk_size - overlap)

    if use_ollama and len(chunks) > 10:
        step = len(chunks) / 10.0
        chunks = [chunks[min(len(chunks) - 1, int(i * step))] for i in range(10)]

    candidates: List[Dict[str, Any]] = []
    notes: List[str] = []
    used_provider = f"Ollama ({settings.ollama_model})" if use_ollama else f"Gemini ({settings.gemini_model})"

    for chunk in chunks:
        formatted = "\n".join(
            f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in chunk
        )
        prompt = (
            f"Source duration: {video_duration:.1f}s. Select standout standalone short-form clips "
            f"between {min_duration}s and {max_duration}s. Focus: {instructions or 'Best viral moments'}.\n"
            f"Scene cuts: {scenes[:20]}\n"
            f"Return JSON with clips array and notes.\n\n{formatted}"
        )

        parsed: Dict[str, Any] = {}
        if use_ollama:
            try:
                parsed = _call_ollama_json(prompt)
            except Exception as exc:
                notes.append(f"Window skipped ({str(exc)[:80]}).")
        else:
            for attempt in range(3):
                try:
                    assert client is not None
                    resp = client.models.generate_content(
                        model=settings.gemini_model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                        ),
                    )
                    parsed = json.loads(resp.text or "{}")
                    break
                except Exception as exc:
                    if settings.ai_provider == "gemini_with_ollama_fallback" and _is_rate_limit_or_missing_key(exc):
                        use_ollama = True
                        used_provider = f"Ollama Fallback ({settings.ollama_model})"
                        try:
                            parsed = _call_ollama_json(prompt)
                        except Exception as o_exc:
                            notes.append(f"Ollama fallback skipped ({str(o_exc)[:80]}).")
                        break
                    if attempt == 2:
                        raise
                    time.sleep(1.5 * (attempt + 1))

        candidates.extend(parsed.get("clips", []))
        if parsed.get("notes"):
            notes.append(parsed["notes"])

    valid: List[Dict[str, Any]] = []
    for c in candidates:
        start = float(c.get("start", -1))
        end = float(c.get("end", -1))
        if start < 0 or start >= video_duration or end <= start:
            continue
        end = min(end, video_duration)
        dur = end - start
        if min_duration <= dur <= max_duration:
            valid.append(
                {
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "title": str(c.get("title", "Highlight"))[:100],
                    "hook": str(c.get("hook", ""))[:140],
                    "reason": str(c.get("reason", ""))[:260],
                    "category": str(c.get("category", "highlight"))[:40],
                    "score": int(max(1, min(100, int(c.get("score", 80))))),
                }
            )

    valid.sort(key=lambda x: x["score"], reverse=True)
    return {"clips": valid[:clip_count], "notes": f"[{used_provider}] " + " ".join(notes)}
