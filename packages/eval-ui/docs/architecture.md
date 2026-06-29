# @tangent/eval-ui Architecture

Eval UI is a product-owned Svelte app. It renders serializable view models from `/api/eval/*` and does not import Eval domain code directly. The Results screen is a compare-first aligned view: `buildAlignedSections` groups artifacts by kind (prompts, context, changed files); each row expands per-column via `expandRow`/`diffCache`; the notes-only lens uses `rowsWithNotes`; and the drill-in (`openDrill`/`loadReviewDiff`) loads a single variant's file for line-level annotation.

## Context section: Assembled view

The Context section's `Files | Assembled` toggle mounts `AssembledContext.svelte`. When Assembled is active:

- `assembled-model.ts` drives the data layer: `concatBlocks` builds a verbatim concatenated string per variant (no dividers, suitable for copying), and `alignBySource` pairs blocks across variants by source path to produce the block-level diff alignment used for "only here" / "differs" tags.
- Shared controls (a `cwd` text input and a skill picker populated from `GET /api/eval/.../context/manifest`) apply to both variants; changing either re-assembles both columns.
- Each column calls `GET /api/eval/.../context/assemble?caseId=&variant=&cwd=&skills=` and renders the resulting blocks with provenance dividers. A copy button per column emits the verbatim concatenation without dividers.
- Blocks present in only one variant are tagged "only here"; blocks present in both but with differing text are tagged "differs". Line-level shading within a changed block is not implemented (block-level only); it is a possible future enhancement.
- A lazy-CLAUDE.md footer lists files below `cwd` that would load only when an agent navigates into a subdirectory.

Rules:
- Keep domain artifact discovery and filesystem/git access in `@tangent/eval/server`.
- The UI may launch runs through `POST /api/eval/runs` and poll status, but holds no run mechanics itself; preparation, execution, and collection stay in `@tangent/eval/server`.
- Support both standalone serving and embedded mounting inside the combined Tangent UI shell.
