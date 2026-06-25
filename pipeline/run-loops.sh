#!/usr/bin/env bash
# Starts the event-driven feature pipeline: one tmux session running the watcher (watch.mjs), which
# watches ~/.tangent and dispatches a FRESH per-feature agent (clean context, one item) into its own
# tmux session whenever work appears in an inbox. No persistent agent and no polling sleep: work is
# picked up when it appears, and each feature is reasoned about from a clean slate. Agents ping you
# via terminal-notifier when they need a decision.
#
#   TANGENT_LOOPS_YES=1 ./pipeline/run-loops.sh     start the watcher (+ an initial dispatch sweep)
#   ./pipeline/stop-loops.sh                          stop the watcher + any in-flight agents
#   tmux attach -t tangent-loop-watch                 watch the dispatcher
#   tmux ls | grep tangent-loop                       list the watcher + in-flight per-feature agents
#
# Env knobs:
#   TANGENT_LOOPS_MODEL    model override passed to `claude --model`
#   TANGENT_LOOPS_LOG_DIR  log directory (default ~/.tangent/loops)
#   TANGENT_HOME           parent of .tangent (default $HOME)
set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PIPELINE_DIR/.." && pwd)"
LOG_DIR="${TANGENT_LOOPS_LOG_DIR:-$HOME/.tangent/loops}"
WATCH_SESSION="tangent-loop-watch"

command -v tmux >/dev/null 2>&1 || { echo "tmux is not installed; install it to run the loops." >&2; exit 1; }

if [ "${TANGENT_LOOPS_YES:-}" != "1" ]; then
  cat <<EOF
The feature pipeline dispatches Claude Code agents with --dangerously-skip-permissions whenever work
appears in an inbox. Each agent runs once, for one feature, in a fresh context, and may on its own:
  edit files, create git worktrees, run builds, merge to main, and redeploy the app.
Agents notify you via terminal-notifier when they need a decision. Watch the dispatcher with:
  tmux attach -t $WATCH_SESSION

To start anyway:  TANGENT_LOOPS_YES=1 $0
EOF
  exit 1
fi

mkdir -p "$LOG_DIR"

if tmux has-session -t "=$WATCH_SESSION" 2>/dev/null; then
  echo "watcher already running (tmux session $WATCH_SESSION). Run stop-loops.sh first to restart." >&2
  exit 1
fi

cmd=$(printf '%q ' node "$PIPELINE_DIR/watch.mjs")
tmux new-session -d -s "$WATCH_SESSION" -c "$REPO_ROOT" "$cmd"
tmux set-option -t "$WATCH_SESSION" remain-on-exit on >/dev/null   # keep the pane if the watcher dies, for inspection
tmux pipe-pane -o -t "$WATCH_SESSION" "$(printf 'cat >> %q' "$LOG_DIR/watch.log")"

echo "watcher running (tmux session $WATCH_SESSION)."
echo "It dispatches a fresh agent per feature as work appears; each gets its own tangent-loop-<stage>-<slug> session."
echo "Attach:  tmux attach -t $WATCH_SESSION"
echo "List:    tmux ls | grep tangent-loop"
echo "Logs:    $LOG_DIR/  (watch.log, plus <stage>-<slug>.log per agent)"
echo "Stop:    $PIPELINE_DIR/stop-loops.sh"
