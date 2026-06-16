# @tangent/eval Public API

Public import paths:
- @tangent/eval
- @tangent/eval/cli
- @tangent/eval/server

CLI notes:
- `tangent eval ...` is the root full-suite command.
- `tangent-eval ...` is the standalone package binary and accepts the same arguments without the root `eval` subcommand.
- `eval quick` is a shortcut alias for `eval run` with `--prompt`/`--context` flags.
- `eval collect|report|diff|open latest ...` resolves `latest` to the newest run manifest.
- `eval run` runs non-manual variants in parallel by default, prints prepare/run/collect progress in human mode, and keeps `--json` machine-readable.
- `eval context capture --include-ancestors` includes repo-local ancestor context files from `--cwd` up to the repo root, never files above the repo.
- `eval ui [run|latest]` starts the local read-only Eval UI for prepared runs.
- `createEvalUiApp(...)` registers Eval for the combined `tangent ui` shell with `/api/eval/*` routes and embedded assets mounted under `/apps/eval/`.
- Eval specs support `prompt` on a variant; variant prompts override the case prompt, and existing case-level prompt specs remain valid.

Agents must import through these public exports, not package src internals.
