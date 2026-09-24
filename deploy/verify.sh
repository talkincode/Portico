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
#   PORTICO_DEPLOY_BIND        address the entrances serve on, when the
#                              deployment injects one (systemd drop-in /
#                              EnvironmentFile). Unset means the gate reads it
#                              from the listeners and refuses to guess when a
#                              port has two of them.
#   PORTICO_DEPLOY_PORTAL_PORT Portal port (default 8788)
#   PORTICO_DEPLOY_GATEWAY_PORT Gateway port (default 8789)
#   PORTICO_DEPLOY_MCP_PORT    MCP port (default 8790)
#   PORTICO_DEPLOY_TREE        checkout the entrances were started from
#                              (default: this script's parent directory)
#   PORTICO_EXPECT_SHA         pin the checkout revision; mismatch fails
#   PORTICO_DEPLOY_ALLOW_UNPINNED  accept a run that pins no revision, reported
#                              as a `skip`; without it an unpinned run fails
#   PORTICO_DEPLOY_REVIEW_ORIGIN  the Review entrance this deployment serves:
#                              `off` (default) when it serves none, or the
#                              absolute origin the Portal links to
set -uo pipefail

BIND="${PORTICO_DEPLOY_BIND:-}"
PORTAL_PORT="${PORTICO_DEPLOY_PORTAL_PORT:-8788}"
GATEWAY_PORT="${PORTICO_DEPLOY_GATEWAY_PORT:-8789}"
MCP_PORT="${PORTICO_DEPLOY_MCP_PORT:-8790}"
TREE="${PORTICO_DEPLOY_TREE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

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

# --- which address each entrance serves on ---------------------------------

# `localhost` and `127.0.0.1` are the same entrance to curl, and IPv6 prints
# its own brackets: comparing the two literally would call a working deployment
# broken.
same_address() {
  local a b
  a="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  b="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  [ "$a" = "$b" ] && return 0
  case "${a}/${b}" in
    localhost/127.0.0.1 | 127.0.0.1/localhost) return 0 ;;
    localhost/::1 | ::1/localhost) return 0 ;;
  esac
  return 1
}

is_wildcard() {
  case "$1" in 0.0.0.0 | '*' | ::) return 0 ;; esac
  return 1
}

# A wildcard entrance answers on every interface including the loopback, which
# is the address this gate can always reach.
probe_host() {
  if is_wildcard "$1"; then printf '127.0.0.1\n'; else printf '%s\n' "$1"; fi
}

# Every address a port listens on, one per line. Reading the whole table rather
# than the first matching row keeps a second listener on the same port visible
# instead of hidden behind it.
listener_addresses() { # port
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '$1 == "LISTEN" { print $4 }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk '/\(LISTEN\)/ { print $(NF - 1) }'
  fi | sed -n "s/^\(.*\):$1\$/\1/p" | sed 's/^\[\(.*\)\]$/\1/' | sort -u
}

SERVES_portal=""; SERVES_gateway=""; SERVES_mcp=""
VERIFY_portal=""; VERIFY_gateway=""; VERIFY_mcp=""
address_problems=""
wildcard_ports=""

# The address an entrance serves on is a property of the deployment — the run
# scripts read it from the environment and the units inject it — so a gate that
# assumes the loopback default reports a healthy deployment as ten broken
# promises, all of them about its own guess. Read the address from the
# deployment instead, and when the port alone cannot say which process serves
# it, refuse to guess.
for entry in "portal:${PORTAL_PORT}" "gateway:${GATEWAY_PORT}" "mcp:${MCP_PORT}"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  listeners="$(listener_addresses "$port")"
  count=$(printf '%s' "$listeners" | grep -c . || true)
  problem=""
  if [ "$count" = "0" ]; then
    served="${BIND:-127.0.0.1}"
    if [ -n "$BIND" ]; then
      problem="the ${name} port ${port} has nothing listening on it, and PORTICO_DEPLOY_BIND=${BIND} is declared"
    else
      problem="nothing is listening on the ${name} port ${port}"
    fi
  elif [ "$count" = "1" ] && { [ -z "$BIND" ] || same_address "$listeners" "$BIND"; }; then
    served="${BIND:-$listeners}"
  elif [ "$count" != "1" ]; then
    listing="$(printf '%s' "$listeners" | tr '\n' ' ')"
    if [ -n "$BIND" ]; then
      served="$BIND"
      problem="two addresses listen on the ${name} port ${port} (${listing% }), so PORTICO_DEPLOY_BIND=${BIND} cannot say which one this deployment serves"
    else
      served="$(printf '%s' "$listeners" | grep -vxE '0\.0\.0\.0|::|\*' | head -n 1)"
      [ -n "$served" ] || served="$(printf '%s' "$listeners" | head -n 1)"
      problem="two addresses listen on the ${name} port ${port} (${listing% }); declare PORTICO_DEPLOY_BIND so the gate knows which one this deployment serves"
    fi
  else
    # The declared address is the entrance this deployment claims. Probing the
    # address that does answer instead would verify somebody else's process and
    # quietly pass the checks the declared entrance just failed.
    served="$BIND"
    problem="PORTICO_DEPLOY_BIND=${BIND} is declared, but the entrance on the ${name} port ${port} answers on ${listeners}"
  fi
  printf -v "SERVES_${name}" '%s' "$served"
  printf -v "VERIFY_${name}" '%s' "$(probe_host "$served")"
  [ -n "$problem" ] && address_problems="${address_problems}${problem}
