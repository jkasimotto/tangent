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

# Run under the claude-otto profile (the `claude-otto` shell alias's real effect): its own config
# dir, separate from the interactive ~/.claude. The alias isn't usable here (aliases don't expand in
# scripts), and tmux won't reliably inherit an exported value, so set it on the process itself.
# Override by exporting CLAUDE_CONFIG_DIR before run-loops.sh if you want a different profile.
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude-otto}"

# ${arr[@]+"${arr[@]}"} expands safely even when empty under `set -u` (macOS bash 3.2).
exec claude \
  --verbose \
  --dangerously-skip-permissions \
  ${model_args[@]+"${model_args[@]}"}
