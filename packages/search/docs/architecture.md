# @tangent/search Architecture

Structural repository indexing and search.

Rules:
- Do not depend on Usage, Rollup, or Eval.
- Keep Search installable without unrelated vertical apps.
- Use @tangent/repo for root discovery and file checks.

Indexing:
- Core indexing emits progress events for scan, parse, write, edge rebuild, and completion phases. The SDK exposes these events and the CLI renders them as log-friendly progress lines.
- `tangent search index --verbose` renders per-file and per-substep diagnostics, including DB/FTS status, affected-file planning, delete/upsert row counts, edge counts, durations, and slow-operation warnings.
- Old index rows for changed files are cleaned up with chunked bulk deletes for edges, entities, FTS rows, symbols, and file rows. Verbose cleanup logs are aggregated by substep instead of emitted once per symbol entity.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
