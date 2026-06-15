# @tangent/eval

Local comparison harness for coding agents.

V1 focuses on inspectable artifacts:

```bash
tangent eval context capture current --repo . --cwd . --include-ancestors
tangent eval capture task add-language-filter --prompt prompts/task.md --repo . --context current
tangent eval prepare evals/add-language-filter/eval.json
tangent eval run evals/add-language-filter/eval.json
tangent eval report <run-id>
tangent eval ui
```

When installed standalone as `@tangent/eval`, use the `tangent-eval` binary with the same arguments:

```bash
tangent-eval prepare evals/add-language-filter/eval.json
tangent-eval ui
```

Automatic eval variants run in parallel by default, while phases stay ordered inside each variant.
Context capture stays within the target repository; `--include-ancestors` only includes context files between `--cwd` and the repo root.

An eval variant is a git branch with predictable commits:

```text
base commit
  -> eval: context <variant>
  -> eval: plan <case> / <variant>
  -> eval: implement <case> / <variant>
```

Context snapshots are stored as special git refs under `refs/tangent/eval/contexts/<name>`.

The local UI discovers `evals/**/eval.json`, shows resolved prompts, contexts, agents, repos, cwd, and phases before execution, and can run a full spec from the browser. UI runs show variant/phase progress plus a bounded live stdout/stderr tail; cancelling a job terminates the active agent process and leaves partial run artifacts for inspection.
