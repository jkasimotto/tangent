<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    createUsageApiClient,
    type UsageBottleneck,
    type UsageConversationChartRow,
    type UsageConversationChartSegment,
    type UsageConversationMessage,
    type UsageConversationView,
    type UsageSessionListItem,
    type UsageSparkline,
    type UsageUiClient
  } from "@tangent/usage-ui-data";

  export let client: UsageUiClient = createUsageApiClient();

  let sessions: UsageSessionListItem[] = [];
  let view: UsageConversationView | undefined;
  let selectedId: string | undefined;
  let mode: "browse" | "read" = "browse";
  let query = "";
  let loading = true;
  let conversationLoading = false;
  let error = "";
  let activeMessageId = "";
  let activeSegmentId = "";
  let bottleneckIndex = -1;
  let expandedMessageIds: string[] = [];
  let expandedToolIds: string[] = [];
  let zoom = 1;

  const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];
  const BASE_PX_PER_MS = 0.001; // ~1px per second at zoom 1; a 2min turn ≈ the min width, longer turns grow
  const MIN_TURN_PX = 120; // keeps the prompt label readable even for short turns
  const MIN_BAR_HEIGHT = 16; // token-light / token-less turns still show a clickable bar
  const MAX_BAR_HEIGHT = 72; // the busiest-context turn
  const LABEL_MIN_PX = 64; // only label a segment in-bar when it is wide enough to read
  const MIN_FLAME_WIDTH_PCT = 12;
  const messagePreviewLimit = 360;
  const messageElements = new Map<string, HTMLElement>();
  const segmentElements = new Map<string, HTMLElement>();
  let messageListNode: HTMLElement;
  let flameScrollNode: HTMLElement;

  onMount(() => {
    void loadSessions();
  });

  $: pxPerMs = BASE_PX_PER_MS * zoom;
  $: filteredSessions = filterSessions(sessions, query);
  $: maxFlameDurationMs = Math.max(1, ...filteredSessions.map((session) => session.flame?.durationMs || 0));
  $: bottleneckIds = new Set((view?.bottlenecks || []).map((bottleneck) => bottleneck.id));
  $: activeRow = view?.chart.rows.find((row) => rowIds(row.messageIds || row.messageId).includes(activeMessageId)) || view?.chart.rows[0];
  $: detailMessages = detailMessagesFor(view, activeRow);

  async function loadSessions(): Promise<void> {
    loading = true;
    try {
      const list = await client.listSessions({ limit: 80 });
      sessions = list.sessions;
      error = "";
    } catch (caught) {
      error = friendlyError((caught as Error).message);
    } finally {
      loading = false;
    }
  }

  let loadKey = "";
  async function loadConversation(id: string, search: string): Promise<void> {
    const key = `${id}:${search}`;
    if (loadKey === key) return;
    loadKey = key;
    const previousView = view;
    conversationLoading = Boolean(previousView);
    try {
      const nextView = await client.getConversationView(id, { query: search, limit: 80 });
      if (loadKey !== key) return;
      view = nextView;
      activeMessageId = view.chart.rows[0]?.messageId || view.messages[0]?.id || "";
      activeSegmentId = "";
      bottleneckIndex = -1;
      expandedMessageIds = [];
      expandedToolIds = [];
      error = "";
    } catch (caught) {
      error = friendlyError((caught as Error).message);
    } finally {
      if (loadKey === key) conversationLoading = false;
    }
  }

  function openSession(id: string): void {
    selectedId = id;
    mode = "read";
    void loadConversation(id, query);
  }

  function backToBrowse(): void {
    mode = "browse";
  }

  /** Filters the session list for the browse gallery and rail. */
  function filterSessions(values: UsageSessionListItem[], search: string): UsageSessionListItem[] {
    const needle = search.trim().toLowerCase();
    if (!needle) return values;
    return values.filter((session) => `${session.title} ${session.provider || ""} ${session.model || ""}`.toLowerCase().includes(needle));
  }

  /** Returns the messages that belong to the active work turn for the detail panel. */
  function detailMessagesFor(currentView: UsageConversationView | undefined, row: UsageConversationChartRow | undefined): UsageConversationMessage[] {
    if (!currentView) return [];
    const ids = rowIds(row?.messageIds || row?.messageId);
    const scoped = currentView.messages.filter((message) => ids.includes(message.id));
    return scoped.length ? scoped : currentView.messages;
  }

  function rowIds(value: string | string[] | undefined): string[] {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  function zoomIn(): void {
    zoom = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom) + 1)] ?? zoom;
  }

  function zoomOut(): void {
    zoom = ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom) - 1)] ?? zoom;
  }

  /** Returns the work-turn wall duration that drives its horizontal width. Uses the turn's own
   * timestamp-window duration (reliable) and only falls back to summed step durations when absent. */
  function turnDurationMs(row: UsageConversationChartRow): number {
    if (row.durationMs !== undefined) return row.durationMs;
    const total = row.segments.reduce((sum, segment) => sum + (segment.durationMs || 0), 0);
    return total || Math.max(1, row.segments.length) * 1000;
  }

  /** Returns the pixel width of a whole work turn, proportional to its wall duration. `scale` is
   * passed in (not read from `pxPerMs`) so Svelte tracks the zoom dependency on re-render. */
  function turnWidthPx(row: UsageConversationChartRow, scale: number): number {
    return Math.max(MIN_TURN_PX, turnDurationMs(row) * scale);
  }

  /** Returns the bar height for a turn, proportional to its cumulative context tokens, so
   * token-heavy turns stand taller and compactions read as a drop. */
  function turnBarHeightPx(row: UsageConversationChartRow, maxTokens: number): number {
    const share = row.tokens === undefined ? 0 : Math.min(1, row.tokens / Math.max(1, maxTokens));
    return Math.round(MIN_BAR_HEIGHT + (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * share);
  }

  /** Returns each segment's effective duration, attributing the turn's untracked time (model /
   * thinking, which carries no per-step timing) evenly to the segments that lack a duration, so the
   * segments still sum to the turn's wall duration. */
  function effectiveSegmentDurations(row: UsageConversationChartRow): number[] {
    const segments = row.segments ?? [];
    const known = segments.map((segment) => (segment.durationMs && segment.durationMs > 0 ? segment.durationMs : undefined));
    const knownSum = known.reduce<number>((sum, value) => sum + (value || 0), 0);
    const unknownCount = known.filter((value) => value === undefined).length;
    const remainder = Math.max(0, turnDurationMs(row) - knownSum);
    const perUnknown = unknownCount > 0 ? remainder / unknownCount : 0;
    return known.map((value) => (value === undefined ? perUnknown : value));
  }

  /** Returns the pixel width of each segment, partitioning the turn's width by effective duration. */
  function segmentWidths(row: UsageConversationChartRow, scale: number): number[] {
    const effective = effectiveSegmentDurations(row);
    const total = effective.reduce((sum, value) => sum + value, 0) || 1;
    const turnWidth = turnWidthPx(row, scale);
    return effective.map((value) => (value / total) * turnWidth);
  }

  /** Fades bars whose timing is less trustworthy so estimated widths are not over-read. */
  function confidenceOpacity(confidence: UsageUiConfidence | undefined): number {
    if (confidence === "exact") return 1;
    if (confidence === "derived") return 0.85;
    if (confidence === "partial") return 0.65;
    if (confidence === "estimated") return 0.55;
    return 0.45;
  }

  function activateSegment(row: UsageConversationChartRow, segment: UsageConversationChartSegment): void {
    activeMessageId = row.messageId;
    activeSegmentId = segment.id;
  }

  function activateRow(row: UsageConversationChartRow): void {
    activeMessageId = row.messageId;
    activeSegmentId = "";
  }

  function isSegmentActive(segment: UsageConversationChartSegment): boolean {
    return segment.id === activeSegmentId;
  }

  async function jumpToBottleneck(index: number): Promise<void> {
    const bottleneck = view?.bottlenecks?.[index];
    if (!bottleneck) return;
    bottleneckIndex = index;
    activeMessageId = bottleneck.messageId;
    activeSegmentId = bottleneck.id;
    await tick();
    scrollFlameToSegment(bottleneck.id);
  }

  function nextBottleneck(): void {
    if (!view?.bottlenecks?.length) return;
    void jumpToBottleneck((bottleneckIndex + 1) % view.bottlenecks.length);
  }

  function prevBottleneck(): void {
    if (!view?.bottlenecks?.length) return;
    void jumpToBottleneck((bottleneckIndex - 1 + view.bottlenecks.length) % view.bottlenecks.length);
  }

  /** Placeholder for the future "send this bottleneck to the eval project" action. */
  function markForEval(bottleneck: UsageBottleneck): void {
    // Intentionally a no-op stub until the eval hand-off is wired.
    void bottleneck;
  }

  function scrollFlameToSegment(id: string): void {
    const target = segmentElements.get(id);
    const container = flameScrollNode;
    if (!target || !container) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset = targetRect.left - containerRect.left;
    const left = container.scrollLeft + offset - container.clientWidth / 2 + targetRect.width / 2;
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ left: Math.max(0, left), behavior: "auto" });
      return;
    }
    container.scrollLeft = Math.max(0, left);
  }

  function rememberMessage(node: HTMLElement, id: string): { destroy(): void } {
    messageElements.set(id, node);
    return { destroy: () => messageElements.delete(id) };
  }

  function rememberSegment(node: HTMLElement, id: string): { update(next: string): void; destroy(): void } {
    let current = id;
    segmentElements.set(current, node);
    return {
      update(next: string): void {
        if (segmentElements.get(current) === node) segmentElements.delete(current);
        current = next;
        segmentElements.set(current, node);
      },
      destroy(): void {
        if (segmentElements.get(current) === node) segmentElements.delete(current);
      }
    };
  }

  function friendlyError(value: string): string {
    return value.includes("<!doctype") ? "Usage API unavailable. Start the app with `tangent usage ui`." : value;
  }

  /** Formats a session timestamp as a compact date for cards and the rail. */
  function formatDate(value: string | undefined): string {
    if (!value) return "Date unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function sessionDate(session: UsageSessionListItem): string {
    return formatDate(session.startedAt || session.lastActivityAt || session.endedAt);
  }

  function formatDurationMs(value: number | undefined): string | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const rounded = Math.max(0, Math.round(value));
    if (rounded < 1000) return `${rounded}ms`;
    const seconds = Math.round(rounded / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }

  function formatTokenCount(value: number | undefined): string | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    if (Math.abs(value) < 1_000) return Intl.NumberFormat("en").format(Math.round(value));
    if (Math.abs(value) < 1_000_000) return `${trimFixed(value / 1_000, 1)}k`;
    return `${trimFixed(value / 1_000_000, 1)}M`;
  }

  function trimFixed(value: number, digits: number): string {
    return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  /** Returns the card flame width as a percentage of the longest session, so card lengths compare
   * by active duration at a glance. `max` is passed in so Svelte tracks the dependency on re-render. */
  function flameWidthPct(flame: UsageSparkline, max: number): number {
    const share = (flame.durationMs / Math.max(1, max)) * 100;
    return Math.max(MIN_FLAME_WIDTH_PCT, Math.min(100, share));
  }

  /** Returns the relative height (0..1) for one sparkline bucket. */
  function sparkHeight(tokenShare: number, durationShare: number): number {
    const value = tokenShare > 0 ? tokenShare : durationShare;
    return Math.max(0.08, Math.min(1, value));
  }

  /** Returns the primary visible text for a tool event. */
  function toolPreview(tool: UsageConversationMessage["toolCalls"][number]): string {
    return tool.commandPreview || tool.preview || tool.name;
  }

  /** Returns a quieter tool label for the event row. */
  function toolKind(tool: UsageConversationMessage["toolCalls"][number]): string {
    return tool.name.replace(/_command(?:_result)?$/i, "").replace(/_/g, " ") || "tool";
  }

  /** Returns whether a tool row has details worth expanding. */
  function hasToolDetails(tool: UsageConversationMessage["toolCalls"][number]): boolean {
    return Boolean(tool.resultDisplayPreview || tool.workdir || tool.target || toolPreview(tool) !== tool.name);
  }

  /** Toggles command details and output for a tool row. */
  function toggleToolExpansion(toolId: string): void {
    expandedToolIds = expandedToolIds.includes(toolId)
      ? expandedToolIds.filter((id) => id !== toolId)
      : [...expandedToolIds, toolId];
  }

  /** Returns display-ready output for expanded tool details. */
  function toolOutput(tool: UsageConversationMessage["toolCalls"][number]): string | undefined {
    return tool.resultDisplayPreview;
  }

  /** Copies a value to the clipboard when available; used for the session id chip. */
  function copyText(value: string | undefined): void {
    if (value && typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(value);
  }

  /** Returns the full readable body for a message, falling back to a placeholder that names the session for raw-transcript lookup. */
  function messageBody(message: UsageConversationMessage): string {
    if (message.text || message.textPreview) return message.text || message.textPreview || "";
    const sessionId = view?.selected.providerSessionId;
    return sessionId ? `No transcript text available. Session ${sessionId}` : "No transcript text available.";
  }

  function isLongMessage(message: UsageConversationMessage): boolean {
    return messageBody(message).length > messagePreviewLimit;
  }

  function visibleMessageBody(message: UsageConversationMessage, expanded: boolean): string {
    const body = messageBody(message);
    if (!isLongMessage(message) || expanded) return body;
    return `${body.slice(0, messagePreviewLimit).trimEnd()}...`;
  }

  function toggleMessageExpansion(messageId: string): void {
    expandedMessageIds = expandedMessageIds.includes(messageId)
      ? expandedMessageIds.filter((id) => id !== messageId)
      : [...expandedMessageIds, messageId];
  }
</script>

{#snippet sparkline(flame: UsageSparkline, variant: string)}
  <span class={`spark spark-${variant}`} aria-hidden="true">
    {#each flame.buckets ?? [] as bucket}
      <span
        class={`spark-bar spark-${bucket.kind}`}
        style={`height:${sparkHeight(bucket.tokenShare, bucket.durationShare) * 100}%`}
      ></span>
    {/each}
    {#if flame.compactions}
      <span class="spark-compactions" title={`${flame.compactions} compactions`}>◆{flame.compactions}</span>
    {/if}
  </span>
{/snippet}

{#if error}
  <main class="usage-loading">
    <section>
      <h1>Usage data unavailable</h1>
      <p>{error}</p>
    </section>
  </main>
{:else if loading}
  <main class="usage-loading" aria-label="Loading Usage UI">
    <span class="usage-spinner"></span>
  </main>
{:else if mode === "browse"}
  <main class="usage-browse" data-mode="browse">
    <header class="browse-header">
      <div>
        <p>Tangent Usage</p>
        <h1>Conversations</h1>
      </div>
      <label class="search">
        <span>Search sessions</span>
        <input bind:value={query} placeholder="Project or session" />
      </label>
    </header>
    <div class="gallery" aria-label="Conversation gallery">
      {#each filteredSessions as session}
        <button type="button" class="session-card" onclick={() => openSession(session.id)}>
          <span class="session-card-date">{sessionDate(session)}</span>
          <span class="session-card-title">{session.title}</span>
          <span class="session-card-meta">
            <span>{session.provider || "unknown"}</span>
            {#if session.model}<span>{session.model}</span>{/if}
            {#if formatDurationMs(session.durationMs)}<span>{formatDurationMs(session.durationMs)}</span>{/if}
            {#if formatTokenCount(session.tokensTotal)}<span>{formatTokenCount(session.tokensTotal)} tokens</span>{/if}
          </span>
          {#if session.flame}
            <span class="session-card-flame" style={`width:${flameWidthPct(session.flame, maxFlameDurationMs)}%`}>{@render sparkline(session.flame, "card")}</span>
          {/if}
        </button>
      {/each}
    </div>
  </main>
{:else}
  <main class="usage-shell" data-mode="read">
    <header class="read-bar">
      <button type="button" class="read-back" onclick={backToBrowse}>← All conversations</button>
      <div class="read-heading">
        <p>Active work over time</p>
        <h1>{view ? view.selected.title : "Loading conversation"}</h1>
        {#if view?.selected.providerSessionId}
          <button
            type="button"
            class="read-id"
            title={`Copy session id${view.selected.transcriptPath ? ` · ${view.selected.transcriptPath}` : ""}`}
            onclick={() => copyText(view?.selected.providerSessionId)}
          >
            {view.selected.providerSessionId} ⧉
          </button>
        {/if}
      </div>
      <div class="read-controls">
        {#if view?.selected.durationLabel}<span class="read-stat">{view.selected.durationLabel}</span>{/if}
        {#if view?.selected.tokenLabel}<span class="read-stat">{view.selected.tokenLabel}</span>{/if}
        <div class="zoom" aria-label="Zoom timeline">
          <button type="button" aria-label="Zoom out" onclick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]}>−</button>
          <span class="zoom-level">{zoom}×</span>
          <button type="button" aria-label="Zoom in" onclick={zoomIn} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}>+</button>
        </div>
      </div>
    </header>

    {#if !view}
      <div class="usage-loading" aria-label="Loading conversation"><span class="usage-spinner"></span></div>
    {:else}
      <section class:loading-pane={conversationLoading} class="flame-band" aria-label="Conversation flame graph">
        <div class="flame-scroll" bind:this={flameScrollNode}>
          <div class="flame-track">
            {#each view.chart.rows as row}
              {@const barWidth = turnWidthPx(row, pxPerMs)}
              {@const barHeight = turnBarHeightPx(row, view.chart.maxTokens)}
              {@const widths = segmentWidths(row, pxPerMs)}
              <div class="turn-column" style={`width:${barWidth}px; --bar-slot:${MAX_BAR_HEIGHT}px`}>
                <button type="button" class:active={row.messageId === activeMessageId} class="turn-prompt" onclick={() => activateRow(row)}>
                  <span class="turn-prompt-label">{row.label}</span>
                  <span class="turn-prompt-meta">
                    {#if row.durationLabel}<span>{row.durationLabel}</span>{/if}
                    {#if row.tokenLabel}<span>{row.tokenLabel}</span>{/if}
                  </span>
                </button>
                <div class="turn-bar-slot">
                  <div class="turn-bar" style={`height:${barHeight}px`}>
                    {#if row.segments?.length}
                      {#each row.segments as segment, index}
                        <button
                          type="button"
                          use:rememberSegment={segment.id}
                          class:active={isSegmentActive(segment)}
                          class:is-bottleneck={bottleneckIds.has(segment.id)}
                          class={`segment segment-${segment.kind}`}
                          style={`width:${widths[index]}px; opacity:${confidenceOpacity(segment.confidence)}`}
                          title={`${segment.detail || segment.label}${segment.durationLabel ? ` · ${segment.durationLabel}` : ""}`}
                          onclick={() => activateSegment(row, segment)}
                        >
                          {#if segment.detail && widths[index] >= LABEL_MIN_PX}
                            <span class="segment-label">{segment.detail}</span>
                          {/if}
                        </button>
                      {/each}
                    {:else}
                      <button
                        type="button"
                        use:rememberSegment={row.id}
                        class:active={row.id === activeSegmentId}
                        class:is-bottleneck={bottleneckIds.has(row.id)}
                        class="segment segment-assistant"
                        style={`width:${barWidth}px; opacity:${confidenceOpacity(row.confidence)}`}
                        title={`${row.label}${row.durationLabel ? ` · ${row.durationLabel}` : ""}`}
                        onclick={() => activateRow(row)}
                      ></button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <div class:loading-pane={conversationLoading} class="read-body">
        <section class="transcript-pane" aria-label="Conversation">
          <div class="message-list" bind:this={messageListNode}>
            {#each detailMessages as message}
              <div use:rememberMessage={message.id} class={`message message-${message.role}`}>
                <div class="message-main">
                  <p>{visibleMessageBody(message, expandedMessageIds.includes(message.id))}</p>
                </div>
                {#if message.thinking}
                  <details class="message-thinking">
                    <summary>Thinking</summary>
                    <pre>{message.thinking}</pre>
                  </details>
                {/if}
                {#if isLongMessage(message)}
                  <button
                    class="message-expand"
                    type="button"
                    aria-expanded={expandedMessageIds.includes(message.id)}
                    onclick={() => toggleMessageExpansion(message.id)}
                  >
                    {expandedMessageIds.includes(message.id) ? "Show less" : `Show full message (${Intl.NumberFormat("en").format(messageBody(message).length)} chars)`}
                  </button>
                {/if}
                {#if message.toolCalls.length}
                  <div class="tool-events" aria-label="Tool calls">
                    {#each message.toolCalls as tool}
                      <div class:expanded={expandedToolIds.includes(tool.id)} class="tool-event">
                        <span class="tool-event-kind">
                          <span class="tool-event-kind-label">{toolKind(tool)}</span>
                          {#if tool.durationLabel}
                            <span class="tool-event-duration">{tool.durationLabel}</span>
                          {/if}
                        </span>
                        <code class="tool-event-command">{toolPreview(tool)}</code>
                        {#if tool.plan}
                          <details class="tool-event-plan" open>
                            <summary>Proposed plan</summary>
                            <pre>{tool.plan}</pre>
                          </details>
                        {/if}
                        {#if hasToolDetails(tool)}
                          <button
                            class="tool-event-toggle"
                            type="button"
                            aria-expanded={expandedToolIds.includes(tool.id)}
                            aria-label={`${expandedToolIds.includes(tool.id) ? "Hide" : "Show"} ${toolPreview(tool)} details`}
                            onclick={() => toggleToolExpansion(tool.id)}
                          >
                            {expandedToolIds.includes(tool.id) ? "Hide" : "Details"}
                          </button>
                        {/if}
                        {#if expandedToolIds.includes(tool.id)}
                          <div class="tool-event-details">
                            <div>
                              <span>Command</span>
                              <code>{toolPreview(tool)}</code>
                            </div>
                            {#if tool.workdir || tool.target}
                              <div>
                                <span>Directory</span>
                                <code>{tool.workdir || tool.target}</code>
                              </div>
                            {/if}
                            {#if toolOutput(tool)}
                              <div>
                                <span>Output</span>
                                <pre>{toolOutput(tool)}</pre>
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>

        <aside class="pane-bottlenecks" aria-label="Bottlenecks">
          <header class="bottlenecks-header">
            <div>
              <p>Where the time went</p>
              <h1>Slowest</h1>
            </div>
            <div class="bottleneck-nav" aria-label="Jump between bottlenecks">
              <button type="button" aria-label="Previous bottleneck" onclick={prevBottleneck} disabled={!view.bottlenecks?.length}>◀</button>
              <button type="button" aria-label="Next bottleneck" onclick={nextBottleneck} disabled={!view.bottlenecks?.length}>▶</button>
            </div>
          </header>
          {#if view.bottlenecks?.length}
            <ol class="bottleneck-list">
              {#each view.bottlenecks as bottleneck, index}
                <li class:active={index === bottleneckIndex} class="bottleneck-row">
                  <button type="button" class="bottleneck-jump" onclick={() => jumpToBottleneck(index)}>
                    <span class="bottleneck-rank">{bottleneck.rank}</span>
                    <span class="bottleneck-body">
                      <span class="bottleneck-label" class:is-command={Boolean(bottleneck.detail)}>{bottleneck.detail || bottleneck.label}</span>
                      <span class="bottleneck-meta">
                        <span class={`bottleneck-kind kind-${bottleneck.kind}`}>{bottleneck.kind}</span>
                        {#if bottleneck.durationLabel}<span class="bottleneck-duration">{bottleneck.durationLabel}</span>{/if}
                      </span>
                    </span>
                  </button>
                  <button type="button" class="bottleneck-mark" aria-label={`Mark ${bottleneck.detail || bottleneck.label} for eval`} title="Mark for eval (coming soon)" onclick={() => markForEval(bottleneck)}>★</button>
                </li>
              {/each}
            </ol>
          {:else}
            <p class="bottlenecks-empty">No step timing available for this session.</p>
          {/if}
        </aside>
      </div>
    {/if}
  </main>
{/if}
