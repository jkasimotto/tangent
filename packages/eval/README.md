# @tangent/eval

Local comparison harness for coding agents.

V1 focuses on inspectable artifacts:

```bash
tangent eval context capture current --repo . --cwd . --include-ancestors
tangent eval capture task add-language-filter --prompt prompts/task.md --repo . --context current
tangent eval prepare evals/add-language-filter/eval.json
tangent eval run evals/add-language-filter/eval.json
tangent eval report <run-id>
```

An eval variant is a git branch with predictable commits:

```text
base commit
  -> eval: context <variant>
  -> eval: plan <case> / <variant>
  -> eval: implement <case> / <variant>
```

Context snapshots are stored as special git refs under `refs/tangent/eval/contexts/<name>`.
