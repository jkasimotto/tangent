export const usageProjectionSchemaSql = `
  create table if not exists raw_events (
    id text primary key,
    source_file_id text,
    provider text not null,
    kind text not null,
    recorded_at text not null,
    observed_at text,
    session_id text not null,
    turn_id text,
    step_id text,
    json text not null
  );
  create table if not exists sessions (
    id text primary key,
    provider text not null,
    provider_session_id text,
    title text,
    first_prompt text,
    started_at text,
    ended_at text,
    last_activity_at text,
    status text not null,
    counts_json text not null,
    metrics_json text not null,
    availability_json text not null,
    evidence_json text not null,
    provider_fields_json text
  );
  create table if not exists steps (
    id text primary key,
    session_id text not null,
    turn_id text,
    parent_step_id text,
    step_order integer not null,
    kind text not null,
    label text not null,
    category text,
    status text not null,
    provider text not null,
    model text,
    tool_name text,
    started_at text,
    ended_at text,
    duration_ms real,
    self_duration_ms real,
    duration_confidence text not null,
    metrics_json text not null,
    target_paths_json text not null,
    evidence_json text not null,
    native_refs_json text not null,
    provider_fields_json text
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
  create table if not exists tool_calls (
    id text primary key,
    session_id text not null,
    turn_id text,
    step_id text,
    message_id text,
    provider text not null,
    tool_name text not null,
    category text not null,
    input_json text,
    plan_text text,
    target_paths_json text not null,
    model text,
    status text not null,
    result_step_id text,
    evidence_json text not null,
    provider_fields_json text
  );
  create table if not exists tool_results (
    id text primary key,
    session_id text not null,
    turn_id text,
    step_id text,
    tool_call_id text,
    provider text not null,
    tool_name text,
    status text not null,
    output_preview text,
    output_full text,
    duration_ms real,
    evidence_json text not null,
    provider_fields_json text
  );
  create table if not exists usage_samples (
    id text primary key,
    session_id text not null,
    turn_id text,
    step_id text,
    provider text not null,
    model text,
    tokens_json text not null,
    evidence_json text not null
  );
  create table if not exists file_events (
    id text primary key,
    session_id text not null,
    step_id text,
    provider text not null,
    operation text,
    target_paths_json text not null,
    evidence_json text not null
  );
  create table if not exists edges (
    id text primary key,
    from_id text not null,
    to_id text not null,
    kind text not null
  );
  create table if not exists provider_capabilities (
    provider text primary key,
    json text not null
  );
  create index if not exists raw_events_session_idx on raw_events (session_id, recorded_at);
  create index if not exists steps_session_started_idx on steps (session_id, started_at);
  create index if not exists steps_session_kind_idx on steps (session_id, kind);
  create index if not exists steps_provider_started_idx on steps (provider, started_at);
  create index if not exists steps_duration_idx on steps (duration_ms);
  create index if not exists steps_tokens_idx on steps (json_extract(metrics_json, '$.tokens.total'));
  create index if not exists messages_session_ordinal_idx on messages (session_id, ordinal);
  create index if not exists messages_session_role_idx on messages (session_id, role);
  create index if not exists tool_calls_session_idx on tool_calls (session_id);
`;
