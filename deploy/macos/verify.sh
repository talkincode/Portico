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
