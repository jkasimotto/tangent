# @tangent/rollup Public API

Public import paths:
- @tangent/rollup
- @tangent/rollup/cli

Human CLI:
- `tangent rollup ...` is the root full-suite command.
- `tangent-rollup ...` is the standalone package binary and accepts the same arguments without the root `rollup` subcommand.

Important exports:
- SDK: `configure`, `status`, `getRollupNote`, `getCandidates`, `processRollup`, `processMetrics`.
- Public Rollup types include `RollupPeriod`, `RollupInput`, `RollupUserConversation`, `RollupUserMessage`, `RollupOutput`, `RollupCandidate`, `SummaryRunner`, and `SummaryProviderConfig`.
- `processRollup` returns structured `failures`, provider preflight status, candidate count, and note write status.
- `ProcessRollupOptions.summaryRunner` is an injection point for deterministic tests and non-CLI integrations; production callers normally omit it. Summary runners implement one period-level `summarizeRollup` call.

Correction metrics:
- `processMetrics({ conversationIds, repo?, scope?, providers?, model? })` judges how many times the user corrected the agent in each selected conversation, from user messages only, and returns per-conversation results plus a headline aggregate (`firstPassRate`, `totalCorrections`). Result schema `metrics.rollup.v1`.
- Metric types: `MetricsRollupResult`, `ConversationMetrics`, `MetricsAggregate`, `CorrectionEvidence`, `CorrectionRunner`, `CorrectionRunnerInput`, `CorrectionRunnerResult`; judge contract: `ClaudeCliCorrectionRunner`, `correctionMetricsJsonSchema`, `correctionPrompt`.
- `ProcessMetricsOptions.runner` and `.readMessages` are injection points for deterministic tests; production callers omit them. The default judge is the Claude CLI on a cheap model (haiku); unchanged conversations are served from a per-conversation fingerprint cache under `artifacts/metrics/`.

Agents must import through these public exports, not package src internals.
