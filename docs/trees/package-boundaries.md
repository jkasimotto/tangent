# Package Boundaries

- `trees-schema`: contracts and validators only.
- `trees-core`: event API, projections, lifecycle services.
- `trees-runtime/fs`: canonical V1 filesystem event store.
- `trees-runtime/sqlite`: optional projection/index boundary.
- `trees-runtime/git`: project and worktree orchestration.
- `trees-runtime/terminal`: tmux/process runtime adapters.
- `trees-runtime/agents`: manual/custom/Codex/Claude/Gemini command adapters.
- `trees-runtime/attention`: status and attention rules.
- `trees-mcp`: typed tool surface.
- `trees-cli`: command-line adapter.

Governance enforces the key forbidden edges from the port specification.
