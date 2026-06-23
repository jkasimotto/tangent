# @tangent/usage-index-sqlite Architecture

This is the only new Usage split package allowed to depend on `better-sqlite3`.

## Slim derived schema and serving

The canonical store is `events` (normalized raw events, one row per event, keyed by `conversation_id`). The persisted derived tables are `sessions` (the projected session as `session_json` plus a precomputed `sparkline_json`), `messages` (full `text_full`/`thinking_text` for cross-session search), and `provider_capabilities`. Steps, tool calls/results, usage samples, file events, a second raw-event copy, and the edges graph are **not** persisted: the UI never read them, and a detail view reprojects them from a single session's `events` on demand. Obsolete tables are dropped on migration (`obsoleteProjectionTables`).

The UI is served by `openUsageUiFromSqlite`: the list, `get`, and message-selection are indexed SQL over `sessions`/`messages`; report/timeline/tool-call detail project one session's events through `createUsageClient`. `openUsageFromSqlite` (full in-memory projection) remains for the one-shot CLI.

Maintenance is incremental: `ensureUsageIndex` re-derives only the conversations whose source files changed (`refreshDerivedTablesForSessions`); a full `refreshDerivedTables` runs only on first build, `force`, or a `DERIVE_VERSION` mismatch (stamped in the `meta` table). `openDb` enables WAL so reads run during the watcher's writes. See ADR-0012 (supersedes the derived-table parts of ADR-0010).
