#!/bin/bash
# Installs launchd as the sole outer supervisor for the Agent Shell gateway.
set -euo pipefail

cd "$(dirname "$0")"
LABEL="com.tangent.agent-shell"
APP_DIR="$(cd .. && pwd)"
NODE_BIN="$(command -v node)"
LOG_PATH="$HOME/.tangent/agent-shell.log"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="com.tangent.agent-shell.plist.template"
TEMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/agent-shell-launch-agent.XXXXXX")"
trap 'rm -f "$TEMP_PLIST"' EXIT

escape_template() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
    | sed 's/[\/&]/\\&/g'
}

mkdir -p "$HOME/.tangent" "$HOME/Library/LaunchAgents"
sed \
  -e "s/__NODE__/$(escape_template "$NODE_BIN")/g" \
  -e "s/__APP_DIR__/$(escape_template "$APP_DIR")/g" \
  -e "s/__PATH__/$(escape_template "$PATH")/g" \
  -e "s/__LOG__/$(escape_template "$LOG_PATH")/g" \
  "$TEMPLATE" > "$TEMP_PLIST"
plutil -lint "$TEMP_PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
mv "$TEMP_PLIST" "$PLIST_PATH"
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "installed: $PLIST_PATH"
