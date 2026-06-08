# @tangent/hooks Architecture

Claude/Codex hook config, install, uninstall, status, and repo-local exclude mechanics.

Event coverage:
- Claude install includes `MessageDisplay`, `PostToolUseFailure`, `PostToolBatch`, `PermissionDenied`, `InstructionsLoaded`, and `Notification` in addition to the core lifecycle/tool events.
- Codex install follows the released Codex hook surface; transcript paths are treated as convenience metadata, not a stable token-usage interface.

Rules:
- Do not import Usage schemas.
- Keep hook record commands injectable.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
