#!/usr/bin/env bash
# Health gate for the macOS deployment. No sudo needed: it only reads
# local ports and the public URLs. Non-zero exit on any failure so the
# runbook (`render` -> install daemons -> `verify`) fails loudly instead
# of leaving a half-system behind.
set -euo pipefail

fail=0
check() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$url") || code="000"
  if [ "$code" = "$expect" ]; then
    echo "ok $name $code"
  else
    echo "FAIL $name got $code want $expect"
    fail=1
  fi
}

# Optional revision pin, mirroring deploy/verify.sh. The probes below only
# prove behaviour, and behaviour is exactly what a daemon that was never
# restarted still answers, so a run that has to name the shipped revision
# sets PORTICO_EXPECT_SHA and gets a verdict on it. Unpinned runs stay silent
# rather than claim a revision they were never told to check.
#
# This runs before the probes on purpose: a wrong revision is the cheapest
# thing to detect and the most expensive to miss, so it reports first and
# survives a probe that hangs or dies half way through.
if [ -n "${PORTICO_EXPECT_SHA:-}" ]; then
  tree="${PORTICO_DEPLOY_TREE:-$(cd "$(dirname "$0")/../.." && pwd)}"
  head=$(git -C "$tree" rev-parse HEAD 2>/dev/null) || head=""
  if [ "$head" = "$PORTICO_EXPECT_SHA" ]; then
    echo "ok checkout-revision"
  else
    echo "FAIL checkout-revision got ${head:-unknown} want $PORTICO_EXPECT_SHA"
    fail=1
  fi
fi

check "portal-local" "http://127.0.0.1:8788/public" "200"
check "review-local" "http://127.0.0.1:8791/review/login" "200"
check "portal-public" "https://portico.talkincode.net/public" "200"
check "review-public" "https://portico.talkincode.net/review/login" "200"
# Anonymous catalog through the tunnel must stay a well-formed envelope
# (fail-closed reads, never an error page or a leak of pending records).
body=$(curl -s -m 10 "https://portico.talkincode.net/api/catalog") || body=""
case "$body" in
  '{"ok":true,"data":'*) echo "ok catalog-envelope" ;;
  *) echo "FAIL catalog-envelope got $body"; fail=1 ;;
esac
check "internal-anon-404" "http://127.0.0.1:8788/internal" "404"

exit "$fail"