"
  printf '%s' "$listeners" | grep -qxE '0\.0\.0\.0|::|\*' &&
    wildcard_ports="${wildcard_ports}${name}:${port} "
done

PORTAL="http://${VERIFY_portal}:${PORTAL_PORT}"
GATEWAY="http://${VERIFY_gateway}:${GATEWAY_PORT}"
MCP="http://${VERIFY_mcp}:${MCP_PORT}"

printf 'Portico deployment gate: portal=%s gateway=%s mcp=%s tree=%s\n' \
  "$PORTAL" "$GATEWAY" "$MCP" "$TREE"

# Which address is serving has to be answered before anything is probed: the
# behaviour checks below are only as honest as the address they were pointed at.
if [ -n "$address_problems" ]; then
  while IFS= read -r problem; do
    [ -n "$problem" ] && bad entrance-address "$problem"
  done <<EOF
${address_problems}
EOF
elif [ -n "$BIND" ]; then
  ok "entrance-address portal=${SERVES_portal}:${PORTAL_PORT} gateway=${SERVES_gateway}:${GATEWAY_PORT} mcp=${SERVES_mcp}:${MCP_PORT} (declared PORTICO_DEPLOY_BIND=${BIND})"
else
  ok "entrance-address portal=${SERVES_portal}:${PORTAL_PORT} gateway=${SERVES_gateway}:${GATEWAY_PORT} mcp=${SERVES_mcp}:${MCP_PORT} (discovered from the listeners)"
fi

# A wildcard entrance is reachable from every network the host is on. The
# scripts cannot say `0.0.0.0`, but only the host can show what is running.
if [ -n "$wildcard_ports" ]; then
  bad entrance-not-all-interfaces "an entrance bound to every interface (${wildcard_ports% }) is not bound to the address this deployment serves"
else
  ok entrance-not-all-interfaces
fi

# The product page, not an error page. The live Portal answers a 404 with the
# same `<title>Portico · Portico</title>` and the same shell, so a title check
# alone accepts an error page: the category navigation only renders for a real
# discovery page.
probe "$PORTAL/"
if [ "$code" = "200" ] && contains "$payload" '<title>Portico' &&
  contains "$payload" 'class="nav"'; then
  ok portal-product-page
else
  bad portal-product-page "HTTP $code is not the discovery shell (title or category nav missing)"
fi

# Day-to-day review lives on the internal content workbench. The discovery
# page must not advertise a parallel /review or external review chrome.
if contains "$payload" 'href="/review' || contains "$payload" '>审核<' || contains "$payload" '去审核'; then
  bad portal-review-entry "the discovery page still advertises a separate review entrance"
else
  ok portal-review-entry
fi

expect_status portal-public-plane "$PORTAL/public" 200
# Anonymous must not reach the internal plane: 404 (not found) or 303 (redirect
# to login) both deny access. The Catalog API must stay a well-formed envelope.
probe "$PORTAL/internal"
if [ "$code" = "404" ] || [ "$code" = "303" ]; then
  ok portal-internal-fail-closed
else
  bad portal-internal-fail-closed "HTTP $code exposes the internal plane to anonymous; want 404 or 303"
fi
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

# The pid behind one entrance. Matching the address as well as the port keeps a
# second listener on the same port from being measured in place of the one this
# deployment serves; a wildcard row owns the port rather than one address on
# it, so it is the fallback.
listener_pid() { # port [address]
  local port="$1" want="${2:-}" pid=""
  if command -v ss >/dev/null 2>&1; then
    pid=$(ss -ltnp 2>/dev/null | awk -v port="$port" -v want="$want" '
      $1 == "LISTEN" && $4 ~ (":" port "$") {
        address = $4
        sub(":" port "$", "", address)
        gsub(/^\[|\]$/, "", address)
        if (address == want) exact = $0
        else if (address == "0.0.0.0" || address == "::" || address == "*") every = $0
      }
      END {
        row = (exact != "" ? exact : every)
        if (row ~ /pid=/) {
          sub(/.*pid=/, "", row)
          sub(/[^0-9].*/, "", row)
          print row
        }
      }')
  fi
  if [ -z "$pid" ] && [ -n "$want" ] && command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -nP -i@"${want}":"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1)
  fi
  if [ -z "$pid" ] && command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1)
  fi
  printf '%s' "$pid"
}

