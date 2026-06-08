# @tangent/daily Architecture

Private daily notes generated from Usage turns.

Workflow notes:
- `daily process` preflights the summary provider before model summarization.
- Runner failures are summarized in terminal output and written under `artifacts/failures/<date>/*.log`.
- Note rendering uses the ledger's latest successful digests for the target date, plus any newly processed digest, so incremental runs do not drop prior successful work.
- `daily retry` is an alias for forced reprocessing of failed or selected turns.

Rules:
- Daily may consume Usage data.
- Keep Daily note schemas and prompts in Daily.

Refer to ../../../docs/architecture/package-boundaries.md and ../../../docs/architecture/dependency-graph.md for monorepo boundaries.
