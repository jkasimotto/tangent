# @convos/convos Architecture

Conversation telemetry domain: schemas, hook normalization, datasets, SDK, and CLI.

Rules:
- Do not depend on Daily, Eval, or Search.
- Do not own provider hook config mechanics.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
