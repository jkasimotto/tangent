# Agent Notes

Purpose: Tangent is a local monorepo for coding-agent tooling: conversation telemetry, rollup notes, eval runs, structural search, and shared infrastructure.

Packages:
- @tangent/core: pure CLI specs, args, JSON/config, hashes, time, and small helpers.
- @tangent/repo: repo discovery, git, worktree, and path helpers.
- @tangent/hooks: Claude/Codex hook installation, status, provider config, and raw hook mechanics.
- @tangent/agent-runtime: shared process execution and agent runner primitives.
- @tangent/governance: architecture, docs, dependency, and duplication lints.
- @tangent/usage: conversation telemetry domain, schemas, datasets, hook normalization, SDK, CLI.
- @tangent/rollup: private rollup notes from Usage turns.
- @tangent/eval: coding-agent eval preparation, execution, collection, and reports.
- @tangent/search: structural repository indexing and search.

Architecture docs:
- ARCHITECTURE.md
- docs/index.md
- docs/architecture/package-boundaries.md
- docs/architecture/dependency-graph.md
- docs/agent/coding-rules.md
- docs/agent/validation.md

Validate work:
- npm run check
- npm run test
- npm run governance
- npm run build

Never:
- Do not add vertical app dependencies except rollup/eval -> usage.
- Do not put provider hook config mechanics outside @tangent/hooks.
- Do not duplicate parseArgs, runProcess, repo discovery, or git/worktree helpers in vertical apps.
- Do not import another package's src internals; use public exports.
- Do not let @tangent/core shell out, write provider config, or learn product schemas.

When architecture changes:
- Update ARCHITECTURE.md and the relevant docs/architecture/*.md file.
- Update package docs/index.md, docs/architecture.md, and docs/public-api.md when package responsibilities or exports change.
- Add or update governance lints for enforceable rules.
- Record durable decisions in docs/decisions/ADR-*.md.
