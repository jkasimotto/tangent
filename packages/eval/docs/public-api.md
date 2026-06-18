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
- `eval ui [run|latest]` starts the local Eval UI for browsing, launching, and comparing runs.
- `createEvalUiApp(...)` registers Eval for the combined `tangent ui` shell with `/api/eval/*` routes and embedded assets mounted under `/apps/eval/`.
- Eval specs support `prompt` on a variant; variant prompts override the case prompt, and existing case-level prompt specs remain valid.

`/api/eval/*` routes:
- `GET /api/eval/selection` resolves the preferred or latest run id.
- `GET /api/eval/runs` lists run summaries; `GET /api/eval/runs/<id>` returns run detail with per-variant output metrics (time, peak context, files changed, and an activity sparkline).
- `GET /api/eval/runs/<id>/compare` compares two variants; artifacts cover prompts, context files, and changed code files (A's final file versus B's final file).
- `GET /api/eval/runs/<id>/diff` returns the line diff for one artifact (`kind` is `prompt`, `context`, or `code`).
- `GET /api/eval/specs` lists launchable specs from the project `evals/` directory and prior runs.
- `POST /api/eval/runs` with `{ specPath }` prepares a run, starts execution in the background, and returns `{ runId }`; the manifest is persisted per phase so polling `GET /api/eval/runs/<id>` shows live status.

Agents must import through these public exports, not package src internals.
