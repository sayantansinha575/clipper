#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${APP_DIR}/.venv-whisper"

echo "[AI Shorts Studio] Installing lightweight CPU faster-whisper in ${VENV_DIR}..."
python3 -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install --no-cache-dir faster-whisper==1.1.1 requests

"${VENV_DIR}/bin/python" -c "import faster_whisper; print('faster-whisper ready:', faster_whisper.__version__)"
