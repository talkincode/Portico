#!/usr/bin/env bash
# Health gate for the three-entrance (Portal / Gateway / MCP) deployment.
#
# This is the Linux/systemd counterpart of `deploy/macos/verify.sh`, and it
# exists because "the ports still answer" is not the same claim as "the new
# revision is serving". A `systemctl restart` whose sudo prompt is refused
# exits non-zero while the old containers keep serving: reachability, the
# permission classes and even the product page all look untouched, so the
# previous revision keeps running until someone stops believing the ports.
# Nothing else in the repository could tell "restarted onto the new revision"
# apart from "still the old process".
#
# Read-only by contract: no sudo, no restart, nothing written outside
# `$TMPDIR`. Every promise is reported by name and any failure exits non-zero,
# so a deploy either proves itself or says which promise it broke.
#
# Environment (all optional):
#   PORTICO_DEPLOY_BIND        listen address of the entrances (default 127.0.0.1)
#   PORTICO_DEPLOY_PORTAL_PORT Portal port (default 8788)
#   PORTICO_DEPLOY_GATEWAY_PORT Gateway port (default 8789)
#   PORTICO_DEPLOY_MCP_PORT    MCP port (default 8790)
#   PORTICO_DEPLOY_TREE        checkout the entrances were started from
#                              (default: this script's parent directory)
#   PORTICO_EXPECT_SHA         pin the checkout revision; mismatch fails
set -uo pipefail

BIND="${PORTICO_DEPLOY_BIND:-127.0.0.1}"
PORTAL_PORT="${PORTICO_DEPLOY_PORTAL_PORT:-8788}"
GATEWAY_PORT="${PORTICO_DEPLOY_GATEWAY_PORT:-8789}"
MCP_PORT="${PORTICO_DEPLOY_MCP_PORT:-8790}"
TREE="${PORTICO_DEPLOY_TREE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

PORTAL="http://${BIND}:${PORTAL_PORT}"
GATEWAY="http://${BIND}:${GATEWAY_PORT}"
MCP="http://${BIND}:${MCP_PORT}"

fail=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s: %s\n' "$1" "$2"; fail=1; }
skip() { printf 'skip %s: %s\n' "$1" "$2"; }

code=""
payload=""

probe() { # url [curl args...]
  local url="$1" out
  shift
  out=$(curl -s -m 10 -w '\n%{http_code}' "$@" "$url" 2>/dev/null) || out=$'\n000'
  code="${out##*$'\n'}"
  payload="${out%$'\n'*}"
}

expect_status() { # name url want [curl args...]
  local name="$1" url="$2" want="$3"
  shift 3
  probe "$url" "$@"
  if [ "$code" = "$want" ]; then ok "$name"; else bad "$name" "got HTTP $code, want $want"; fi
}

contains() { printf '%s' "$1" | grep -qF -- "$2"; }

printf 'Portico deployment gate: portal=%s gateway=%s mcp=%s tree=%s\n' \
  "$PORTAL" "$GATEWAY" "$MCP" "$TREE"

# The product page, not an error page. The live Portal answers a 404 with the
# same `<title>Portico · Portico</title>` and the same shell, so a title check
# alone accepts an error page: the channel rail only renders for a real
# discovery page.
probe "$PORTAL/"
if [ "$code" = "200" ] && contains "$payload" '<title>Portico' &&
  contains "$payload" 'class="filter-tabs"'; then
  ok portal-product-page
else
  bad portal-product-page "HTTP $code is not the discovery shell (title or channel rail missing)"
fi

expect_status portal-public-plane "$PORTAL/public" 200
# Anonymous must not reach the internal plane, and the Catalog API must stay a
# well-formed envelope rather than an error page.
expect_status portal-internal-fail-closed "$PORTAL/internal" 404
probe "$PORTAL/api/catalog"
if [ "$code" = "200" ] && contains "$payload" '{"ok":true'; then
  ok portal-catalog-envelope
else
  bad portal-catalog-envelope "HTTP $code is not an ok:true envelope"
fi
# The Portal serves governance state and must never be able to write it.
expect_status portal-read-only "$PORTAL/api/catalog" 405 -X POST

# The Gateway is a gatekeeper: it authorizes and routes, it never executes a
# tool, and its access audit is auditor-only.
expect_status gateway-does-not-execute-tools "$GATEWAY/gateway/mcp/probe/tools/call" 405 -X POST
expect_status gateway-audit-is-auditor-only "$GATEWAY/gateway/audit" 403

