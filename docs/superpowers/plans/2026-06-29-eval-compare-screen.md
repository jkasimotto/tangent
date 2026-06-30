# Eval Compare-First Review Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Eval Results screen open on a comparison of two configs, with prompts, context files, and changed files each shown left-vs-right aligned by identity, inline scoring, a notes-only lens, and a per-file note drill-in.

**Architecture:** All work is in `packages/eval-ui`. Pure layout/notes logic is extracted into a new testable module `src/compare-model.ts`; `src/App.svelte` is restructured from three mode tabs into a single stacked aligned Compare view that consumes that module. The data layer is unchanged: each `EvalCompareArtifactView` is one path across both variants, so "aligned by identity" needs no server change. Per-file content and diffs stay expand-on-demand via the existing `getDiff` API, now memoized in a client-side cache. An optional final task adds cheap per-file changed-line counts to the compare payload in `@tangent/eval`.

**Tech Stack:** Svelte 5, TypeScript, Vite, Vitest + @testing-library/svelte (jsdom). Server side: `@tangent/eval` Node server, plain `node --test`.

## Global Constraints

- `@tangent/eval-ui` is UI-only: it talks to `/api/eval/*` and must NOT import `@tangent/eval`. Shared types are mirrored in `src/client.ts`.
- Use shared UI tokens (`@tangent/ui-tokens`) for colors/typography/diff semantics; do not hardcode palette values.
- Never use em dashes in code, comments, or copy.
- Do all work in a dev worktree, never the live `main` checkout. Create it with `node scripts/dev-worktree.mjs create eval-compare` and run all commands from the worktree path.
- Validation gates for every task: `npm run check`, `npm run test -w @tangent/eval-ui`. Full-repo gates before finishing: `npm run check`, `npm run test`, `npm run governance`, `npm run build`.
- The user enters through `tangent ui`. Visual verification uses `node scripts/verify-app.mjs ui` from the worktree (verify-app skill), not the standalone eval app.

---

## File Structure

- `packages/eval-ui/src/compare-model.ts` (NEW): pure functions for aligned sections, the diff-cache key, and notes-only selection. No Svelte, no DOM, no fetch. Unit-tested in isolation.
- `packages/eval-ui/src/compare-model.test.ts` (NEW): unit tests for the above.
- `packages/eval-ui/src/App.svelte` (MODIFY): replace the `review | compare | diff` mode tabs and their three panes with one stacked aligned Compare view; add inline per-column verdict, notes-only toggle, expand-on-demand rows with a diff cache, and the note drill-in overlay.
- `packages/eval-ui/src/App.test.ts` (MODIFY): update assertions that depend on the old default/tabs; add tests for the new behaviors.
- `packages/eval-ui/src/client.ts` (MODIFY, only in Task 7): mirror optional per-file count fields on `EvalCompareArtifactView`.
- `packages/eval/src/server/*` (MODIFY, only in Task 7): populate per-file changed-line counts in the compare payload; `packages/eval/test/*` for its test.
- `packages/eval-ui/docs/*` (MODIFY in Task 8): note the compare-first default if architecture text references the old modes.

---

## Task 1: Parameterize review mutations by variant

The verdict/score setters currently mutate the single `reviewKey` (the reviewed variant). Inline scoring per column needs them to target an arbitrary variant. Refactor them to take a `variantId`, keeping a thin wrapper for current call sites so behavior is unchanged until later tasks wire the columns.

**Files:**
- Modify: `packages/eval-ui/src/App.svelte` (functions `setScore` ~322, `setVerdict` ~536, `setVerdictText` ~544, `ensureReview` ~482)
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Produces: `setVerdictFor(variantId: string, sentiment: EvalVerdictSentiment): Promise<void>`, `setScoreFor(variantId: string, score: number | undefined): Promise<void>`, `setVerdictTextFor(variantId: string, text: string): Promise<void>`. Each resolves the storage key via `variantKey(selectedCaseId, variantId)`, mutates `reviews`, and calls `persistReviews()`.

- [ ] **Step 1: Write the failing test**

Add to `App.test.ts`:

```ts
it("scores a specific variant by key, not just the reviewed one", async () => {
  const client = fakeEvalClient();
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);

  // Set a score on variant B (repo) directly via its column control.
  await fireEvent.click(await screen.findByRole("button", { name: "Score repo 8" }));

  const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
  expect(saved.variants["task/repo"].verdict.score).toBe(8);
});
```

This references a control (`Score repo 8`) added in Task 3; for Task 1 alone, instead assert the refactor preserves the existing default-variant scoring by keeping the current passing tests green. Run the existing suite as the gate.

- [ ] **Step 2: Run the existing suite to confirm baseline green**

Run: `npm run test -w @tangent/eval-ui`
Expected: PASS (the new `it(...)` above is skipped until Task 3 wires the control; mark it `it.todo(...)` for now).

- [ ] **Step 3: Implement the parameterized setters**

Replace the three setters and keep `reviewKey`-based callers working by delegating:

