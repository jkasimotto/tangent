#!/usr/bin/env bash
# Runs ONE pipeline stage as a single interactive Claude session.
# Launched inside a dedicated tmux session by run-loops.sh (not meant to be run by hand).
# This only LAUNCHES interactive claude (no -p, no prompt arg). run-loops.sh then types the stage's
# `/loop <prompt>` into the REPL after launch, because a slash command passed as the initial CLI
# argument is treated as literal text and would not invoke the /loop skill.
set -uo pipefail

NAME="$1"          # stage label, e.g. "scope" (unused here; kept for a readable `ps`/pane title)
REPO_ROOT="$2"     # cwd for claude: the repo the loops operate on
MODEL="${TANGENT_LOOPS_MODEL:-}"

cd "$REPO_ROOT"
model_args=()
[ -n "$MODEL" ] && model_args=(--model "$MODEL")

# ${arr[@]+"${arr[@]}"} expands safely even when empty under `set -u` (macOS bash 3.2).
exec claude \
  --dangerously-skip-permissions \
  ${model_args[@]+"${model_args[@]}"}
