# Agent Notes

Purpose: @tangent/eval marks source area: the tangent.mark.v1 record, the per-file JSON store, and Claude session resolution for the mark loop's capture surface.

Local rules:
- Marks are local files under `~/.tangent/marks/`, one JSON file per mark, cross-repo by design.
- Reuse `claudeHomes`/`discoverClaudeNative` from `@tangent/usage-index-sqlite`; do not reimplement profile enumeration or transcript discovery here.
- No hook-based capture and no LLM calls in this module; capture reads native transcripts and local input only.

Read next:
- ../../docs/index.md
- ../../docs/architecture.md
- ../../docs/public-api.md
- ../../../../docs/superpowers/specs/2026-07-05-mark-loop-design.md
