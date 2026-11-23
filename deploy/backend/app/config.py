import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ai_provider: str = "gemini_with_ollama_fallback"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-4-hydrogen"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3.5:4b"
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = 4
    storage_root: str = "./storage"
    max_upload_mb: int = 2048
    min_free_disk_mb: int = 1024
    retention_days: int = 14
    backend_port: int = 8000
    allowed_origins: str = "http://localhost:3000"
    admin_api_key: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

DIRS = {
    "uploads": Path(settings.storage_root) / "uploads",
    "output": Path(settings.storage_root) / "output",
    "temp": Path(settings.storage_root) / "temp",
    "clips": Path(settings.storage_root) / "clips",
    "subtitles": Path(settings.storage_root) / "subtitles",
    "thumbnails": Path(settings.storage_root) / "thumbnails",
    "logs": Path(settings.storage_root) / "logs",
}


def ensure_dirs() -> None:
    for d in DIRS.values():
        d.mkdir(parents=True, exist_ok=True)
