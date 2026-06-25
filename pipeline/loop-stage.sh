#!/usr/bin/env bash
# Runs ONE pipeline stage as a single interactive Claude session.
# Launched inside a dedicated tmux session by run-loops.sh (not meant to be run by hand).
# Unlike the old headless `claude -p` loop, this opens an INTERACTIVE claude you can attach to,
# watch, and steer. The stage prompt is submitted via Claude Code's `/loop` command, so the agent
# self-paces and re-runs its prompt on a recurring interval inside this one session (the stage
# prompt self-gates, exiting a tick early when its inbox is empty).
set -uo pipefail

NAME="$1"          # stage label, e.g. "scope"
PROMPT_PATH="$2"   # absolute path to the stage prompt markdown
REPO_ROOT="$3"     # cwd for claude: the repo the loops operate on
MODEL="${TANGENT_LOOPS_MODEL:-}"

cd "$REPO_ROOT"
model_args=()
[ -n "$MODEL" ] && model_args=(--model "$MODEL")

# Interactive (no -p) so you can answer and redirect it. The first input is the literal Claude Code
# slash command `/loop` with the stage prompt as its argument, so the stage runs on a self-paced
# recurring loop. ${arr[@]+"${arr[@]}"} expands safely even when empty under `set -u` (macOS bash 3.2).
exec claude "/loop $(cat "$PROMPT_PATH")" \
  --dangerously-skip-permissions \
  ${model_args[@]+"${model_args[@]}"}
