# @tangent/search Docs

Purpose: Structural repository indexing and search.

Read next:
- architecture.md
- public-api.md

Package rules:
- Do not depend on Usage, Rollup, or Eval.
- Use @tangent/repo for root discovery and file checks.

Operational notes:
- Indexing exposes progress events through the SDK and the CLI prints those events during long index runs.
- Use `tangent search index --verbose` when debugging slow index work; it prints repo-relative paths, substeps, row counts, durations, and slow warnings.
