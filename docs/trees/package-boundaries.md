# Package Boundaries

- `trees-schema`: contracts and validators only.
- `trees-core`: event API, projections, lifecycle services.
- `trees-store-fs`: canonical V1 filesystem event store.
- `trees-store-sqlite`: optional projection/index boundary.
- `trees-git`: project and worktree orchestration.
- `trees-terminal`: tmux/process runtime adapters.
- `trees-agents`: manual/custom/Codex/Claude/Gemini command adapters.
- `trees-attention`: status and attention rules.
- `trees-mcp`: typed tool surface.
- `trees-cli`: command-line adapter.

Governance enforces the key forbidden edges from the port specification.
