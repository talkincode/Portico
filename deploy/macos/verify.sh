#!/usr/bin/env bash
# Health gate for the macOS deployment. No sudo needed: it only reads
# local ports and the public URLs. Non-zero exit on any failure so the
# runbook (`render` -> install daemons -> `verify`) fails loudly instead
# of leaving a half-system behind.
#
# Three claims, in the order they are cheapest to detect and most expensive to
# miss: the checkout is the revision you pinned, the four entrances were started
# from that checkout rather than from the previous revision the restart never
# replaced, and each entrance answers its own contract. The middle claim is read
# twice, from the revision each launcher recorded and from when each process
# started, because the first is what a restart writes and the second is what a
# pull that skipped the restart leaves behind.
#
# Environment (all optional; the defaults are the shipped deployment):
#   PORTICO_DEPLOY_BIND           address the four entrances serve on
#                                 (default 127.0.0.1)
#   PORTICO_DEPLOY_PORTAL_PORT    Portal port (default 8788)
#   PORTICO_DEPLOY_GATEWAY_PORT   Gateway port (default 8789)
#   PORTICO_DEPLOY_MCP_PORT       MCP port (default 8790)
#   PORTICO_DEPLOY_REVIEW_PORT    Review port (default 8791)
#   PORTICO_DEPLOY_PUBLIC_ORIGIN  origin the tunnel serves (default
#                                 https://portico.talkincode.net)
#   PORTICO_DEPLOY_TREE           checkout the daemons were started from
#                                 (default: the checkout this script is in)
#   PORTICO_EXPECT_SHA            pin the checkout revision; mismatch fails, and
#                                 leaving it unset fails too unless the run
#                                 accepts a behaviour-only verdict below
#   PORTICO_DEPLOY_ALLOW_UNPINNED accept a run that pins no revision; it reports
#                                 a `skip` instead of a verdict
set -euo pipefail

BIND="${PORTICO_DEPLOY_BIND:-127.0.0.1}"
PORTAL_PORT="${PORTICO_DEPLOY_PORTAL_PORT:-8788}"
GATEWAY_PORT="${PORTICO_DEPLOY_GATEWAY_PORT:-8789}"
MCP_PORT="${PORTICO_DEPLOY_MCP_PORT:-8790}"
REVIEW_PORT="${PORTICO_DEPLOY_REVIEW_PORT:-8791}"
PUBLIC="${PORTICO_DEPLOY_PUBLIC_ORIGIN:-https://portico.talkincode.net}"
PUBLIC="${PUBLIC%/}"

fail=0
check() {
  local name="$1" url="$2" expect="$3"
  local code
  shift 3
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$@" "$url") || code="000"
  if [ "$code" = "$expect" ]; then
    echo "ok $name $code"
  else
    echo "FAIL $name got $code want $expect"
    fail=1
  fi
}

# The revision pin, mirroring deploy/verify.sh. The probes below only prove
# behaviour, and behaviour is exactly what a daemon that was never restarted
# still answers, so a run that never named a revision has verified no
# deployment. Leaving the pin out therefore fails; only an explicit acceptance
# turns the omission into a `skip`, so a host that is not a checkout can still be
# probed while saying so on the record.
#
# This runs before the probes on purpose: a wrong revision is the cheapest
# thing to detect and the most expensive to miss, so it reports first and
# survives a probe that hangs or dies half way through.
TREE="${PORTICO_DEPLOY_TREE:-$(cd "$(dirname "$0")/../.." && pwd)}"
case "$(printf '%s' "${PORTICO_DEPLOY_ALLOW_UNPINNED:-}" | tr '[:upper:]' '[:lower:]')" in
  1 | true | yes | on) accepts_unpinned="1" ;;
  *) accepts_unpinned="" ;;
esac
if [ -n "${PORTICO_EXPECT_SHA:-}" ]; then
  head=$(git -C "$TREE" rev-parse HEAD 2>/dev/null) || head=""
  if [ "$head" = "$PORTICO_EXPECT_SHA" ]; then
    echo "ok checkout-revision"
  else
    echo "FAIL checkout-revision got ${head:-unknown} want $PORTICO_EXPECT_SHA"
    fail=1
  fi
elif [ -n "$accepts_unpinned" ]; then
  echo "skip checkout-revision PORTICO_EXPECT_SHA is not set, so this run proves behaviour only (accepted by PORTICO_DEPLOY_ALLOW_UNPINNED)"
else
  echo "FAIL checkout-revision PORTICO_EXPECT_SHA is not set, so nothing here names the revision being served; pin it, or accept a behaviour-only run with PORTICO_DEPLOY_ALLOW_UNPINNED=1"
  fail=1
fi

