// Slim derived schema. The Usage UI serves the session list directly from `sessions` (indexed SQL,
// precomputed aggregates + sparkline) and projects a single session's `events` on demand for detail
// views, so the only persisted derived tables are `sessions` (list + detail header), `messages`
// (cross-session search), and `provider_capabilities`. Steps, tool calls/results, usage samples,
// file events, edges, and a second raw-event copy were never read by the UI; they were rebuilt in
// full on every transcript change and made the index multi-GB. They are intentionally absent here
// and dropped on migration; anything they held is reprojected from `events` per session when needed.
export const usageProjectionSchemaSql = `
  create table if not exists sessions (
    id text primary key,
    provider text not null,
    started_at text,
    last_activity_at text,
    status text not null,
    session_json text not null,
    sparkline_json text
  );
  create table if not exists messages (
    id text primary key,
    session_id text not null,
    turn_id text,
    step_id text,
    role text not null,
    ordinal integer not null,
    created_at text,
    text_preview text,
    text_full text,
    text_chars integer,
    text_bytes integer,
    content_mode text not null,
    model text,
    has_tool_use integer not null,
    has_thinking integer not null,
    thinking_text text,
    thinking_preview text,
    token_usage_json text,
    confidence text not null,
    evidence_json text not null,
    provider_fields_json text
  );
  create table if not exists provider_capabilities (
    provider text primary key,
    json text not null
  );
  create index if not exists sessions_activity_idx on sessions (last_activity_at desc);
  create index if not exists sessions_provider_activity_idx on sessions (provider, last_activity_at desc);
  create index if not exists messages_session_ordinal_idx on messages (session_id, ordinal);
  create index if not exists messages_role_idx on messages (role);
`;

/** Derived tables that earlier index versions persisted but the slim schema reprojects on demand; dropped on migration to reclaim the multi-GB they held. */
export const obsoleteProjectionTables = [
  "raw_events",
  "steps",
  "tool_calls",
  "tool_results",
  "usage_samples",
  "file_events",
  "edges"
];
