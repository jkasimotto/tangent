# Coding Rules

Read AGENTS.md first, then the nearest package docs.

Rules:
- Prefer existing package patterns and public exports.
- Keep vertical apps independent.
- Put pure shared helpers in @tangent/core.
- Put git/repo/worktree/path discovery in @tangent/repo.
- Do not add provider hook install or hook record product surfaces.
- Put process runner behavior in @tangent/agent-runtime.
- Keep Usage event schemas in @tangent/usage.
- Add governance lints for enforceable architecture rules.
