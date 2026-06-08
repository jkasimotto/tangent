# @tangent/daily Public API

Public import paths:
- @tangent/daily
- @tangent/daily/cli

Important exports:
- SDK: `configure`, `status`, `getDailyNote`, `getCandidates`, `getUnprocessed`, `processUnprocessed`.
- `processUnprocessed` returns structured `failures`, provider preflight status, candidate count, and note write status.
- `ProcessUnprocessedOptions.summaryRunner` is an injection point for deterministic tests and non-CLI integrations; production callers normally omit it.

Agents must import through these public exports, not package src internals.
