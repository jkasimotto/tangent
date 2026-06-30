# @tangent/eval-ui Docs

Purpose: Svelte browser UI for comparing two eval configurations side by side. The default Results view is a compare-first screen: aligned sections (Prompts, Context files, Changed files) with A/B column headers, per-column verdict and score, expand-on-demand diff with caching, a notes-only lens that collapses to annotated files, and GitHub-style inline comments (click a diff line in either column to comment, no separate panel).

Under Changed files, a Conversations section reconstructs what each agent actually did (turns and tool calls, sourced from the usage index) in two side-by-side transcripts, with a shared highlight box that dims non-matching turns and counts matches per side, so differences like "did this agent load a skill?" stand out.

When the server returns an evaluator score on a variant, a score chip (`X / Y pts`) appears on the variant card (in the live dashboard) and in the compare column header (in the Results view). A collapsible Scoring section below Conversations mounts `ScoringCompare.svelte` to show each rubric criterion side by side: the statement, each side's pass/fail glyph and point count, and the judge's reasoning. Warnings emitted by the judge model appear as note lines below the criteria.

The Context section has a `Files | Assembled` toggle. The Assembled view renders both variants' verbatim concatenated context side by side with provenance dividers, shared `cwd` and skill controls, block-level difference highlighting ("only here" / "differs" tags), a copy action per column, and a lazy-CLAUDE.md footer. Scope: repo-contributed context only (no base system prompt, no user-global, no plugin skills).

Read next:
- architecture.md
- public-api.md
