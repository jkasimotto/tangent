# @tangent/usage-index-sqlite Architecture

This is the only new Usage split package allowed to depend on `better-sqlite3`.

The `messages`, `tool_calls`, and `tool_results` tables store full content (`text_full`, `thinking_text`, `input_json`, `plan_text`, `output_full`) alongside previews. New columns are added to existing databases with `tableHasColumn`-guarded `alter table` statements and backfilled by rebuilding derived tables from `raw_events`. See ADR-0010.
