<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    createEvalApiClient,
    type EvalCaseView,
    type EvalCompareArtifactKind,
    type EvalCompareArtifactView,
    type EvalCompareView,
    type EvalDiffLineView,
    type EvalDiffView,
    type EvalReviews,
    type EvalReviewNote,
    type EvalReviewSentiment,
    type EvalRunDetailView,
    type EvalRunStatus,
    type EvalRunSummaryView,
    type EvalSparkline,
    type EvalSpecPromptsView,
    type EvalSpecSummaryView,
    type EvalUiClient,
    type EvalVariantMetricsView,
    type EvalVariantPhaseView,
    type EvalVariantReview,
    type EvalVariantSummaryView,
    type EvalVerdictSentiment
  } from "./client.js";

  export let client: EvalUiClient = createEvalApiClient();

  // Review mode: read one config's result at a time and annotate it (inline good/bad notes + an
  // overall verdict); Compare synthesizes those notes into a side-by-side, not a code diff; Diff keeps
  // the original A/B line view. Notes persist per run via the reviews API.
  type ReviewMode = "review" | "compare" | "diff";
  let mode: ReviewMode = "review";
  let reviewVariantId = "";
  let reviews: EvalReviews = { schema: "eval.reviews.v1", variants: {} };
  let reviewDiff: EvalDiffView | undefined;
  let reviewDiffLoadKey = "";
  let noteLine: number | undefined;
  let noteSentiment: EvalReviewSentiment = "bad";
  let noteText = "";
  let savingReview = false;

  let runs: EvalRunSummaryView[] = [];
  let specs: EvalSpecSummaryView[] = [];
  let selectedSpecPath = "";
  let launching = false;
  let launchError = "";
  let selectedRunId = "";
  let runDetail: EvalRunDetailView | undefined;
  let selectedCaseId = "";
  let leftVariantId = "";
  let rightVariantId = "";
  let compare: EvalCompareView | undefined;
  let diff: EvalDiffView | undefined;
  let selectedArtifactId = "";
  let loading = true;
  let runLoading = false;
  let compareLoading = false;
  let error = "";
  let runLoadKey = "";
  let compareLoadKey = "";
  let diffLoadKey = "";
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  // Primary view: the live run dashboard (a running eval is the focal point) vs the results explorer.
  // An active run snaps the view to "live"; finishing snaps it back to "results". The user can switch
  // freely between them, so a finished config can be inspected while others still run.
  type WorkspaceView = "live" | "results";
  let view: WorkspaceView = "results";
  let prevActive = false;
  let now = Date.now();
  let nowTimer: ReturnType<typeof setInterval> | undefined;

  // Prompt editor (workflow 2): edit the selected spec's task prompt(s) and save them back to disk.
  let promptEditorOpen = false;
  let promptDoc: EvalSpecPromptsView | undefined;
  let promptDraft = "";
  let promptSelectedId = "";
  let promptLoading = false;
  let promptSaving = false;
  let promptError = "";

  // Side-by-side layout (workflow 5): "diff" aligns changes; "split" shows both results whole with no
  // diff markers. Defaults per artifact kind (generated code reads better whole) but the user overrides.
  type DiffLayout = "diff" | "split";
  let diffLayoutOverride: DiffLayout | undefined;

  // Block selection for review notes (workflow 5): a note can target a range of lines, picked by
  // clicking the start gutter then the end gutter. noteEndLine carries the block end while composing.
  let selStart: number | undefined;
  let selEnd: number | undefined;
  let noteEndLine: number | undefined;

  onMount(() => {
    void loadInitial();
  });

  onDestroy(() => {
    clearTimeout(pollTimer);
    if (nowTimer) clearInterval(nowTimer);
  });

  $: anyActive = runDetail ? runActive(runDetail) : false;
  $: variantsFlat = runDetail ? runDetail.cases.flatMap((testCase) => testCase.variants.map((variant) => ({ caseId: testCase.id, variant }))) : [];
  $: multiCase = (runDetail?.cases.length || 0) > 1;
  $: manageNowTimer(anyActive);
  $: handleActivity(anyActive);

  /** Ticks a clock once a second while a run is active, so live elapsed times advance without a poll. */
  function manageNowTimer(active: boolean): void {
    if (active && !nowTimer) {
      now = Date.now();
      nowTimer = setInterval(() => { now = Date.now(); }, 1000);
    } else if (!active && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = undefined;
    }
  }

  /** Snaps the focus to the live dashboard when a run starts, and back to results when it finishes. */
  function handleActivity(active: boolean): void {
    if (active === prevActive) return;
    prevActive = active;
    if (active) view = "live";
    else if (view === "live") view = "results";
  }

  $: selectedCase = runDetail?.cases.find((item) => item.id === selectedCaseId);
  $: selectedCase && syncVariantSelection(selectedCase);
  $: selectedRunId && void loadRun(selectedRunId);
  $: selectedCase && leftVariantId && rightVariantId && void loadCompare();
  // Dependencies (mode, reviewVariantId, leftVariantId, rightVariantId) are passed explicitly so Svelte
  // recomputes the list when the reviewed variant changes; reading them only inside a filter callback would
  // not register them as reactive dependencies.
  $: selectableArtifacts = artifactsForReview(compare?.artifacts || [], mode, reviewVariantId, leftVariantId, rightVariantId);
  $: compare && syncArtifactSelection(selectableArtifacts);
  $: compare && selectedArtifactId && mode === "diff" && void loadDiff();
  $: compare && selectedArtifactId && reviewVariantId && mode === "review" && void loadReviewDiff();
  $: reviewKey = variantKey(selectedCaseId, reviewVariantId);
  $: currentReview = reviews.variants[reviewKey] || { notes: [] };
  $: reviewReader = reviewDiff ? readerLines(reviewDiff.lines, "left") : [];

  async function loadInitial(): Promise<void> {
    loading = true;
    try {
      const [selection, list, specList] = await Promise.all([
        client.getSelection().catch(() => ({ runId: undefined })),
        client.listRuns(),
        client.listSpecs().catch(() => ({ specs: [] }))
      ]);
      runs = list.runs;
      specs = specList.specs;
      selectedRunId = selection.runId && runs.some((run) => run.id === selection.runId) ? selection.runId : runs[0]?.id || "";
      selectedSpecPath = specPathForRun(selectedRunId) ?? (specs[0]?.path || "");
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      loading = false;
    }
  }

  async function launch(): Promise<void> {
    if (!selectedSpecPath || launching) return;
    launching = true;
    launchError = "";
    try {
      const { runId } = await client.launchRun({ specPath: selectedSpecPath });
      runs = (await client.listRuns()).runs;
      selectRun(runId);
    } catch (caught) {
      launchError = friendlyError(caught);
    } finally {
      launching = false;
    }
  }

  // --- Prompt editor (workflow 2) ----------------------------------------------------------------

  /** Opens the prompt editor for the selected spec, loading its task prompt(s) from disk. */
  async function openPromptEditor(): Promise<void> {
    if (!selectedSpecPath) return;
    promptEditorOpen = true;
    promptError = "";
    promptLoading = true;
    try {
      promptDoc = await client.getSpecPrompts(selectedSpecPath);
      const first = promptDoc.prompts[0];
      promptSelectedId = first?.id || "";
      promptDraft = first?.content || "";
    } catch (caught) {
      promptError = friendlyError(caught);
    } finally {
      promptLoading = false;
    }
  }

  /** Switches the editor to another of the spec's prompts, discarding the current unsaved draft. */
  function selectPrompt(id: string): void {
    promptSelectedId = id;
    promptDraft = promptDoc?.prompts.find((prompt) => prompt.id === id)?.content || "";
  }

  /** Saves the edited prompt back to disk and refreshes the loaded prompt set. */
  async function savePrompt(): Promise<void> {
    if (!promptDoc || !promptSelectedId || promptSaving) return;
    promptSaving = true;
    promptError = "";
    try {
      promptDoc = await client.saveSpecPrompt({ specPath: promptDoc.specPath, promptPath: promptSelectedId, content: promptDraft });
    } catch (caught) {
      promptError = friendlyError(caught);
    } finally {
      promptSaving = false;
    }
  }

  $: promptDirty = promptDoc ? (promptDoc.prompts.find((prompt) => prompt.id === promptSelectedId)?.content ?? "") !== promptDraft : false;

  // --- Live run dashboard (workflows 4 & 9) ------------------------------------------------------

  /** Live (or final) wall-clock duration of a variant, ticking while it runs. */
  function variantElapsedMs(variant: EvalVariantSummaryView): number | undefined {
    if (!variant.startedAt) return undefined;
    const start = Date.parse(variant.startedAt);
    if (Number.isNaN(start)) return undefined;
    const end = variant.endedAt ? Date.parse(variant.endedAt) : now;
    return Math.max(0, end - start);
  }

  /** The phase a variant is currently in (running first, else the latest finished, else the first). */
  function activePhase(variant: EvalVariantSummaryView): EvalVariantPhaseView | undefined {
    return variant.phases.find((phase) => phase.status === "running") ||
      [...variant.phases].reverse().find((phase) => phase.status === "done") ||
      variant.phases[0];
  }

  /** Short, human label for a run status, used on dashboard badges. */
  function statusText(status: EvalRunStatus): string {
    if (status === "prepared") return "queued";
    if (status === "running") return "running";
    if (status === "done") return "done";
    if (status === "failed") return "failed";
    if (status === "cancelled") return "cancelled";
    return "manual";
  }

  /** Longest variant duration in the run, so dashboard flames scale against the same baseline. */
  function maxRunDurationMs(): number {
    return Math.max(1, ...variantsFlat.map(({ variant }) => variant.metrics?.sparkline?.durationMs || variantElapsedMs(variant) || 0));
  }

  /** Width percent for a dashboard flame, scaled against the run's longest conversation. */
  function dashboardFlameWidth(variant: EvalVariantSummaryView): number {
    const self = variant.metrics?.sparkline?.durationMs || variantElapsedMs(variant) || 0;
    return Math.max(18, Math.min(100, (self / maxRunDurationMs()) * 100));
  }

  /** Opens the live dashboard from the run controls, even before activity (e.g. just-launched runs). */
  function showLive(): void {
    view = "live";
  }

  /** Opens the results explorer. */
  function showResults(): void {
    view = "results";
  }

  // --- Block selection + scoring for review notes (workflows 5 & 7) ------------------------------

  /** Click the line gutter to anchor a selection, click again to extend it into a block, or clear it. */
  function selectGutter(line: number): void {
    if (selStart === undefined) {
      selStart = line;
      selEnd = line;
      return;
    }
    if (line === selStart && selEnd === selStart) {
      clearSelection();
      return;
    }
    selEnd = line;
  }

  $: selRange = selStart !== undefined && selEnd !== undefined
    ? { start: Math.min(selStart, selEnd), end: Math.max(selStart, selEnd) }
    : undefined;

  /** Whether a line falls inside the active selection block. */
  function inSelection(line: number): boolean {
    return selRange ? line >= selRange.start && line <= selRange.end : false;
  }

  /** Clears the current line-block selection. */
  function clearSelection(): void {
    selStart = undefined;
    selEnd = undefined;
  }

  /** Opens the note composer for a line block with a sentiment. */
  function openNote(start: number, end: number, sentiment: EvalReviewSentiment): void {
    noteLine = start;
    noteEndLine = end;
    noteSentiment = sentiment;
    noteText = "";
  }

  /** Opens the note composer for the current selection block. */
  function openSelectionNote(sentiment: EvalReviewSentiment): void {
    if (selRange) openNote(selRange.start, selRange.end, sentiment);
  }

  /** Sets the overall numeric score (0-10) for the reviewed variant. */
  async function setScore(score: number | undefined): Promise<void> {
    const review = ensureReview(reviewKey);
    review.verdict = { sentiment: review.verdict?.sentiment || "mixed", text: review.verdict?.text, score };
    reviews = reviews;
    await persistReviews();
  }

  $: effectiveLayout = (diffLayoutOverride ?? (diff?.artifact.kind === "code" ? "split" : "diff")) as DiffLayout;
  $: isSplit = effectiveLayout === "split";

  /** Re-fetches the run while any variant is still preparing or running, then refreshes the comparison. */
  function schedulePoll(runId: string): void {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void poll(runId), 1500);
  }

  async function poll(runId: string): Promise<void> {
    if (runId !== selectedRunId) return;
    try {
      const next = await client.getRun(runId);
      if (runId !== selectedRunId) return;
      runDetail = next;
      if (runActive(next)) {
        schedulePoll(runId);
      } else {
        compareLoadKey = "";
        diffLoadKey = "";
        void loadCompare();
      }
    } catch {
      // Stop polling on transient errors; the user can reselect the run to retry.
    }
  }

  /** Returns whether a run still has variants that are preparing or running. */
  function runActive(detail: EvalRunDetailView): boolean {
    return detail.statuses.prepared + detail.statuses.running > 0;
  }

  async function loadRun(runId: string): Promise<void> {
    if (runLoadKey === runId) return;
    runLoadKey = runId;
    runLoading = Boolean(runDetail);
    try {
      const next = await client.getRun(runId);
      if (runLoadKey !== runId) return;
      runDetail = next;
      selectedCaseId = next.cases.find((item) => item.id === selectedCaseId)?.id || next.cases[0]?.id || "";
      selectedArtifactId = "";
      compare = undefined;
      diff = undefined;
      reviewDiff = undefined;
      reviewDiffLoadKey = "";
      void loadReviews(runId);
      error = "";
      if (runActive(next)) schedulePoll(runId);
      else clearTimeout(pollTimer);
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      if (runLoadKey === runId) runLoading = false;
    }
  }

  async function loadCompare(): Promise<void> {
    if (!selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const key = `${selectedRunId}:${selectedCaseId}:${leftVariantId}:${rightVariantId}`;
    if (compareLoadKey === key) return;
    compareLoadKey = key;
    compareLoading = Boolean(compare);
    try {
      const next = await client.compareRun({
        runId: selectedRunId,
        caseId: selectedCaseId,
        left: leftVariantId,
        right: rightVariantId
      });
      if (compareLoadKey !== key) return;
      compare = next;
      selectedArtifactId = preferredArtifact(next.artifacts, selectedArtifactId)?.id || "";
      diff = undefined;
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      if (compareLoadKey === key) compareLoading = false;
    }
  }

  async function loadDiff(): Promise<void> {
    if (!compare) return;
    const artifact = compare.artifacts.find((item) => item.id === selectedArtifactId);
    if (!artifact) return;
    const key = `${selectedRunId}:${selectedCaseId}:${leftVariantId}:${rightVariantId}:${artifact.id}`;
    if (diffLoadKey === key) return;
    diffLoadKey = key;
    try {
      const next = await client.getDiff({
        runId: selectedRunId,
        caseId: selectedCaseId,
        left: leftVariantId,
        right: rightVariantId,
        kind: artifact.kind,
        path: artifact.path
      });
      if (diffLoadKey !== key) return;
      diff = next;
      expandedGaps = new Set();
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    }
  }

  /** Loads the single reviewed variant's content for the selected artifact (left=right=that variant). */
  async function loadReviewDiff(): Promise<void> {
    if (!compare || !reviewVariantId) return;
    const artifact = compare.artifacts.find((item) => item.id === selectedArtifactId);
    if (!artifact) { reviewDiff = undefined; return; }
    const key = `${selectedRunId}:${selectedCaseId}:${reviewVariantId}:${artifact.id}`;
    if (reviewDiffLoadKey === key) return;
    reviewDiffLoadKey = key;
    try {
      reviewDiff = await client.getDiff({ runId: selectedRunId, caseId: selectedCaseId, left: reviewVariantId, right: reviewVariantId, kind: artifact.kind, path: artifact.path });
      noteLine = undefined;
      noteText = "";
    } catch {
      reviewDiff = undefined;
    }
  }

  /** Loads persisted review notes for a run. */
  async function loadReviews(runId: string): Promise<void> {
    try {
      reviews = await client.getReviews(runId);
    } catch {
      reviews = { schema: "eval.reviews.v1", variants: {} };
    }
  }

  /** The storage key for one variant's review. */
  function variantKey(caseId: string, variantId: string): string {
    return `${caseId}/${variantId}`;
  }

  /** Returns the mutable review record for a variant, creating it if missing. */
  function ensureReview(key: string): EvalVariantReview {
    if (!reviews.variants[key]) reviews.variants[key] = { notes: [] };
    return reviews.variants[key];
  }

  /** Persists the current reviews document. */
  async function persistReviews(): Promise<void> {
    if (!selectedRunId) return;
    savingReview = true;
    try {
      reviews = await client.putReviews(selectedRunId, reviews);
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      savingReview = false;
    }
  }

  /** Saves the drafted note against the reviewed variant's current artifact line block. */
  async function saveNote(): Promise<void> {
    if (!reviewDiff || noteLine === undefined || !noteText.trim()) return;
    const start = noteLine;
    const end = noteEndLine ?? noteLine;
    const snippet = reviewReader.filter((row) => row.n >= start && row.n <= end).map((row) => row.text).join("\n");
    const note: EvalReviewNote = {
      id: newId(),
      artifactId: reviewDiff.artifact.id,
      artifactLabel: reviewDiff.artifact.label,
      line: start,
      endLine: end > start ? end : undefined,
      snippet,
      sentiment: noteSentiment,
      text: noteText.trim(),
      ts: Date.now()
    };
    ensureReview(reviewKey).notes.push(note);
    reviews = reviews;
    noteLine = undefined;
    noteEndLine = undefined;
    noteText = "";
    clearSelection();
    await persistReviews();
  }

  /** Removes a note by id from the reviewed variant. */
  async function removeNote(id: string): Promise<void> {
    const review = reviews.variants[reviewKey];
    if (!review) return;
    review.notes = review.notes.filter((note) => note.id !== id);
    reviews = reviews;
    await persistReviews();
  }

  /** Sets the overall verdict sentiment for the reviewed variant, preserving any score and text. */
  async function setVerdict(sentiment: EvalVerdictSentiment): Promise<void> {
    const review = ensureReview(reviewKey);
    review.verdict = { sentiment, text: review.verdict?.text, score: review.verdict?.score };
    reviews = reviews;
    await persistReviews();
  }

  /** Saves the free-text part of the reviewed variant's verdict on blur, preserving sentiment and score. */
  async function setVerdictText(text: string): Promise<void> {
    const review = ensureReview(reviewKey);
    review.verdict = { sentiment: review.verdict?.sentiment || "mixed", text: text.trim() || undefined, score: review.verdict?.score };
    reviews = reviews;
    await persistReviews();
  }

  /** Notes anchored at a line (a note renders once, at its block's first line). */
  function notesAt(review: EvalVariantReview, artifactId: string, line: number): EvalReviewNote[] {
    return review.notes.filter((note) => note.artifactId === artifactId && note.line === line);
  }

  /** Whether any note's block covers a line, used to shade reviewed lines. */
  function lineCovered(review: EvalVariantReview, artifactId: string, line: number): boolean {
    return review.notes.some((note) => note.artifactId === artifactId && line >= note.line && line <= (note.endLine ?? note.line));
  }

  /** A short range label for a note block, e.g. "L12" or "L12–15". */
  function noteRangeLabel(note: EvalReviewNote): string {
    return note.endLine && note.endLine > note.line ? `L${note.line}–${note.endLine}` : `L${note.line}`;
  }

  /** A variant's notes of one sentiment, for the Compare synthesis. */
  function notesBySentiment(key: string, sentiment: EvalReviewSentiment): EvalReviewNote[] {
    return (reviews.variants[key]?.notes || []).filter((note) => note.sentiment === sentiment);
  }

  /** A short label for a verdict sentiment. */
  function verdictLabel(sentiment: EvalVerdictSentiment | undefined): string {
    return sentiment === "like" ? "👍 Liked" : sentiment === "dislike" ? "👎 Disliked" : sentiment === "mixed" ? "🤔 Mixed" : "No verdict";
  }

  /** Generates a fresh note id. */
  function newId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : `n_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
  }

  /**
   * The spec a run was launched from, when that spec is still known to the spec picker. Lets run
   * selection drive the "Eval to run" picker and the prompt editor, so they describe the run being
   * viewed rather than a stale leftover spec.
   */
  function specPathForRun(runId: string): string | undefined {
    const runSpecPath = runs.find((run) => run.id === runId)?.specPath;
    return runSpecPath && specs.some((spec) => spec.path === runSpecPath) ? runSpecPath : undefined;
  }

  function selectRun(runId: string): void {
    selectedRunId = runId;
    selectedSpecPath = specPathForRun(runId) ?? selectedSpecPath;
    runLoadKey = "";
    compareLoadKey = "";
    diffLoadKey = "";
  }

  function selectCase(caseId: string): void {
    selectedCaseId = caseId;
    leftVariantId = "";
    rightVariantId = "";
    compareLoadKey = "";
    diffLoadKey = "";
  }

  function selectArtifact(artifact: EvalCompareArtifactView): void {
    selectedArtifactId = artifact.id;
    diffLoadKey = "";
    reviewDiffLoadKey = "";
  }

  function syncVariantSelection(testCase: EvalCaseView): void {
    const variants = testCase.variants;
    if (!variants.length) {
      leftVariantId = "";
      rightVariantId = "";
      return;
    }
    if (!variants.some((variant) => variant.variantId === leftVariantId)) leftVariantId = variants[0]?.variantId || "";
    if (!variants.some((variant) => variant.variantId === rightVariantId) || rightVariantId === leftVariantId) {
      rightVariantId = variants.find((variant) => variant.variantId !== leftVariantId)?.variantId || leftVariantId;
    }
    if (!variants.some((variant) => variant.variantId === reviewVariantId)) reviewVariantId = leftVariantId;
  }

  function selectReviewVariant(variantId: string): void {
    reviewVariantId = variantId;
    reviewDiffLoadKey = "";
    noteLine = undefined;
  }

  function syncArtifactSelection(artifacts: EvalCompareArtifactView[]): void {
    if (!artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      selectedArtifactId = preferredArtifact(artifacts, "")?.id || "";
    }
  }

  function preferredArtifact(artifacts: EvalCompareArtifactView[], currentId: string): EvalCompareArtifactView | undefined {
    return artifacts.find((artifact) => artifact.id === currentId) ||
      artifacts.find((artifact) => artifact.status && artifact.status !== "same") ||
      artifacts[0];
  }

  /**
   * The artifacts selectable for the current view. Compare and Side-by-side use the whole pair. Individual
   * review scopes the list to artifacts that exist in the reviewed variant: compare status is relative to the
   * left/right pair, so a "left-only"/"right-only" artifact is absent from the opposite variant, and reviewing
   * that variant would fetch a diff that 404s and leave the pane blank. Such artifacts are filtered out here so
   * they are neither listed nor auto-selected.
   */
  function artifactsForReview(
    artifacts: EvalCompareArtifactView[],
    mode: ReviewMode,
    reviewVariantId: string,
    leftVariantId: string,
    rightVariantId: string
  ): EvalCompareArtifactView[] {
    if (mode !== "review") return artifacts;
    return artifacts.filter((artifact) => {
      if (artifact.status === "left-only") return reviewVariantId === leftVariantId;
      if (artifact.status === "right-only") return reviewVariantId === rightVariantId;
      return true;
    });
  }

  const artifactSections: { kind: EvalCompareArtifactKind; title: string; empty: string }[] = [
    { kind: "prompt", title: "Prompts", empty: "No prompt artifacts" },
    { kind: "context", title: "Context files", empty: "No context files" },
    { kind: "code", title: "Changed files", empty: "No code changes" }
  ];

  // The artifact list is derived directly into a reactive value (not via a function called from markup) so
  // Svelte re-renders it when selectableArtifacts changes, e.g. when the mode switches between Individual and
  // the A/B views. Changed artifacts surface first; same artifacts collapse behind a toggle.
  $: artifactSectionViews = artifactSections.map((section) => {
    const group = selectableArtifacts.filter((artifact) => artifact.kind === section.kind);
    return {
      ...section,
      changed: group.filter((artifact) => artifact.status !== "same"),
      same: group.filter((artifact) => artifact.status === "same")
    };
  });

  let expandedUnchanged = new Set<EvalCompareArtifactKind>();

  function toggleUnchanged(kind: EvalCompareArtifactKind): void {
    if (expandedUnchanged.has(kind)) expandedUnchanged.delete(kind);
    else expandedUnchanged.add(kind);
    expandedUnchanged = expandedUnchanged;
  }

  // Each artifact section (Prompts / Context files / Changed files) collapses to just its header so the
  // list stays scannable when one kind has many files.
  let collapsedSections = new Set<EvalCompareArtifactKind>();

  function toggleSection(kind: EvalCompareArtifactKind): void {
    if (collapsedSections.has(kind)) collapsedSections.delete(kind);
    else collapsedSections.add(kind);
    collapsedSections = collapsedSections;
  }

  type DiffSegment =
    | { kind: "lines"; lines: EvalDiffLineView[] }
    | { kind: "gap"; index: number; count: number; lines: EvalDiffLineView[] };

  const DIFF_CONTEXT = 3;
  const DIFF_GAP_MIN = 3;

  let expandedGaps = new Set<number>();

  /** Collapses long runs of equal lines into expandable gaps, keeping a few context lines around changes. */
  function diffSegments(lines: EvalDiffLineView[]): DiffSegment[] {
    const segments: DiffSegment[] = [];
    let visible: EvalDiffLineView[] = [];
    let equalRun: EvalDiffLineView[] = [];
    let gapIndex = 0;
    const flushVisible = () => {
      if (visible.length) segments.push({ kind: "lines", lines: visible });
      visible = [];
    };
    const flushEqual = (atEnd: boolean) => {
      const leadingContext = segments.length === 0 ? 0 : DIFF_CONTEXT;
      const trailingContext = atEnd ? 0 : DIFF_CONTEXT;
      if (equalRun.length <= leadingContext + trailingContext + DIFF_GAP_MIN) {
        visible.push(...equalRun);
      } else {
        visible.push(...equalRun.slice(0, leadingContext));
        flushVisible();
        const middle = equalRun.slice(leadingContext, equalRun.length - trailingContext);
        segments.push({ kind: "gap", index: gapIndex++, count: middle.length, lines: middle });
        visible.push(...equalRun.slice(equalRun.length - trailingContext));
      }
      equalRun = [];
    };
    for (const line of lines) {
      if (line.kind === "equal") {
        equalRun.push(line);
      } else {
        flushEqual(false);
        visible.push(line);
      }
    }
    flushEqual(true);
    flushVisible();
    return segments;
  }

  function toggleGap(index: number): void {
    expandedGaps.add(index);
    expandedGaps = expandedGaps;
  }

  $: segments = diff ? diffSegments(diff.lines) : [];

  function friendlyError(value: unknown): string {
    const message = value instanceof Error ? value.message : String(value);
    return message.includes("<!doctype") ? "Eval API unavailable. Start the app with `tangent eval ui`." : message;
  }

  function formatDate(value: string | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function contextLabel(variant: EvalVariantSummaryView | undefined): string {
    if (!variant) return "";
    if (variant.context.mode === "repo") return "repo context";
    if (variant.context.mode === "empty") return "empty context";
    return `${variant.context.mode}: ${variant.context.ref}`;
  }

  function agentLabel(variant: EvalVariantSummaryView | undefined): string {
    if (!variant) return "";
    return [variant.agent.kind, variant.model].filter(Boolean).join(" / ");
  }

  function lineCount(): string {
    if (!diff) return "";
    const changed = diff.lines.filter((line) => line.kind !== "equal").length;
    return `${diff.lines.length} lines, ${changed} changed`;
  }

  /** Height (0..1) for one flame bucket, matching the Usage UI sparkline. */
  function sparkHeight(tokenShare: number, durationShare: number): number {
    const value = tokenShare > 0 ? tokenShare : durationShare;
    return Math.max(0.08, Math.min(1, value));
  }

  /** Width percent for a flame strip, scaling each conversation against the longer one so relative length reads at a glance. */
  function flameWidth(self: EvalSparkline | undefined, other: EvalSparkline | undefined): number {
    if (!self) return 0;
    const max = Math.max(self.durationMs, other?.durationMs || 0, 1);
    return Math.max(20, Math.min(100, (self.durationMs / max) * 100));
  }

  /** One-line flame caption: how long the conversation ran and how many tokens it spent. */
  function flameCaption(metrics: EvalVariantMetricsView | null | undefined): string {
    if (!metrics) return "";
    const parts: string[] = [];
    if (metrics.durationMs !== undefined) parts.push(formatDurationMs(metrics.durationMs));
    if (metrics.tokensTotal) parts.push(`${formatTokens(metrics.tokensTotal)} tok`);
    if (metrics.peakContextTokens) parts.push(`${formatTokens(metrics.peakContextTokens)} ctx`);
    return parts.join(" · ");
  }

  /**
   * Reconstructs one side's full document from the aligned diff. Produced output (a generated file)
   * is two independent results to read side by side, not a diff: each is shown whole so its length and
   * shape are visible. Inputs (prompts, context) keep the diff, where "what differs" is the point.
   */
  function readerLines(lines: EvalDiffLineView[], side: "left" | "right"): { n: number; text: string }[] {
    const rows: { n: number; text: string }[] = [];
    for (const line of lines) {
      const num = side === "left" ? line.leftNumber : line.rightNumber;
      if (num === undefined) continue;
      rows.push({ n: num, text: (side === "left" ? line.left : line.right) || "" });
    }
    return rows;
  }

  $: leftReader = diff && isSplit ? readerLines(diff.lines, "left") : [];
  $: rightReader = diff && isSplit ? readerLines(diff.lines, "right") : [];

  function formatDurationMs(value: number): string {
    if (value < 1000) return `${Math.round(value)}ms`;
    const seconds = value / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1000) return `${Math.round(value / 1000)}K`;
    return `${Math.round(value)}`;
  }
</script>

<main class="eval-workspace" aria-label="Eval viewer">
  <div class="topbar">
    <span class="brand">Tangent Eval</span>
    <label class="topbar-pick">
      <select bind:value={selectedRunId} on:change={() => selectRun(selectedRunId)} disabled={runs.length === 0}>
        {#if runs.length === 0}
          <option value="">{loading ? "Loading runs…" : "No prepared runs"}</option>
        {:else}
          {#each runs as run}
            <option value={run.id}>{run.name} · {formatDate(run.createdAt)}</option>
          {/each}
        {/if}
      </select>
    </label>
    {#if runDetail && runDetail.cases.length > 1}
      <label class="topbar-pick">
        <select bind:value={selectedCaseId} on:change={() => selectCase(selectedCaseId)}>
          {#each runDetail.cases as testCase}
            <option value={testCase.id}>{testCase.id}</option>
          {/each}
        </select>
      </label>
    {/if}
    <span class="topbar-spacer"></span>
    {#if launchError}<small class="run-error" role="alert">{launchError}</small>{/if}
    <label class="topbar-pick" aria-label="Eval to run">
      <select bind:value={selectedSpecPath} disabled={launching || specs.length === 0}>
        {#if specs.length === 0}
          <option value="">No specs</option>
        {:else}
          {#each specs as spec}
            <option value={spec.path}>{spec.name} ({spec.variantCount} configs)</option>
          {/each}
        {/if}
      </select>
    </label>
    <button type="button" class="ghost-button" on:click={openPromptEditor} disabled={!selectedSpecPath} title="Edit this eval's task prompt">
      Edit prompt
    </button>
    <button type="button" class="run-button" on:click={launch} disabled={launching || !selectedSpecPath}>
      {launching ? "Starting…" : "Run"}
    </button>
  </div>

  {#if runDetail}
    <div class="runbar" class:running={anyActive}>
      <div class="run-tabs" aria-label="Workspace view">
        <button type="button" class:active={view === "live"} on:click={showLive}>
          Live{#if anyActive}<span class="live-dot" aria-hidden="true"></span>{/if}
        </button>
        <button type="button" class:active={view === "results"} on:click={showResults}>Results</button>
      </div>
      <span class="run-name">{runDetail.name}</span>
      <span class="run-pills" aria-label="Run status">
        {#if runDetail.statuses.running}<span class="pill pill-running">{runDetail.statuses.running} running</span>{/if}
        {#if runDetail.statuses.prepared}<span class="pill pill-prepared">{runDetail.statuses.prepared} queued</span>{/if}
        {#if runDetail.statuses.done}<span class="pill pill-done">{runDetail.statuses.done} done</span>{/if}
        {#if runDetail.statuses.failed}<span class="pill pill-failed">{runDetail.statuses.failed} failed</span>{/if}
        {#if runDetail.statuses.cancelled}<span class="pill pill-cancelled">{runDetail.statuses.cancelled} cancelled</span>{/if}
      </span>
    </div>
  {/if}

  {#if promptEditorOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal-scrim" role="presentation" on:click={() => (promptEditorOpen = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="prompt-editor" role="dialog" aria-modal="true" aria-label="Edit eval prompt" tabindex="-1" on:click|stopPropagation>
        <header class="prompt-editor-head">
          <h2>Edit prompt{#if promptDoc} · {promptDoc.name}{/if}</h2>
          <button type="button" class="ghost" on:click={() => (promptEditorOpen = false)}>Close</button>
        </header>
        {#if promptLoading}
          <div class="state">Loading prompts…</div>
        {:else if promptError}
          <div class="notice" role="alert">{promptError}</div>
        {:else if promptDoc}
          {#if promptDoc.prompts.length === 0}
            <div class="state">This spec references no editable prompt files.</div>
          {:else}
            {#if promptDoc.prompts.length > 1}
              <div class="prompt-tabs">
                {#each promptDoc.prompts as prompt}
                  <button type="button" class:active={prompt.id === promptSelectedId} on:click={() => selectPrompt(prompt.id)}>{prompt.label}</button>
                {/each}
              </div>
            {/if}
            <textarea class="prompt-text" bind:value={promptDraft} spellcheck="false" aria-label="Prompt text"></textarea>
            <footer class="prompt-editor-foot">
              <small class="prompt-path">{promptSelectedId}{#if promptDirty} · unsaved{/if}</small>
              <span class="topbar-spacer"></span>
              <button type="button" class="run-button" on:click={savePrompt} disabled={promptSaving || !promptDirty}>
                {promptSaving ? "Saving…" : "Save prompt"}
              </button>
            </footer>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <section class="compare-shell" aria-busy={runLoading || compareLoading}>
    {#if error}
      <div class="notice" role="alert">{error}</div>
    {/if}

    {#if runDetail && view === "live"}
      <div class="dashboard" aria-label="Live run dashboard">
        <header class="dashboard-head">
          <h2>{anyActive ? "Running" : "Run complete"}</h2>
          <small>{variantsFlat.length} config{variantsFlat.length === 1 ? "" : "s"} · {runDetail.statuses.done} done</small>
          <span class="topbar-spacer"></span>
          {#if !anyActive}<button type="button" class="ghost-button" on:click={showResults}>Review results →</button>{/if}
        </header>
        <div class="config-grid">
          {#each variantsFlat as row (row.caseId + "/" + row.variant.variantId)}
            {@const variant = row.variant}
            {@const phase = activePhase(variant)}
            {@const elapsed = variantElapsedMs(variant)}
            <article class="config-card status-{variant.status}">
              <header class="config-card-head">
                <div class="config-id">
                  {#if multiCase}<span class="config-case">{row.caseId}</span>{/if}
                  <strong>{variant.variantId}</strong>
                </div>
                <span class="config-status badge-status-{variant.status}">
                  {#if variant.status === "running"}<span class="live-dot" aria-hidden="true"></span>{/if}
                  {statusText(variant.status)}
                </span>
              </header>
              <div class="config-meta">
                <span>{variant.model || variant.agent.kind}</span>
                {#if phase}<span class="config-phase">{phase.id}{phase.status === "running" ? "…" : ""}</span>{/if}
                <span class="config-time">{elapsed !== undefined ? formatDurationMs(elapsed) : "—"}</span>
              </div>
              {#if variant.metrics?.sparkline}
                <span class="flame flame-dashboard" style={`width:${dashboardFlameWidth(variant)}%`} aria-label="Live conversation flame graph">
                  {#each variant.metrics.sparkline.buckets as bucket}
                    <span class={`flame-bar flame-${bucket.kind}`} style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}></span>
                  {/each}
                </span>
                <small class="flame-caption">{flameCaption(variant.metrics)}</small>
              {:else if variant.status === "running"}
                <span class="flame flame-dashboard flame-warming" aria-label="Waiting for activity"></span>
                <small class="flame-caption">warming up…</small>
              {:else if variant.status === "prepared"}
                <small class="flame-caption muted">queued</small>
              {/if}
              {#if variant.error}<p class="config-error" title={variant.error}>{variant.error}</p>{/if}
            </article>
          {/each}
        </div>
      </div>
    {:else if runDetail}
      {#if compare}
        <div class="artifact-and-diff">
          <aside class="artifact-list" aria-label="Artifacts">
            {#each artifactSectionViews as section}
              <section>
                <h3>
                  <button type="button" class="section-toggle" aria-expanded={!collapsedSections.has(section.kind)} on:click={() => toggleSection(section.kind)}>
                    <span class="section-caret" aria-hidden="true">{collapsedSections.has(section.kind) ? "▸" : "▾"}</span>
                    {section.title}
                  </button>
                </h3>
                {#if collapsedSections.has(section.kind)}
                  <!-- collapsed: header only -->
                {:else if section.changed.length === 0 && section.same.length === 0}
                  <p>{section.empty}</p>
                {:else}
                  {#each section.changed as artifact}
                    <button type="button" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                      <span>{artifact.label}</span>
                      <small class="badge badge-{artifact.status || 'available'}">{artifact.status || "available"}</small>
                    </button>
                  {/each}
                  {#if section.same.length}
                    <button type="button" class="unchanged-toggle" aria-expanded={expandedUnchanged.has(section.kind)} on:click={() => toggleUnchanged(section.kind)}>
                      {expandedUnchanged.has(section.kind) ? "▾" : "▸"} {section.same.length} unchanged
                    </button>
                    {#if expandedUnchanged.has(section.kind)}
                      {#each section.same as artifact}
                        <button type="button" class="same-row" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                          <span>{artifact.label}</span>
                          <small class="badge badge-same">same</small>
                        </button>
                      {/each}
                    {/if}
                  {/if}
                {/if}
              </section>
            {/each}
          </aside>

          <section class="diff-pane" aria-label="Artifact view">
            <div class="mode-tabs" aria-label="View mode">
              <button type="button" class:active={mode === "review"} on:click={() => mode = "review"} title="Review one config on its own">Individual</button>
              <button type="button" class:active={mode === "compare"} on:click={() => mode = "compare"} title="Compare the review notes you left">Compare notes</button>
              <button type="button" class:active={mode === "diff"} on:click={() => mode = "diff"} title="View two configs side by side">Side by side</button>
              {#if mode === "diff"}
                <span class="layout-toggle" aria-label="Side-by-side layout">
                  <button type="button" class:active={effectiveLayout === "split"} on:click={() => diffLayoutOverride = "split"}>No diff</button>
                  <button type="button" class:active={effectiveLayout === "diff"} on:click={() => diffLayoutOverride = "diff"}>Diff</button>
                </span>
              {/if}
              {#if savingReview}<small class="saving">saving…</small>{/if}
            </div>

            {#if mode === "review"}
              <div class="review-head">
                <div class="review-pick">
                  <span class="review-eyebrow">Reviewing</span>
                  {#each selectedCase?.variants || [] as variant}
                    <button type="button" class="variant-chip" class:active={variant.variantId === reviewVariantId} on:click={() => selectReviewVariant(variant.variantId)}>{variant.variantId}</button>
                  {/each}
                </div>
                <div class="verdict" aria-label="Overall verdict">
                  <button type="button" class:active={currentReview.verdict?.sentiment === "like"} on:click={() => setVerdict("like")}>👍</button>
                  <button type="button" class:active={currentReview.verdict?.sentiment === "mixed"} on:click={() => setVerdict("mixed")}>🤔</button>
                  <button type="button" class:active={currentReview.verdict?.sentiment === "dislike"} on:click={() => setVerdict("dislike")}>👎</button>
                  <span class="score" aria-label="Score out of 10">
                    <span class="score-label">Score</span>
                    {#each [0,1,2,3,4,5,6,7,8,9,10] as value}
                      <button type="button" class="score-pip" class:active={currentReview.verdict?.score === value} on:click={() => setScore(currentReview.verdict?.score === value ? undefined : value)}>{value}</button>
                    {/each}
                  </span>
                  <input class="verdict-text" placeholder="overall note (optional)" value={currentReview.verdict?.text || ""} on:change={(event) => setVerdictText(event.currentTarget.value)} />
                </div>
              </div>
              {#if reviewDiff}
                <header class="diff-head">
                  <h3>{reviewDiff.artifact.label}</h3>
                  {#if selRange}
                    <span class="sel-bar">
                      Lines {selRange.start}{#if selRange.end > selRange.start}–{selRange.end}{/if} selected
                      <button type="button" class="mark good" on:click={() => openSelectionNote("good")}>👍 good</button>
                      <button type="button" class="mark bad" on:click={() => openSelectionNote("bad")}>👎 bad</button>
                      <button type="button" class="ghost" on:click={clearSelection}>clear</button>
                    </span>
                  {:else}
                    <span>{reviewReader.length} lines · click line #s to select a block, 👍/👎 to note it</span>
                  {/if}
                </header>
                <div class="review-reader" aria-label={`${reviewDiff.artifact.label} review`}>
                  {#each reviewReader as row}
                    {@const lineNotes = notesAt(currentReview, reviewDiff.artifact.id, row.n)}
                    {@const covered = lineCovered(currentReview, reviewDiff.artifact.id, row.n)}
                    <div class="review-row" class:has-notes={covered} class:selected={inSelection(row.n)}>
                      <button type="button" class="line-no line-no-pick" class:anchor={row.n === selStart} title="Click to start/extend a selection block" on:click={() => selectGutter(row.n)}>{row.n}</button>
                      <code>{row.text}</code>
                      <span class="row-actions">
                        <button type="button" class="mark good" title="Mark this line good" on:click={() => openNote(row.n, row.n, "good")}>👍</button>
                        <button type="button" class="mark bad" title="Mark this line bad" on:click={() => openNote(row.n, row.n, "bad")}>👎</button>
                      </span>
                    </div>
                    {#each lineNotes as note}
                      <div class="line-note {note.sentiment}">
                        <span class="note-icon">{note.sentiment === "good" ? "👍" : "👎"}</span>
                        <span class="note-range">{noteRangeLabel(note)}</span>
                        <span class="note-text">{note.text}</span>
                        <button type="button" class="note-del" title="Remove note" on:click={() => removeNote(note.id)}>×</button>
                      </div>
                    {/each}
                    {#if noteLine === row.n}
                      <form class="note-composer {noteSentiment}" on:submit|preventDefault={() => saveNote()}>
                        <span class="note-icon">{noteSentiment === "good" ? "👍" : "👎"}</span>
                        <span class="note-range">{noteEndLine && noteEndLine > noteLine ? `L${noteLine}–${noteEndLine}` : `L${noteLine}`}</span>
                        <!-- svelte-ignore a11y-autofocus -->
                        <input class="note-input" placeholder={noteSentiment === "good" ? "what's good here…" : "what's wrong here…"} bind:value={noteText} autofocus />
                        <button type="submit" class="primary" disabled={!noteText.trim()}>Add</button>
                        <button type="button" class="ghost" on:click={() => { noteLine = undefined; noteEndLine = undefined; }}>Cancel</button>
                      </form>
                    {/if}
                  {/each}
                </div>
              {:else}
                <div class="state">Pick an artifact on the left to review “{reviewVariantId}”.</div>
              {/if}

            {:else if mode === "compare"}
              <div class="compare-pick">
                <label><span class="entity-tag">A</span>
                  <select bind:value={leftVariantId}>{#each selectedCase?.variants || [] as variant}<option value={variant.variantId}>{variant.variantId}</option>{/each}</select>
                </label>
                <label><span class="entity-tag">B</span>
                  <select bind:value={rightVariantId}>{#each selectedCase?.variants || [] as variant}<option value={variant.variantId}>{variant.variantId}</option>{/each}</select>
                </label>
                <small class="compare-hint">Built from your review notes</small>
              </div>
              <div class="review-compare">
                {#each [leftVariantId, rightVariantId] as variantId, index}
                  {@const key = variantKey(selectedCaseId, variantId)}
                  {@const review = reviews.variants[key]}
                  <div class="review-col">
                    <header class="review-col-head">
                      <span class="entity-tag">{index === 0 ? "A" : "B"}</span>
                      <h3>{variantId}</h3>
                      <span class="verdict-badge {review?.verdict?.sentiment || 'none'}">{verdictLabel(review?.verdict?.sentiment)}</span>
                      {#if review?.verdict?.score !== undefined}<span class="score-badge">{review.verdict.score}/10</span>{/if}
                    </header>
                    {#if review?.verdict?.text}<p class="verdict-note">{review.verdict.text}</p>{/if}
                    <section class="syn-group good">
                      <h4>👍 Did well</h4>
                      {#each notesBySentiment(key, "good") as note}
                        <div class="syn-note"><p class="syn-text">{note.text}</p><code class="syn-snippet">{note.artifactLabel}:{note.line} · {note.snippet.trim()}</code></div>
                      {:else}
                        <p class="syn-empty">No notes yet.</p>
                      {/each}
                    </section>
                    <section class="syn-group bad">
                      <h4>👎 Mistakes</h4>
                      {#each notesBySentiment(key, "bad") as note}
                        <div class="syn-note"><p class="syn-text">{note.text}</p><code class="syn-snippet">{note.artifactLabel}:{note.line} · {note.snippet.trim()}</code></div>
                      {:else}
                        <p class="syn-empty">No notes yet.</p>
                      {/each}
                    </section>
                  </div>
                {/each}
              </div>

            {:else}
              <div class="entity-heads">
                <div class="entity entity-a">
                  <label>
                    <span class="entity-tag">A</span>
                    <select bind:value={leftVariantId}>
                      {#each selectedCase?.variants || [] as variant}
                        <option value={variant.variantId}>{variant.variantId}</option>
                      {/each}
                    </select>
                  </label>
                  <small>{agentLabel(compare.left) || "manual"} · {contextLabel(compare.left)}</small>
                  {#if compare.left.metrics?.sparkline}
                    <span class="flame" style={`width:${flameWidth(compare.left.metrics.sparkline, compare.right.metrics?.sparkline)}%`} aria-label="Conversation flame graph">
                      {#each compare.left.metrics.sparkline.buckets as bucket}
                        <span class={`flame-bar flame-${bucket.kind}`} style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}></span>
                      {/each}
                    </span>
                    <small class="flame-caption">{flameCaption(compare.left.metrics)}</small>
                  {/if}
                </div>
                <div class="entity entity-b">
                  <label>
                    <span class="entity-tag">B</span>
                    <select bind:value={rightVariantId}>
                      {#each selectedCase?.variants || [] as variant}
                        <option value={variant.variantId}>{variant.variantId}</option>
                      {/each}
                    </select>
                  </label>
                  <small>{agentLabel(compare.right) || "manual"} · {contextLabel(compare.right)}</small>
                  {#if compare.right.metrics?.sparkline}
                    <span class="flame" style={`width:${flameWidth(compare.right.metrics.sparkline, compare.left.metrics?.sparkline)}%`} aria-label="Conversation flame graph">
                      {#each compare.right.metrics.sparkline.buckets as bucket}
                        <span class={`flame-bar flame-${bucket.kind}`} style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}></span>
                      {/each}
                    </span>
                    <small class="flame-caption">{flameCaption(compare.right.metrics)}</small>
                  {/if}
                </div>
              </div>
              {#if diff && isSplit}
                <header class="diff-head">
                  <h3>{diff.artifact.label}</h3>
                  <span>A {leftReader.length} · B {rightReader.length} lines</span>
                </header>
                <div class="reader" aria-label={`${diff.artifact.label} side by side`}>
                  <div class="reader-col">
                    {#each leftReader as row}
                      <div class="reader-row"><span class="line-no">{row.n}</span><code>{row.text}</code></div>
                    {/each}
                  </div>
                  <div class="reader-col reader-col-b">
                    {#each rightReader as row}
                      <div class="reader-row"><span class="line-no">{row.n}</span><code>{row.text}</code></div>
                    {/each}
                  </div>
                </div>
              {:else if diff}
                <header class="diff-head">
                  <h3>{diff.artifact.label}</h3>
                  <span>{lineCount()}</span>
                </header>
                <div class="diff-grid" role="table" aria-label={`${diff.artifact.label} diff`}>
                  {#each segments as segment}
                    {#if segment.kind === "gap" && !expandedGaps.has(segment.index)}
                      <button type="button" class="diff-gap" on:click={() => toggleGap(segment.index)}>
                        ⋯ {segment.count} unchanged lines
                      </button>
                    {:else}
                      {#each segment.lines as line}
                        <div class:changed={line.kind === "changed"} class:add={line.kind === "add"} class:delete={line.kind === "delete"} class:equal={line.kind === "equal"} class="diff-row">
                          <span class="line-no">{line.leftNumber || ""}</span>
                          <code>{line.left || ""}</code>
                          <span class="line-no">{line.rightNumber || ""}</span>
                          <code>{line.right || ""}</code>
                        </div>
                      {/each}
                    {/if}
                  {/each}
                </div>
              {:else}
                <div class="state">Select an artifact to view its diff.</div>
              {/if}
            {/if}
          </section>
        </div>
      {:else if selectedCase?.variants.length === 1}
        <div class="state">This case has one configuration. Add another variant to compare.</div>
      {:else if selectedCase && selectedCase.variants.length >= 2}
        <div class="state">Loading comparison</div>
      {:else}
        <div class="state">This run has no variants to compare yet.</div>
      {/if}
    {:else if !loading}
      <div class="state">Select a prepared run.</div>
    {/if}
  </section>
</main>