month_number() {
  case "$1" in
    Jan) printf '01\n' ;; Feb) printf '02\n' ;; Mar) printf '03\n' ;;
    Apr) printf '04\n' ;; May) printf '05\n' ;; Jun) printf '06\n' ;;
    Jul) printf '07\n' ;; Aug) printf '08\n' ;; Sep) printf '09\n' ;;
    Oct) printf '10\n' ;; Nov) printf '11\n' ;; Dec) printf '12\n' ;;
    *) return 1 ;;
  esac
}

# `ps -o lstart=` gives "Mon Sep 21 01:22:44 2026"; `touch -t` wants
# [[CC]YY]MMDDhhmm[.SS]. Building the stamp keeps the comparison portable
# between this host and the Linux gate that shares the idea.
touch_stamp() {
  set -- $1
  local month hhmm
  month=$(month_number "$2") || return 1
  hhmm="${4%:*}"
  printf '%s%s%s%s.%s\n' "$5" "$month" "$3" "${hhmm/:/}" "${4##*:}"
}

# The pid behind one entrance. Matching the address as well as the port keeps a
# leftover listener on the same port from being measured in place of the one
# this deployment serves; a listener on that port under any other address is
# only a fallback, because the four entrances below are the ones this host is
# contracted to run. (A bind that is not the loopback is refused by the runtime
# itself — `src/runtime/bind.ts` — so the gate does not re-argue it here.)
listener_pid() { # port [address]
  local port="$1" want="${2:-}" rows="" pids="" found=""
  if [ -n "$want" ] && command -v ss >/dev/null 2>&1; then
    rows=$(ss -ltnp 2>/dev/null) || rows=""
    found=$(printf '%s\n' "$rows" | awk -v port="$port" -v want="$want" '
      $1 == "LISTEN" && $4 ~ (":" port "$") {
        address = $4
        sub(":" port "$", "", address)
        gsub(/^\[|\]$/, "", address)
        if (address == want) row = $0
      }
      END {
        if (row ~ /pid=/) {
          sub(/.*pid=/, "", row)
          sub(/[^0-9].*/, "", row)
          print row
        }
      }') || found=""
  fi
  if [ -z "$found" ] && [ -n "$want" ] && command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -nP -i@"${want}":"$port" -sTCP:LISTEN -t 2>/dev/null) || pids=""
    found="${pids%%$'\n'*}"
  fi
  if [ -z "$found" ] && command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null) || pids=""
    found="${pids%%$'\n'*}"
  fi
  printf '%s' "$found"
}

# What a launcher recorded for one process, read back from the kernel. `ps eww`
# prints the environment a process was *started* with, so the value is fixed at
# exec time and only starting the process again can change it; macOS quotes each
# entry in that output. (The Linux gate reads the same record, unquoted.)
#
# Only that one variable is extracted, and only when it looks like a revision:
# the same output carries whatever else the launcher exported, and the env file
# this host runs from holds credentials — repeating it would turn a read-only
# check into a disclosure in the deploy log.
capture_launch_revision() { # pid
  local pid="$1" line
  line=$(ps eww -p "$pid" 2>/dev/null) || line=""
  printf '%s\n' "$line" | tr -d "'" | tr ' ' '\n' |
    sed -n 's/^PORTICO_REVISION=\([0-9a-f]\{7,64\}\)$/\1/p' | head -n 1
}

# The same silent no-op restart the start-time comparison below catches, caught
# instead by the record the launcher left behind. A file time can be moved
# without restarting anything (a restore, a touch, a clock), and the previous
# revision answers every probe with the same product page; the revision a
# process was started from cannot be talked out of it, because `kickstart -k` is
# the only thing that rewrites it.
check_running_revision() {
  local expected entry name port pid reported wrong=0
  expected=$(git -C "$TREE" rev-parse HEAD 2>/dev/null) || expected=""
  if [ -z "$expected" ]; then
    echo "skip running-revision the tree at $TREE is not a git checkout, so there is no revision for the daemons to have been started from"
    return
  fi
  for entry in "portal:$PORTAL_PORT" "gateway:$GATEWAY_PORT" "mcp:$MCP_PORT" "review:$REVIEW_PORT"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    pid=$(listener_pid "$port" "$BIND")
    if [ -z "$pid" ]; then
      echo "FAIL running-revision: nothing is listening on the $name entrance ${BIND}:${port}, so the revision it serves is unknown"
      wrong=1
      continue
    fi
    reported=$(capture_launch_revision "$pid")
    if [ -z "$reported" ]; then
      echo "FAIL running-revision: the $name entrance (pid $pid) recorded no PORTICO_REVISION, so the revision it serves is unknown; restart it from a launcher that records one"
      wrong=1
    elif [ "$reported" != "$expected" ]; then
      echo "FAIL running-revision: the $name entrance (pid $pid) was started from $reported, but $TREE is at $expected; restart it onto this checkout"
      wrong=1
    fi
  done
  if [ "$wrong" = "1" ]; then
    echo "FAIL running-revision: a listening entrance was not started from the revision this checkout is at; restart the daemons"
    fail=1
  else
    echo "ok running-revision"
  fi
}

