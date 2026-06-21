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

  function statusSummary(run: EvalRunSummaryView): string {
    return Object.entries(run.statuses)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${count} ${status}`)
      .join(", ");
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

  function sparklineBarStyle(tokenShare: number, durationShare: number): string {
    return `height:${Math.max(10, Math.round(tokenShare * 100))}%;opacity:${(0.4 + durationShare * 0.6).toFixed(2)}`;
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
  <aside class="run-rail" aria-label="Eval runs">
    <header>
      <p>Tangent Eval</p>
      <h1>Prepared runs</h1>
    </header>

    <section class="run-launch" aria-label="Run an eval">
      <label>
        <span>Spec</span>
        <select bind:value={selectedSpecPath} disabled={launching || specs.length === 0}>
          {#if specs.length === 0}
            <option value="">No specs found</option>
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
      {#if launchError}<small class="run-error" role="alert">{launchError}</small>{/if}
    </section>

    {#if loading}
      <div class="state">Loading runs</div>
    {:else if runs.length === 0}
      <div class="state">No prepared eval runs found.</div>
    {:else}
      <div class="run-list">
        {#each runs as run}
          <button type="button" class:active={run.id === selectedRunId} on:click={() => selectRun(run.id)}>
            <strong>{run.name}</strong>
            <span>{formatDate(run.createdAt)}</span>
            <small>{run.variantCount} variants · {statusSummary(run)}</small>
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <section class="compare-shell" aria-busy={runLoading || compareLoading}>
    {#if error}
      <div class="notice" role="alert">{error}</div>
    {/if}

    {#if runDetail}
      <header class="run-header">
        <div>
          <p>{runDetail.id}</p>
          <h2>{runDetail.name}</h2>
        </div>
        <div class="run-meta">
          <span>{runDetail.caseCount} cases</span>
          <span>{runDetail.variantCount} variants</span>
          <span>{statusSummary(runDetail)}</span>
        </div>
      </header>

      <div class="compare-controls" aria-label="Compare configurations">
        <label>
          <span>Case</span>
          <select bind:value={selectedCaseId} on:change={() => selectCase(selectedCaseId)}>
            {#each runDetail.cases as testCase}
              <option value={testCase.id}>{testCase.id}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Configuration A</span>
          <select bind:value={leftVariantId}>
            {#each selectedCase?.variants || [] as variant}
              <option value={variant.variantId}>{variant.variantId}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Configuration B</span>
          <select bind:value={rightVariantId}>
            {#each selectedCase?.variants || [] as variant}
              <option value={variant.variantId}>{variant.variantId}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if compare}
        <div class="variant-strip">
          {#each [{ tag: "A", variant: compare.left }, { tag: "B", variant: compare.right }] as side}
            <section>
              <p>{side.tag} · {side.variant.status}</p>
              <h3>{side.variant.variantId}</h3>
              <span>{agentLabel(side.variant) || "manual"}</span>
              <small>{contextLabel(side.variant)}</small>
              {#if side.variant.metrics?.sparkline}
                <div class="spark" aria-label={`${side.tag} activity`}>
                  {#each side.variant.metrics.sparkline.buckets as bucket}
                    <span class="spark-bar spark-{bucket.kind}" style={sparklineBarStyle(bucket.tokenShare, bucket.durationShare)}></span>
                  {/each}
                </div>
                {#if side.variant.metrics.conversationIds[0]}
                  <a class="spark-link" href={`/usage?conversation=${encodeURIComponent(side.variant.metrics.conversationIds[0])}`}>Open flamegraph</a>
                {/if}
              {/if}
            </section>
          {/each}
        </div>

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
            <section>
              <h3>Prompts</h3>
              {#if artifactGroup("prompt").length === 0}
                <p>No prompt artifacts</p>
              {:else}
                {#each artifactGroup("prompt") as artifact}
                  <button type="button" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                    <span>{artifact.label}</span>
                    <small>{artifact.status || "available"}</small>
                  </button>
                {/each}
              {/if}
            </section>
            <section>
              <h3>Context files</h3>
              {#if artifactGroup("context").length === 0}
                <p>No context files</p>
              {:else}
                {#each artifactGroup("context") as artifact}
                  <button type="button" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                    <span>{artifact.label}</span>
                    <small>{artifact.status || "available"}</small>
                  </button>
                {/each}
              {/if}
            </section>
            <section>
              <h3>Changed files</h3>
              {#if artifactGroup("code").length === 0}
                <p>No code changes</p>
              {:else}
                {#each artifactGroup("code") as artifact}
                  <button type="button" class:active={artifact.id === selectedArtifactId} on:click={() => selectArtifact(artifact)}>
                    <span>{artifact.label}</span>
                    <small>{artifact.status || "available"}</small>
                  </button>
                {/each}
              {/if}
            </section>
          </aside>

          <section class="diff-pane" aria-label="Artifact diff">
            {#if diff}
              <header>
                <div>
                  <p>{diff.artifact.kind}</p>
                  <h3>{diff.artifact.label}</h3>
                </div>
                <span>{lineCount()}</span>
              </header>
              <div class="diff-grid" role="table" aria-label={`${diff.artifact.label} diff`}>
                {#each diff.lines as line}
                  <div class:changed={line.kind === "changed"} class:add={line.kind === "add"} class:delete={line.kind === "delete"} class:equal={line.kind === "equal"} class="diff-row">
                    <span class="line-no">{line.leftNumber || ""}</span>
                    <code>{line.left || ""}</code>
                    <span class="line-no">{line.rightNumber || ""}</span>
                    <code>{line.right || ""}</code>
                  </div>
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
