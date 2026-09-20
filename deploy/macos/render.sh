#!/usr/bin/env bash
# Render deploy/macos templates into live host files.
#
# Deployment is a deterministic function of (repo templates + three host
# values). Nothing is hand-edited on the host: re-running this script after
# `git pull` converges the host to the repo, which is what makes a stale
# run.sh (the old three-process copy that once took the whole supervisor
# down) impossible to leave behind silently.
#
# Usage (no sudo needed):
#   PORTICO_HOME=~/portico \
#   PORTICO_TUNNEL_ID=<uuid from 'cloudflared tunnel create'> \
#   PORTICO_EDGE_BIND=<mac egress ip, e.g. its en1 address> \
#   PORTICO_USER=<mac username> \
#   ./deploy/macos/render.sh
#
# The script never overwrites an existing portico.env (live env may carry
# operator choices); it creates it from the example only on first run.
# Secrets (tunnel credentials JSON, session tokens) are never rendered:
# they already live mode-600 next to the live scripts.
set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${PORTICO_HOME:?set PORTICO_HOME, e.g. /Users/example/portico}"
TUNNEL_ID="${PORTICO_TUNNEL_ID:?set PORTICO_TUNNEL_ID from 'cloudflared tunnel create'}"
EDGE_BIND="${PORTICO_EDGE_BIND:?set PORTICO_EDGE_BIND to the Mac egress IP}"
USER_NAME="${PORTICO_USER:?set PORTICO_USER to the Mac username}"

render() {
  sed -e "s#/Users/example/portico#${HOME_DIR}#g" \
    -e "s#TUNNEL_ID#${TUNNEL_ID}#g" \
    -e "s#EDGE_BIND_IP#${EDGE_BIND}#g" \
    -e "s#<string>example</string>#<string>${USER_NAME}</string>#g" \
    "$1"
}

mkdir -p "$HOME_DIR" "$HOME_DIR/logs"
render "$TEMPLATE_DIR/run.sh" > "$HOME_DIR/run.sh"
render "$TEMPLATE_DIR/run-cloudflared.sh" > "$HOME_DIR/run-cloudflared.sh"
render "$TEMPLATE_DIR/config.yml" > "$HOME_DIR/config.yml"
render "$TEMPLATE_DIR/net.portico.macstudio.plist" > "$HOME_DIR/net.portico.macstudio.plist"
render "$TEMPLATE_DIR/net.portico.cloudflared.plist" > "$HOME_DIR/net.portico.cloudflared.plist"
chmod +x "$HOME_DIR/run.sh" "$HOME_DIR/run-cloudflared.sh"
chmod 600 "$HOME_DIR/config.yml"
if [ ! -f "$HOME_DIR/portico.env" ]; then
  render "$TEMPLATE_DIR/portico.env.example" > "$HOME_DIR/portico.env"
fi

bash -n "$HOME_DIR/run.sh"
bash -n "$HOME_DIR/run-cloudflared.sh"
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$HOME_DIR/net.portico.macstudio.plist"
  plutil -lint "$HOME_DIR/net.portico.cloudflared.plist"i
if [ -x "$HOME_DIR/bin/cloudflared" ]; then
  "$HOME_DIR/bin/cloudflared" tunnel --config "$HOME_DIR/config.yml" ingress validate
fi
echo "rendered $HOME_DIR from $TEMPLATE_DIR"
