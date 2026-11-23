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
        "format": "json",
        "options": {"temperature": 0.2, "num_ctx": 8192},
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
    resp = httpx.post(url, json=payload, timeout=120.0)
    resp.raise_for_status()
    data = resp.json()
    content = (data.get("message") or {}).get("content") or data.get("response") or "{}"
    return json.loads(_extract_json_text(content))


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

    segments = transcript.get("segments", [])
    chunk_size = 100
    overlap = 12
    candidates: List[Dict[str, Any]] = []
    notes: List[str] = []
    used_provider = f"Ollama ({settings.ollama_model})" if use_ollama else f"Gemini ({settings.gemini_model})"

    idx = 0
    while idx < max(1, len(segments)):
        chunk = segments[idx : idx + chunk_size]
        formatted = "\n".join(
            f"[{s['start']:.2f} - {s['end']:.2f}] {s['text']}" for s in chunk
        )
        prompt = (
            f"Source duration: {video_duration:.2f}s. Select standout standalone short-form clips "
            f"between {min_duration}s and {max_duration}s. Focus: {instructions or 'Best viral moments'}.\n"
            f"Scene cuts: {scenes[:40]}\n"
            f"Return JSON with clips array and notes.\n\n{formatted}"
        )

        if use_ollama:
            parsed = _call_ollama_json(prompt)
        else:
            parsed = {}
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
                        parsed = _call_ollama_json(prompt)
                        break
                    if attempt == 2:
                        raise
                    time.sleep(1.5 * (attempt + 1))

        candidates.extend(parsed.get("clips", []))
        if parsed.get("notes"):
            notes.append(parsed["notes"])

        if idx + chunk_size >= len(segments):
            break
        idx += chunk_size - overlap

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
