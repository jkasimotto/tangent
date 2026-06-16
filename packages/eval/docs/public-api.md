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
- The old browser `eval ui` surface is retired for now; use `eval report`, `eval diff`, and `eval open` for inspection.

Agents must import through these public exports, not package src internals.