```ts
/** Sets the overall verdict sentiment for a given variant, preserving its score and text. */
async function setVerdictFor(variantId: string, sentiment: EvalVerdictSentiment): Promise<void> {
  const key = variantKey(selectedCaseId, variantId);
  const review = ensureReview(key);
  review.verdict = { sentiment, text: review.verdict?.text, score: review.verdict?.score };
  reviews = reviews;
  await persistReviews();
}

/** Sets the overall numeric score (0-10) for a given variant, preserving its sentiment and text. */
async function setScoreFor(variantId: string, score: number | undefined): Promise<void> {
  const key = variantKey(selectedCaseId, variantId);
  const review = ensureReview(key);
  review.verdict = { sentiment: review.verdict?.sentiment || "mixed", text: review.verdict?.text, score };
  reviews = reviews;
  await persistReviews();
}

/** Saves the free-text verdict for a given variant, preserving its sentiment and score. */
async function setVerdictTextFor(variantId: string, text: string): Promise<void> {
  const key = variantKey(selectedCaseId, variantId);
  const review = ensureReview(key);
  review.verdict = { sentiment: review.verdict?.sentiment || "mixed", text: text.trim() || undefined, score: review.verdict?.score };
  reviews = reviews;
  await persistReviews();
}
```

Update the existing `review`-mode markup callers `setVerdict(...)`, `setScore(...)`, `setVerdictText(...)` to `setVerdictFor(reviewVariantId, ...)`, `setScoreFor(reviewVariantId, ...)`, `setVerdictTextFor(reviewVariantId, ...)`. Delete the now-unused single-variant `setVerdict`/`setScore`/`setVerdictText`.

- [ ] **Step 4: Run tests**

Run: `npm run check -w @tangent/eval-ui && npm run test -w @tangent/eval-ui`
Expected: PASS (existing behavior preserved).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/App.test.ts
git commit -m "refactor(eval-ui): parameterize verdict/score setters by variant"
```

---

## Task 2: Pure aligned-section + notes model

Extract the comparison's display logic into a pure, unit-tested module. This is the heart of "compare prompts with prompts, context with context, changed files with changed files": each artifact is one identity row spanning both sides; the module decides what each side shows and which rows are differences.

**Files:**
- Create: `packages/eval-ui/src/compare-model.ts`
- Test: `packages/eval-ui/src/compare-model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type AlignedSide = { present: boolean; changed: boolean };
  type AlignedRow = { artifact: EvalCompareArtifactView; a: AlignedSide; b: AlignedSide; identical: boolean };
  type AlignedSection = { kind: EvalCompareArtifactKind; title: string; rows: AlignedRow[]; differs: boolean };
  function buildAlignedSections(artifacts: EvalCompareArtifactView[]): AlignedSection[];
  function diffCacheKey(caseId: string, variantId: string, artifactId: string): string;
  function fileNotes(reviews: EvalReviews, caseId: string, variantId: string, artifactId: string): EvalReviewNote[];
  function rowsWithNotes(section: AlignedSection, reviews: EvalReviews, caseId: string, a: string, b: string): AlignedRow[];
  ```
- Consumes: `EvalCompareArtifactView`, `EvalCompareArtifactKind`, `EvalReviews`, `EvalReviewNote` from `./client.js`.

- [ ] **Step 1: Write the failing test**

`packages/eval-ui/src/compare-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAlignedSections, diffCacheKey, fileNotes, rowsWithNotes } from "./compare-model.js";
import type { EvalCompareArtifactView, EvalReviews } from "./client.js";

