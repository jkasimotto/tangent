# @tangent/daily Architecture

Private daily notes generated from Usage conversation reports.

Workflow notes:
- `daily rollup` preflights the summary provider before model summarization.
- `daily rollup` is the preferred command. `daily process` remains an alias.
- Date processing builds one cached `daily.rollup-input.v1` containing Usage `usage.conversation.v1` reports plus style examples from `.tangent/daily/examples/*.md` and previous edited notes.
- Rollup artifacts are written under `artifacts/rollups/<date>/` as input JSON, readable messages markdown, prompt markdown, and output JSON. The generated markdown is written directly into the note's generated block.
- Turn digests and topic rollups are legacy/debug surfaces, not the default workflow.
- Runner failures are summarized in terminal output and written under `artifacts/failures/<date>/*.log`.
- Note rendering preserves the manual section and replaces only the generated block.
- `daily retry` is an alias for forced reprocessing of failed or selected turns.

Rules:
- Daily may consume Usage data.
- Keep Daily note schemas and prompts in Daily.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
