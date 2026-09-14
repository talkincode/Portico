#!/bin/bash
# Portico MCP entrance (read-only, session-authenticated).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIND="${PORTICO_DEPLOY_BIND:-10.201.15.192}"
PORT="${PORTICO_DEPLOY_PORT:-8790}"
IMAGE="${PORTICO_DENO_IMAGE:-denoland/deno:2.9.6}"
DOCKER="${PORTICO_DOCKER:-/usr/bin/docker}"

exec "$DOCKER" run --rm --name portico-mcp --network host \
  --user 1000:1000 \
  --tmpfs /tmp:rw,mode=1777 \
  -e DENO_DIR=/tmp/deno-dir \
  -v "$ROOT:/app:ro" \
  -w /app \
  -e PORTICO_BIND="$BIND" \
  -e PORTICO_PORT="$PORT" \
  -e PORTICO_CATALOG_PATH=/app/data/catalog.json \
  -e PORTICO_IDENTITIES_PATH=/app/data/identities.json \
  -e PORTICO_SESSIONS_PATH=/app/data/sessions.json \
  -e PORTICO_GATEWAY_AUDIT_PATH=/app/data/gateway-audit.json \
  "$IMAGE" \
  run --allow-read=/app --allow-env --allow-net=127.0.0.1,"$BIND" \
  src/mcp/main.ts
