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
    type EvalVariantSummaryView
  } from "./client.js";
  import { buildAlignedSections, diffCacheKey, fileNotes, rowsWithNotes, type AlignedSection, type AlignedRow } from "./compare-model.js";
  import AssembledContext from "./AssembledContext.svelte";
  import ConversationCompare from "./ConversationCompare.svelte";
  import ScoringCompare from "./ScoringCompare.svelte";
  import type { EvalAssembledContext, EvalConversationsView } from "./client.js";

  export let client: EvalUiClient = createEvalApiClient();

  // Per-config review state: inline good/bad notes on diff lines, persisted per run via the reviews API.
  // The aligned Compare view reads and writes these inline. Scoring is the evaluator rubric, shown separately.
  let notesOnly = false;
  let reviews: EvalReviews = { schema: "eval.reviews.v1", variants: {} };
  let savingReview = false;
  // Inline comment composer: GitHub-style, opened by clicking a diff line in either column. It carries the
  // side's variant, the artifact, the line, and that line's text (the saved note's snippet). Only one is
  // open at a time, like a single open comment box in a code review.
  let composer: { variantId: string; artifactId: string; artifactLabel: string; line: number; snippet: string } | undefined;
  let composerText = "";

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
  // Context section view: the raw file diff list vs the assembled "what the agent sees" reconstruction.
  let contextView: "files" | "assembled" = "files";
  let assembleCwd = "";
  let loadedSkills = new Set<string>();
  let assembledLeft: EvalAssembledContext | undefined;
  let assembledRight: EvalAssembledContext | undefined;
  let assembledLoading = false;
  let assembledError = "";
  let assembledKey = "";

  // Conversations section: a side-by-side reconstruction of what each agent actually did (turns and tool
  // calls), reconstructed lazily when the section is opened, so it never costs a fetch unless asked for.
  let conversationsOpen = false;
  // Scoring section: shows the evaluator model's rubric judgement for each side, side by side.
  let scoringOpen = false;
  let conversationsLeft: EvalConversationsView | undefined;
  let conversationsRight: EvalConversationsView | undefined;
  let conversationsLoading = false;
  let conversationsError = "";
  let conversationsKey = "";

  // Per-side content cache for the aligned view: keyed by diffCacheKey so re-expanding never refetches.
  let diffCache = new Map<string, EvalDiffView>();
  let expandedRows = new Set<string>(); // diffCacheKey values currently open
  let loadingRows = new Set<string>();
  let loading = true;
  let compareLoading = false;
  let error = "";
  // A run-load failure is tracked against the run it belongs to, so a deleted or moved run shows a clear
  // "could not load" message for that run instead of an endless "Loading run…".
  let runLoadError = "";
  let runLoadErrorId = "";
  let runLoadKey = "";
  let compareLoadKey = "";
  // A comparison-load failure (e.g. the server rejecting a variant pair mid-switch) is held here so the compare
  // area shows a clear, recoverable error instead of a permanent fake "Loading comparison".
  let compareError = "";
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

  onMount(() => {
    void loadInitial();
  });

  onDestroy(() => {
    clearTimeout(pollTimer);
    clearTimeout(assembleTimer);
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
  // Loading is derived, never an imperative flag: a run is "loading" whenever the loaded detail does not yet
  // match the selected run (and that run has not failed). This is self-correcting, so a fast switch can never
  // leave a stale flag stuck on "Loading run…" forever.
  $: runLoading = Boolean(runDetail) && runDetail.id !== selectedRunId && runLoadErrorId !== selectedRunId;
  $: selectedCase && leftVariantId && rightVariantId && void loadCompare();
  // The aligned Compare view shows the whole pair: one identity row per artifact, grouped by kind.
  $: alignedSections = buildAlignedSections(compare?.artifacts || []);
  $: defaultCollapsed(alignedSections);
  // Reconstruct both sides' conversations when the section opens or the variant pair changes. Svelte only
  // re-runs a reactive block for variables it directly reads, so the dep string is what makes a pair switch
  // refetch; loadConversations itself short-circuits when the section is closed or already loaded.
  $: conversationsDeps = `${conversationsOpen}|${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}`;
  $: { void conversationsDeps; void loadConversations(); }

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

  // --- Inline comments + scoring for review notes -----------------------------------------------

  /**
   * Focuses the composer input without scrolling it into view. The browser's default focus (and the
   * `autofocus` attribute) scrolls the nearest scrollable ancestor to reveal the input, which yanks the
   * diff panel and makes the line the user just clicked jump away. preventScroll keeps the line in place.
   */
  function focusNoScroll(node: HTMLElement): void {
    node.focus({ preventScroll: true });
  }

  /** Opens the inline comment composer on a diff line in one column. Clicking a line is the whole gesture. */
  function openComposer(variantId: string, artifact: EvalCompareArtifactView, line: number | undefined, snippet: string): void {
    if (line === undefined) return;
    composer = { variantId, artifactId: artifact.id, artifactLabel: artifact.label, line, snippet };
    composerText = "";
  }

  /** Whether the composer is open on this exact line of this side's artifact. */
  function composerAt(variantId: string, artifactId: string, line: number | undefined): boolean {
    return Boolean(composer && line !== undefined && composer.variantId === variantId && composer.artifactId === artifactId && composer.line === line);
  }

  /** Closes the inline composer without saving. */
  function closeComposer(): void {
    composer = undefined;
    composerText = "";
  }

  /** Saves the inline comment with a sentiment against the composer's side, then closes it. */
  async function saveComposer(sentiment: EvalReviewSentiment): Promise<void> {
    if (!composer || !composerText.trim()) return;
    const note: EvalReviewNote = {
      id: newId(),
      artifactId: composer.artifactId,
      artifactLabel: composer.artifactLabel,
      line: composer.line,
      snippet: composer.snippet,
      sentiment,
      text: composerText.trim(),
      ts: Date.now()
    };
    ensureReview(variantKey(selectedCaseId, composer.variantId)).notes.push(note);
    reviews = reviews;
    closeComposer();
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
    try {
      const next = await client.getRun(runId);
      if (runLoadKey !== runId) return;
      runDetail = next;
      selectedCaseId = next.cases.find((item) => item.id === selectedCaseId)?.id || next.cases[0]?.id || "";
      compare = undefined;
      composer = undefined;
      runLoadError = "";
      runLoadErrorId = "";
      void loadReviews(runId);
      error = "";
      if (runActive(next)) schedulePoll(runId);
      else clearTimeout(pollTimer);
    } catch (caught) {
      if (runLoadKey !== runId) return;
      // A run that cannot be loaded (deleted, moved, or corrupt) fails gracefully into its own message,
      // keyed to the run so switching to a healthy one clears it. loadRunKey stays set so a quick re-select
      // of the same run does nothing; retryRun resets it to force a fresh fetch.
      runLoadError = friendlyError(caught);
      runLoadErrorId = runId;
    }
  }

  /** Forces a fresh fetch of a run after a load failure (clears the dedup key so loadRun runs again). */
  function retryRun(runId: string): void {
    runLoadKey = "";
    runLoadError = "";
    runLoadErrorId = "";
    compareError = "";
    compareLoadKey = "";
    void loadRun(runId);
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
      compareError = "";
    } catch (caught) {
      if (compareLoadKey !== key) return;
      // A failed comparison must never read as an endless "Loading comparison". Surface it as a recoverable
      // error in the compare area, and drop the dedup key so a reload (or a corrected variant pair) retries
      // instead of being swallowed as "already loaded".
      compareError = friendlyError(caught);
      compareLoadKey = "";
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

  /** Warms the cache for a row's present sides without expanding it, so the diff is ready the instant the
      user clicks. Errors are swallowed: a prefetch that misses must never surface as an error. */
  function prefetchRow(row: AlignedRow): void {
    if (row.a.present) void ensureSideLoaded(leftVariantId, row.artifact).catch(() => {});
    if (row.b.present) void ensureSideLoaded(rightVariantId, row.artifact).catch(() => {});
  }

  // Eagerly warm the Changed files diffs as soon as a comparison loads. The agent's changed set is small,
  // so clicking a changed file is instant (a cache hit) rather than triggering a multi-second git read.
  $: prefetchChangedCode(alignedSections);
  function prefetchChangedCode(sections: AlignedSection[]): void {
    for (const section of sections) {
      if (section.kind !== "code") continue;
      for (const row of section.rows) if (!row.identical) prefetchRow(row);
    }
  }

  /** Loads (or serves from cache) one side's content for an artifact. In-flight requests (from a prefetch)
      are deduped so a hover-then-click, or prefetch-then-click, never fires the same diff twice. */
  async function ensureSideLoaded(variantId: string, artifact: EvalCompareArtifactView): Promise<void> {
    const key = diffCacheKey(selectedCaseId, variantId, artifact.id);
    if (diffCache.has(key) || loadingRows.has(key)) return;
    loadingRows.add(key); loadingRows = loadingRows;
    try {
      const view = await client.getDiff({ runId: selectedRunId, caseId: selectedCaseId, left: variantId, right: variantId, kind: artifact.kind, path: artifact.path });
      diffCache.set(key, view); diffCache = diffCache;
    } finally {
      loadingRows.delete(key); loadingRows = loadingRows;
    }
  }

  /** Fetches both variants' assembled context for the current cwd and loaded skills, memoized by key.
      Runs whenever the pair or inputs change (not only when the Assembled view is open) so switching to
      Assembled is an instant cache hit instead of a blank loading flash. */
  async function loadAssembled(): Promise<void> {
    if (!selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
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

  // Re-assemble when the pair or any input changes. Svelte only re-runs a reactive block when a variable it
  // directly reads changes; it does not track reads inside loadAssembled. Referencing the dep string here is
  // what makes cwd and skill changes refetch. Not gated on the Assembled view, so the result is prefetched.
  // Debounced so typing a cwd path resolves once the user pauses, never a fetch (and re-render) per keystroke.
  let assembleTimer: ReturnType<typeof setTimeout> | undefined;
  $: assembleDeps = `${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}|${assembleCwd}|${[...loadedSkills].sort().join(",")}`;
  $: { void assembleDeps; scheduleAssemble(); }

  /** Schedules an assembled-context reload a beat after the last input, so a typed cwd path updates the view
      in one smooth swap with no per-keystroke loading flash. */
  function scheduleAssemble(): void {
    clearTimeout(assembleTimer);
    assembleTimer = setTimeout(() => void loadAssembled(), 250);
  }

  let contextSkills: import("./client.js").EvalContextSkill[] = [];
  let contextManifestKey = "";

  /** Loads the union of discoverable skills across both variants for the picker. Prefetched alongside the
      assembled context so the skill picker is populated the moment the Assembled view is opened. */
  async function loadContextManifest(): Promise<void> {
    if (!selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const key = `${selectedRunId}::${selectedCaseId}::${leftVariantId}::${rightVariantId}`;
    if (key === contextManifestKey) return;
    contextManifestKey = key;
    try {
      const [a, b] = await Promise.all([
        client.getContextManifest({ runId: selectedRunId, caseId: selectedCaseId, variant: leftVariantId }),
        client.getContextManifest({ runId: selectedRunId, caseId: selectedCaseId, variant: rightVariantId })
      ]);
      const byName = new Map<string, import("./client.js").EvalContextSkill>();
      for (const skill of [...a.skills, ...b.skills]) if (!byName.has(skill.name)) byName.set(skill.name, skill);
      contextSkills = [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
    } catch (loadError) {
      assembledError = (loadError as Error).message;
    }
  }

  $: manifestDeps = `${selectedRunId}|${selectedCaseId}|${leftVariantId}|${rightVariantId}`;
  $: { void manifestDeps; void loadContextManifest(); }

  /** Toggles whether a skill's body is included, then re-assembles. */
  function toggleSkill(name: string): void {
    if (loadedSkills.has(name)) loadedSkills.delete(name);
    else loadedSkills.add(name);
    loadedSkills = loadedSkills;
  }

  /** Review rows for a cached side (collapsed unified diff for code, full read otherwise). */
  function sideRows(key: string): ReviewRow[] {
    const view = diffCache.get(key);
    if (!view) return [];
    return buildReviewRows(view, view.artifact.kind === "code", new Set());
  }

  /** Toggles the Conversations section open or closed. */
  function toggleConversations(): void {
    conversationsOpen = !conversationsOpen;
  }

  /** Toggles the Scoring section open or closed. */
  function toggleScoring(): void {
    scoringOpen = !scoringOpen;
  }

  /** Loads conversations when the section is open (the reactive caller), memoized by the variant pair. */
  async function loadConversations(): Promise<void> {
    if (!conversationsOpen) return;
    await fetchConversations();
  }

  /** Reconstructs both sides' conversations, memoized by the variant pair. Reconstruction is heavier than a
      diff, so it is warmed on hover/focus of the section header (see prefetchConversations) rather than
      eagerly on every comparison, then served instantly when the section opens. */
  async function fetchConversations(): Promise<void> {
    if (!selectedRunId || !selectedCaseId || !leftVariantId || !rightVariantId) return;
    const key = `${selectedRunId}::${selectedCaseId}::${leftVariantId}::${rightVariantId}`;
    if (key === conversationsKey) return;
    conversationsKey = key;
    conversationsLoading = true;
    conversationsError = "";
    try {
      const [a, b] = await Promise.all([
        client.getConversations({ runId: selectedRunId, caseId: selectedCaseId, variant: leftVariantId }),
        client.getConversations({ runId: selectedRunId, caseId: selectedCaseId, variant: rightVariantId })
      ]);
      conversationsLeft = a; conversationsRight = b;
    } catch (loadError) {
      conversationsError = (loadError as Error).message;
    } finally {
      conversationsLoading = false;
    }
  }

  /** Warms the conversation reconstruction on intent (hovering or focusing the section header), so opening
      the section is instant. Swallows errors: a prefetch that misses must never surface as one. */
  function prefetchConversations(): void {
    void fetchConversations().catch(() => {});
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

  /** Removes a note by id, wherever it lives (notes are uniquely identified across all variants). */
  async function removeNote(id: string): Promise<void> {
    let touched = false;
    for (const review of Object.values(reviews.variants)) {
      const next = review.notes.filter((note) => note.id !== id);
      if (next.length !== review.notes.length) { review.notes = next; touched = true; }
    }
    if (!touched) return;
    reviews = reviews;
    await persistReviews();
  }

  /** Notes anchored at a line (a note renders once, at its line). */
  function notesAt(review: EvalVariantReview, artifactId: string, line: number): EvalReviewNote[] {
    return review.notes.filter((note) => note.artifactId === artifactId && note.line === line);
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
    compareError = "";
    // Clear the previous run's comparison up front so switching gives instant feedback. Without this the
    // old run's cards linger on screen for the full getRun fetch (slow for big runs), reading as "nothing
    // happened". loadRun repopulates once the new run resolves.
    compare = undefined;
    // Drop the previous run's variant selection too. Otherwise the context/assemble/manifest reactives fire
    // against the new run id with the old variant ids the instant selectedRunId changes (before loadRun
    // resolves), every one a guaranteed 404. syncVariantSelection repopulates these once runDetail arrives.
    leftVariantId = "";
    rightVariantId = "";
    diffCache = new Map(); expandedRows = new Set(); loadingRows = new Set();
  }

  function selectCase(caseId: string): void {
    selectedCaseId = caseId;
    leftVariantId = "";
    rightVariantId = "";
    compareLoadKey = "";
    compareError = "";
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
  }

  // Each aligned section (Prompts / Context files / Changed files) collapses to just its header so the
  // view stays scannable. Every section starts collapsed so the page opens as a clean list of headers.
  let collapsedSections = new Set<EvalCompareArtifactKind>();
  let collapsedInitFor = "";

  function toggleSection(kind: EvalCompareArtifactKind): void {
    if (collapsedSections.has(kind)) collapsedSections.delete(kind);
    else collapsedSections.add(kind);
    collapsedSections = collapsedSections;
  }

  /** Collapse every section by default so the compare view opens as a scannable list of headers. Runs once
   * per compare load (keyed by compareLoadKey) so a user's manual toggles are never overridden by a re-render
   * of the same comparison. */
  function defaultCollapsed(sections: AlignedSection[]): void {
    if (!compareLoadKey || collapsedInitFor === compareLoadKey) return;
    collapsedInitFor = compareLoadKey;
    const next = new Set<EvalCompareArtifactKind>();
    for (const section of sections) next.add(section.kind);
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

  /** One-line flame caption: how long the conversation ran, tokens spent (with the cached share that
      makes the total look large), the estimated dollar cost, peak context, and how many distinct files
      the agent read (a comparable signal of how much it explored). */
  function flameCaption(metrics: EvalVariantMetricsView | null | undefined): string {
    if (!metrics) return "";
    const parts: string[] = [];
    if (metrics.durationMs !== undefined) parts.push(formatDurationMs(metrics.durationMs));
    if (metrics.tokensTotal) {
      const tok = `${formatTokens(metrics.tokensTotal)} tok`;
      parts.push(metrics.cachedTokens ? `${tok} (${formatTokens(metrics.cachedTokens)} cached)` : tok);
    }
    if (metrics.costUsd !== undefined) parts.push(formatCost(metrics.costUsd));
    if (metrics.peakContextTokens) parts.push(`${formatTokens(metrics.peakContextTokens)} ctx`);
    if (metrics.filesRead) parts.push(`${metrics.filesRead} files read`);
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

  /** Estimated run cost. A run dominated by cheap cache reads can land below a cent, so floor it to "<$0.01" rather than showing "$0.00". */
  function formatCost(value: number): string {
    if (value > 0 && value < 0.01) return "<$0.01";
    return value < 100 ? `$${value.toFixed(2)}` : `$${Math.round(value)}`;
  }
</script>

<main class="eval-workspace" aria-label="Eval viewer">
  <div class="topbar">
    <span class="brand">Tangent Eval</span>
    <label class="topbar-pick">
      <!-- One-way value + a single change handler, never bind:value + on:change. With both, a native change
           writes selectedRunId and flushes the run/manifest reactives with the previous run's variants still
           set (a 404) before selectRun runs to clear them and reset the load key; selectRun then resets the
           key mid-flight so getRun's result is discarded and the run sticks on "Loading run…". selectRun is
           the single source of truth, reading the new id straight off the event. -->
      <select value={selectedRunId} on:change={(event) => selectRun(event.currentTarget.value)} disabled={runs.length === 0}>
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
        <select value={selectedCaseId} on:change={(event) => selectCase(event.currentTarget.value)}>
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
                <span class="config-time">{elapsed !== undefined ? formatDurationMs(elapsed) : "-"}</span>
              </div>
              {#if variant.metrics?.sparkline}
                <span class="flame flame-dashboard" style={`width:${dashboardFlameWidth(variant)}%`} aria-label="Live conversation flame graph">
                  {#each variant.metrics.sparkline.buckets as bucket}
                    <span class={`flame-bar flame-${bucket.kind}`} style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}></span>
                  {/each}
                </span>
                <small class="flame-caption">{flameCaption(variant.metrics)}</small>
              {/if}
              {#if variant.evaluation}<span class="score-chip">{variant.evaluation.totalPoints} / {variant.evaluation.maxPoints} pts</span>{/if}
              {#if !variant.metrics?.sparkline && variant.status === "running"}
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
      {#if runLoadErrorId === selectedRunId && runLoadError}
        <div class="state state-error" role="alert">
          <p>This run could not be loaded. It may have been deleted or moved.</p>
          <button type="button" class="ghost-button" on:click={() => retryRun(selectedRunId)}>Retry</button>
        </div>
      {:else if runLoading}
        <div class="state">Loading run…</div>
      {:else if compare}
        <div class="compare-stack">
          <header class="compare-head" aria-label="Configs compared">
            {#each [{ side: "a", id: leftVariantId, v: compare.left, other: compare.right }, { side: "b", id: rightVariantId, v: compare.right, other: compare.left }] as col}
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
                {#if col.v.evaluation}<span class="score-chip">{col.v.evaluation.totalPoints} / {col.v.evaluation.maxPoints} pts</span>{/if}
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
                <div class="assembled-controls">
                  <label class="cwd-field">cwd
                    <input type="text" aria-label="cwd path" placeholder="repo root" bind:value={assembleCwd} />
                  </label>
                  {#if contextSkills.length}
                    <div class="skill-picker" role="group" aria-label="Skills to load">
                      {#each contextSkills as skill}
                        <label class="skill-option">
                          <input type="checkbox" aria-label={skill.name} checked={loadedSkills.has(skill.name)} on:change={() => toggleSkill(skill.name)} />
                          {skill.name}
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
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
                            on:pointerenter={() => prefetchRow(row)} on:focus={() => prefetchRow(row)}
                            on:click={() => toggleRow(row)}>
                            <span class="badge badge-{row.a.changed ? 'changed' : 'same'}">{row.artifact.label}</span>
                            {#if row.a.changed && row.artifact.addedLeft !== undefined}<small class="counts">+{row.artifact.addedLeft} -{row.artifact.removedLeft}</small>{/if}
                          </button>
                          {#if expandedRows.has(rkey)}
                            <div class="aligned-detail review-reader review-diff">
                              {#if loadingRows.has(key)}<div class="state">Loading…</div>
                              {:else}
                                {@const review = reviews.variants[variantKey(selectedCaseId, leftVariantId)]}
                                {#each sideRows(key) as r}
                                  {#if r.kind === "gap"}<div class="diff-gap">⋯ {r.count} unchanged lines</div>
                                  {:else}
                                    {@const lineNotes = r.line !== undefined && review ? notesAt(review, row.artifact.id, r.line) : []}
                                    {#if r.line !== undefined}
                                      <button type="button" class="review-row review-{r.marker} commentable" class:has-notes={lineNotes.length > 0} class:active={composerAt(leftVariantId, row.artifact.id, r.line)} aria-label={`Comment on line ${r.line}`} on:click={() => openComposer(leftVariantId, row.artifact, r.line, r.text)}><span class="line-no">{r.gutter}</span><code>{r.text}</code></button>
                                    {:else}<div class="review-row review-{r.marker}"><span class="line-no">{r.gutter}</span><code>{r.text}</code></div>{/if}
                                    {#each lineNotes as note}
                                      <div class="line-note {note.sentiment}">
                                        <span class="note-icon">{note.sentiment === "good" ? "👍" : "👎"}</span>
                                        <span class="note-text">{note.text}</span>
                                        <button type="button" class="note-del" aria-label="Remove note" on:click={() => removeNote(note.id)}>×</button>
                                      </div>
                                    {/each}
                                    {#if composer && composerAt(leftVariantId, row.artifact.id, r.line)}
                                      <form class="note-composer" on:submit|preventDefault={() => saveComposer("bad")}>
                                        <input class="note-input" placeholder="comment on this line…" bind:value={composerText} use:focusNoScroll />
                                        <button type="button" class="mark good" aria-label="Add positive note" disabled={!composerText.trim()} on:click={() => saveComposer("good")}>👍</button>
                                        <button type="submit" class="mark bad" aria-label="Add note flagging an issue" disabled={!composerText.trim()}>👎</button>
                                        <button type="button" class="ghost" aria-label="Cancel" on:click={closeComposer}>×</button>
                                      </form>
                                    {/if}
                                  {/if}
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
                            on:pointerenter={() => prefetchRow(row)} on:focus={() => prefetchRow(row)}
                            on:click={() => toggleRow(row)}>
                            <span class="badge badge-{row.b.changed ? 'changed' : 'same'}">{row.artifact.label}</span>
                            {#if row.b.changed && row.artifact.addedRight !== undefined}<small class="counts">+{row.artifact.addedRight} -{row.artifact.removedRight}</small>{/if}
                          </button>
                          {#if expandedRows.has(rkey)}
                            <div class="aligned-detail review-reader review-diff">
                              {#if loadingRows.has(key)}<div class="state">Loading…</div>
                              {:else}
                                {@const review = reviews.variants[variantKey(selectedCaseId, rightVariantId)]}
                                {#each sideRows(key) as r}
                                  {#if r.kind === "gap"}<div class="diff-gap">⋯ {r.count} unchanged lines</div>
                                  {:else}
                                    {@const lineNotes = r.line !== undefined && review ? notesAt(review, row.artifact.id, r.line) : []}
                                    {#if r.line !== undefined}
                                      <button type="button" class="review-row review-{r.marker} commentable" class:has-notes={lineNotes.length > 0} class:active={composerAt(rightVariantId, row.artifact.id, r.line)} aria-label={`Comment on line ${r.line}`} on:click={() => openComposer(rightVariantId, row.artifact, r.line, r.text)}><span class="line-no">{r.gutter}</span><code>{r.text}</code></button>
                                    {:else}<div class="review-row review-{r.marker}"><span class="line-no">{r.gutter}</span><code>{r.text}</code></div>{/if}
                                    {#each lineNotes as note}
                                      <div class="line-note {note.sentiment}">
                                        <span class="note-icon">{note.sentiment === "good" ? "👍" : "👎"}</span>
                                        <span class="note-text">{note.text}</span>
                                        <button type="button" class="note-del" aria-label="Remove note" on:click={() => removeNote(note.id)}>×</button>
                                      </div>
                                    {/each}
                                    {#if composer && composerAt(rightVariantId, row.artifact.id, r.line)}
                                      <form class="note-composer" on:submit|preventDefault={() => saveComposer("bad")}>
                                        <input class="note-input" placeholder="comment on this line…" bind:value={composerText} use:focusNoScroll />
                                        <button type="button" class="mark good" aria-label="Add positive note" disabled={!composerText.trim()} on:click={() => saveComposer("good")}>👍</button>
                                        <button type="submit" class="mark bad" aria-label="Add note flagging an issue" disabled={!composerText.trim()}>👎</button>
                                        <button type="button" class="ghost" aria-label="Cancel" on:click={closeComposer}>×</button>
                                      </form>
                                    {/if}
                                  {/if}
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
          <section class="aligned-section" class:collapsed={!conversationsOpen}>
            <button type="button" class="section-toggle" aria-expanded={conversationsOpen}
              on:pointerenter={prefetchConversations} on:focus={prefetchConversations} on:click={toggleConversations}>
              <span class="section-caret" aria-hidden="true">{conversationsOpen ? "▾" : "▸"}</span>
              <h3>Conversations</h3>
              <small class="section-summary">what each agent did</small>
            </button>
            {#if conversationsOpen}
              <ConversationCompare
                left={conversationsLeft}
                right={conversationsRight}
                leftLabel={leftVariantId}
                rightLabel={rightVariantId}
                loading={conversationsLoading}
                errorText={conversationsError} />
            {/if}
          </section>
          {#if compare.left.evaluation || compare.right.evaluation}
            <section class="aligned-section" class:collapsed={!scoringOpen}>
              <button type="button" class="section-toggle" aria-expanded={scoringOpen} on:click={toggleScoring}>
                <span class="section-caret" aria-hidden="true">{scoringOpen ? "▾" : "▸"}</span>
                <h3>Scoring</h3>
                <small class="section-summary">evaluator rubric judgement</small>
              </button>
              {#if scoringOpen}
                <ScoringCompare
                  left={compare.left.evaluation}
                  right={compare.right.evaluation}
                  leftLabel={leftVariantId}
                  rightLabel={rightVariantId} />
              {/if}
            </section>
          {/if}
        </div>
      {:else if compareError}
        <div class="state state-error" role="alert">
          <p>This comparison could not be loaded.</p>
          <p class="muted">{compareError}</p>
          <button type="button" class="ghost-button" on:click={() => retryRun(selectedRunId)}>Reload run</button>
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
