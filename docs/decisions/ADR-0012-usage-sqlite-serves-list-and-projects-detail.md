# ADR-0012 Usage UI Serves the Session List From SQLite and Projects Detail On Demand

Date: 2026-06-23

## Context

Switching to the Usage panel in `tangent ui` was slow (seconds to minutes) even though only a few new conversations had changed. Two causes compounded:

1. The serve path (`openUsageFromSqlite`) loaded the whole view window's events into memory and re-projected every session on each open and on every watcher tick, while the persisted derived tables it had just written went unread.
2. The index rebuilt **all** derived tables (`refreshDerivedTables`) on **any** transcript change. Because the live `tangent ui` session writes its own transcript every turn, a single new turn triggered a full re-projection of all history (~300k events, ~1.5M rows) under a `journal_mode=delete` write lock that also blocked reads.

The index had grown to ~5.5 GB from ~236 MB of transcripts, dominated by a duplicate raw-event store (`events` + `raw_events`), a `steps` table, full tool input/output, and a 0.5M-row `edges` graph, none of which the UI read.

A reference tool (`agentsview-kenn`) served the same data fast (204 MB DB) by precomputing aggregates at index time and serving the list with cursor-paginated indexed SQL, loading messages only on detail open.

## Decision

The Usage UI is served by a new SQLite-backed client (`openUsageUiFromSqlite`, `packages/usage-index-sqlite/src/sqlite/uiClient.ts`) that never loads or projects the whole window:

1. **List, get, message-selection** are indexed SQL reads over a slim `sessions` table that stores the projected session as `session_json` plus a precomputed `sparkline_json`. The per-card activity sparkline is built once at index time (`buildSessionSparkline` in `@tangent/usage-core/core/sparkline`, raw step kinds; the UI maps kind→colour), removing the former N+1 of one timeline query per listed session.
2. **Detail** (report, timeline, tool calls) projects a single session's `events` on demand (~tens of ms) by reusing the in-memory `createUsageClient` scoped to that one conversation. Cold analytics/raw/token methods the UI never calls fall through to an empty in-memory client.
3. **Index maintenance is incremental.** `ensureUsageIndex` re-derives only the conversations whose source files changed (`refreshDerivedTablesForSessions`); a full rebuild runs only on first build, an explicit `force`, or a `DERIVE_VERSION` bump. The projection is partitioned by session id, so one changed transcript re-derives one session.
4. **The derived schema is slim.** Persisted derived tables are `sessions` (list + detail header), `messages` (cross-session search), and `provider_capabilities`. `raw_events`, `steps`, `tool_calls`, `tool_results`, `usage_samples`, `file_events`, and `edges` are dropped on migration and reprojected from `events` per session when a detail view needs them. The canonical `events` store is kept so detail views stay self-contained (no source-file re-reads).
5. `openDb` uses WAL plus a busy timeout so the UI's reads run while the watcher writes the next incremental update, instead of blocking on the writer's lock.

The server (`createUsageUiApp`) drops the old empty-snapshot / background-reproject / swap dance: it opens the SQL client directly and the watcher only runs incremental maintenance; the client reads the live DB, so nothing is swapped.

`openUsageFromSqlite` (full in-memory projection) is retained for the CLI resource commands, which are one-shot and not latency-sensitive.

## Consequences

- Switching to Usage is a sub-100 ms indexed query (measured: open ~19 ms, list ~50 ms, conversation view ~200 ms) instead of a multi-second rebuild. A new turn no longer thrashes the index.
- The global index drops from ~5.5 GB to ~1.6 GB; the remaining bulk is the canonical `events` store (~1.2 GB). Dropping `events` and re-reading source transcripts on demand (reference-style, ~250 MB) is a possible follow-up, traded against robustness for resumed/archived sessions.
- Upgrading an existing index runs a one-time rebuild on first launch: `ensureSchema` drops the obsolete tables and the `DERIVE_VERSION` bump re-derives `sessions`/`messages` from `events` in the background (~45 s for ~300k events). Until it finishes the list is empty; the watcher fills it without blocking the UI.
- The `sessions` row is now a `session_json` payload rather than per-field columns, so the served session matches the projected shape exactly and the list needs no field mapping.
- The index version is stamped in a `meta` table; future derived-shape changes bump `DERIVE_VERSION` to force a one-time rebuild. Supersedes the relevant parts of ADR-0010's derived-table description.
