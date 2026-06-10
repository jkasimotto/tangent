# @tangent/rollup Public API

Public import paths:
- @tangent/rollup
- @tangent/rollup/cli

Important exports:
- SDK: `configure`, `status`, `getRollupNote`, `getCandidates`, `processRollup`.
- Public Rollup types include `RollupPeriod`, `RollupInput`, `RollupOutput`, legacy `TurnDigestInput`, `TurnDigest`, `TopicRollup`, `SummaryRunner`, and `SummaryProviderConfig`.
- `processRollup` returns structured `failures`, provider preflight status, candidate count, and note write status.
- `ProcessRollupOptions.summaryRunner` is an injection point for deterministic tests and non-CLI integrations; production callers normally omit it. The default workflow expects `summarizeRollup` for single-call period roll-ups.

Agents must import through these public exports, not package src internals.
