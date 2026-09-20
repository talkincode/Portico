#!/usr/bin/env bash
# Portico on macOS (LaunchDaemon target): single supervised unit.
#
# TEMPLATE: copy to $PORTICO_HOME/run.sh (e.g. /Users/<user>/portico/run.sh)
# and replace /Users/example/portico with the real home. Do not point the
# daemon at this template copy: the live file must be reviewable on the host,
# same rule as the Linux run-*.sh scripts.
#
# The supervisor (src/up/main.ts) starts Portal :8788, Gateway :8789,
# MCP :8790 and Review :8791 as separate processes with their own permission
# sets from src/perms.ts (Portal/MCP read-only, Gateway write-scoped to its
# audit file, Review scoped to catalog+sessions). If any entrance exits,
# the supervisor stops the rest, so there is
# never a half-system. The supervisor itself never binds a socket and never
# touches governance data, so it holds only --allow-env (config) and
# --allow-run (spawning); it must never gain --allow-all, --allow-write or
# --allow-net.
set -euo pipefail

ROOT="/Users/example/portico"
export PATH="$HOME/.deno/bin:/usr/local/bin:/usr/bin:/bin"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  export "$key=$value"
done < "$ROOT/portico.env"
export PORTICO_DATA_DIR="${PORTICO_DATA_DIR:-$ROOT/data}"
mkdir -p "$PORTICO_DATA_DIR" "$ROOT/logs"
cd "$ROOT/app"
exec "$HOME/.deno/bin/deno" run --allow-env --allow-run src/up/main.ts
