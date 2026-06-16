# ADR-0006: Build Trees as a Clean Rewrite

Status: accepted

## Context

The old `pa` tool proved that semantic tree paths, optional worktrees, tmux durability, and agent-controllable workflows are useful. It also relied on brittle side channels such as `.state`, `.tokens`, `.label`, `current_pulse.conf`, `pulses.jsonl`, and iTerm AppleScript integration.

## Decision

Build Tangent Trees as a clean TypeScript rewrite in split packages. The old `pa` repo is only a behavioral reference and migration source.

Trees uses typed resources, immutable events, rebuildable projections, formal observations, deterministic status resolution, and generated attention items.

## Consequences

- No core package depends on React, SQLite, tmux implementation details, iTerm, or old `pa` code.
- Legacy files are read only by explicit import.
- tmux remains a durable runtime, not the primary UI.
- Future project management can build on typed Trees resources instead of terminal side channels.
