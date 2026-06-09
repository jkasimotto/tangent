# @tangent/daily Public API

Public import paths:
- @tangent/daily
- @tangent/daily/cli

Important exports:
- SDK: `configure`, `status`, `getDailyNote`, `getCandidates`, `getUnprocessed`, `processUnprocessed`.
- Public Daily types include `DailyRollupInput`, `DailyRollupOutput`, legacy `TurnDigestInput`, `TurnDigest`, `DayRollupInput`, `DayRollupOutput`, `TopicRollup`, `SummaryRunner`, and `SummaryProviderConfig`.
- `processUnprocessed` returns structured `failures`, provider preflight status, candidate count, and note write status.
- `ProcessUnprocessedOptions.summaryRunner` is an injection point for deterministic tests and non-CLI integrations; production callers normally omit it. The default workflow expects `summarizeDay` for single-call date rollups.

Agents must import through these public exports, not package src internals.
