#!/usr/bin/env bash
# Starts every pipeline loop as its own interactive Claude session inside a dedicated tmux session,
# so you can attach, watch the agent work, and steer it. Each stage gets one session named
# "tangent-loop-<stage>". The stages coordinate only through ~/.tangent/features/<slug>/ (see
# dossier.mjs), so they can be started, stopped, or restarted independently.
#
#   TANGENT_LOOPS_YES=1 ./pipeline/run-loops.sh      start all loops
#   ./pipeline/stop-loops.sh                          stop them
#   tmux attach -t tangent-loop-scope                 watch / steer one
#   tmux ls | grep tangent-loop                       list them
#
# Env knobs:
#   TANGENT_LOOPS_MODEL    model override passed to `claude --model`
#   TANGENT_LOOPS_LOG_DIR  log directory (default ~/.tangent/loops)
set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PIPELINE_DIR/.." && pwd)"
LOG_DIR="${TANGENT_LOOPS_LOG_DIR:-$HOME/.tangent/loops}"
SESSION_PREFIX="tangent-loop-"

command -v tmux >/dev/null 2>&1 || { echo "tmux is not installed; install it to run the loops." >&2; exit 1; }

if [ "${TANGENT_LOOPS_YES:-}" != "1" ]; then
  cat <<EOF
The feature pipeline runs Claude Code with --dangerously-skip-permissions inside tmux.
Each stage opens an INTERACTIVE Claude session that may, on its own:
  edit files, create git worktrees, run builds, merge to main, and redeploy the app.
You can attach to any session to watch or steer it:
  tmux attach -t ${SESSION_PREFIX}scope
Pane output is mirrored to: $LOG_DIR/<stage>.log

To start anyway:  TANGENT_LOOPS_YES=1 $0
EOF
  exit 1
fi

mkdir -p "$LOG_DIR"

# stage label : prompt file  (one tmux session per stage; all independent)
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
  session="${SESSION_PREFIX}${name}"

  if [ ! -f "$prompt_path" ]; then
    echo "WARN: missing prompt $prompt_path; skipping loop '$name'"
    continue
  fi
  if tmux has-session -t "=$session" 2>/dev/null; then
    echo "loop '$name' already running (tmux session $session); skipping. Stop it first to restart."
    continue
  fi

  # Build the in-session command with shell-safe quoting, then let tmux run it in a fresh pty so
  # claude sees a TTY and starts interactive. remain-on-exit keeps the pane around after claude
  # quits so a crash or early exit is inspectable; pipe-pane mirrors the pane to the stage log.
  cmd=$(printf '%q ' "$PIPELINE_DIR/loop-stage.sh" "$name" "$REPO_ROOT")
  tmux new-session -d -s "$session" -c "$REPO_ROOT" "$cmd"
  tmux set-option -t "$session" remain-on-exit on >/dev/null   # window option: plain session target, not =exact (that resolves a window name)
  logcmd=$(printf 'cat >> %q' "$LOG_DIR/$name.log")
  tmux pipe-pane -o -t "$session" "$logcmd"

  # Type the stage's `/loop <prompt>` into the REPL once claude is up. We can't pass it as the CLI
  # arg (a leading slash command there is treated as literal text, not invoked). Wait for the input
  # box, then paste with bracketed paste (-p) so the multi-line prompt lands as ONE input that still
  # starts with `/loop`, then submit with Enter.
  for _ in $(seq 1 40); do
    tmux capture-pane -p -t "$session" 2>/dev/null | grep -q 'bypass permissions on' && break
    sleep 0.5
  done
  tmux set-buffer -b "$session" -- "/loop $(cat "$prompt_path")"
  tmux paste-buffer -p -b "$session" -t "$session"   # -p = bracketed paste so the multi-line prompt is one input
  tmux send-keys -t "$session" Enter
  echo "started loop '$name' (tmux session $session)"
done

echo ""
echo "All loops running as interactive tmux sessions."
echo "Attach:  tmux attach -t ${SESSION_PREFIX}<stage>   (e.g. ${SESSION_PREFIX}scope)"
echo "List:    tmux ls | grep ${SESSION_PREFIX}"
echo "Logs:    $LOG_DIR/<stage>.log"
echo "Stop:    $PIPELINE_DIR/stop-loops.sh"
