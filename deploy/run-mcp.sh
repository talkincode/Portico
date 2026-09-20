#!/bin/bash
# Portico MCP entrance (read-only, session-authenticated).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# What this entrance was started from, for the health gate to read back out of
# its launch environment. Only a real restart can change it, which is the one
# thing a pull without a restart cannot fake; a host without `git` leaves it
# empty and the gate reports the missing record instead of guessing.
REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
BIND="${PORTICO_DEPLOY_BIND:-127.0.0.1}"
PORT="${PORTICO_DEPLOY_PORT:-8790}"
IMAGE="${PORTICO_DENO_IMAGE:-denoland/deno:2.9.6}"
DOCKER="${PORTICO_DOCKER:-/usr/bin/docker}"

exec "$DOCKER" run --rm --name portico-mcp --network host \
  --user 1000:1000 \
  --tmpfs /tmp:rw,mode=1777 \
  -e DENO_DIR=/tmp/deno-dir \
  -v "$ROOT:/app:ro" \
  -w /app \
  -e PORTICO_REVISION="$REVISION" \
  -e PORTICO_BIND="$BIND" \
  -e PORTICO_PORT="$PORT" \
  -e PORTICO_CATALOG_PATH=/app/data/catalog.json \
  -e PORTICO_IDENTITIES_PATH=/app/data/identities.json \
  -e PORTICO_SESSIONS_PATH=/app/data/sessions.json \
  -e PORTICO_GATEWAY_AUDIT_PATH=/app/data/gateway-audit.json \
  -e PORTICO_PAGE_PATH=/app/data/page.json \
  -e PORTICO_CONCLUSIONS_PATH=/app/data/conclusions.json \
  -e PORTICO_SEAL_ANCHORS_PATH=/app/data/seal-anchors.json \
  "$IMAGE" \
  run --allow-read=/app --allow-env --allow-net=127.0.0.1,"$BIND" \
  src/mcp/main.ts
