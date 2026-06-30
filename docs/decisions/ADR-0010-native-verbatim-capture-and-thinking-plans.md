# ADR-0010 Verbatim Claude Native Capture with Thinking and Plans

Date: 2026-06-18

## Decision

Claude native transcript capture stores conversation content verbatim and extracts richer metadata that was previously dropped.

1. Redaction and truncation are disabled for Claude native import. `normalizeClaudeNativeRecords` no longer runs `redactUnknown`/`defaultRedaction` over tool input and tool output; both are stored as-is. Codex native capture is unchanged and still redacts.
2. Assistant thinking blocks (`type: "thinking"` content) are extracted into a dedicated `thinking` field on the assistant message event, projected onto `UsageMessage.thinking`/`hasThinking`, and stored in a `messages.thinking_text` column. This is separate from the visible message `text`.
3. The `ExitPlanMode` tool call is first-class. It is categorized as `category: "plan"`, its `input.plan` markdown is lifted into a `plan` field on the tool call, projected onto `UsageToolCall.plan`, surfaced in the conversation report and UI, and stored in a `tool_calls.plan_text` column. This goes beyond the agentsview reference, which only counts ExitPlanMode for a metric.
4. Token attribution stays at the assistant message/step level. There is no per-tool-call token split, because Claude reports tokens per message and a message can issue several tool calls.

Full message text and full tool output are also stored in new `messages.text_full` and `tool_results.output_full` columns alongside the existing previews.

## Consequences

- Local index databases store full transcript content verbatim. There is no longer a 4000-byte truncation or secret-key masking on Claude native content. This is acceptable because the index is a local, single-user artifact; it does increase index size and means secrets present in a transcript are stored unmasked.
- New projection columns are additive. `ensureSchema` adds them to pre-existing databases with `tableHasColumn`-guarded `alter table` statements, and derived tables are rebuilt from `raw_events` on the next forced reproject. A one-time `--force` reindex is needed to backfill existing indexes; unchanged source files are otherwise skipped.
- The SQLite "rebuildable from raw events" invariant still holds: full content rides in the `raw_events` event blob, and the typed columns are recomputed from it.
- Thinking and plans are conversation content, not raw provider metadata, so they are shown by default in the Usage UI conversation pane and CLI conversation report.

## Known limitations / follow-ups

- Many Claude Code transcripts persist thinking blocks as encrypted signatures with an empty `thinking` text field, so no plaintext is available to display for those sessions. Extraction is correct and will surface thinking whenever the transcript carries plaintext; the reference implementation hits the same wall.
- Claude streams one assistant turn across several JSONL lines that share a `message.id` (a thinking-only chunk, then a text/tool_use chunk). We do not yet merge these chunks, so per-id derived signals such as thinking presence can be split across rows and the typed `messages` row keeps the last chunk. Merging assistant chunks by `message.id` (as agentsview does) is the follow-up that would make thinking-presence and full-text concatenation exact. Plans and verbatim tool output are unaffected because each `tool_use`/`tool_result` is keyed independently.
