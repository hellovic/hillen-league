#!/usr/bin/env bash
# Check the actual export before a data commit or Pages upload.
set -euo pipefail
cd "$(dirname "$0")/.."
EXPORT_DIR=${1:-docs}
PORT=${VERIFY_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$EXPORT_DIR" >/dev/null 2>&1 &
site_pid=$!
trap 'kill "$site_pid" 2>/dev/null || true' EXIT
VERIFY_BASE="http://127.0.0.1:$PORT" node react-dashboard/scripts/verify.mjs
kill -0 "$site_pid"  # Fail if a bind error made the browser hit another server.
