# @tangent/governance Architecture

Architecture, docs, dependency, and duplication lints.

Rules:
- Lint messages must include agent-readable remediation steps.
- Update docs when adding enforceable rules.
- Every non-ignored repo directory must keep `AGENTS.md` as the source file and a sibling `CLAUDE.md` symlink pointing to it.
- The Agent Shell workflow lint rejects retired schema writers, inherited mutation authority, combined instruction reads, and Test-based routine closure.
- The Agent Shell worker handover lint requires one strict CLI parser, strict route input, and durable queue notice receipts.
- The Area-map world lint rejects locked regions, retired scope authority, and projection metadata in composed-world modules.
- The retired-capture lint rejects removed storage, routes, commands, schema values, instructions, and current product nouns.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
