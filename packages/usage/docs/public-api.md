# @tangent/usage Public API

Public import paths:
- @tangent/usage
- @tangent/usage/cli

Important exports:
- SDK: `scanRepo`, `openUsage`, `ensureUsageIndex`, `loadUsageDatasetFromIndex`, `resolveConversationRef`, `archiveUsageTelemetry`, `status`, `installHooks`, `uninstallHooks`, `importNative`, `inspectNativeLogFile`, `listNativeSchemas`, `nativeSchemaStatus`, `UsageDataset`.
- CLI specs/runners: `usageCommandSpec`, `runUsageCli`.
- Types include `QueryResult`, `QuerySupport`, `UsageProvider`, and `UsageConfidence`.

Human CLI:
- `tangent usage ...` is the default activity surface.
- Raw telemetry views live under explicit `usage events --json`, `usage messages --json`, `usage export`, and hidden `data archive`.
- Native-log schema scaffolding lives under hidden `usage native schemas` and `usage native status`. These commands report compatibility and user-facing version drift messages; they do not import native logs into normal usage queries.

Agents must import through these public exports, not package src internals.
