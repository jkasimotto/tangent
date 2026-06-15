# @tangent/eval Public API

Public import paths:
- @tangent/eval
- @tangent/eval/cli

CLI notes:
- `tangent eval ...` is the root full-suite command.
- `tangent-eval ...` is the standalone package binary and accepts the same arguments without the root `eval` subcommand.
- `eval quick` is a shortcut alias for `eval run` with `--prompt`/`--context` flags.
- `eval collect|report|diff|open latest ...` resolves `latest` to the newest run manifest.
- `eval run` runs non-manual variants in parallel by default, prints prepare/run/collect progress in human mode, and keeps `--json` machine-readable.
- `eval context capture --include-ancestors` includes repo-local ancestor context files from `--cwd` up to the repo root, never files above the repo.
- `eval ui [run-id|latest|eval.json]` starts a local-only UI. With no argument it scans `evals/**/eval.json`, shows discovered specs and existing runs, and selects the newest run only when no specs are present. With an eval spec path it opens that spec for inspection and full-spec execution. With a run id or `latest` it opens the comparison view.
- UI-started eval jobs are process-local to the UI server. They persist run artifacts under the normal eval run directory, expose live progress/log events while the server is alive, and support cancellation of active agent processes.

Agents must import through these public exports, not package src internals.
