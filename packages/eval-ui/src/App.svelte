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
  import { buildAlignedSections, diffCacheKey, fileNotes, rowsWithNotes, type AlignedSection, type AlignedRow } from "./compare-model.js";
  import AssembledContext from "./AssembledContext.svelte";
  import type { EvalAssembledContext } from "./client.js";

  export let client: EvalUiClient = createEvalApiClient();

  // Per-config review state: an overall verdict (sentiment + score + optional note) plus inline good/bad
  // notes, persisted per run via the reviews API. The aligned Compare view reads these inline; per-row
  // content expansion and the notes lens build on this state in later tasks.
  let reviewVariantId = "";
  let notesOnly = false;
  let reviews: EvalReviews = { schema: "eval.reviews.v1", variants: {} };
  let reviewDiff: EvalDiffView | undefined;
  let reviewDiffLoadKey = "";
  let reviewDiffLoading = false;
  let noteLine: number | undefined;
  let noteSentiment: EvalReviewSentiment = "bad";
  let noteText = "";
  let savingReview = false;
  // Per-file note drill-in: the focused single-variant reader for one artifact, opened from an expanded
  // compare side. While set, reviewVariantId/selectedArtifactId track it and loadReviewDiff loads its content.
  let drill: { variantId: string; artifact: EvalCompareArtifactView } | undefined;

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
  let selectedArtifactId = "";
  // Context section view: the raw file diff list vs the assembled "what the agent sees" reconstruction.
  let contextView: "files" | "assembled" = "files";
  let assembleCwd = "";
  let loadedSkills = new Set<string>();
  let assembledLeft: EvalAssembledContext | undefined;
  let assembledRight: EvalAssembledContext | undefined;
  let assembledLoading = false;
  let assembledError = "";
  let assembledKey = "";

  // Per-side content cache for the aligned view: keyed by diffCacheKey so re-expanding never refetches.
  let diffCache = new Map<string, EvalDiffView>();
  let expandedRows = new Set<string>(); // diffCacheKey values currently open
  let loadingRows = new Set<string>();
  let loading = true;
  let runLoading = false;
  let compareLoading = false;
  let error = "";
  let runLoadKey = "";
  let compareLoadKey = "";
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
  // The aligned Compare view shows the whole pair: one identity row per artifact, grouped by kind.
  $: alignedSections = buildAlignedSections(compare?.artifacts || []);
  $: defaultCollapsed(alignedSections);
  $: reviewKey = variantKey(selectedCaseId, reviewVariantId);
  $: currentReview = reviews.variants[reviewKey] || { notes: [] };
  $: reviewReader = reviewDiff ? readerLines(reviewDiff.lines, "right") : [];
  // Individual review of code shows the agent's change (base -> this variant) as a unified diff with
  // unchanged runs collapsed, so the edits are immediately visible instead of buried in the whole file.
  // Prompts and context are inputs the agent read, not edits it made, so they stay a full read.
  $: reviewIsDiff = reviewDiff?.artifact.kind === "code";
  $: reviewChangedCount = reviewDiff ? reviewDiff.lines.filter((line) => line.kind !== "equal").length : 0;
  $: reviewRows = buildReviewRows(reviewDiff, reviewIsDiff, expandedReviewGaps);
  // The drill-in owns the single-variant reader: when open, load that one variant+file's content.
  $: compare && selectedArtifactId && reviewVariantId && drill && void loadReviewDiff();

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

  /** Sets the overall numeric score (0-10) for a given variant, preserving its sentiment and text. */
  async function setScoreFor(variantId: string, score: number | undefined): Promise<void> {
    const key = variantKey(selectedCaseId, variantId);
    const review = ensureReview(key);
    review.verdict = { sentiment: review.verdict?.sentiment || "mixed", text: review.verdict?.text, score };
    reviews = reviews;
    await persistReviews();
  }

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
      // The aligned view has no single "selected" artifact; per-row expansion drives content loads later.
      diffCache = new Map(); expandedRows = new Set(); loadingRows = new Set();
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      if (compareLoadKey === key) compareLoading = false;
    }
  }

  /** Row-level open key (per artifact within the selected case), independent of side. */
  function rowExpandKey(artifact: EvalCompareArtifactView): string {
    return `${selectedCaseId}::${artifact.id}`;
  }

  /** Toggles a comparison row open or closed, loading both sides' content together so one click opens both columns. */
  async function toggleRow(row: AlignedRow): Promise<void> {
    const rkey = rowExpandKey(row.artifact);
    if (expandedRows.has(rkey)) { expandedRows.delete(rkey); expandedRows = expandedRows; return; }
    expandedRows.add(rkey); expandedRows = expandedRows;
    const sides: string[] = [];
    if (row.a.present) sides.push(leftVariantId);
    if (row.b.present) sides.push(rightVariantId);
    await Promise.all(sides.map((variantId) => ensureSideLoaded(variantId, row.artifact)));
  }

  /** Loads (or serves from cache) one side's content for an artifact. */
  async function ensureSideLoaded(variantId: string, artifact: EvalCompareArtifactView): Promise<void> {
    const key = diffCacheKey(selectedCaseId, variantId, artifact.id);
    if (diffCache.has(key)) return;
    loadingRows.add(key); loadingRows = loadingRows;
    try {
      const view = await client.getDiff({ runId: selectedRunId, caseId: selectedCaseId, left: variantId, right: variantId, kind: artifact.kind, path: artifact.path });
      diffCache.set(key, view); diffCache = diffCache;
    } finally {
      loadingRows.delete(key); loadingRows = loadingRows;
    }
  }

  /** Opens the focused single-variant reader for one file, to add per-line notes. */
  function openDrill(variantId: string, artifact: EvalCompareArtifactView): void {
    drill = { variantId, artifact };
    reviewVariantId = variantId;
    selectedArtifactId = artifact.id;
    reviewDiffLoadKey = "";
  }

  /** Fetches both variants' assembled context for the current cwd and loaded skills, memoized by key. */
  async function loadAssembled(): Promise<void> {
    if (contextView !== "assembled" || !selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const skills = [...loadedSkills].sort();
    const key = `${selectedRunId}::${selectedCaseId}::${leftVariantId}::${rightVariantId}::${assembleCwd}::${skills.join(",")}`;
    if (key === assembledKey) return;
    assembledKey = key;
    assembledLoading = true;
    assembledError = "";
    try {
      const [a, b] = await Promise.all([
        client.assembleContext({ runId: selectedRunId, caseId: selectedCaseId, variant: leftVariantId, cwd: assembleCwd, skills }),
        client.assembleContext({ runId: selectedRunId, caseId: selectedCaseId, variant: rightVariantId, cwd: assembleCwd, skills })
      ]);
      assembledLeft = a; assembledRight = b;
    } catch (loadError) {
      assembledError = (loadError as Error).message;
    } finally {
      assembledLoading = false;
    }
  }

  // Re-assemble when the view opens or any input changes. Svelte only re-runs a reactive block when a
  // variable it directly reads changes; it does not track reads inside loadAssembled. Referencing the dep
  // string here is what makes cwd and skill changes refetch.
  $: assembleDeps = `${contextView}|${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}|${assembleCwd}|${[...loadedSkills].sort().join(",")}`;
  $: if (contextView === "assembled") { void assembleDeps; void loadAssembled(); }

  /** Closes the drill-in and returns to the comparison. */
  function closeDrill(): void {
    drill = undefined;
    noteLine = undefined;
    clearSelection();
  }

  /** Review rows for a cached side (collapsed unified diff for code, full read otherwise). */
  function sideRows(key: string): ReviewRow[] {
    const view = diffCache.get(key);
    if (!view) return [];
    return buildReviewRows(view, view.artifact.kind === "code", new Set());
  }

  /** Loads the single reviewed variant's content for the selected artifact (left=right=that variant). */
  async function loadReviewDiff(): Promise<void> {
    if (!compare || !reviewVariantId) return;
    const artifact = compare.artifacts.find((item) => item.id === selectedArtifactId);
    if (!artifact) { reviewDiff = undefined; reviewDiffLoading = false; return; }
    const key = `${selectedRunId}:${selectedCaseId}:${reviewVariantId}:${artifact.id}`;
    if (reviewDiffLoadKey === key) return;
    reviewDiffLoadKey = key;
    // Clear the previous file's diff and show a loading state: the git read can take a couple of seconds, and
    // leaving the old diff on screen makes a variant or artifact switch look stuck on the wrong file.
    reviewDiff = undefined;
    reviewDiffLoading = true;
    try {
      const next = await client.getDiff({ runId: selectedRunId, caseId: selectedCaseId, left: reviewVariantId, right: reviewVariantId, kind: artifact.kind, path: artifact.path });
      // Discard a stale response: switching the reviewed variant or artifact can leave an earlier request in
      // flight, and without this guard its late resolution would overwrite the current selection's diff.
      if (reviewDiffLoadKey !== key) return;
      reviewDiff = next;
      reviewDiffLoading = false;
      expandedReviewGaps = new Set();
      noteLine = undefined;
      noteText = "";
    } catch {
      if (reviewDiffLoadKey === key) { reviewDiff = undefined; reviewDiffLoading = false; }
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

  /** Sets the overall verdict sentiment for a given variant, preserving its score and text. */
  async function setVerdictFor(variantId: string, sentiment: EvalVerdictSentiment): Promise<void> {
    const key = variantKey(selectedCaseId, variantId);
    const review = ensureReview(key);
    review.verdict = { sentiment, text: review.verdict?.text, score: review.verdict?.score };
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
    diffCache = new Map(); expandedRows = new Set(); loadingRows = new Set();
  }

  function selectCase(caseId: string): void {
    selectedCaseId = caseId;
    leftVariantId = "";
    rightVariantId = "";
    compareLoadKey = "";
    diffCache = new Map(); expandedRows = new Set(); loadingRows = new Set();
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

  // Each aligned section (Prompts / Context files / Changed files) collapses to just its header so the
  // view stays scannable. A section with no differences starts collapsed so sameness stays out of the way.
  let collapsedSections = new Set<EvalCompareArtifactKind>();
  let collapsedInitFor = "";

  function toggleSection(kind: EvalCompareArtifactKind): void {
    if (collapsedSections.has(kind)) collapsedSections.delete(kind);
    else collapsedSections.add(kind);
    collapsedSections = collapsedSections;
  }

  /** Collapse a section by default when it has no differences. Runs once per compare load (keyed by
   * compareLoadKey) so a user's manual toggles are never overridden by a re-render of the same comparison. */
  function defaultCollapsed(sections: AlignedSection[]): void {
    if (!compareLoadKey || collapsedInitFor === compareLoadKey) return;
    collapsedInitFor = compareLoadKey;
    const next = new Set<EvalCompareArtifactKind>();
    for (const section of sections) if (!section.differs) next.add(section.kind);
    collapsedSections = next;
  }

  type DiffSegment =
    | { kind: "lines"; lines: EvalDiffLineView[] }
    | { kind: "gap"; index: number; count: number; lines: EvalDiffLineView[] };

  const DIFF_CONTEXT = 3;
  const DIFF_GAP_MIN = 3;

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

  // One row of the Individual review reader. A "line" row carries the variant line number it annotates when
  // present (added/unchanged code); rows without one (removed code) are shown for context but not annotated.
  type ReviewRow =
    | { kind: "gap"; index: number; count: number }
    | { kind: "line"; marker: "equal" | "add" | "delete" | "changed"; gutter: string; line?: number; text: string };

  let expandedReviewGaps = new Set<number>();

  function expandReviewGap(index: number): void {
    expandedReviewGaps.add(index);
    expandedReviewGaps = expandedReviewGaps;
  }

  /** Flattens the reviewed artifact into annotatable rows: a collapsed unified diff for code, a full read otherwise. */
  function buildReviewRows(view: EvalDiffView | undefined, isDiff: boolean, expanded: Set<number>): ReviewRow[] {
    if (!view) return [];
    if (!isDiff) {
      return readerLines(view.lines, "right").map((row) => ({ kind: "line", marker: "equal", gutter: `${row.n}`, line: row.n, text: row.text }));
    }
    const rows: ReviewRow[] = [];
    for (const segment of diffSegments(view.lines)) {
      if (segment.kind === "gap" && !expanded.has(segment.index)) {
        rows.push({ kind: "gap", index: segment.index, count: segment.count });
        continue;
      }
      for (const line of segment.lines) rows.push(...reviewLineRows(line));
    }
    return rows;
  }

  /** Renders one diff line as review rows: a changed line becomes a removed row above the added row. */
  function reviewLineRows(line: EvalDiffLineView): ReviewRow[] {
    if (line.kind === "delete") return [{ kind: "line", marker: "delete", gutter: `${line.leftNumber ?? ""}`, text: line.left || "" }];
    if (line.kind === "add") return [{ kind: "line", marker: "add", gutter: `${line.rightNumber ?? ""}`, line: line.rightNumber, text: line.right || "" }];
    if (line.kind === "changed") return [
      { kind: "line", marker: "delete", gutter: `${line.leftNumber ?? ""}`, text: line.left || "" },
      { kind: "line", marker: "changed", gutter: `${line.rightNumber ?? ""}`, line: line.rightNumber, text: line.right || "" }
    ];
    return [{ kind: "line", marker: "equal", gutter: `${line.rightNumber ?? ""}`, line: line.rightNumber, text: line.right || "" }];
  }

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

  {#if drill}
    <div class="modal-scrim drill-overlay" role="dialog" aria-modal="true" aria-label={`Review ${drill.variantId} · ${drill.artifact.label}`}>
      <div class="drill-panel">
        <header class="drill-head">
          <h3>{drill.variantId} · {drill.artifact.label}</h3>
          <span class="topbar-spacer"></span>
          {#if savingReview}<small class="saving" aria-live="polite">saving…</small>{/if}
          <button type="button" class="ghost" on:click={closeDrill}>Close</button>
        </header>
        {#if reviewDiffLoading}
          <div class="state">Loading…</div>
        {:else if reviewDiff}
          <header class="diff-head">
            {#if selRange}
              <span class="sel-bar">
                Lines {selRange.start}{#if selRange.end > selRange.start}–{selRange.end}{/if} selected
                <button type="button" class="mark good" on:click={() => openSelectionNote("good")}>👍 good</button>
                <button type="button" class="mark bad" on:click={() => openSelectionNote("bad")}>👎 bad</button>
                <button type="button" class="ghost" on:click={clearSelection}>clear</button>
              </span>
            {:else if reviewIsDiff}
              <span>{reviewChangedCount} changed {reviewChangedCount === 1 ? "line" : "lines"} · unchanged code collapsed · click line #s to select, 👍/👎 to note</span>
            {:else}
              <span>{reviewReader.length} lines · click line #s to select a block, 👍/👎 to note it</span>
            {/if}
          </header>
          <div class="review-reader" class:review-diff={reviewIsDiff} aria-label={`${reviewDiff.artifact.label} review`}>
            {#if reviewIsDiff && reviewChangedCount === 0}
              <div class="state">This config made no changes to {reviewDiff.artifact.label}.</div>
            {/if}
            {#each reviewRows as row}
              {#if row.kind === "gap"}
                <button type="button" class="diff-gap" on:click={() => expandReviewGap(row.index)}>⋯ {row.count} unchanged lines</button>
              {:else if row.line !== undefined}
                {@const lineNotes = notesAt(currentReview, reviewDiff.artifact.id, row.line)}
                {@const covered = lineCovered(currentReview, reviewDiff.artifact.id, row.line)}
                <div class="review-row review-{row.marker}" class:has-notes={covered} class:selected={inSelection(row.line)}>
                  <button type="button" class="line-no line-no-pick" class:anchor={row.line === selStart} title="Click to start/extend a selection block" on:click={() => selectGutter(row.line)}>{row.gutter}</button>
                  <code>{row.text}</code>
                  <span class="row-actions">
                    <button type="button" class="mark good" title="Mark this line good" on:click={() => openNote(row.line, row.line, "good")}>👍</button>
                    <button type="button" class="mark bad" title="Mark this line bad" on:click={() => openNote(row.line, row.line, "bad")}>👎</button>
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
                {#if noteLine === row.line}
                  <form class="note-composer {noteSentiment}" on:submit|preventDefault={() => saveNote()}>
                    <span class="note-icon">{noteSentiment === "good" ? "👍" : "👎"}</span>
                    <span class="note-range">{noteEndLine && noteEndLine > noteLine ? `L${noteLine}–${noteEndLine}` : `L${noteLine}`}</span>
                    <!-- svelte-ignore a11y-autofocus -->
                    <input class="note-input" placeholder={noteSentiment === "good" ? "what's good here…" : "what's wrong here…"} bind:value={noteText} autofocus />
                    <button type="submit" class="primary" disabled={!noteText.trim()}>Add</button>
                    <button type="button" class="ghost" on:click={() => { noteLine = undefined; noteEndLine = undefined; }}>Cancel</button>
                  </form>
                {/if}
              {:else}
                <div class="review-row review-{row.marker} review-context">
                  <span class="line-no muted">{row.gutter}</span>
                  <code>{row.text}</code>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="state">No content to review for {drill.artifact.label}.</div>
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
                <span class="config-time">{elapsed !== undefined ? formatDurationMs(elapsed) : "-"}</span>
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
        <div class="compare-stack">
          <header class="compare-head" aria-label="Configs compared">
            {#each [{ side: "a", id: leftVariantId, v: compare.left, other: compare.right }, { side: "b", id: rightVariantId, v: compare.right, other: compare.left }] as col}
              {@const review = reviews.variants[variantKey(selectedCaseId, col.id)]}
              <div class="compare-col-head entity-{col.side}">
                <label>
                  <span class="entity-tag">{col.side === "a" ? "A" : "B"}</span>
                  <select value={col.id} on:change={(event) => col.side === "a" ? (leftVariantId = event.currentTarget.value) : (rightVariantId = event.currentTarget.value)}>
                    {#each selectedCase?.variants || [] as variant}<option value={variant.variantId}>{variant.variantId}</option>{/each}
                  </select>
                </label>
                <small class="compare-col-meta">{agentLabel(col.v) || "manual"} · {contextLabel(col.v)}</small>
                {#if col.v.metrics?.sparkline}
                  <span class="flame" style={`width:${flameWidth(col.v.metrics.sparkline, col.other.metrics?.sparkline)}%`} aria-label="Conversation flame graph">
                    {#each col.v.metrics.sparkline.buckets as bucket}
                      <span class={`flame-bar flame-${bucket.kind}`} style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}></span>
                    {/each}
                  </span>
                  <small class="flame-caption">{flameCaption(col.v.metrics)}</small>
                {/if}
                <div class="verdict-inline" aria-label={`Verdict for ${col.id}`}>
                  <button type="button" aria-label={`Verdict ${col.id} like`} class:active={review?.verdict?.sentiment === "like"} on:click={() => setVerdictFor(col.id, "like")}>👍</button>
                  <button type="button" aria-label={`Verdict ${col.id} mixed`} class:active={review?.verdict?.sentiment === "mixed"} on:click={() => setVerdictFor(col.id, "mixed")}>🤔</button>
                  <button type="button" aria-label={`Verdict ${col.id} dislike`} class:active={review?.verdict?.sentiment === "dislike"} on:click={() => setVerdictFor(col.id, "dislike")}>👎</button>
                  <span class="score" aria-label="Score out of 10">
                    {#each [0,1,2,3,4,5,6,7,8,9,10] as value}
                      <button type="button" class="score-pip" aria-label={`Score ${col.id} ${value}`} class:active={review?.verdict?.score === value} on:click={() => setScoreFor(col.id, review?.verdict?.score === value ? undefined : value)}>{value}</button>
                    {/each}
                  </span>
                </div>
              </div>
            {/each}
          </header>

          {#if savingReview}<small class="saving" aria-live="polite">saving…</small>{/if}

          <div class="compare-lens">
            <button type="button" class="lens-toggle" class:active={notesOnly} on:click={() => (notesOnly = !notesOnly)}>Notes only</button>
          </div>

          {#each alignedSections as section}
            {@const rows = notesOnly ? rowsWithNotes(section, reviews, selectedCaseId, leftVariantId, rightVariantId) : section.rows}
            <section class="aligned-section" class:collapsed={collapsedSections.has(section.kind)}>
              <button type="button" class="section-toggle" aria-expanded={!collapsedSections.has(section.kind)} on:click={() => toggleSection(section.kind)}>
                <span class="section-caret" aria-hidden="true">{collapsedSections.has(section.kind) ? "▸" : "▾"}</span>
                <h3>{section.title}</h3>
                <small class="section-summary">{section.differs ? "differs" : "identical"}</small>
              </button>
              {#if section.kind === "context"}
                <div class="context-toggle">
                  <button type="button" class="seg" class:active={contextView === "files"} on:click={() => (contextView = "files")}>Files</button>
                  <button type="button" class="seg" class:active={contextView === "assembled"} on:click={() => (contextView = "assembled")}>Assembled</button>
                </div>
              {/if}
              {#if section.kind === "context" && contextView === "assembled"}
                <AssembledContext
                  left={assembledLeft}
                  right={assembledRight}
                  leftLabel={leftVariantId}
                  rightLabel={rightVariantId}
                  loading={assembledLoading}
                  errorText={assembledError} />
              {:else}
              <div class="aligned-rows">
                {#each rows as row}
                  <div class="aligned-row" class:identical={row.identical}>
                    {#if notesOnly}
                      {#each [{ id: leftVariantId, cls: "aligned-a" }, { id: rightVariantId, cls: "aligned-b" }] as side}
                        <div class={side.cls}>
                          {#each fileNotes(reviews, selectedCaseId, side.id, row.artifact.id) as note}
                            <div class="syn-note {note.sentiment}">
                              <p class="note-text">{note.text}</p>
                              <code class="syn-snippet">{note.artifactLabel}:{note.line} · {note.snippet.trim()}</code>
                            </div>
                          {/each}
                        </div>
                      {/each}
                    {:else}
                      <div class="aligned-a">
                        {#if row.a.present}
                          {@const key = diffCacheKey(selectedCaseId, leftVariantId, row.artifact.id)}
                          {@const rkey = rowExpandKey(row.artifact)}
                          <button type="button" class="row-expand"
                            aria-label={`${expandedRows.has(rkey) ? "Collapse" : "Expand"} ${row.artifact.label}`}
                            on:click={() => toggleRow(row)}>
                            <span class="badge badge-{row.a.changed ? 'changed' : 'same'}">{row.artifact.label}</span>
                            {#if row.a.changed && row.artifact.addedLeft !== undefined}<small class="counts">+{row.artifact.addedLeft} -{row.artifact.removedLeft}</small>{/if}
                          </button>
                          {#if expandedRows.has(rkey)}
                            <div class="aligned-detail review-reader review-diff">
                              <button type="button" class="row-note" aria-label={`Add notes on ${row.artifact.label} for ${leftVariantId}`} on:click={() => openDrill(leftVariantId, row.artifact)}>note ✎</button>
                              {#if loadingRows.has(key)}<div class="state">Loading…</div>
                              {:else}
                                {#each sideRows(key) as r}
                                  {#if r.kind === "gap"}<div class="diff-gap">⋯ {r.count} unchanged lines</div>
                                  {:else}<div class="review-row review-{r.marker}"><span class="line-no">{r.gutter}</span><code>{r.text}</code></div>{/if}
                                {/each}
                              {/if}
                            </div>
                          {/if}
                        {:else}<span class="absent">absent</span>{/if}
                      </div>
                      <div class="aligned-b">
                        {#if row.b.present}
                          {@const key = diffCacheKey(selectedCaseId, rightVariantId, row.artifact.id)}
                          {@const rkey = rowExpandKey(row.artifact)}
                          <button type="button" class="row-expand"
                            aria-label={`${expandedRows.has(rkey) ? "Collapse" : "Expand"} ${row.artifact.label}`}
                            on:click={() => toggleRow(row)}>
                            <span class="badge badge-{row.b.changed ? 'changed' : 'same'}">{row.artifact.label}</span>
                            {#if row.b.changed && row.artifact.addedRight !== undefined}<small class="counts">+{row.artifact.addedRight} -{row.artifact.removedRight}</small>{/if}
                          </button>
                          {#if expandedRows.has(rkey)}
                            <div class="aligned-detail review-reader review-diff">
                              <button type="button" class="row-note" aria-label={`Add notes on ${row.artifact.label} for ${rightVariantId}`} on:click={() => openDrill(rightVariantId, row.artifact)}>note ✎</button>
                              {#if loadingRows.has(key)}<div class="state">Loading…</div>
                              {:else}
                                {#each sideRows(key) as r}
                                  {#if r.kind === "gap"}<div class="diff-gap">⋯ {r.count} unchanged lines</div>
                                  {:else}<div class="review-row review-{r.marker}"><span class="line-no">{r.gutter}</span><code>{r.text}</code></div>{/if}
                                {/each}
                              {/if}
                            </div>
                          {/if}
                        {:else}<span class="absent">absent</span>{/if}
                      </div>
                    {/if}
                  </div>
                {/each}
                {#if rows.length === 0}
                  {#if notesOnly}
                    <p class="aligned-empty">No notes in {section.title.toLowerCase()}</p>
                  {:else}
                    <p class="aligned-empty">No {section.title.toLowerCase()}</p>
                  {/if}
                {/if}
              </div>
              {/if}
            </section>
          {/each}
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
