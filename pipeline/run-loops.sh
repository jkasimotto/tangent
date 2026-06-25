#!/usr/bin/env bash
# Starts every pipeline loop as a detached background process, each ticking on its own timer.
# The loops coordinate only through ~/.tangent/features/<slug>/ (see dossier.mjs), so they need no
# shared memory and can be started, stopped, or restarted independently.
#
#   TANGENT_LOOPS_YES=1 ./pipeline/run-loops.sh      start all loops
#   ./pipeline/stop-loops.sh                          stop them
#
# Env knobs:
#   TANGENT_LOOPS_TICK     seconds between ticks (default 1800 = 30 min)
#   TANGENT_LOOPS_MODEL    model override passed to `claude --model`
#   TANGENT_LOOPS_LOG_DIR  log/pid directory (default ~/.tangent/loops)
set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PIPELINE_DIR/.." && pwd)"
LOG_DIR="${TANGENT_LOOPS_LOG_DIR:-$HOME/.tangent/loops}"
PIDFILE="$LOG_DIR/pids"

if [ "${TANGENT_LOOPS_YES:-}" != "1" ]; then
  cat <<EOF
The feature pipeline runs Claude Code UNATTENDED with --dangerously-skip-permissions.
Each loop ticks every ${TANGENT_LOOPS_TICK:-1800}s and may, on its own:
  edit files, create git worktrees, run builds, merge to main, and redeploy the app.
Logs will be written to: $LOG_DIR/<stage>.log

To start anyway:  TANGENT_LOOPS_YES=1 $0
EOF
  exit 1
fi

mkdir -p "$LOG_DIR"

# Refuse to double-start if a prior run left live pids.
if [ -f "$PIDFILE" ]; then
  while read -r pid _; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      echo "Loops already running (pid $pid in $PIDFILE). Run stop-loops.sh first." >&2
      exit 1
    fi
  done < "$PIDFILE"
fi
: > "$PIDFILE"

# stage label : prompt file  (one process per stage; all run concurrently)
STAGES=(
  "feedback:0-feedback.md"
  "scope:1-scope.md"
  "ux:2-ux.md"
  "plan:3-plan.md"
  "implement:4-implement.md"
  "review:5-review.md"
  "deploy:6-deploy.md"
)

for entry in "${STAGES[@]}"; do
  name="${entry%%:*}"
  prompt_file="${entry#*:}"
  prompt_path="$PIPELINE_DIR/prompts/$prompt_file"
  if [ ! -f "$prompt_path" ]; then
    echo "WARN: missing prompt $prompt_path; skipping loop '$name'"
    continue
  fi
  nohup "$PIPELINE_DIR/loop-stage.sh" "$name" "$prompt_path" "$REPO_ROOT" "$LOG_DIR" >/dev/null 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid $name" >> "$PIDFILE"
  echo "started loop '$name' (pid $pid)"
  sleep 3   # stagger starts so the loops don't all hit the API on the same tick
done

echo ""
echo "All loops running every ${TANGENT_LOOPS_TICK:-1800}s."
echo "Logs:  $LOG_DIR/<stage>.log"
echo "PIDs:  $PIDFILE"
echo "Stop:  $PIPELINE_DIR/stop-loops.sh"
