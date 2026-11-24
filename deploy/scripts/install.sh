#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "[AI Shorts Studio] Installing in ${APP_DIR}"

# Verify existing system FFmpeg & Python 3.12 without reinstalling FFmpeg
command -v ffmpeg >/dev/null 2>&1 || { echo "Error: ffmpeg not found on PATH"; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "Error: ffprobe not found on PATH"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 not found on PATH"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node not found on PATH"; exit 1; }

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "Error: Node.js 22+ is required (found $(node -v)). Install via NodeSource setup_22.x."
  exit 1
fi

echo "Using existing FFmpeg: $(ffmpeg -version | head -n 1)"
echo "Using Node.js: $(node -v)"
echo "Using Python: $(python3 --version)"

# 1. Install dependencies (including Vite/Tailwind build tools) and build Node.js full-stack app
cd "${APP_DIR}"
npm ci || npm install
npm run build

# 2. Install lightweight CPU faster-whisper for local word-level subtitles & captions (~200 MB)
if [ "${SKIP_WHISPER_INSTALL:-0}" != "1" ]; then
  if [ -f "${APP_DIR}/deploy/scripts/install-whisper.sh" ]; then
    "${APP_DIR}/deploy/scripts/install-whisper.sh" || echo "Warning: faster-whisper install failed (install python3-venv and run ./deploy/scripts/install-whisper.sh)"
  fi
fi

# 3. Optional: Python virtual environment for standalone FastAPI worker
if [ "${INSTALL_PYTHON_WORKER:-0}" = "1" ] && [ -d "${APP_DIR}/deploy/backend" ]; then
  python3 -m venv "${APP_DIR}/deploy/backend/.venv"
  "${APP_DIR}/deploy/backend/.venv/bin/pip" install --upgrade pip
  "${APP_DIR}/deploy/backend/.venv/bin/pip" install -r "${APP_DIR}/deploy/backend/requirements.txt"
fi

# 3. Ensure storage directories exist
mkdir -p "${APP_DIR}/storage"/{uploads,output,temp,clips,subtitles,thumbnails,logs}

echo "[AI Shorts Studio] Installation complete."
echo "Configure .env from .env.example and run ./deploy/scripts/start.sh"
