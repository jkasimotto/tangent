# @tangent/rollup Public API

Public import paths:
- @tangent/rollup
- @tangent/rollup/cli

Human CLI:
- `tangent rollup ...` is the root full-suite command.
- `tangent-rollup ...` is the standalone package binary and accepts the same arguments without the root `rollup` subcommand.

Important exports:
- SDK: `configure`, `status`, `getRollupNote`, `getCandidates`, `processRollup`.
- Public Rollup types include `RollupPeriod`, `RollupInput`, `RollupUserConversation`, `RollupUserMessage`, `RollupOutput`, `RollupCandidate`, `SummaryRunner`, and `SummaryProviderConfig`.
- `processRollup` returns structured `failures`, provider preflight status, candidate count, and note write status.
- `ProcessRollupOptions.summaryRunner` is an injection point for deterministic tests and non-CLI integrations; production callers normally omit it. Summary runners implement one period-level `summarizeRollup` call.

Agents must import through these public exports, not package src internals.
