# @tangent/usage Architecture

Conversation telemetry domain: schemas, hook normalization, native-log schema compatibility, datasets, SDK, and CLI.

Product split:
- `usage` is the human-readable activity CLI: sessions, transcripts, tools, tokens, status, and export.
- `usage report <session|latest>` projects raw `usage.event.v2` rows into assistant-centered `usage.conversation.v1` reports with user/assistant messages, assistant-message token usage, nested tool calls, and allocated per-tool token attribution.
- Raw/debug views are explicit subcommands: `usage events --json`, `usage messages --json`, `usage export`, hidden hook recording, and hidden data archive.
- Human output hides provenance unless `--json` or a debug/export command is used.

Capture notes:
- Native Codex and Claude Code transcripts are the default source for sessions, visible messages, tools, and token usage.
- Hook capture remains available for legacy/debug use but is not included in normal queries unless callers explicitly request the `usage-jsonl`/`hooks` source.
- Codex native token usage comes from final cumulative `token_count` records; Claude native token usage comes from assistant message `usage` fields.
- Claude assistant message token usage is provider-reported at message granularity. Per-tool-call token attribution in conversation reports is allocated from the assistant output tokens and must not be treated as exact.
- Native transcript indexing skips active files by default. A file is eligible when the provider marks it complete, or when it has been quiet for at least 15 minutes and does not end on a user message.
- Native schemas remain version-tagged and permissive so Tangent can warn when provider versions drift beyond known ranges.
- SQLite is the default query path. Provider native transcript files and legacy hook JSONL files are ingested incrementally by source-file metadata.

Rules:
- Do not depend on Daily, Eval, or Search.
- Do not own provider hook config mechanics.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
