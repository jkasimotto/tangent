#!/usr/bin/env bash
# Stops every interactive loop session started by run-loops.sh by killing its tmux session,
# which also kills the claude process running inside it.
set -uo pipefail

SESSION_PREFIX="tangent-loop-"

command -v tmux >/dev/null 2>&1 || { echo "tmux is not installed; nothing to stop." ; exit 0; }

sessions=$(tmux ls -F '#{session_name}' 2>/dev/null | grep "^${SESSION_PREFIX}" || true)
if [ -z "$sessions" ]; then
  echo "No ${SESSION_PREFIX}* tmux sessions; nothing to stop."
  exit 0
fi

while read -r session; do
  [ -n "$session" ] || continue
  if tmux kill-session -t "=$session" 2>/dev/null; then
    echo "stopped loop session '$session'"
  else
    echo "could not stop '$session'"
  fi
done <<< "$sessions"

echo "All loop sessions stopped."
