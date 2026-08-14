# @tangent/agent-runtime Architecture

Shared process execution and agent runner primitives.

The agent adapter supports Claude, Codex, and Gemini. It owns provider arguments, structured completion, streamed events, provider session identifiers, fresh sessions, and supported session resume operations.

A saved preset can request a login shell. This option lets a local alias select an account or wrapper without moving shell behavior into a vertical app.

Rules:
- Do not import vertical app schemas.
- Keep provider-agnostic process behavior here.
- Do not add Program, Eval, Goal, or Run schemas here.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
