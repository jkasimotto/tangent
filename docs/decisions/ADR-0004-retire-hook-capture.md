# ADR-0004 Retire Hook Capture

Status: accepted

Decision: Tangent no longer installs provider hooks or records hook payloads. Native Claude/Codex transcript indexing is the source of truth for new usage data.

Consequences:
- Remove the `@tangent/hooks` workspace and hook install/record CLI surfaces.
- Keep `usage-jsonl` readers and `capture.source: "hook"` schema compatibility for historical event files.
- Diagnostics may report stale managed hook commands, but runtime code must not regenerate hook configs.
- Governance should prevent reintroducing hook install or hook record product code.
