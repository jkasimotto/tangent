<script lang="ts">
  import {
    buildInsightsFeedView,
    createInsightsApiClient,
    type UsageInsightsClient,
    type UsageInsightsFeedView,
    type UsageInsightsFindingRow
  } from "@tangent/usage-ui-data";

  // The efficiency lens: a findings-first feed over Usage telemetry, per the mark-loop design's
  // "tangent usage insights" surface. Numbers lead, charts are reduced to a one-line header, and every
  // finding carries its evidence and remedy inline so nothing here requires re-reading a conversation.
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

<main class="usage-insights" data-mode="insights">
  <header class="insights-header">
    <div class="insights-heading">
      <button type="button" class="read-back" onclick={onBack}>← Conversations</button>
      <p>Tangent Usage</p>
      <h1>Insights{feed ? ` · ${feed.scopeLabel} · last ${feed.windowDays} days` : ""}</h1>
    </div>
    {#if feed && !feed.isEmpty}
      <div class="insights-distribution" aria-label="Agent time distribution">
        <span class="insights-total">Agent time {feed.totalLabel}</span>
        {#each feed.categories as category}
          <div class="insights-category">
            <span class="insights-category-label">{category.label}</span>
            <span class="insights-category-track" role="presentation">
              <span class="insights-category-fill" style={`width:${category.fraction * 100}%`}></span>
            </span>
            <span class="insights-category-percent">{category.percentLabel}</span>
          </div>
        {/each}
      </div>
    {/if}
  </header>

  {#if error}
    <div class="insights-empty">
      <p>{error}</p>
    </div>
  {:else if loading}
    <div class="usage-loading" aria-label="Loading insights"><span class="usage-spinner"></span></div>
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
                <p class="insight-title">{row.title}{#if row.tokenLabel}<span class="insight-tokens"> ({row.tokenLabel})</span>{/if}</p>
                <p class="insight-remedy">{row.remedyLabel}</p>
                <div class="insight-actions">
                  <button type="button" onclick={() => toggleEvidence(row.fingerprint)}>
                    {expandedFingerprints.includes(row.fingerprint) ? "Hide sessions" : `View sessions (${row.evidence.length})`}
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
                <p class="insight-title">{row.title}</p>
                <p class="insight-remedy">{row.remedyLabel}</p>
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
    padding: 18px 24px;
    border-bottom: 1px solid var(--tangent-color-border, #d9ded7);
    background: var(--tangent-color-surface-raised, #fff);
  }

  .insights-heading {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .insights-heading p {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .insights-heading h1 {
    margin: 0;
    font-size: 20px;
  }

  .read-back {
    border: none;
    background: none;
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 13px;
    padding: 0;
  }

  .insights-distribution {
    display: grid;
    gap: 4px;
    font-size: 13px;
  }

  .insights-total {
    font-weight: 600;
    margin-bottom: 2px;
  }

  .insights-category {
    display: grid;
    grid-template-columns: 88px minmax(120px, 240px) 40px;
    align-items: center;
    gap: 8px;
    color: var(--tangent-color-text-muted, #66716a);
  }

  .insights-category-track {
    display: block;
    height: 6px;
    border-radius: var(--tangent-radius-pill, 999px);
    background: var(--tangent-color-surface-inset, #e7ebe4);
    overflow: hidden;
  }

  .insights-category-fill {
    display: block;
    height: 100%;
    background: var(--tangent-color-chart, #4f46e5);
  }

  .insights-category-percent {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .usage-loading {
    display: grid;
    place-items: center;
    height: 100%;
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

  .insight-title {
    margin: 0 0 4px;
    font-size: 14px;
  }

  .insight-tokens {
    color: var(--tangent-color-text-muted, #66716a);
    font-weight: 400;
  }

  .insight-remedy {
    margin: 0 0 8px;
    color: var(--tangent-color-text-muted, #66716a);
    font-size: 13px;
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

  .insight-park,
  .insight-unpark {
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
</style>