# A merge or a pull that is not followed by a real restart leaves the previous
# revision answering on the same ports. Comparing each listener's start time
# against the tree it serves is what separates the two.
check_running_code_is_current() {
  local anchor stale=0 unknown=0 entry name port pid start stamp newest wanted
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
    wanted="VERIFY_${name}"
    pid=$(listener_pid "$port" "${!wanted}")
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

# What a launcher recorded for one process, read back from the kernel: `ps eww`
# prints the environment a process was *started* with, so the value is fixed at
# exec time and only starting the process again can change it. (macOS quotes
# each entry in that output; the Linux form is bare.)
#
# Only that one variable is extracted, and only when it looks like a revision:
# the same output carries whatever else the deployment exported — env files hold
# credentials — so repeating it would turn a read-only check into a disclosure
# in the deploy log.
capture_launch_revision() { # pid
  local pid="$1" line
  line=$(ps eww -p "$pid" 2>/dev/null)
  printf '%s\n' "$line" | tr -d "'" | tr ' ' '\n' |
    sed -n 's/^PORTICO_REVISION=\([0-9a-f]\{7,64\}\)$/\1/p' | head -n 1
}

# The same no-op restart `check_running_code_is_current` below catches by dates,
# caught instead by the record the launcher left behind. A file time can be moved
# without restarting anything (a restore, a touch, a clock), and a previous
# revision answers every probe with the same product page; the revision a process
# was started from cannot be talked out of it — it is the only evidence here that
# *is* the restart, rather than a side effect of one.
check_running_revision() {
  local expected entry name port pid wanted reported seen=0 wrong=0
  expected=$(git -C "$TREE" rev-parse HEAD 2>/dev/null)
  if [ -z "$expected" ]; then
    skip running-revision "the tree at $TREE is not a git checkout, so there is no revision for the entrances to have been started from"
    return
  fi
  for entry in "portal:${PORTAL_PORT}" "gateway:${GATEWAY_PORT}" "mcp:${MCP_PORT}"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    wanted="VERIFY_${name}"
    pid=$(listener_pid "$port" "${!wanted}")
    if [ -z "$pid" ]; then
      # Nothing is listening, so there is no launch record to read; the address
      # check above and the start-time check below already report that as their
      # own failure rather than letting it read as a verified entrance here.
      continue
    fi
    seen=1
    reported=$(capture_launch_revision "$pid")
    if [ -z "$reported" ]; then
      wrong=1
      bad running-revision "the ${name} entrance (pid ${pid}) recorded no PORTICO_REVISION, so the revision it serves is unknown; restart it with the launcher that records one"
    elif [ "$reported" != "$expected" ]; then
      wrong=1
      bad running-revision "the ${name} entrance (pid ${pid}) was started from ${reported}, but the tree is at ${expected}; restart it onto this checkout"
    fi
  done
  if [ "$wrong" = "1" ]; then
    return
  fi
  if [ "$seen" = "0" ]; then
    skip running-revision "no listening entrance to read a launch record from"
  else
    ok running-revision
  fi
}

check_running_revision
check_running_code_is_current

# The revision pin is required, not optional. Behaviour is exactly what a
# daemon that was never restarted still answers, so a run that never named a
# revision has verified no deployment — letting it exit 0 behind a wall of green
# probes is the same silence the pin was added to remove. Only an explicit
# acceptance turns the omission into a `skip`: a host that is not a checkout can
# still be probed, but it says so on the record.
#
# Truthiness matches the runtime's `isEnabledFlag` (src/access/cf-access.ts):
# an explicit yes, never a stray non-empty string.
accepts_unpinned() {
  case "$(printf '%s' "${PORTICO_DEPLOY_ALLOW_UNPINNED:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
  esac
  return 1
}

if [ -n "${PORTICO_EXPECT_SHA:-}" ]; then
  head=$(git -C "$TREE" rev-parse HEAD 2>/dev/null)
  if [ "$head" = "$PORTICO_EXPECT_SHA" ]; then
    ok checkout-revision
  else
    bad checkout-revision "tree is at ${head:-unknown}, expected ${PORTICO_EXPECT_SHA}"
  fi
elif accepts_unpinned; then
  skip checkout-revision \
    "PORTICO_EXPECT_SHA is not set, so this run proves behaviour only (accepted by PORTICO_DEPLOY_ALLOW_UNPINNED)"
else
  bad checkout-revision \
    "PORTICO_EXPECT_SHA is not set, so nothing here names the revision being served; pin it, or accept a behaviour-only run with PORTICO_DEPLOY_ALLOW_UNPINNED=1"
fi

if [ "$fail" = "0" ]; then
  printf 'deployment verified: the three entrances answer the product contract\n'
else
  printf 'deployment NOT verified: see the FAIL lines above\n'
fi
exit "$fail"
