# @tangent/eval-ui Architecture

Eval UI is a product-owned Svelte app. It renders serializable view models from `/api/eval/*` and does not import Eval domain code directly. The Results screen is a compare-first aligned view: `buildAlignedSections` groups artifacts by kind (prompts, context, changed files); each row expands per-column via `expandRow`/`diffCache`; the notes-only lens uses `rowsWithNotes`; and the drill-in (`openDrill`/`loadReviewDiff`) loads a single variant's file for line-level annotation.

Rules:
- Keep domain artifact discovery and filesystem/git access in `@tangent/eval/server`.
- The UI may launch runs through `POST /api/eval/runs` and poll status, but holds no run mechanics itself; preparation, execution, and collection stay in `@tangent/eval/server`.
- Support both standalone serving and embedded mounting inside the combined Tangent UI shell.
