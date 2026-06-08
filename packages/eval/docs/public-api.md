# @tangent/eval Public API

Public import paths:
- @tangent/eval
- @tangent/eval/cli

CLI notes:
- `eval quick` is a shortcut alias for `eval run` with `--prompt`/`--context` flags.
- `eval collect|report|diff|open latest ...` resolves `latest` to the newest run manifest.

Agents must import through these public exports, not package src internals.
