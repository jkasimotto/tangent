<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    createEvalApiClient,
    type EvalCaseView,
    type EvalCompareArtifactKind,
    type EvalCompareArtifactView,
    type EvalCompareView,
    type EvalDiffView,
    type EvalRunDetailView,
    type EvalRunSummaryView,
    type EvalSpecSummaryView,
    type EvalUiClient,
    type EvalVariantMetricsView,
    type EvalVariantSummaryView
  } from "./client.js";

  export let client: EvalUiClient = createEvalApiClient();

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

  onMount(() => {
    void loadInitial();
  });

  onDestroy(() => clearTimeout(pollTimer));

  $: selectedCase = runDetail?.cases.find((item) => item.id === selectedCaseId);
  $: selectedCase && syncVariantSelection(selectedCase);
  $: selectedRunId && void loadRun(selectedRunId);
  $: selectedCase && leftVariantId && rightVariantId && void loadCompare();
  $: compare && syncArtifactSelection(compare.artifacts);
  $: compare && selectedArtifactId && void loadDiff();

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
      selectedSpecPath = specs[0]?.path || "";
      selectedRunId = selection.runId && runs.some((run) => run.id === selection.runId) ? selection.runId : runs[0]?.id || "";
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

  function selectRun(runId: string): void {
    selectedRunId = runId;
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

  function artifactGroup(kind: EvalCompareArtifactKind): EvalCompareArtifactView[] {
    return compare?.artifacts.filter((artifact) => artifact.kind === kind) || [];
  }

  const artifactSections: { kind: EvalCompareArtifactKind; title: string; empty: string }[] = [
    { kind: "prompt", title: "Prompts", empty: "No prompt artifacts" },
    { kind: "context", title: "Context files", empty: "No context files" },
    { kind: "code", title: "Changed files", empty: "No code changes" }
  ];

  /** Splits a kind's artifacts into changed (surfaced first) and same (collapsed). */
  function splitArtifacts(kind: EvalCompareArtifactKind): { changed: EvalCompareArtifactView[]; same: EvalCompareArtifactView[] } {
    const group = artifactGroup(kind);
    return {
      changed: group.filter((artifact) => artifact.status !== "same"),
      same: group.filter((artifact) => artifact.status === "same")
    };
  }

  let expandedUnchanged = new Set<EvalCompareArtifactKind>();

  function toggleUnchanged(kind: EvalCompareArtifactKind): void {
    if (expandedUnchanged.has(kind)) expandedUnchanged.delete(kind);
    else expandedUnchanged.add(kind);
    expandedUnchanged = expandedUnchanged;
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

  type ResultRow = {
    label: string;
    aText: string;
    bText: string;
    aPct: number;
    bPct: number;
    delta: string;
    deltaBad: boolean;
    deltaGood: boolean;
  };

  $: resultRows = compare ? buildResultRows(compare.left.metrics, compare.right.metrics) : [];

  /** Builds the A-vs-B output rows (time, peak context, files changed). Lower is treated as better. */
  function buildResultRows(left: EvalVariantMetricsView | null | undefined, right: EvalVariantMetricsView | null | undefined): ResultRow[] {
    if (!left && !right) return [];
    return [
      resultRow("Time", left?.durationMs, right?.durationMs, formatDurationMs),
      resultRow("Peak context", left?.peakContextTokens, right?.peakContextTokens, formatTokens),
      resultRow("Files changed", left?.filesChanged, right?.filesChanged, (value) => `${value}`)
    ];
  }

  /** Builds one comparison row, scaling both bars against the larger value. */
  function resultRow(label: string, a: number | undefined, b: number | undefined, format: (value: number) => string): ResultRow {
    const aValue = a ?? 0;
    const bValue = b ?? 0;
    const max = Math.max(aValue, bValue, 1);
    const delta = bValue - aValue;
    return {
      label,
      aText: a === undefined ? "—" : format(aValue),
      bText: b === undefined ? "—" : format(bValue),
      aPct: (aValue / max) * 100,
      bPct: (bValue / max) * 100,
      delta: delta === 0 ? "even" : `${delta > 0 ? "+" : "−"}${format(Math.abs(delta))} B`,
      deltaBad: delta > 0,
      deltaGood: delta < 0
    };
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
    <label class="topbar-pick">
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
    <button type="button" class="run-button" on:click={launch} disabled={launching || !selectedSpecPath}>
      {launching ? "Starting…" : "Run"}
    </button>
  </div>

  <section class="compare-shell" aria-busy={runLoading || compareLoading}>
    {#if error}
      <div class="notice" role="alert">{error}</div>
    {/if}

    {#if runDetail}
      {#if compare}
        {#if resultRows.length}
          <div class="results-strip" aria-label="Output comparison">
            {#each resultRows as row}
              <div class="result-metric">
                <span class="result-label">{row.label}</span>
                <div class="versus">
                  <div class="versus-row"><span class="versus-tag">A</span><div class="versus-track"><span class="versus-fill a" style={`width:${row.aPct}%`}></span></div><span class="versus-value">{row.aText}</span></div>
                  <div class="versus-row"><span class="versus-tag">B</span><div class="versus-track"><span class="versus-fill b" style={`width:${row.bPct}%`}></span></div><span class="versus-value">{row.bText}</span></div>
                </div>
                <span class="result-delta" class:good={row.deltaGood} class:bad={row.deltaBad}>{row.delta}</span>
              </div>
            {/each}
          </div>
        {/if}

        <div class="artifact-and-diff">
          <aside class="artifact-list" aria-label="Artifacts">
            {#each artifactSections as section}
              {@const split = splitArtifacts(section.kind)}
              <section>
                <h3>{section.title}</h3>
                {#if split.changed.length === 0 && split.same.length === 0}
                  <p>{section.empty}</p>
                {:else}
                  {#each split.changed as artifact}
                    <button type="button" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                      <span>{artifact.label}</span>
                      <small class="badge badge-{artifact.status || 'available'}">{artifact.status || "available"}</small>
                    </button>
                  {/each}
                  {#if split.same.length}
                    <button type="button" class="unchanged-toggle" aria-expanded={expandedUnchanged.has(section.kind)} on:click={() => toggleUnchanged(section.kind)}>
                      {expandedUnchanged.has(section.kind) ? "▾" : "▸"} {split.same.length} unchanged
                    </button>
                    {#if expandedUnchanged.has(section.kind)}
                      {#each split.same as artifact}
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

          <section class="diff-pane" aria-label="Artifact diff">
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
                <small>
                  {agentLabel(compare.left) || "manual"} · {contextLabel(compare.left)}
                  {#if compare.left.metrics?.conversationIds?.[0]}
                    · <a href={`/usage?conversation=${encodeURIComponent(compare.left.metrics.conversationIds[0])}`}>flamegraph</a>
                  {/if}
                </small>
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
                <small>
                  {agentLabel(compare.right) || "manual"} · {contextLabel(compare.right)}
                  {#if compare.right.metrics?.conversationIds?.[0]}
                    · <a href={`/usage?conversation=${encodeURIComponent(compare.right.metrics.conversationIds[0])}`}>flamegraph</a>
                  {/if}
                </small>
              </div>
            </div>
            {#if diff}
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
