import shutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import DIRS, ensure_dirs, settings

ensure_dirs()

app = FastAPI(title="AI Shorts Studio API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    usage = shutil.disk_usage(settings.storage_root)
    return {
        "status": "ok",
        "whisper_model": settings.whisper_model,
        "whisper_device": settings.whisper_device,
        "whisper_compute_type": settings.whisper_compute_type,
        "free_disk_bytes": usage.free,
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
    }
