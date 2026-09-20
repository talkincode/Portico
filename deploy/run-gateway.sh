#!/bin/bash
# Portico Gateway (doorman: authorization + access audit; never executes tools).
#
# Write access is scoped to the audit file and its temp sibling — never to the
# directory. `src/fs.ts` stats the parent before creating it precisely so this
# grant shape keeps working.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# What this entrance was started from, for the health gate to read back out of
# its launch environment. Only a real restart can change it, which is the one
# thing a pull without a restart cannot fake; a host without `git` leaves it
# empty and the gate reports the missing record instead of guessing.
REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
BIND="${PORTICO_DEPLOY_BIND:-127.0.0.1}"
PORT="${PORTICO_DEPLOY_PORT:-8789}"
IMAGE="${PORTICO_DENO_IMAGE:-denoland/deno:2.9.6}"
DOCKER="${PORTICO_DOCKER:-/usr/bin/docker}"
AUDIT=/app/data/gateway-audit.json

exec "$DOCKER" run --rm --name portico-gateway --network host \
  --user 1000:1000 \
  --tmpfs /tmp:rw,mode=1777 \
  -e DENO_DIR=/tmp/deno-dir \
  -v "$ROOT:/app:ro" \
  -v "$ROOT/data:/app/data" \
  -w /app \
  -e PORTICO_REVISION="$REVISION" \
  -e PORTICO_BIND="$BIND" \
  -e PORTICO_PORT="$PORT" \
  -e PORTICO_CATALOG_PATH=/app/data/catalog.json \
  -e PORTICO_IDENTITIES_PATH=/app/data/identities.json \
  -e PORTICO_SESSIONS_PATH=/app/data/sessions.json \
  -e PORTICO_GATEWAY_AUDIT_PATH="$AUDIT" \
  "$IMAGE" \
  run --allow-read=/app --allow-write="$AUDIT","$AUDIT".tmp --allow-env \
  --allow-net=127.0.0.1,"$BIND" \
  src/gateway/main.ts
