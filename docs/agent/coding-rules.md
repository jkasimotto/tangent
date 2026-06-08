# Coding Rules

Read AGENTS.md first, then the nearest package docs.

Rules:
- Prefer existing package patterns and public exports.
- Keep vertical apps independent.
- Put pure shared helpers in @tangent/core.
- Put git/repo/worktree/path discovery in @tangent/repo.
- Put provider hook mechanics in @tangent/hooks.
- Put process runner behavior in @tangent/agent-runtime.
- Keep Convos event schemas in @convos/convos.
- Add governance lints for enforceable architecture rules.
