#!/usr/bin/env bash
# Portico tunnel client (macOS template, locally-managed config).
#
# TEMPLATE: copy to $PORTICO_HOME/run-cloudflared.sh and replace
# /Users/example/portico with the real home. Ingress lives in
# $ROOT/config.yml (see config.yml in this directory), so the whole tunnel
# path is CLI-driven: create -> route dns -> config.yml -> run, with no
# dashboard click. The tunnel credentials JSON sits next to the live script
# (mode 600, created with `cloudflared tunnel create`), never in the repo.
# The edge bind address is host-specific on purpose: it pins the egress
# interface on a multi-homed Mac, so it stays in host env, not here.
set -euo pipefail

ROOT="/Users/example/portico"
EDGE_BIND="${PORTICO_EDGE_BIND:?set PORTICO_EDGE_BIND to the Mac egress IP (e.g. its en1 address)}"
exec "$ROOT/bin/cloudflared" tunnel \
  --config "$ROOT/config.yml" \
  --no-autoupdate \
  --edge-ip-version 4 \
  --edge-bind-address "$EDGE_BIND" \
  run
