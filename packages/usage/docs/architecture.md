# @tangent/usage Architecture

Conversation telemetry domain: schemas, hook normalization, native-log schema compatibility, datasets, SDK, and CLI.

Product split:
- `usage` is the human-readable activity CLI: sessions, transcripts, tools, tokens, status, and export.
- Raw/debug views are explicit subcommands: `usage events --json`, `usage messages --json`, `usage export`, hidden hook recording, and hidden data archive.
- Human output hides provenance unless `--json` or a debug/export command is used.

Capture notes:
- Claude native transcript import emits separate `token.usage` events when provider usage fields are present.
- Token usage is confidence-labelled; Codex hooks remain unsupported for token usage.
- Native Codex and Claude Code transcripts are higher-signal than hooks but less stable. Usage keeps version-tagged schema descriptors and permissive inspection/status helpers so Tangent can warn when provider versions drift beyond known ranges.
- Native-log schema inference is separate tooling. Runtime code only carries descriptors, discovery, inspection, and compatibility messages; it does not infer new schemas or automatically wire native logs into sessions, tokens, Daily, or Eval.
- SQLite is the default query path. JSONL files remain the audit log and are ingested incrementally by source-file metadata.

Rules:
- Do not depend on Daily, Eval, or Search.
- Do not own provider hook config mechanics.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