# MCP speaks JSON-RPC over POST and nothing else.
probe "$MCP/" -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"deploy-gate","version":"1"}}}'
if [ "$code" = "200" ] && contains "$payload" '"name":"portico"'; then
  ok mcp-jsonrpc-initialize
else
  bad mcp-jsonrpc-initialize "HTTP $code is not a portico initialize result"
fi
expect_status mcp-get-is-not-a-transport "$MCP/" 405

month_number() {
  case "$1" in
    Jan) printf '01\n' ;; Feb) printf '02\n' ;; Mar) printf '03\n' ;;
    Apr) printf '04\n' ;; May) printf '05\n' ;; Jun) printf '06\n' ;;
    Jul) printf '07\n' ;; Aug) printf '08\n' ;; Sep) printf '09\n' ;;
    Oct) printf '10\n' ;; Nov) printf '11\n' ;; Dec) printf '12\n' ;;
    *) return 1 ;;
  esac
}

# `ps -o lstart=` gives "Sun Sep 20 14:24:08 2026"; `touch -t` wants
# [[CC]YY]MMDDhhmm[.SS]. Building the stamp keeps the comparison portable
# between the Linux host and a developer's macOS box without `stat -c`/`-f`.
touch_stamp() {
  set -- $1
  local month hhmm
  month=$(month_number "$2") || return 1
  hhmm="${4%:*}"
  printf '%s%s%s%s.%s\n' "$5" "$month" "$3" "${hhmm/:/}" "${4##*:}"
}

listener_pid() { # port
  local pid=""
  if command -v ss >/dev/null 2>&1; then
    pid=$(ss -ltnp 2>/dev/null | grep -F ":$1 " |
      sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
  fi
  if [ -z "$pid" ] && command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1)
  fi
  printf '%s' "$pid"
}

# A merge or a pull that is not followed by a real restart leaves the previous
# revision answering on the same ports. Comparing each listener's start time
# against the tree it serves is what separates the two.
check_running_code_is_current() {
  local anchor stale=0 unknown=0 entry name port pid start stamp newest
  if [ ! -d "$TREE/src" ]; then
    bad running-code-not-stale "no source tree at $TREE/src to compare against"
    return
  fi
  anchor=$(mktemp 2>/dev/null) || {
    skip running-code-not-stale "mktemp unavailable"
    return
  }
  for entry in "portal:${PORTAL_PORT}" "gateway:${GATEWAY_PORT}" "mcp:${MCP_PORT}"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    pid=$(listener_pid "$port")
    if [ -z "$pid" ]; then
      unknown=1
      printf '     %s: nothing listening on port %s\n' "$name" "$port"
      continue
    fi
    start=$(ps -o lstart= -p "$pid" 2>/dev/null)
    stamp=$(touch_stamp "$start")
    if [ -z "$stamp" ] || ! touch -t "$stamp" "$anchor" 2>/dev/null; then
      unknown=1
      printf '     %s: cannot read the start time of pid %s\n' "$name" "$pid"
      continue
    fi
    newest=$(find "$TREE/src" -type f -newer "$anchor" -print -quit 2>/dev/null)
    if [ -n "$newest" ]; then
      stale=1
      printf '     %s (pid %s) started %s, before %s was written\n' \
        "$name" "$pid" "$start" "$newest"
    fi
  done
  rm -f "$anchor"
  if [ "$stale" = "1" ]; then
    bad running-code-not-stale "a listening process is older than the tree it serves; restart the entrances"
  elif [ "$unknown" = "1" ]; then
    skip running-code-not-stale "could not read every listener's start time"
  else
    ok running-code-not-stale
  fi
}

check_running_code_is_current

if [ -n "${PORTICO_EXPECT_SHA:-}" ]; then
  head=$(git -C "$TREE" rev-parse HEAD 2>/dev/null)
  if [ "$head" = "$PORTICO_EXPECT_SHA" ]; then
    ok checkout-revision
  else
    bad checkout-revision "tree is at ${head:-unknown}, expected ${PORTICO_EXPECT_SHA}"
  fi
else
  skip checkout-revision "set PORTICO_EXPECT_SHA to pin the revision being served"
fi

if [ "$fail" = "0" ]; then
  printf 'deployment verified: the three entrances answer the product contract\n'
else
  printf 'deployment NOT verified: see the FAIL lines above\n'
fi
exit "$fail"
