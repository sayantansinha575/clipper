#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_FILE="${APP_DIR}/storage/logs/studio.pid"
LOG_FILE="${APP_DIR}/storage/logs/studio.log"

mkdir -p "${APP_DIR}/storage/logs"

if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "AI Shorts Studio is already running (PID $(cat "${PID_FILE}"))."
  exit 0
fi

cd "${APP_DIR}"
export NODE_ENV=production
export PORT="${PORT:-3000}"

nohup node server.ts > "${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"

echo "AI Shorts Studio started on port ${PORT} (PID $(cat "${PID_FILE}"))."
echo "Logs: ${LOG_FILE}"