# A pull that is not followed by a real restart leaves the previous revision
# answering on every port with the same product page, so no behaviour probe can
# tell "restarted onto the new revision" from "still the old process". Comparing
# each listening process's start time against the tree it serves is what
# separates the two.
#
# Unlike the Linux gate, an entrance with nothing behind it is a FAIL here
# rather than a `skip`: this deployment ships exactly four entrances from one
# supervisor, so a missing one is not an unknown, it is a system that is not up.
check_running_code_is_current() {
  local anchor entry name port pid start stamp newest stale=0
  if [ ! -d "$TREE/src" ]; then
    echo "FAIL running-code-not-stale: no source tree at $TREE/src to compare against"
    fail=1
    return
  fi
  anchor=$(mktemp 2>/dev/null) || {
    echo "FAIL running-code-not-stale: mktemp is unavailable, so nothing can be dated"
    fail=1
    return
  }
  for entry in "portal:$PORTAL_PORT" "gateway:$GATEWAY_PORT" "mcp:$MCP_PORT" "review:$REVIEW_PORT"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    pid=$(listener_pid "$port" "$BIND")
    if [ -z "$pid" ]; then
      echo "FAIL running-code-not-stale: nothing is listening on the $name entrance ${BIND}:${port}, so the revision it serves is unknown"
      stale=1
      continue
    fi
    start=$(ps -o lstart= -p "$pid" 2>/dev/null) || start=""
    stamp=""
    if [ -n "$start" ]; then
      stamp=$(touch_stamp "$start") || stamp=""
    fi
    if [ -z "$stamp" ] || ! touch -t "$stamp" "$anchor" 2>/dev/null; then
      echo "FAIL running-code-not-stale: cannot read the start time of pid $pid on the $name entrance"
      stale=1
      continue
    fi
    newest=$(find "$TREE/src" -type f -newer "$anchor" -print -quit 2>/dev/null) || newest=""
    if [ -n "$newest" ]; then
      echo "FAIL running-code-not-stale: the $name entrance (pid $pid) started $start, before $newest was written"
      stale=1
    fi
  done
  rm -f "$anchor"
  if [ "$stale" = "1" ]; then
    echo "FAIL running-code-not-stale: a listening entrance is older than the tree it serves; restart the daemons"
    fail=1
  else
    echo "ok running-code-not-stale"
  fi
}

check_running_revision
check_running_code_is_current

check "portal-local" "http://${BIND}:${PORTAL_PORT}/public" "200"
check "review-local" "http://${BIND}:${REVIEW_PORT}/review/login" "200"
check "portal-public" "${PUBLIC}/public" "200"
check "review-public" "${PUBLIC}/review/login" "200"
# Anonymous catalog through the tunnel must stay a well-formed envelope
# (fail-closed reads, never an error page or a leak of pending records).
body=$(curl -s -m 10 "${PUBLIC}/api/catalog") || body=""
case "$body" in
  '{"ok":true,"data":'*) echo "ok catalog-envelope" ;;
  *) echo "FAIL catalog-envelope got $body"; fail=1 ;;
esac
check "internal-anon-404" "http://${BIND}:${PORTAL_PORT}/internal" "404"
# The Gateway authorizes and routes; it never executes a tool. The port being
# open says nothing about that, so the entrance is asked directly — same
# question and same expectation as the Linux gate.
check "gateway-does-not-execute-tools" \
  "http://${BIND}:${GATEWAY_PORT}/gateway/mcp/probe/tools/call" "405" -X POST
# MCP speaks JSON-RPC over POST and must say who it is.
mcp=$(curl -s -m 10 -w '\n%{http_code}' -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"deploy-gate","version":"1"}}}' \
  "http://${BIND}:${MCP_PORT}/") || mcp=$'\n000'
mcp_code="${mcp##*$'\n'}"
mcp_body="${mcp%$'\n'*}"
case "${mcp_code}:${mcp_body}" in
  200:*'"name":"portico"'*) echo "ok mcp-jsonrpc-initialize" ;;
  200:*) echo "FAIL mcp-jsonrpc-initialize got a 200 that is not a portico initialize result"; fail=1 ;;
  *) echo "FAIL mcp-jsonrpc-initialize got $mcp_code want 200"; fail=1 ;;
esac

exit "$fail"
