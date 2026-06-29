# @tangent/eval-ui Architecture

Eval UI is a product-owned Svelte app. It renders serializable view models from `/api/eval/*` and does not import Eval domain code directly. The Results screen is a compare-first aligned view: `buildAlignedSections` groups artifacts by kind (prompts, context, changed files); each row expands per-column via `toggleRow`/`diffCache`; and the notes-only lens uses `rowsWithNotes`.

## Inline comments

Diff lines in an expanded column are GitHub-style: each commentable line is a button (`openComposer`) that opens a one-at-a-time composer keyed by `{variantId, artifactId, line}` (`composerAt`). Submitting with 👍/👎 (`saveComposer`) appends a note to that side's variant review and persists via `PUT /api/eval/.../reviews`; saved notes render inline under their line and delete in place (`removeNote` finds a note by id across variants). There is no separate drill-in panel.

## Conversations section

Under Changed files, a collapsed `Conversations` section mounts `ConversationCompare.svelte` and lazily loads `GET /api/eval/.../conversations` for both variants when opened (`loadConversations`). Each column is an independent transcript of turns with tool calls (name, input preview, target paths, status), so differences in what each agent did (which files it read, whether it loaded a skill) are visible side by side. A shared highlight box dims non-matching turns and counts matches per side; `conversation-model.ts` holds the pure matchers (`messageMatches`, `conversationMatchCount`), and the match-count helpers take the needle as an argument so the counts recompute reactively as the box changes.

## Scoring section

When `compare.left.evaluation || compare.right.evaluation` is truthy, a collapsible `Scoring` section appears below Conversations. It mounts `ScoringCompare.svelte` directly with the evaluation data already present on the variant summary view -- no separate API call. `ScoringCompare` renders a two-column rubric grid: a header row with each side's `totalPoints / maxPoints`, then one block per criterion (statement, pass/fail glyph, points, and judge reasoning side by side), and any judge warnings as note lines at the bottom.

`EvalEvaluationView` is defined locally in `client.ts` (mirroring the server shape) and is not imported from `@tangent/eval`. The score chip (`.score-chip`) surfaces the aggregate score on the variant card in the live dashboard and in the compare column header in the Results view.

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
