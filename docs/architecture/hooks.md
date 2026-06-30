# Retired Hook Capture

Provider hook installation and hook recording are retired Tangent product surfaces.

Current rules:
- New usage data comes from native Claude/Codex transcript indexing.
- Usage keeps `usage-jsonl` readers and `capture.source: "hook"` schema compatibility so old event files still load.
- Tangent must not add new hook install, hook record, provider hook config merge, or hook allowlist tracking code.
- Stale managed hook commands should be reported by diagnostics or documented for manual cleanup, not regenerated.
