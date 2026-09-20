#!/bin/bash
# Portico Portal (read-only entrance).
#
# Canonical copy: this file is versioned so the deployment's permission
# allow-list is reviewable and testable. `tests/deploy_contract_test.ts` fails
# if it drifts from `src/perms.ts`.
#
# The read-only entrances must never be granted write access: an unconditional
# `mkdir` in the store layer once turned every Gateway audit append into a 500
# on the live deployment, because the deployed grant covers two files and not
# the directory. Keeping this list in the repo is what makes that visible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# What this entrance was started from, for the health gate to read back out of
# its launch environment. Only a real restart can change it, which is the one
# thing a pull without a restart cannot fake; a host without `git` leaves it
# empty and the gate reports the missing record instead of guessing.
REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
BIND="${PORTICO_DEPLOY_BIND:-127.0.0.1}"
PORT="${PORTICO_DEPLOY_PORT:-8788}"
IMAGE="${PORTICO_DENO_IMAGE:-denoland/deno:2.9.6}"
DOCKER="${PORTICO_DOCKER:-/usr/bin/docker}"

exec "$DOCKER" run --rm --name portico-portal --network host \
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
  -e PORTICO_REVIEW_ORIGIN="${PORTICO_DEPLOY_REVIEW_ORIGIN:-off}" \
  "$IMAGE" \
  run --allow-read=/app --allow-env --allow-net=127.0.0.1,"$BIND" \
  src/portal/main.ts
