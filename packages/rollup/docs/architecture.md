# @tangent/rollup Architecture

Private rollup notes generated from Usage conversation reports.

Workflow notes:
- `tangent rollup <selector>` preflights the summary provider before model summarization.
- Selectors include `today`, `yesterday`, `YYYY-MM-DD`, `YYYYMMDD`, and inclusive compact ranges such as `YYYYMMDD-YYYYMMDD`.
- Processing builds one cached `rollup.input.v1` containing Usage `usage.conversation.v1` reports plus style examples from `.tangent/rollup/examples/*.md` and previous edited notes.
- Rollup artifacts are written under `artifacts/rollups/<key>/` as input JSON, readable messages markdown, prompt markdown, and output JSON. The generated markdown is written directly into the note's generated block.
- Rollup does not expose or preserve a topic architecture; the period-level output is the only generated path.
- Runner failures are summarized in terminal output and written under `artifacts/failures/<date>/*.log`.
- Note rendering preserves the manual section and replaces only the generated block.
- `rollup retry` is an alias for forced reprocessing of failed or selected turns.

Rules:
- Rollup may consume Usage data.
- Keep Rollup note schemas and prompts in Rollup.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
