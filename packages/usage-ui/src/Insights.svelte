<script lang="ts">
  import {
    buildInsightsFeedView,
    createInsightsApiClient,
    type UsageInsightsClient,
    type UsageInsightsFeedView,
    type UsageInsightsFindingRow
  } from "@tangent/usage-ui-data";

  // The efficiency lens: a findings-first feed over Usage telemetry, per the mark-loop design's
  // "tangent usage insights" surface. Numbers lead, the distribution chart is one stacked bar, and
  // every finding carries its evidence and remedy inline so nothing here requires re-reading a
  // conversation.
  export let client: UsageInsightsClient = createInsightsApiClient();
  /** Opens the given conversation id in the existing per-conversation view; owned by the caller (App.svelte) so this component stays decoupled from browse/read navigation state. */
  export let onOpenConversation: (conversationId: string) => void = () => undefined;
  export let onBack: () => void = () => undefined;

  let loading = true;
  let error = "";
  let feed: UsageInsightsFeedView | undefined;
  let showParked = false;
  let expandedFingerprints: string[] = [];
  let pendingFingerprints: string[] = [];
  let actionError = "";

  /**
   * Fixed category-to-color assignment for the distribution bar, keyed by the API's category key so
   * a category keeps its hue regardless of which categories arrive or in what order (color follows
   * the entity, never its position). "other" is the catch-all bucket, so it wears a neutral gray.
   */
  const CATEGORY_COLORS: Record<string, string> = {
    findingInfo: "#2a78d6",
    executing: "#1baf7a",
    writing: "#eda100",
    other: "#8a949d"
  };

  /** Fallback hues for category keys this client does not know yet, assigned by arrival order so a new server category still gets a stable, distinguishable color. */
  const FALLBACK_CATEGORY_COLORS = ["#008300", "#4a3aa7", "#e34948", "#e87ba4"];

  /** Resolves the bar/legend color for a category: the fixed per-key hue when known, otherwise a stable fallback by arrival position. */
  function categoryColor(key: string, index: number): string {
    return CATEGORY_COLORS[key] || FALLBACK_CATEGORY_COLORS[index % FALLBACK_CATEGORY_COLORS.length]!;
  }

  load();

  /** Loads the Insights feed, always fetching parked findings too so the "parked (N)" toggle needs no extra request. */
  async function load(): Promise<void> {
    loading = true;
    error = "";
    try {
      const response = await client.getInsights({ includeParked: true });
      feed = buildInsightsFeedView(response);
    } catch (caught) {
      error = friendlyError((caught as Error).message);
    } finally {
      loading = false;
    }
  }

  function toggleEvidence(fingerprint: string): void {
    expandedFingerprints = expandedFingerprints.includes(fingerprint)
      ? expandedFingerprints.filter((id) => id !== fingerprint)
      : [...expandedFingerprints, fingerprint];
  }

  /** Parks a finding, refetching the feed on success so the visible/parked split stays authoritative. */
  async function park(row: UsageInsightsFindingRow): Promise<void> {
    await runAction(row.fingerprint, () => client.park(row.fingerprint));
  }

  /** Unparks a finding, refetching the feed on success. */
  async function unpark(row: UsageInsightsFindingRow): Promise<void> {
    await runAction(row.fingerprint, () => client.unpark(row.fingerprint));
  }

  /** Runs a park/unpark mutation, surfacing a read-only-instance message instead of crashing when the server rejects it. */
  async function runAction(fingerprint: string, action: () => Promise<unknown>): Promise<void> {
    pendingFingerprints = [...pendingFingerprints, fingerprint];
    actionError = "";
    try {
      await action();
      await load();
    } catch (caught) {
      actionError = friendlyActionError((caught as Error).message);
    } finally {
      pendingFingerprints = pendingFingerprints.filter((id) => id !== fingerprint);
    }
  }

  /** Copies a value to the clipboard when available; used for the mark-command copy actions. */
  function copyText(value: string): void {
    if (value && typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(value);
  }

  function friendlyError(value: string): string {
    return value.includes("<!doctype") ? "Usage API unavailable. Start the app with `tangent usage ui`." : value;
  }

  function friendlyActionError(value: string): string {
    return value.includes("403") || /disabled in verify harness/i.test(value)
      ? "This is a read-only instance; park/unpark is disabled here."
      : value;
  }
</script>

{#snippet findingMeta(row: UsageInsightsFindingRow)}
  <div class="insight-meta">
    <span class="insight-remedy-chip" title={row.remedyLabel}>{row.remedyChip}</span>
    {#if row.projectLabel}<span class="insight-project-chip">{row.projectLabel}</span>{/if}
    {#if row.tokenLabel}<span class="insight-tokens">{row.tokenLabel}</span>{/if}
  </div>
{/snippet}

<main class="usage-insights" data-mode="insights">
  <header class="insights-header">
    <div class="insights-heading">
      <button type="button" class="read-back" onclick={onBack}>← Conversations</button>
      <h1>Insights</h1>
      {#if feed}<span class="insights-scope">{feed.scopeLabel} · last {feed.windowDays} days</span>{/if}
    </div>
    {#if feed && !feed.isEmpty && feed.categories.length}
      <div class="insights-distribution" aria-label="Agent time distribution">
        <span class="insights-total">Agent time {feed.totalLabel}</span>
        <div class="insights-bar" role="img" aria-label={feed.categories.map((category) => `${category.label} ${category.percentLabel}`).join(", ")}>
          {#each feed.categories as category, index (category.key)}
            <span
              class="insights-bar-segment"
              style={`flex-basis:${category.fraction * 100}%; background:${categoryColor(category.key, index)}`}
              title={`${category.label} ${category.percentLabel}`}
            ></span>
          {/each}
        </div>
        <div class="insights-legend">
          {#each feed.categories as category, index (category.key)}
            <span class="insights-legend-item">
              <span class="insights-legend-swatch" style={`background:${categoryColor(category.key, index)}`} aria-hidden="true"></span>
              <span class="insights-legend-label">{category.label}</span>
              <span class="insights-legend-percent">{category.percentLabel}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </header>

  {#if error}
    <div class="insights-empty">
      <p>{error}</p>
    </div>
  {:else if loading}
    <div class="insights-body" aria-label="Loading insights" aria-busy="true">
      <p class="insights-computing">Computing insights across all projects, last 30 days</p>
      <div class="insights-skeleton" aria-hidden="true">
        {#each Array.from({ length: 5 }) as _placeholder}
          <div class="insight-skeleton-card">
            <span class="insight-skeleton-cost"></span>
            <span class="insight-skeleton-body">
              <span class="insight-skeleton-line"></span>
              <span class="insight-skeleton-line short"></span>
            </span>
          </div>
        {/each}
      </div>
    </div>
  {:else if feed?.isEmpty}
    <div class="insights-empty">
      <h2>No indexed conversations in this window</h2>
      <p>Insights needs conversations indexed in the last {feed.windowDays} days to find patterns. Use Tangent for a while, or widen the window, then come back.</p>
    </div>
  {:else if feed}
    <div class="insights-body">
      {#if actionError}
        <p class="insights-action-error" role="alert">{actionError}</p>
      {/if}
      {#if feed.findings.length}
        <ol class="insights-feed" aria-label="Findings ranked by cost">
          {#each feed.findings as row (row.fingerprint)}
            <li class="insight-row">
              <span class="insight-cost">{row.costLabel}</span>
              <div class="insight-body">
                <p class="insight-title" title={row.title}>{row.title}</p>
                {@render findingMeta(row)}
                <div class="insight-actions">
                  <button type="button" onclick={() => toggleEvidence(row.fingerprint)}>
                    {expandedFingerprints.includes(row.fingerprint) ? "Hide sessions" : `Sessions (${row.evidence.length})`}
                  </button>
                  <button type="button" title={row.primaryMarkCommand} onclick={() => copyText(row.primaryMarkCommand)}>
                    Copy mark command
                  </button>
                  <button type="button" class="insight-park" disabled={pendingFingerprints.includes(row.fingerprint)} onclick={() => park(row)}>
                    {pendingFingerprints.includes(row.fingerprint) ? "Parking…" : "Park"}
                  </button>
                </div>
                {#if expandedFingerprints.includes(row.fingerprint)}
                  <ul class="insight-evidence">
                    {#each row.evidence as evidenceRow}
                      <li>
                        <button type="button" class="insight-evidence-open" onclick={() => onOpenConversation(evidenceRow.conversationId)}>
                          {evidenceRow.sessionId || evidenceRow.conversationId}
                        </button>
                        <code>{evidenceRow.markCommand}</code>
                        <button type="button" onclick={() => copyText(evidenceRow.markCommand)}>Copy</button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="insights-quiet">No findings above the noise floor in this window.</p>
      {/if}

      <button type="button" class="insights-parked-toggle" onclick={() => (showParked = !showParked)}>
        {showParked ? "Hide parked" : `Parked (${feed.parkedCount})`}
      </button>
      {#if showParked && feed.parkedFindings.length}
        <ol class="insights-feed insights-feed-parked" aria-label="Parked findings">
          {#each feed.parkedFindings as row (row.fingerprint)}
            <li class="insight-row insight-row-parked">
              <span class="insight-cost">{row.costLabel}</span>
              <div class="insight-body">
                <p class="insight-title" title={row.title}>{row.title}</p>
                {@render findingMeta(row)}
                <div class="insight-actions">
                  <button type="button" class="insight-unpark" disabled={pendingFingerprints.includes(row.fingerprint)} onclick={() => unpark(row)}>
                    {pendingFingerprints.includes(row.fingerprint) ? "Unparking…" : "Unpark"}
                  </button>
                </div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}

      {#if feed.excludedEvalRuns}
        <p class="insights-footnote">{feed.excludedEvalRuns} eval sandbox sessions excluded</p>
      {/if}
    </div>
  {/if}
</main>

<style>
  .usage-insights {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--tangent-color-surface, #f3f5f1);
    color: var(--tangent-color-text, #17201b);
    overflow-y: auto;
  }

  .insights-header {
    display: grid;
    gap: 10px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--tangent-color-border, #d9ded7);
    background: var(--tangent-color-surface-raised, #fff);
  }

  .insights-heading {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .insights-heading h1 {
    margin: 0;
    font-size: 17px;
    line-height: 1.2;
  }

  .insights-scope {
    font-size: 12px;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .read-back {
    border: none;
    background: none;
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 13px;
    padding: 0;
  }

  /* One 100% stacked bar plus a legend: the header answers "where does agent time go" in one
     glance, replacing the previous per-category mini-bars that read as three broken charts. */
  .insights-distribution {
    display: grid;
    gap: 6px;
    max-width: 640px;
  }

  .insights-total {
    font-size: 13px;
    font-weight: 600;
  }

  .insights-bar {
    display: flex;
    gap: 2px;
    height: 10px;
    border-radius: var(--tangent-radius-pill, 999px);
    overflow: hidden;
    background: var(--tangent-color-surface-inset, #e7ebe4);
  }

  .insights-bar-segment {
    display: block;
    flex: 0 0 auto;
    min-width: 2px;
    height: 100%;
  }

  .insights-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 12px;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .insights-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .insights-legend-swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .insights-legend-percent {
    font-variant-numeric: tabular-nums;
    color: var(--tangent-color-text, #17201b);
  }

  .insights-empty {
    padding: 48px 24px;
    max-width: 560px;
  }

  .insights-empty h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }

  .insights-empty p,
  .insights-quiet {
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 14px;
  }

  .insights-body {
    overflow-y: auto;
    padding: 18px 24px 32px;
  }

  /* Skeleton loading: the shape of the feed appears immediately, so a slow first computation reads
     as progress rather than a blank page. */
  .insights-computing {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .insights-skeleton {
    display: grid;
    gap: 12px;
  }

  .insight-skeleton-card {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--tangent-color-border, #d9ded7);
    border-radius: var(--tangent-radius-lg, 8px);
    background: var(--tangent-color-surface-raised, #fff);
  }

  .insight-skeleton-cost,
  .insight-skeleton-line {
    display: block;
    border-radius: 4px;
    background: var(--tangent-color-surface-inset, #e7ebe4);
    animation: insights-pulse 1.4s ease-in-out infinite;
  }

  .insight-skeleton-cost {
    height: 22px;
    width: 56px;
  }

  .insight-skeleton-body {
    display: grid;
    gap: 8px;
    align-content: start;
  }

  .insight-skeleton-line {
    height: 13px;
    width: 80%;
  }

  .insight-skeleton-line.short {
    width: 45%;
  }

  @keyframes insights-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .insight-skeleton-cost,
    .insight-skeleton-line {
      animation: none;
    }
  }

  .insights-action-error {
    color: var(--tangent-color-danger, #b91c1c);
    font-size: 13px;
    margin: 0 0 12px;
  }

  .insights-feed {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: grid;
    gap: 12px;
  }

  .insight-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--tangent-color-border, #d9ded7);
    border-radius: var(--tangent-radius-lg, 8px);
    background: var(--tangent-color-surface-raised, #fff);
  }

  .insight-row-parked {
    opacity: 0.6;
  }

  .insight-cost {
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  /* Title stays scannable: at most two lines, the full text in the tooltip. */
  .insight-title {
    margin: 0 0 6px;
    font-size: 14px;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  /* One quiet metadata line per card: remedy tag, project, token estimate. */
  .insight-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0 0 8px;
  }

  .insight-remedy-chip {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--tangent-radius-pill, 999px);
    background: var(--tangent-color-surface-inset, #e7ebe4);
    color: var(--tangent-color-text, #17201b);
    font-size: 11px;
    font-weight: 650;
    line-height: 1.4;
    white-space: nowrap;
  }

  .insight-project-chip {
    display: inline-block;
    padding: 2px 8px;
    border: 1px solid var(--tangent-color-border, #d9ded7);
    border-radius: var(--tangent-radius-pill, 999px);
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
  }

  .insight-tokens {
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 11px;
  }

  .insight-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .insight-actions button {
    border: 1px solid var(--tangent-color-border, #d9ded7);
    background: var(--tangent-color-surface, #fff);
    color: var(--tangent-color-text, #17201b);
    border-radius: var(--tangent-radius-md, 6px);
    padding: 4px 10px;
    font-size: 12px;
  }

  .insight-actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* Park is curation, not the card's call to action: quiet text-weight secondary. */
  .insight-actions button.insight-park {
    border-color: transparent;
    background: transparent;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .insight-actions button.insight-park:hover {
    color: var(--tangent-color-text, #17201b);
  }

  .insight-actions button.insight-unpark {
    border-color: var(--tangent-color-accent, #2563eb);
    color: var(--tangent-color-accent, #2563eb);
  }

  .insight-evidence {
    list-style: none;
    margin: 10px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--tangent-color-border, #d9ded7);
    display: grid;
    gap: 6px;
  }

  .insight-evidence li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .insight-evidence-open {
    border: none;
    background: none;
    color: var(--tangent-color-accent, #2563eb);
    padding: 0;
    text-decoration: underline;
  }

  .insight-evidence code {
    color: var(--tangent-color-text-muted, #66716a);
    background: var(--tangent-color-surface-inset, #e7ebe4);
    padding: 1px 6px;
    border-radius: var(--tangent-radius-sm, 4px);
  }

  .insight-evidence button {
    border: 1px solid var(--tangent-color-border, #d9ded7);
    background: none;
    color: var(--tangent-color-text, #17201b);
    border-radius: var(--tangent-radius-sm, 4px);
    padding: 1px 6px;
    font-size: 11px;
  }

  .insights-parked-toggle {
    border: none;
    background: none;
    color: var(--tangent-color-accent, #2563eb);
    font-size: 12px;
    padding: 0;
  }

  .insights-feed-parked {
    margin-top: 12px;
  }

  .insights-footnote {
    margin: 16px 0 0;
    font-size: 11px;
    color: var(--tangent-color-text-muted, #66716a);
  }
</style>
