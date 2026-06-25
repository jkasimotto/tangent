#!/usr/bin/env bash
# Runs ONE pipeline stage against ONE work item as a fresh, headless `claude -p` process.
# Spawned by dispatch.mjs into a dedicated tmux session whenever work appears in that stage's inbox;
# not meant to be run by hand. Fresh process per feature == clean context per feature (no cross-task
# pollution). The agent does its one unit of work, advances the dossier, and exits, which ends the
# session and frees the item to advance to the next stage. Output streams to the pane (attachable)
# and is mirrored to a log by dispatch.mjs.
set -uo pipefail

NAME="$1"          # stage: feedback|scope|ux|plan|implement|review|deploy
SLUG="$2"          # feature slug, or "" for the feedback-triage batch
REPO_ROOT="$3"     # cwd for claude: the repo the pipeline operates on
PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${TANGENT_LOOPS_MODEL:-}"

case "$NAME" in
  feedback)  prompt_file="0-feedback.md" ;;
  scope)     prompt_file="1-scope.md" ;;
  ux)        prompt_file="2-ux.md" ;;
  plan)      prompt_file="3-plan.md" ;;
  implement) prompt_file="4-implement.md" ;;
  review)    prompt_file="5-review.md" ;;
  deploy)    prompt_file="6-deploy.md" ;;
  *) echo "unknown stage: $NAME" >&2; exit 2 ;;
esac
prompt_path="$PIPELINE_DIR/prompts/$prompt_file"

cd "$REPO_ROOT"

# Run under the claude-otto profile (own config dir, separate from the interactive ~/.claude).
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude-otto}"

if [ -n "$SLUG" ]; then
  scope_line="Process ONLY the feature with slug '$SLUG'."
  notify_title="Tangent: $NAME / $SLUG"
else
  scope_line="Triage ONLY the currently-untriaged feedback."
  notify_title="Tangent: $NAME"
fi

# Appended to the stage prompt: scope this fresh agent to its single item, and give it a way to reach
# the user. The pipeline coordinates through disk, so an agent only interrupts the human when it must.
# `read -d ''` (not $(cat <<EOF)) avoids a command-substitution parse error on apostrophes in bash 3.2.
IFS= read -r -d '' RUN_NOTE <<EOF || true

---
## This dispatch run (fresh process, one item)
You were spawned fresh with a clean context for a SINGLE work item. $scope_line Ignore every other inbox item; each has its own agent. Do your one unit of work, leave the dossier truthful, then finish.

If you need the user's attention or a decision (you parked this on awaiting-answers, hit a blocker you cannot resolve, or shipped something they were waiting on), notify them once on the desktop:
  terminal-notifier -title "$notify_title" -message "<concise: what you need, or what shipped>" -sound default
Only notify when it genuinely needs a human; routine progress goes to the dossier, not a notification.
EOF

model_args=()
[ -n "$MODEL" ] && model_args=(--model "$MODEL")

# ${arr[@]+"${arr[@]}"} expands safely even when empty under `set -u` (macOS bash 3.2).
exec claude -p "$(cat "$prompt_path")$RUN_NOTE" \
  --verbose \
  --dangerously-skip-permissions \
  ${model_args[@]+"${model_args[@]}"}
