#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_FILE="${APP_DIR}/storage/logs/studio.pid"

if [ ! -f "${PID_FILE}" ]; then
  echo "No PID file found at ${PID_FILE}."
  exit 0
fi

PID="$(cat "${PID_FILE}")"
if kill -0 "${PID}" 2>/dev/null; then
  kill -TERM "${PID}"
  sleep 2
  if kill -0 "${PID}" 2>/dev/null; then
    kill -KILL "${PID}"
  fi
  echo "Stopped AI Shorts Studio (PID ${PID})."
else
  echo "Process ${PID} is not running."
fi

rm -f "${PID_FILE}"
