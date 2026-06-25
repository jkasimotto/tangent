#!/usr/bin/env bash
# Runs ONE pipeline stage forever: invoke its Claude prompt headless, then sleep one tick.
# Launched (and detached) by run-loops.sh; not meant to be run by hand. The stage's prompt
# self-gates (exits immediately when its inbox is empty), so an idle tick is cheap.
set -uo pipefail

NAME="$1"          # stage label, e.g. "scope"
PROMPT_PATH="$2"   # absolute path to the stage prompt markdown
REPO_ROOT="$3"     # cwd for claude: the repo the loops operate on
LOG_DIR="$4"
TICK="${TANGENT_LOOPS_TICK:-1800}"   # seconds between ticks (default 30 min)
MODEL="${TANGENT_LOOPS_MODEL:-}"

cd "$REPO_ROOT"
model_args=()
[ -n "$MODEL" ] && model_args=(--model "$MODEL")

# Survive the launching terminal closing.
trap '' HUP

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $NAME tick start" >> "$LOG_DIR/$NAME.log"
  claude -p "$(cat "$PROMPT_PATH")" \
    --dangerously-skip-permissions \
    "${model_args[@]}" \
    >> "$LOG_DIR/$NAME.log" 2>&1 \
    || echo "[$(date '+%H:%M:%S')] $NAME tick exited non-zero" >> "$LOG_DIR/$NAME.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $NAME tick done; sleeping ${TICK}s" >> "$LOG_DIR/$NAME.log"
  sleep "$TICK"
done