const artifacts: EvalCompareArtifactView[] = [
  { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
  { id: "context:AGENTS.md", kind: "context", path: "AGENTS.md", label: "AGENTS.md", status: "right-only" },
  { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: false }
];

describe("buildAlignedSections", () => {
  it("groups by kind in prompt/context/code order with titles", () => {
    const sections = buildAlignedSections(artifacts);
    expect(sections.map((s) => s.kind)).toEqual(["prompt", "context", "code"]);
    expect(sections.map((s) => s.title)).toEqual(["Prompts", "Context files", "Changed files"]);
  });

  it("marks a same prompt identical and not differing", () => {
    const prompt = buildAlignedSections(artifacts)[0];
    expect(prompt.rows[0].identical).toBe(true);
    expect(prompt.differs).toBe(false);
    expect(prompt.rows[0].a.present).toBe(true);
    expect(prompt.rows[0].b.present).toBe(true);
  });

  it("places a right-only context file on B only and flags the section as differing", () => {
    const ctx = buildAlignedSections(artifacts)[1];
    expect(ctx.rows[0].a.present).toBe(false);
    expect(ctx.rows[0].b.present).toBe(true);
    expect(ctx.differs).toBe(true);
  });

  it("uses per-side changed flags for code, not the pair status", () => {
    const code = buildAlignedSections(artifacts)[2];
    expect(code.rows[0].a.changed).toBe(true);
    expect(code.rows[0].b.changed).toBe(false);
    expect(code.rows[0].identical).toBe(false);
  });
});

describe("diffCacheKey", () => {
  it("is stable per case+variant+artifact", () => {
    expect(diffCacheKey("task", "repo", "code:src/foo.ts")).toBe("task::repo::code:src/foo.ts");
  });
});

describe("fileNotes / rowsWithNotes", () => {
  const reviews: EvalReviews = {
    schema: "eval.reviews.v1",
    variants: {
      "task/empty": { notes: [{ id: "n1", artifactId: "code:src/foo.ts", artifactLabel: "src/foo.ts", line: 3, snippet: "x", sentiment: "bad", text: "off by one", ts: 1 }] }
    }
  };

  it("returns a variant's notes for one artifact", () => {
    expect(fileNotes(reviews, "task", "empty", "code:src/foo.ts")).toHaveLength(1);
    expect(fileNotes(reviews, "task", "repo", "code:src/foo.ts")).toHaveLength(0);
  });

  it("keeps only rows annotated on either side", () => {
    const code = buildAlignedSections(artifacts)[2];
    // empty has a note on src/foo.ts; either ordering of the two variants keeps the row.
    expect(rowsWithNotes(code, reviews, "task", "empty", "repo")).toHaveLength(1);
    expect(rowsWithNotes(code, reviews, "task", "repo", "empty")).toHaveLength(1);
    // a section whose rows carry no notes on either side drops to empty.
    const prompts = buildAlignedSections(artifacts)[0];
    expect(rowsWithNotes(prompts, reviews, "task", "empty", "repo")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval-ui -- compare-model`
Expected: FAIL with "Cannot find module './compare-model.js'".

- [ ] **Step 3: Implement `compare-model.ts`**

```ts
import type { EvalCompareArtifactKind, EvalCompareArtifactView, EvalReviews, EvalReviewNote } from "./client.js";

export type AlignedSide = { present: boolean; changed: boolean };
export type AlignedRow = { artifact: EvalCompareArtifactView; a: AlignedSide; b: AlignedSide; identical: boolean };
export type AlignedSection = { kind: EvalCompareArtifactKind; title: string; rows: AlignedRow[]; differs: boolean };

const SECTION_ORDER: { kind: EvalCompareArtifactKind; title: string }[] = [
  { kind: "prompt", title: "Prompts" },
  { kind: "context", title: "Context files" },
  { kind: "code", title: "Changed files" }
];

/** A is the left variant, B the right. A right-only artifact is absent from A; left-only from B. */
function sideFor(artifact: EvalCompareArtifactView, side: "a" | "b"): AlignedSide {
  const present = side === "a" ? artifact.status !== "right-only" : artifact.status !== "left-only";
  // Code carries per-side changed flags (the agent's own edits); other kinds "changed" when the pair differs.
  const changed = artifact.kind === "code" && (artifact.changedLeft !== undefined || artifact.changedRight !== undefined)
    ? (side === "a" ? artifact.changedLeft === true : artifact.changedRight === true)
    : present && artifact.status !== "same";
  return { present, changed };
}

/** One identity row per artifact, spanning both sides, so each kind compares like with like. */
export function buildAlignedSections(artifacts: EvalCompareArtifactView[]): AlignedSection[] {
  return SECTION_ORDER.map(({ kind, title }) => {
    const rows = artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => {
        const a = sideFor(artifact, "a");
        const b = sideFor(artifact, "b");
        return { artifact, a, b, identical: artifact.status === "same" };
      });
    return { kind, title, rows, differs: rows.some((row) => !row.identical) };
  });
}

/** The cache key for one side's rendered file content, so re-expanding never refetches. */
export function diffCacheKey(caseId: string, variantId: string, artifactId: string): string {
  return `${caseId}::${variantId}::${artifactId}`;
}

/** The notes one variant carries for one artifact. */
export function fileNotes(reviews: EvalReviews, caseId: string, variantId: string, artifactId: string): EvalReviewNote[] {
  const review = reviews.variants[`${caseId}/${variantId}`];
  return review ? review.notes.filter((note) => note.artifactId === artifactId) : [];
}

/** Rows that carry at least one note on either side, for the notes-only lens. */
export function rowsWithNotes(section: AlignedSection, reviews: EvalReviews, caseId: string, a: string, b: string): AlignedRow[] {
  return section.rows.filter((row) =>
    fileNotes(reviews, caseId, a, row.artifact.id).length > 0 ||
    fileNotes(reviews, caseId, b, row.artifact.id).length > 0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @tangent/eval-ui -- compare-model`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/compare-model.ts packages/eval-ui/src/compare-model.test.ts
git commit -m "feat(eval-ui): pure aligned-section and notes model for compare view"
```

---

## Task 3: Stacked aligned Compare view as the default

Replace the `review | compare | diff` mode tabs and their three panes with one stacked Compare view: a header carrying the two variant pickers with inline verdict per column, then the three aligned sections (Prompts, Context files, Changed files), each a list of identity rows with an A cell and a B cell. Identical rows are dimmed; differing rows stand out. Content stays collapsed (Task 4 adds expansion).

**Files:**
- Modify: `packages/eval-ui/src/App.svelte` (state ~33-94; the `.diff-pane` markup ~1090-1317; reactive blocks ~137-149)
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `buildAlignedSections`, `setVerdictFor`, `setScoreFor`, `setVerdictTextFor`.
- Produces: reactive `alignedSections = buildAlignedSections(compare?.artifacts || [])`; per-column verdict controls labelled `Verdict <variantId> 👍/🤔/👎`, `Score <variantId> <n>`; row containers with class `aligned-row` and per-side cells `aligned-a` / `aligned-b`, dimmed via class `identical` when `row.identical`.

- [ ] **Step 1: Write the failing tests**

Replace the two old default/mode tests (`renders run selection…` lines 11-39 still mostly holds; the `defaults to Review mode…` test at 41-54 must change) and add:

```ts
it("opens on the aligned Compare view with two pickers and three sections", async () => {
  const client = fakeEvalClient();
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);

  // Two config pickers, A and B, in the header.
  expect(container.querySelectorAll(".compare-head select")).toHaveLength(2);
  // Three aligned sections, in order.
  const titles = Array.from(container.querySelectorAll(".aligned-section h3")).map((n) => n.textContent?.trim());
  expect(titles).toEqual(["Prompts", "Context files", "Changed files"]);
  // No legacy mode tabs.
  expect(screen.queryByRole("button", { name: "Individual" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Side by side" })).toBeNull();
});

it("dims identical rows and marks differing ones", async () => {
  const client = fakeEvalClient({
    artifacts: [
      { id: "prompt:task", kind: "prompt", path: "task", label: "Task prompt", status: "same" },
      { id: "code:src/foo.ts", kind: "code", path: "src/foo.ts", label: "src/foo.ts", status: "changed", changedLeft: true, changedRight: false }
    ]
  });
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);
  const rows = container.querySelectorAll(".aligned-row");
  // Prompt row identical -> dimmed; code row differs -> not dimmed.
  expect(container.querySelector(".aligned-section .aligned-row.identical")).toBeInTheDocument();
  expect(rows.length).toBeGreaterThanOrEqual(2);
});

it("scores a specific variant from its column header", async () => {
  const client = fakeEvalClient();
  render(App, { props: { client } });
  await screen.findByText(/ui-compare/);
  await fireEvent.click(await screen.findByRole("button", { name: "Score repo 8" }));
  const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
  expect(saved.variants["task/repo"].verdict.score).toBe(8);
});
```

Delete the obsolete `defaults to Review mode and synthesizes a Compare view from notes` test and the `Side by side` assertions inside `renders run selection…` (the split-reader content moves behind Task 4 expansion; keep the run-selection and flame-caption assertions, drop the tab clicks).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval-ui`
Expected: FAIL (no `.compare-head`, `.aligned-section`, or `Score repo 8` control yet).

- [ ] **Step 3: Implement the aligned Compare view**

In the script block: delete `type ReviewMode`/`let mode`, the `artifactsForReview` mode-scoping (the aligned view shows the whole pair), and the mode-dependent reactive guards. Add:

```ts
$: alignedSections = buildAlignedSections(compare?.artifacts || []);
let collapsedSections = new Set<EvalCompareArtifactKind>(); // existing; default Prompts open only if differ (see below)
$: defaultCollapsed(alignedSections);

/** Collapse a section by default when it has no differences, so sameness stays out of the way. */
function defaultCollapsed(sections: AlignedSection[]): void {
  // Run once per compare load; guarded by compareLoadKey so user toggles are not overridden.
  if (collapsedInitFor === compareLoadKey) return;
  collapsedInitFor = compareLoadKey;
  const next = new Set<EvalCompareArtifactKind>();
  for (const section of sections) if (!section.differs) next.add(section.kind);
  collapsedSections = next;
}
let collapsedInitFor = "";
```

Replace the `.diff-pane` block (the `<section class="diff-pane">` … `</section>` spanning ~1090-1318) with the stacked layout. Header:

```svelte
<header class="compare-head" aria-label="Configs compared">
  {#each [{ side: "a", id: leftVariantId, v: compare.left }, { side: "b", id: rightVariantId, v: compare.right }] as col}
    {@const review = reviews.variants[variantKey(selectedCaseId, col.id)]}
    <div class="compare-col-head entity-{col.side}">
      <label>
        <span class="entity-tag">{col.side === "a" ? "A" : "B"}</span>
        <select value={col.side === "a" ? leftVariantId : rightVariantId}
          on:change={(e) => col.side === "a" ? (leftVariantId = e.currentTarget.value) : (rightVariantId = e.currentTarget.value)}>
          {#each selectedCase?.variants || [] as variant}<option value={variant.variantId}>{variant.variantId}</option>{/each}
        </select>
      </label>
      <small>{agentLabel(col.v) || "manual"} · {contextLabel(col.v)}</small>
      <div class="verdict-inline" aria-label={`Verdict for ${col.id}`}>
        <button type="button" aria-label={`Verdict ${col.id} like`} class:active={review?.verdict?.sentiment === "like"} on:click={() => setVerdictFor(col.id, "like")}>👍</button>
        <button type="button" aria-label={`Verdict ${col.id} mixed`} class:active={review?.verdict?.sentiment === "mixed"} on:click={() => setVerdictFor(col.id, "mixed")}>🤔</button>
        <button type="button" aria-label={`Verdict ${col.id} dislike`} class:active={review?.verdict?.sentiment === "dislike"} on:click={() => setVerdictFor(col.id, "dislike")}>👎</button>
        <span class="score">
          {#each [0,1,2,3,4,5,6,7,8,9,10] as value}
            <button type="button" class="score-pip" aria-label={`Score ${col.id} ${value}`} class:active={review?.verdict?.score === value}
              on:click={() => setScoreFor(col.id, review?.verdict?.score === value ? undefined : value)}>{value}</button>
          {/each}
        </span>
      </div>
    </div>
  {/each}
</header>
```

Sections (content rendering is filled in Task 4; for now each differing row shows a status badge per side):

```svelte
{#each alignedSections as section}
  <section class="aligned-section">
    <h3>
      <button type="button" class="section-toggle" aria-expanded={!collapsedSections.has(section.kind)} on:click={() => toggleSection(section.kind)}>
        <span class="section-caret" aria-hidden="true">{collapsedSections.has(section.kind) ? "▸" : "▾"}</span>
        {section.title}
        <small class="section-summary">{section.differs ? "differs" : "identical"}</small>
      </button>
    </h3>
    {#if !collapsedSections.has(section.kind)}
      {#each section.rows as row}
        <div class="aligned-row" class:identical={row.identical}>
          <div class="aligned-a">{#if row.a.present}<span class="badge badge-{row.a.changed ? 'changed' : 'same'}">{row.artifact.label}</span>{:else}<span class="absent">—</span>{/if}</div>
          <div class="aligned-b">{#if row.b.present}<span class="badge badge-{row.b.changed ? 'changed' : 'same'}">{row.artifact.label}</span>{:else}<span class="absent">—</span>{/if}</div>
        </div>
      {/each}
      {#if section.rows.length === 0}<p class="aligned-empty">No {section.title.toLowerCase()}</p>{/if}
    {/if}
  </section>
{/each}
```

Keep the old `.artifact-list` aside removed (its job is now the aligned rows). Keep `toggleSection`. Remove the `mode-tabs`, the `review`/`compare`/`diff` panes, `artifactsForReview`, `preferredReviewArtifact`/`preferredArtifact` calls tied to mode (replace artifact auto-select with: none needed; expansion is per-row in Task 4). Update `loadCompare` to drop the `mode`-based initial artifact selection.

Add CSS using existing tokens: `.compare-head` two-column grid; `.aligned-row` a two-column grid matching the header; `.aligned-row.identical { opacity: .55; }`; reuse `.badge-changed`/`.badge-same`/`.entity-tag`/`.score-pip` styles already in the file.

- [ ] **Step 4: Run tests**

Run: `npm run check -w @tangent/eval-ui && npm run test -w @tangent/eval-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): compare-first aligned view as the default Results screen"
```

---

## Task 4: Expand-on-demand content with a diff cache

A differing row expands in place to show each side's content: for code, that side's unified change (reusing `buildReviewRows`); for prompt/context, the aligned text read. Fetches go through `getDiff` and are memoized by `diffCacheKey`, so re-expanding or re-entering is instant and the "takes a little to load" lag never recurs after the first view.

**Files:**
- Modify: `packages/eval-ui/src/App.svelte`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `diffCacheKey`, existing `client.getDiff`, `buildReviewRows`, `readerLines`.
- Produces: `diffCache: Map<string, EvalDiffView>`; `async function expandRow(variantId, artifact)`; expanded content rendered under the row in `.aligned-detail`. A code side reuses `.review-diff` row rendering; an absent side renders nothing.

- [ ] **Step 1: Write the failing test**

```ts
it("expands a changed file to each side's diff and caches the fetch", async () => {
  const client = fakeEvalClient();
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);

  // Expand the changed code row on side A (empty variant).
  await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for empty" }));
  expect(await screen.findByText("Use repo context.")).toBeInTheDocument();
  const callsAfterFirst = (client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length;

  // Collapse and re-expand: no new fetch (served from cache).
  await fireEvent.click(screen.getByRole("button", { name: "Collapse src/foo.ts for empty" }));
  await fireEvent.click(screen.getByRole("button", { name: "Expand src/foo.ts for empty" }));
  expect((client.getDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval-ui`
Expected: FAIL (no expand control / cache yet).

- [ ] **Step 3: Implement expansion + cache**

```ts
let diffCache = new Map<string, EvalDiffView>();
let expandedRows = new Set<string>(); // diffCacheKey values currently open
let loadingRows = new Set<string>();

/** Loads (or serves from cache) one side's content for an artifact and toggles its row open. */
async function expandRow(variantId: string, artifact: EvalCompareArtifactView): Promise<void> {
  const key = diffCacheKey(selectedCaseId, variantId, artifact.id);
  if (expandedRows.has(key)) { expandedRows.delete(key); expandedRows = expandedRows; return; }
  expandedRows.add(key); expandedRows = expandedRows;
  if (diffCache.has(key)) return;
  loadingRows.add(key); loadingRows = loadingRows;
  try {
    const view = await client.getDiff({ runId: selectedRunId, caseId: selectedCaseId, left: variantId, right: variantId, kind: artifact.kind, path: artifact.path });
    diffCache.set(key, view); diffCache = diffCache;
  } finally {
    loadingRows.delete(key); loadingRows = loadingRows;
  }
}

/** Review rows for a cached side (collapsed unified diff for code, full read otherwise). */
function sideRows(key: string): ReviewRow[] {
  const view = diffCache.get(key);
  if (!view) return [];
  return buildReviewRows(view, view.artifact.kind === "code", new Set());
}
```

When the run/case/pair changes (`loadCompare` success and `selectCase`/`selectRun`), reset `diffCache`, `expandedRows`, `loadingRows` so stale content never shows.

In each side cell, when `row.<side>.present`, add an expand control and detail region:

```svelte
{@const key = diffCacheKey(selectedCaseId, sideVariantId, row.artifact.id)}
<button type="button" class="row-expand"
  aria-label={`${expandedRows.has(key) ? "Collapse" : "Expand"} ${row.artifact.label} for ${sideVariantId}`}
  on:click={() => expandRow(sideVariantId, row.artifact)}>
  <span class="badge badge-{row.<side>.changed ? 'changed' : 'same'}">{row.artifact.label}</span>
</button>
{#if expandedRows.has(key)}
  <div class="aligned-detail review-reader review-diff">
    {#if loadingRows.has(key)}<div class="state">Loading…</div>
    {:else}
      {#each sideRows(key) as r}
        {#if r.kind === "gap"}<div class="diff-gap">⋯ {r.count} unchanged lines</div>
        {:else}<div class="review-row review-{r.marker}"><span class="line-no">{r.gutter}</span><code>{r.text}</code></div>{/if}
      {/each}
    {/if}
  </div>
{/if}
```

Here `sideVariantId` is `leftVariantId` for the A cell, `rightVariantId` for the B cell. (Gaps stay collapsed in the aligned view; per-line note-taking is the drill-in in Task 6.)

- [ ] **Step 4: Run tests**

Run: `npm run check -w @tangent/eval-ui && npm run test -w @tangent/eval-ui`
Expected: PASS (content shows; second expand makes no new `getDiff` call).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): expand-on-demand aligned content with a per-side diff cache"
```

---

## Task 5: Notes-only lens

A header toggle collapses the comparison to just annotated files: each side shows only files carrying notes, with the note text and its stored snippet. Un-annotated rows disappear. Reads `reviews` plus each note's `snippet`; no new fetch.

**Files:**
- Modify: `packages/eval-ui/src/App.svelte`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: `rowsWithNotes`, `fileNotes` from `compare-model`.
- Produces: `let notesOnly = false`; a header toggle `Notes only`; when on, each section renders `rowsWithNotes(section, reviews, selectedCaseId, leftVariantId, rightVariantId)` and each present side lists `fileNotes(...)` with `.note-text` and `.syn-snippet`.

- [ ] **Step 1: Write the failing test**

```ts
it("notes-only collapses to annotated files with their notes", async () => {
  const client = fakeEvalClient();
  client.getReviews = async () => ({
    schema: "eval.reviews.v1",
    variants: { "task/empty": { notes: [{ id: "n1", artifactId: "code:src/foo.ts", artifactLabel: "src/foo.ts", line: 2, snippet: "return 1", sentiment: "bad", text: "wrong base case", ts: 1 }] } }
  });
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);

  await fireEvent.click(screen.getByRole("button", { name: "Notes only" }));
  expect(screen.getByText("wrong base case")).toBeInTheDocument();
  // The prompt row (no notes) is gone in notes-only.
  expect(screen.queryByText("Task prompt")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval-ui`
Expected: FAIL (no `Notes only` toggle).

- [ ] **Step 3: Implement the lens**

Add to the compare header a toggle:

```svelte
<button type="button" class="lens-toggle" class:active={notesOnly} on:click={() => (notesOnly = !notesOnly)}>Notes only</button>
```

In each section, choose the row set by lens, and in notes-only render notes instead of expand controls:

```svelte
{@const rows = notesOnly ? rowsWithNotes(section, reviews, selectedCaseId, leftVariantId, rightVariantId) : section.rows}
...
{#if notesOnly}
  {#each [leftVariantId, rightVariantId] as sideVariantId, i}
    <div class={i === 0 ? "aligned-a" : "aligned-b"}>
      {#each fileNotes(reviews, selectedCaseId, sideVariantId, row.artifact.id) as note}
        <div class="syn-note {note.sentiment}">
          <p class="note-text">{note.text}</p>
          <code class="syn-snippet">{note.artifactLabel}:{note.line} · {note.snippet.trim()}</code>
        </div>
      {/each}
    </div>
  {/each}
{:else}
  <!-- expand controls from Task 4 -->
{/if}
```

When notes-only and a section has no annotated rows, show `No notes in {section.title.toLowerCase()}`.

- [ ] **Step 4: Run tests**

Run: `npm run check -w @tangent/eval-ui && npm run test -w @tangent/eval-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): notes-only lens collapses compare to annotated files"
```

---

## Task 6: Per-file note drill-in

A `note ✎` control on an expanded changed-file side opens the existing focused single-variant reader (the old Individual pane: gutter selection, 👍/👎, note composer) as an overlay scoped to that one variant + file. Saving persists through the reviews API; closing returns to the comparison with the new note visible in notes-only.

**Files:**
- Modify: `packages/eval-ui/src/App.svelte`
- Test: `packages/eval-ui/src/App.test.ts`

**Interfaces:**
- Consumes: existing `reviewDiff`/`reviewReader`/`reviewRows`/`saveNote`/`openNote`/`selectGutter`/`removeNote` machinery, now driven by drill-in state instead of the removed `mode === "review"`.
- Produces: `let drill: { variantId: string; artifact: EvalCompareArtifactView } | undefined`; `function openDrill(variantId, artifact)`; `function closeDrill()`. While `drill` is set, `reviewVariantId` and `selectedArtifactId` are set from it and the existing `loadReviewDiff` reactive runs; the reader renders in a `.modal-scrim` overlay.

- [ ] **Step 1: Write the failing test**

```ts
it("drills into a single variant+file to add a per-line note", async () => {
  const client = fakeEvalClient();
  const { container } = render(App, { props: { client } });
  await screen.findByText(/ui-compare/);

  await fireEvent.click(await screen.findByRole("button", { name: "Expand src/foo.ts for empty" }));
  await fireEvent.click(await screen.findByRole("button", { name: "Add notes on src/foo.ts for empty" }));

  // The focused reader opens scoped to empty/src/foo.ts.
  const overlay = container.querySelector(".drill-overlay") as HTMLElement;
  expect(overlay).toBeInTheDocument();
  await fireEvent.click(within(overlay).getAllByRole("button", { name: "👎" })[0]);
  await fireEvent.input(within(overlay).getByPlaceholderText(/what's wrong here/), { target: { value: "bad guard" } });
  await fireEvent.click(within(overlay).getByRole("button", { name: "Add" }));

  const saved = (client.putReviews as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
  expect(saved.variants["task/empty"].notes.at(-1).text).toBe("bad guard");
});
```

Add `within` to the testing-library import.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval-ui`
Expected: FAIL (no drill control/overlay).

- [ ] **Step 3: Implement the drill-in**

Reuse the existing review-reader markup (currently under the deleted `mode === "review"` block). Move it into an overlay driven by `drill`:

```ts
let drill: { variantId: string; artifact: EvalCompareArtifactView } | undefined;

/** Opens the focused single-variant reader for one file, to add per-line notes. */
function openDrill(variantId: string, artifact: EvalCompareArtifactView): void {
  drill = { variantId, artifact };
  reviewVariantId = variantId;
  selectedArtifactId = artifact.id;
  reviewDiffLoadKey = "";
}

/** Closes the drill-in and returns to the comparison. */
function closeDrill(): void {
  drill = undefined;
  noteLine = undefined;
  clearSelection();
}
```

Change the review-diff reactive guard from `mode === "review"` to `drill` being set:

```ts
$: compare && selectedArtifactId && reviewVariantId && drill && void loadReviewDiff();
```

Add the `note ✎` control beside each expanded side (Task 4 detail region):

```svelte
<button type="button" class="row-note" aria-label={`Add notes on ${row.artifact.label} for ${sideVariantId}`} on:click={() => openDrill(sideVariantId, row.artifact)}>note ✎</button>
```

Render the overlay (wrap the existing review-reader block, unchanged internally, in a scrim):

```svelte
{#if drill}
  <div class="modal-scrim drill-overlay" role="dialog" aria-modal="true" aria-label={`Review ${drill.variantId} · ${drill.artifact.label}`}>
    <div class="drill-panel">
      <header class="drill-head"><h3>{drill.variantId} · {drill.artifact.label}</h3><button type="button" class="ghost" on:click={closeDrill}>Close</button></header>
      <!-- existing review-reader markup: reviewDiffLoading / reviewRows / note composer, verbatim -->
    </div>
  </div>
{/if}
```

- [ ] **Step 4: Run tests**

Run: `npm run check -w @tangent/eval-ui && npm run test -w @tangent/eval-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src/App.svelte packages/eval-ui/src/App.test.ts
git commit -m "feat(eval-ui): per-file note drill-in from the aligned compare view"
```

---

## Task 7 (optional, server): per-file changed-line counts

Show `+N / −M` per side on changed-file rows. `git diff --numstat` over each variant's `contextCommit → implementation` is one cheap call already paralleled in `compareArtifacts`. Add optional counts to the compare artifact and render them.

**Files:**
- Modify: `packages/eval/src/server/index.ts` (`codeArtifactStatuses` ~459-478, `variantChangedFiles` ~528-533) and `packages/eval/src/server/types.ts` (`EvalCompareArtifactView`)
- Modify: `packages/eval-ui/src/client.ts` (mirror the optional fields)
- Modify: `packages/eval-ui/src/App.svelte` (render counts)
- Test: `packages/eval/test/<existing compare test>.test.mjs` and `App.test.ts`

**Interfaces:**
- Produces on `EvalCompareArtifactView`: `addedLeft?: number; removedLeft?: number; addedRight?: number; removedRight?: number` (counts of the agent's own change per side; undefined when not code or not changed).

- [ ] **Step 1: Write the failing server test**

Extend the nearest existing compare server test to assert a changed code artifact carries `addedRight`/`removedRight` numbers from numstat. (Locate it with `ls packages/eval/test` and follow that file's fixture pattern; assert `artifact.addedRight` is a number for the changed file.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @tangent/eval`
Expected: FAIL (counts undefined).

- [ ] **Step 3: Implement counts**

In `variantChangedFiles`, switch to (or add alongside) `git diff --numstat <from> <impl>` parsing `added\tremoved\tpath`, and thread per-path counts into `codeArtifactStatuses` so each artifact gets `addedLeft/removedLeft` from the left variant and `addedRight/removedRight` from the right. Add the optional fields to `types.ts`. Mirror them in `client.ts`.

- [ ] **Step 4: Render and run**

In the aligned changed-file cell, append `<small class="counts">+{n} −{m}</small>` when present. Run: `npm run check && npm run test -w @tangent/eval && npm run test -w @tangent/eval-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src packages/eval/test packages/eval-ui/src/client.ts packages/eval-ui/src/App.svelte
git commit -m "feat(eval): per-file changed-line counts in the compare payload"
```

---

## Task 8: Cleanup, docs, full validation, visual verify

Remove dead code, reconcile docs, and verify in the live combined app.

**Files:**
- Modify: `packages/eval-ui/src/App.svelte` (delete any now-unused helpers: `artifactsForReview`, `preferredReviewArtifact`/`preferredArtifact` if unreferenced, `notesBySentiment`/`verdictLabel` if the compare-notes synthesis is fully removed, `effectiveLayout`/`isSplit`/`leftReader`/`rightReader`/`diffSegments`/`segments`/`loadDiff` if the standalone Side-by-side per-file view is gone)
- Modify: `packages/eval-ui/docs/index.md`, `packages/eval-ui/docs/architecture.md` (describe the compare-first default; drop the three-mode description)

- [ ] **Step 1: Find dead code**

Run: `npm run check -w @tangent/eval-ui` and search for unreferenced functions:
```bash
cd <worktree> && grep -nE "artifactsForReview|preferredReviewArtifact|preferredArtifact|notesBySentiment|verdictLabel|effectiveLayout|leftReader|rightReader|loadDiff\b" packages/eval-ui/src/App.svelte
```
Remove each symbol with no remaining caller. Keep anything still used by the drill-in (`buildReviewRows`, `readerLines`, `diffSegments`, `saveNote`, `selectGutter`, etc.).

- [ ] **Step 2: Update docs**

Edit `packages/eval-ui/docs/index.md` and `architecture.md`: replace any "Individual / Compare notes / Side by side" description with the compare-first model (aligned sections, inline verdict, notes-only lens, note drill-in). One line each, no em dashes.

- [ ] **Step 3: Full validation**

Run from the worktree:
```bash
npm run check && npm run test && npm run governance && npm run build
```
Expected: all PASS.

- [ ] **Step 4: Visual verification (verify-app skill)**

Boot the combined app read-only from the worktree and drive it:
```bash
node scripts/verify-app.mjs ui
```
Then via chrome-devtools MCP: open the eval Results for `context-vs-no-context-haiku`, confirm it opens directly on the aligned Compare view (no Individual default), that Prompts/Context/Changed sections each show A|B aligned, that identical sections read `identical` and collapse, that expanding a changed file is instant on re-expand, that scoring a column persists, that `Notes only` collapses to annotated files, and that `note ✎` opens the drill-in and a saved note appears. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-ui/src packages/eval-ui/docs
git commit -m "chore(eval-ui): remove dead review-mode code and update docs for compare-first screen"
```

---

## Self-Review

**Spec coverage:**
- Compare default + two pickers → Task 3. Swap freely → per-column `select` bound to `leftVariantId`/`rightVariantId` in Task 3.
- Three sections aligned by identity (prompt/context/changed) → Tasks 2 + 3.
- Density: collapsible sections, render-on-expand, dim identical → Tasks 3 (collapse/dim) + 4 (render-on-expand).
- Inline verdict + score in compare → Tasks 1 + 3.
- Notes-only lens with related code → Task 5.
- Note drill-in → Task 6.
- Instant switching / cache / prefetch → Task 4 (cache) + Task 3 (compare is the default, so its data is already loaded; no mode switch fetch).
- No schema change required for the core; optional counts isolated in Task 7.
- Docs/cleanup/validation → Task 8.

**Placeholder scan:** No TBD/TODO; every code step shows code; every test step shows assertions. Task 7 references the existing eval compare server test by discovery (`ls packages/eval/test`) rather than a guessed filename, since the exact fixture file is not known from here; this is intentional and flagged.

**Type consistency:** `buildAlignedSections`, `AlignedSection`, `AlignedRow`, `AlignedSide`, `diffCacheKey`, `fileNotes`, `rowsWithNotes` are defined in Task 2 and consumed with matching signatures in Tasks 3-5. `setVerdictFor`/`setScoreFor`/`setVerdictTextFor` defined in Task 1, consumed in Tasks 3 and 6. `expandRow`/`sideRows`/`diffCache`/`expandedRows`/`loadingRows` defined in Task 4, used in Tasks 5-6. `drill`/`openDrill`/`closeDrill` defined in Task 6.

**Scope:** One screen, one package (plus an optional, isolated server task). Focused enough for a single plan.
