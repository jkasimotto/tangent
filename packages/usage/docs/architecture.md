# @tangent/usage Architecture

Conversation telemetry domain: schemas, native-log schema compatibility, legacy usage-jsonl readers, dependency-light conversation APIs, projection/query engines, optional SQLite indexing, SDK, and CLI.

Product split:
- `usage` is the human-readable activity CLI: sessions, messages, steps, tools, tokens, analytics, raw events, status, and export.
- `usage ui` starts the local Usage UI server, serving `/api/usage/*` routes over public Usage core APIs. In a workspace checkout it uses Vite middleware for Svelte hot reload when `@tangent/usage-ui` source files and Vite are available; otherwise it serves compiled `@tangent/usage-ui` assets.
- `createUsageUiApp` registers the same Usage routes and embedded assets for the combined root `tangent ui` shell.
- `tangent-usage` is the standalone install binary; `tangent usage` is the full-suite root command.
- `@tangent/usage/schema`, `/core`, and `/query` are dependency-light and must not import SQLite, pricing tables, server/UI code, or provider-specific native parser dependencies at module load time.
- `@tangent/usage/core` projects normalized events into `tangent.usage.session.v1`, `turn.v1`, `step.v1`, `message.v1`, timeline, and aggregate resources.
- `@tangent/usage/sqlite` owns optional SQLite indexing. The index is a rebuildable projection store over normalized raw events, not the canonical data model.
- Legacy `usage report <session|latest>` and `usage transcript` remain aliases; canonical commands are `usage sessions report`, `usage messages query`, `usage steps query`, `usage analytics aggregate`, and `usage raw events`.
- Raw/debug views are explicit subcommands: `usage raw events --json`, `usage export`, and hidden data archive.
- Human output hides provenance unless `--json` or a debug/export command is used.

Capture notes:
- Native Codex and Claude Code transcripts are the default source for sessions, visible messages, tools, and token usage.
- Hook capture is retired. Legacy usage-jsonl files remain readable for old data and are included only when callers explicitly request the combined source.
- Codex native token usage comes from unique `token_count.info.last_token_usage` snapshots, with `total_token_usage` retained as cumulative audit metadata. Claude native token usage comes from assistant message `usage` fields.
- Tool results retain non-token metadata such as output size and truncation status. Usage does not estimate or allocate per-tool-call token usage because providers do not report it at that granularity.
- Native transcript indexing skips incomplete in-progress files. A file is eligible when the provider marks it complete, or when it has been quiet for at least 15 minutes and does not end on a user message.
- Native schemas remain version-tagged and permissive so Tangent can warn when provider versions drift beyond known ranges.
- `openUsage({ index: "auto" })` uses SQLite when the optional dependency is available and falls back to in-memory projections when it is not.
- `startUsageUiServer` and `createUsageUiApp` use `openUsage({ index: "auto" })`, map domain data through `@tangent/usage-ui-data`, and lazily import UI server/assets only when a UI command starts. The optional Vite dev path is requested by the standalone Usage UI CLI and falls back to static assets when source files or Vite are unavailable.
- Provider native transcript files and legacy hook JSONL files are ingested incrementally by source-file metadata when SQLite is available.
- Provider ids are open strings in public APIs. Built-in Claude/Codex adapters are registered through the provider adapter contract; unknown providers require caller-supplied adapters.

Rules:
- Do not depend on Rollup, Eval, or Search.
- Keep Usage installable without unrelated vertical apps.
- Do not own provider hook config mechanics.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
