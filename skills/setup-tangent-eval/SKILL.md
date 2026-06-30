---
name: setup-tangent-eval
description: "WHEN TO USE: Use only when the user explicitly asks to use this skill, asks for Tangent eval setup help, or asks how to compare coding-agent task variants with Tangent eval. Do not use automatically for ordinary coding, testing, search, or evaluation tasks."
---

# Setup Tangent Eval

Assume the target repo is not Tangent itself and `tangent` is installed on `PATH`.

## Basic Workflow

Create one prompt per task:

```bash
tangent eval init
mkdir -p evals/my-task/prompts
$EDITOR evals/my-task/prompts/task.md
```

Capture repo instructions as eval context when the task should see normal agent guidance:

```bash
tangent eval context capture current --repo . --cwd . --include-ancestors
```

Create and run an eval:

```bash
tangent eval capture task my-task \
  --prompt evals/my-task/prompts/task.md \
  --repo . \
  --context current \
  --agent codex-cli \
  --model gpt-5.4-mini

tangent eval run evals/my-task/eval.json
tangent eval report latest
tangent eval ui latest
```

For a quick context comparison:

```bash
tangent eval quick \
  --prompt evals/my-task/prompts/task.md \
  --context empty \
  --context repo \
  --agent codex-cli \
  --model gpt-5.4-mini
```

Compare multi-variant runs:

```bash
tangent eval diff latest repo-context no-context --phase impl --case my-task
tangent eval open latest repo-context --case my-task
```

## Supported Agent Runners

Manual:

```bash
tangent eval capture task my-task \
  --prompt evals/my-task/prompts/task.md \
  --repo . \
  --agent manual

tangent eval prepare evals/my-task/eval.json
```

Codex CLI:

```bash
tangent eval quick \
  --prompt evals/my-task/prompts/task.md \
  --context repo \
  --agent codex-cli \
  --model gpt-5.4-mini \
  --sandbox workspace-write
```

Claude CLI:

```bash
tangent eval quick \
  --prompt evals/my-task/prompts/task.md \
  --context repo \
  --agent claude-cli \
  --model sonnet \
  --permission-mode acceptEdits
```

## Search vs No Search

Index first:

```bash
tangent search index
```

Use two context snapshots: one without search-specific instructions, one with a short `.agents/` instruction file that tells the agent to try Tangent search before broad file reads.

```bash
tangent eval context capture no-search --repo . --cwd . --include-ancestors

mkdir -p .agents
cat > .agents/eval-search.md <<'EOF'
For this eval variant, use Tangent search before broad file reads:
- tangent search open-plan "<task query>"
- tangent search "<query>"
- tangent search symbol <symbol>
Then inspect the recommended files normally.
EOF

tangent eval context capture with-search --repo . --cwd . --include-ancestors --include-dirty-context
rm .agents/eval-search.md
```

Run both variants:

```bash
tangent eval quick \
  --prompt evals/my-task/prompts/task.md \
  --context no-search \
  --context with-search \
  --agent codex-cli \
  --model gpt-5.4-mini

tangent eval report latest
tangent eval diff latest no-search with-search --phase impl --case my-task
tangent eval ui latest
```

## Explicit Spec Pattern

Use an explicit `eval.json` when variants need stable names or different agents:

```json
{
  "schema": "eval.spec.v1",
  "name": "my-task-search-comparison",
  "defaults": {
    "repo": { "path": ".", "ref": "HEAD" },
    "cwd": ".",
    "agent": {
      "kind": "codex-cli",
      "model": "gpt-5.4-mini",
      "sandbox": "workspace-write"
    },
    "phases": ["plan", "implement"]
  },
  "cases": [
    {
      "id": "my-task",
      "prompt": "prompts/task.md",
      "variants": [
        { "id": "no-search", "context": { "mode": "snapshot", "ref": "refs/tangent/eval/contexts/no-search" } },
        { "id": "with-search", "context": { "mode": "snapshot", "ref": "refs/tangent/eval/contexts/with-search" } }
      ]
    }
  ]
}
```

Run it:

```bash
tangent eval run evals/my-task/eval.json
tangent eval report latest
tangent eval diff latest no-search with-search --phase impl --case my-task
```
