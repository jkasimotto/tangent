#!/usr/bin/env bash
# Stops every loop started by run-loops.sh, plus any claude child a loop spawned mid-tick.
set -uo pipefail

LOG_DIR="${TANGENT_LOOPS_LOG_DIR:-$HOME/.tangent/loops}"
PIDFILE="$LOG_DIR/pids"

if [ ! -f "$PIDFILE" ]; then
  echo "No pidfile at $PIDFILE; nothing to stop."
  exit 0
fi

while read -r pid name; do
  [ -n "${pid:-}" ] || continue
  pkill -P "$pid" 2>/dev/null || true   # the in-flight claude child, if any
  if kill "$pid" 2>/dev/null; then
    echo "stopped loop '$name' (pid $pid)"
  else
    echo "loop '$name' (pid $pid) was not running"
  fi
done < "$PIDFILE"

: > "$PIDFILE"
echo "All loops stopped."
