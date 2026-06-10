# @tangent/usage Public API

Public import paths:
- @tangent/usage
- @tangent/usage/cli

Important exports:
- SDK: `scanRepo`, `openUsage`, `ensureUsageIndex`, `loadUsageDatasetFromIndex`, `resolveConversationRef`, `archiveUsageTelemetry`, `status`, `importNative`, `inspectNativeLogFile`, `listNativeSchemas`, `nativeSchemaStatus`, `UsageDataset`, `conversationReport`.
- Conversation report types: `NormalizedConversation`, `NormalizedConversationMessage`, `NormalizedToolCall`, `TokenUsage`.
- `ensureUsageIndex` and dataset query helpers default to native transcripts. Pass `sources: ["usage-jsonl"]` for legacy hook JSONL, or `sources: ["native", "usage-jsonl"]` for explicit combined debug reads.
- CLI specs/runners: `usageCommandSpec`, `runUsageCli`.
- Types include `QueryResult`, `QuerySupport`, `UsageProvider`, and `UsageConfidence`.

Human CLI:
- `tangent usage ...` is the default activity surface.
- `tangent usage report <session|latest> --json` prints exactly `usage.conversation.v1`.
- Raw telemetry views live under explicit `usage events --json`, `usage messages --json`, `usage export`, and hidden `data archive`.
- Native transcripts are the default human query source. Native-log schema scaffolding lives under hidden `usage native schemas`, `usage native inspect <path>`, and `usage native status`. Hook install and hook record commands are retired.

Agents must import through these public exports, not package src internals.
