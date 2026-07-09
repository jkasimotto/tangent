# @tangent/search Public API

Public import paths:
- @tangent/search
- @tangent/search/cli

Agents must import through these public exports, not package src internals.

Human CLI:
- `tangent search ...` is the root full-suite command.
- `tangent-search ...` is the standalone package binary and accepts the same arguments without the root `search` subcommand.

SDK:
- `indexRepo(options)` accepts `onProgress?: (event: IndexProgressEvent) => void` for index progress.
- `indexRepo(options)` accepts `slowOperationMs?: number` to tune warning events for long parse/write/edge operations.
- `IndexProgressEvent` includes `phase`, optional `stage`, `step`, `path`, count fields, row diagnostics, `ftsMode`, durations, and `level: "warning"` slow-operation events.
- `IndexProgressEvent` and `IndexResult` are exported from `@tangent/search`.
- `symbol(name)` ranks fuzzy matches by declaration kind (classes and other top-level declarations before members), public before private, and matches on the symbol's own name (qualified names only for dotted queries). It returns up to 25 results; call-graph detail (`calledBy`/`calls`/`tests`) is hydrated for the top 5 only.
