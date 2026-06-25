#!/usr/bin/env bash
# Runs ONE pipeline stage as a single interactive Claude session.
# Launched inside a dedicated tmux session by run-loops.sh (not meant to be run by hand).
# Unlike the old headless `claude -p` loop, this opens an INTERACTIVE claude you can attach to,
# watch, and steer; it does not auto-tick. The stage prompt still self-gates (it exits early when
# its inbox is empty), but interactive claude then waits at the REPL instead of looping. When you
# exit claude, the stage session ends.
set -uo pipefail

NAME="$1"          # stage label, e.g. "scope"
PROMPT_PATH="$2"   # absolute path to the stage prompt markdown
REPO_ROOT="$3"     # cwd for claude: the repo the loops operate on
MODEL="${TANGENT_LOOPS_MODEL:-}"

cd "$REPO_ROOT"
model_args=()
[ -n "$MODEL" ] && model_args=(--model "$MODEL")

# Interactive (no -p) so you can answer and redirect it; the prompt is submitted as the first turn.
# ${arr[@]+"${arr[@]}"} expands safely even when empty under `set -u` (macOS bash 3.2).
exec claude "$(cat "$PROMPT_PATH")" \
  --dangerously-skip-permissions \
  ${model_args[@]+"${model_args[@]}"}
