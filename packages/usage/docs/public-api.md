# @tangent/usage Public API

Public import paths:
- @tangent/usage
- @tangent/usage/schema
- @tangent/usage/core
- @tangent/usage/query
- @tangent/usage/providers
- @tangent/usage/sqlite
- @tangent/usage/cli
- @tangent/usage/server
- @tangent/usage/pricing

Important exports:
- Core SDK: `openUsage`, `createUsageClient`, `eventsToProjections`, `UsageClient`, session/message/step/tool/analytics APIs, `UsageResult<T>`, and `UsageError`.
- Schema: `UsageEventV3`, `UsageSession`, `UsageTurn`, `UsageStep`, `UsageMessage`, `UsageMetrics`, `UsageProviderAdapter`, provider capabilities, evidence, availability, and query result envelope types.
- Query: serializable `UsageWhere`, ordering, aggregate, series, histogram, and timeline query types.
- SQLite: `ensureUsageIndex`, `loadUsageDatasetFromIndex`, `resolveConversationRef`, `archiveUsageTelemetry`, plus compatibility index types.
- Legacy root SDK: `scanRepo`, old `openUsage` returning `UsageDataset`, `ensureUsageIndex`, `loadUsageDatasetFromIndex`, `resolveConversationRef`, `archiveUsageTelemetry`, `status`, `importNative`, `inspectNativeLogFile`, `listNativeSchemas`, `nativeSchemaStatus`, `UsageDataset`, `conversationReport`.
- Conversation report types: `NormalizedConversation`, `NormalizedConversationMessage`, `NormalizedToolCall`, `TokenUsage`.
- Dataset message query types: `MessageListItem`, `MessageListQuery`, `VisibleMessage`.
- `ensureUsageIndex` and dataset query helpers default to native transcripts. Pass `sources: ["usage-jsonl"]` for legacy hook JSONL, or `sources: ["native", "usage-jsonl"]` for explicit combined debug reads.
- CLI specs/runners: `usageCommandSpec`, `runUsageCli`.
- Local UI server: `startUsageUiServer`, `createUsageUiApp`, `UsageUiServer`, `UsageUiApp`, and `StartUsageUiServerOptions`.
- Legacy types include `QueryResult`, `QuerySupport`, `UsageProvider`, and `UsageConfidence`; new public provider fields use open `string`.

Dependency contract:
- `@tangent/usage/schema`, `/core`, and `/query` must be importable without loading SQLite or pricing code.
- `better-sqlite3` is optional. SQLite-backed commands and `/sqlite` APIs return an explicit capability error or fall back when `index: "auto"` is used.

Dataset queries:
- Use `dataset.messages.list(...)` to query visible user and assistant messages across the loaded dataset by provider, conversation, turn, role, date, or date range.
- `dataset.messages.visible({ conversationId, turnId })` remains available for one-conversation transcript reads.

Core client examples:
- `usage.messages.query({ where: { role: "user", textChars: { gte: 500 } } })`
- `usage.sessions.timeline("latest", { metric: "selfDurationMs", bucketBy: "kind", nesting: "tree" })`
- `usage.analytics.aggregate({ scope: { sessionId: "latest" }, groupBy: ["step.kind"], metrics: ["tokens.total.sum", "durationMs.sum", "count"] })`

Human CLI:
- `tangent usage ...` is the default activity surface.
- `tangent-usage ...` is the standalone package binary and accepts the same arguments without the root `usage` subcommand.
- `tangent usage ui [session|latest] --repo . --scope repo --host 127.0.0.1 --port 0 --no-browser --json` starts the local Usage UI backed by `/api/usage/*`; pass `--scope all` to discover sessions across all supported local agent roots. In a workspace checkout the CLI uses Vite hot reload for `@tangent/usage-ui`; pass `--static-ui` to serve built assets instead.
- `createUsageUiApp(...)` registers Usage for the combined `tangent ui` shell with `/api/usage/*` routes and embedded assets mounted under `/apps/usage/`.
- `GET /api/usage/sessions/:id/conversation-view` returns the `UsageConversationView` used by the default Svelte UI.
- `GET /api/usage/sessions/:id/timeline-view` returns the legacy minimal `UsageSessionTimelineView`.
- Canonical resource commands are `usage sessions list`, `usage sessions get`, `usage sessions report`, `usage sessions timeline`, `usage messages query`, `usage steps query`, `usage tools query`, `usage tokens summary`, `usage analytics aggregate`, and `usage raw events`.
- `--json` on canonical commands emits a `UsageResult<T>` envelope.
- Legacy `usage report <session|latest> --json` still prints `usage.conversation.v1`.
- Raw telemetry views live under explicit `usage raw events --json`, `usage export`, and hidden `data archive`.
- Native transcripts are the default human query source. Native-log schema scaffolding lives under hidden `usage native schemas`, `usage native inspect <path>`, and `usage native status`. Hook install and hook record commands are retired.

Agents must import through these public exports, not package src internals.
