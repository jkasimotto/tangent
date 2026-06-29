# Eval Results: compare-first review screen

Date: 2026-06-29
Status: Design, pending implementation
Area: `packages/eval-ui/src/App.svelte`, `packages/eval/src/server`

## Problem

The Results review screen is built for reviewing one variant at a time and scoring it, but the actual job is comparing two configurations. Every current pain point traces to that mismatch:

- `Individual` is the default mode (`mode: ReviewMode = "review"` in `App.svelte`), so the screen opens on single-variant review instead of a comparison.
- The left panel lists `PROMPTS / CONTEXT FILES / CHANGED FILES` for one variant, mixing the three dimensions of a single config rather than pitting two configs against each other.
- There is no view that puts prompts across from prompts, context across from context, changed files across from changed files.
- Switching into `Side by side` fetches the compare/diff payload on demand, so it feels laggy when it should be instant.
- Adding per-line notes (the focused single-variant reader) is treated as the primary path when it should be an occasional drill-in.

## Goal

When you open Results, you immediately see two configurations side by side, compared like-for-like across all three dimensions, with differences jumping out and sameness receding. Scoring and note-taking are available without leaving the comparison. The screen stays dense and scannable, never overloaded.

## Design

### Default and modes

- Results opens in **Compare** (stacked L|R). This becomes the default; the old `review` default is removed.
- Two config pickers in the header: **A** on the left, **B** on the right. Each picker can select any variant in the current case, and either side can be swapped instantly (two pickers, swap freely).
- Each column header carries its own inline verdict: sentiment (👍 / 🤔 / 👎) and a 0–10 score, settable while comparing. Scoring is not gated to a separate mode.
- The standalone `Individual` and `Compare notes` tabs go away as defaults. Individual review survives as a focused drill-in (see Notes drill-in). `Compare notes` is replaced by the Notes lens (below).

### Three sections, aligned by identity

The page is three stacked sections. In every section both columns render the *same dimension*, row-aligned by identity, so you always compare like with like:

- **Prompts** — A's prompt vs B's prompt. If identical (the common case), the section collapses to a one-line `Prompts identical`. Only a real difference expands.
- **Context files** — the two context-file *lists* side by side, aligned by path. Files only one side had are highlighted. No file content is rendered unless drilled in.
- **Changed files** — file lists aligned by path, each row showing `+N / −M` per side. A file both configs changed shares a single row; expanding it reveals that side's diff against its own context baseline (the `contextCommit → implementation` scoping already implemented in `variantChangedFiles()` / `diffView()`).

Row alignment by path is what guarantees "prompts with prompts, context with context, changed files with changed files." Identity, not scroll position, decides what sits across from what.

### Density controls

The screen must never overload. Three levers, all serving "differences jump out, sameness disappears":

1. **Collapsible sections with summary headers.** Each section header shows compact counts and an `identical` / `differs` badge. Default open state: Prompts open only if they differ; Context and Changed open to their aligned *lists*, not content.
2. **Render on expand only.** Diffs and file contents paint only when a row is expanded. Nothing heavy renders up front.
3. **Dim the sameness.** Equal / identical rows are dimmed and tightened so the eye lands on what differs. Color and position do the work; no reading required to spot a difference.

### Notes lens

A `Notes only` toggle in the Compare header. When on, every diff in both columns collapses down to just the annotated blocks: each note is shown with its related code snippet, still in the aligned L|R layout so A's notes sit across from B's. Everything un-annotated disappears. This is the "collapse all the code, just look at the notes with their code" flow.

The reviews model already stores what this needs per note: `artifactId`, `artifactLabel`, `line`, `endLine`, `snippet` (the block's text), `sentiment`, and `text` (`EvalReviewNote` in `packages/eval/src/server/reviews.ts`). The Notes lens reads from the same `reviews.variants[variantKey]` data, no new persistence.

### Notes drill-in

`note ✎` on an expanded changed-file row opens the focused single-variant reader scoped to that one variant + file (today's Individual diff reader, demoted). Per-line notes are added there and saved through the existing reviews API (`PUT /api/eval/runs/{runId}/reviews`). Closing returns to the comparison.

### Performance

The lag on `Side by side` today is the compare/diff fetch firing on mode switch. Two fixes:

1. **Prefetch the compare payload** for the selected A/B pair when the run/case is selected, so the default Compare view is already loaded when it paints.
2. **Cache per-file diffs** by `(caseId, variantId, artifactId)`. Expanding, collapsing, and re-opening a file is then instant, and re-entering the Notes lens or drill-in reuses the cached diff.

## Data model impact

No schema changes. Everything the new screen needs already exists:

- `EvalCompareView` / `EvalCompareArtifactView` carry `kind`, `path`, `status`, `changedLeft`, `changedRight` — enough to build the three aligned sections.
- `EvalDiffView` provides per-file line diffs for expand-on-demand.
- `EvalReviews` / `EvalVariantReview` / `EvalReviewNote` carry verdict and notes-with-snippets for inline scoring and the Notes lens.

Work is concentrated in `packages/eval-ui/src/App.svelte` (layout, modes, density, caching, prefetch) plus any small additions to the client/server compare payload if prompt and context content need to ship alongside the artifact list for the aligned sections.

## Out of scope

- Comparing more than two configs at once (always exactly two columns; swap via pickers).
- Changing the diff algorithm or the `contextCommit → implementation` scoping (already correct).
- New persistence or schema for reviews.

## Open questions

None blocking. Confirm during implementation whether prompt/context *content* should be added to the compare payload or fetched per-section on expand; default to expand-on-demand to keep the initial payload light.
