<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    createUsageApiClient,
    type UsageConversationChartRow,
    type UsageConversationMessage,
    type UsageConversationProjectGroup,
    type UsageConversationSessionItem,
    type UsageConversationTokenMode,
    type UsageConversationView,
    type UsageSessionListItem,
    type UsageUiClient
  } from "@tangent/usage-ui-data";

  export let client: UsageUiClient = createUsageApiClient();

  let sessions: UsageSessionListItem[] = [];
  let view: UsageConversationView | undefined;
  let selectedId: string | undefined;
  let query = "";
  let loading = true;
  let conversationLoading = false;
  let error = "";
  let activeMessageId = "";
  let expandedProjectIds: string[] = [];
  let expandedMessageIds: string[] = [];
  let expandedToolIds: string[] = [];
  let chartTokenMode: "cumulative" | "added" = "cumulative";
  const messagePreviewLimit = 360;
  const messageElements = new Map<string, HTMLElement>();
  const rowElements = new Map<string, HTMLElement>();

  type DisplayChartRow = UsageConversationChartRow & {
    displayTokenLabel?: string;
    displayWidthShare: number;
  };

  onMount(() => {
    void loadSessions();
  });

  $: selectedId && void loadConversation(selectedId, query);

  async function loadSessions(): Promise<void> {
    loading = true;
    try {
      const list = await client.listSessions({ limit: 80 });
      sessions = list.sessions;
      selectedId = selectedId || bestSessionCandidate(sessions)?.id;
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
      activeMessageId = view.messages[0]?.id || "";
      expandedMessageIds = [];
      expandedToolIds = [];
      error = "";
      await tick();
      if (activeMessageId) scrollToPair(activeMessageId, "message");
    } catch (caught) {
      error = friendlyError((caught as Error).message);
    } finally {
      if (loadKey === key) conversationLoading = false;
    }
  }

  function selectSession(id: string): void {
    selectedId = id;
  }

  function activate(messageId: string, source: "message" | "chart"): void {
    activeMessageId = messageId;
    scrollToPair(messageId, source);
  }

  function scrollToPair(messageId: string, source: "message" | "chart"): void {
    const target = source === "message" ? rowElements.get(messageId) : messageElements.get(messageId);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: source === "chart" ? "start" : "center" });
    }
  }

  async function activateChartRow(row: UsageConversationChartRow): Promise<void> {
    const messageId = chartRowAnchorMessageId(row);
    activeMessageId = messageId;
    await tick();
    scrollToPair(messageId, "chart");
  }

  function chartRowAnchorMessageId(row: UsageConversationChartRow): string {
    const ids = rowIds(row.messageIds || row.messageId);
    const rowUserMessage = ids.find((id) => view?.messages.find((message) => message.id === id)?.role === "user");
    if (rowUserMessage) return rowUserMessage;

    const messageIndex = view?.messages.findIndex((message) => message.id === row.messageId) ?? -1;
    if (!view || messageIndex < 0) return row.messageId;
    for (let index = messageIndex; index >= 0; index -= 1) {
      const message = view.messages[index];
      if (message?.role === "user") return message.id;
    }
    return row.messageId;
  }

  function rememberMessage(node: HTMLElement, id: string): { destroy(): void } {
    messageElements.set(id, node);
    return { destroy: () => messageElements.delete(id) };
  }

  function rememberRow(node: HTMLElement, value: string | string[]): { update(next: string | string[]): void; destroy(): void } {
    let ids = rowIds(value);
    for (const id of ids) rowElements.set(id, node);
    return {
      update(next: string | string[]): void {
        for (const id of ids) {
          if (rowElements.get(id) === node) rowElements.delete(id);
        }
        ids = rowIds(next);
        for (const id of ids) rowElements.set(id, node);
      },
      destroy(): void {
        for (const id of ids) {
          if (rowElements.get(id) === node) rowElements.delete(id);
        }
      }
    };
  }

  function rowIds(value: string | string[] | undefined): string[] {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  function isRowActive(row: UsageConversationChartRow): boolean {
    return rowIds(row.messageIds || row.messageId).includes(activeMessageId);
  }

  function bestSessionCandidate(values: UsageSessionListItem[]): UsageSessionListItem | undefined {
    return values.find((session) => session.status === "active") || values[0] || [...values].sort((left, right) => (right.tokensTotal || 0) - (left.tokensTotal || 0))[0];
  }

  function friendlyError(value: string): string {
    return value.includes("<!doctype") ? "Usage API unavailable. Start the app with `tangent usage ui`." : value;
  }

  function projectCount(projects: UsageConversationProjectGroup[] | undefined): number {
    return projects?.reduce((sum, project) => sum + project.sessions.length, 0) || 0;
  }

  function toggleProject(project: UsageConversationProjectGroup): void {
    expandedProjectIds = expandedProjectIds.includes(project.id)
      ? expandedProjectIds.filter((id) => id !== project.id)
      : [...expandedProjectIds, project.id];
  }

  function sessionMeta(session: UsageConversationSessionItem): string[] {
    return [
      session.lastActivityLabel ? `Last ${session.lastActivityLabel}` : undefined,
      session.messageCountLabel,
      session.tokenLabel ? `${session.tokenLabel} tokens` : undefined
    ].filter((value): value is string => Boolean(value));
  }

  function sessionIdentity(session: UsageConversationSessionItem): string[] {
    return [session.provider, session.model].filter((value): value is string => Boolean(value));
  }

  function sessionLabel(session: UsageConversationSessionItem): string {
    return [session.title, ...sessionIdentity(session), ...sessionMeta(session)].join(" · ");
  }

  function chartMode(row: UsageConversationChartRow, modeName: "cumulative" | "added"): UsageConversationTokenMode {
    return row.tokenModes?.[modeName] || { tokens: row.tokens, tokenLabel: row.tokenLabel, widthShare: row.widthShare };
  }

  function chartRowsForMode(rows: UsageConversationChartRow[], modeName: "cumulative" | "added"): DisplayChartRow[] {
    const normalized = normalizeChartTokenModes(rows);
    return normalized.map((row) => {
      const mode = chartMode(row, modeName);
      return {
        ...row,
        displayTokenLabel: mode.tokenLabel,
        displayWidthShare: mode.widthShare
      };
    });
  }

  function normalizeChartTokenModes(rows: UsageConversationChartRow[]): UsageConversationChartRow[] {
    if (rows.every((row) => row.tokenModes)) return rows;
    const cumulativeTokens = rows.map((row) => row.tokenModes?.cumulative.tokens ?? contextTokensFromLabel(row.tokenLabel) ?? row.tokens);
    const addedTokens = cumulativeTokens.map((tokens, index) => {
      if (tokens === undefined) return undefined;
      const previous = previousDefinedNumber(cumulativeTokens, index) ?? 0;
      return tokens >= previous ? tokens - previous : tokens;
    });
    const maxCumulative = Math.max(1, ...cumulativeTokens.map((tokens) => tokens || 0));
    const maxAdded = Math.max(1, ...addedTokens.map((tokens) => tokens || 0));
    return rows.map((row, index) => ({
      ...row,
      tokens: cumulativeTokens[index],
      tokenLabel: formatContextTokenLabel(cumulativeTokens[index]) || row.tokenLabel,
      widthShare: widthShare(cumulativeTokens[index], maxCumulative),
      tokenModes: {
        cumulative: row.tokenModes?.cumulative || {
          tokens: cumulativeTokens[index],
          tokenLabel: formatContextTokenLabel(cumulativeTokens[index]) || row.tokenLabel,
          widthShare: widthShare(cumulativeTokens[index], maxCumulative)
        },
        added: row.tokenModes?.added || {
          tokens: addedTokens[index],
          tokenLabel: formatAddedTokenLabel(addedTokens[index]),
          widthShare: widthShare(addedTokens[index], maxAdded)
        }
      }
    }));
  }

  function chartLabel(row: DisplayChartRow): string {
    return `${row.label}: ${row.displayTokenLabel || "tokens unknown"}${row.durationLabel ? `, ${row.durationLabel}` : ""}`;
  }

  function previousDefinedNumber(values: Array<number | undefined>, beforeIndex: number): number | undefined {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (value !== undefined) return value;
    }
    return undefined;
  }

  function contextTokensFromLabel(value: string | undefined): number | undefined {
    const match = /([0-9]+(?:\.[0-9]+)?)\s*([kKmM]?)\s*ctx\b/.exec(value || "");
    if (!match) return undefined;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return undefined;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
    return Math.round(amount * multiplier);
  }

  function formatContextTokenLabel(value: number | undefined): string | undefined {
    const formatted = formatTokenCount(value);
    return formatted ? `${formatted} ctx` : undefined;
  }

  function formatAddedTokenLabel(value: number | undefined): string | undefined {
    const formatted = formatTokenCount(value);
    return formatted ? `${formatted} added` : undefined;
  }

  function formatTokenCount(value: number | undefined): string | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    if (Math.abs(value) < 1_000) return Intl.NumberFormat("en").format(Math.round(value));
    if (Math.abs(value) < 1_000_000) return `${trimFixed(value / 1_000, 1)}k`;
    return `${trimFixed(value / 1_000_000, 1)}M`;
  }

  function widthShare(value: number | undefined, maxValue: number): number {
    return value === undefined ? 0.02 : Math.max(0.02, value / maxValue);
  }

  function trimFixed(value: number, digits: number): string {
    return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  /** Returns the duration visible with the tool kind. */
  function toolDuration(tool: UsageConversationMessage["toolCalls"][number]): string | undefined {
    return tool.durationLabel;
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

  /** Returns the full readable body for a message. */
  function messageBody(message: UsageConversationMessage): string {
    return message.text || message.textPreview || "No transcript text available.";
  }

  /** Returns whether a message body should render collapsed by default. */
  function isLongMessage(message: UsageConversationMessage): boolean {
    return messageBody(message).length > messagePreviewLimit;
  }

  /** Returns whether a message body is currently expanded. */
  function isMessageExpanded(messageId: string): boolean {
    return expandedMessageIds.includes(messageId);
  }

  /** Returns the body text currently visible for a message. */
  function visibleMessageBody(message: UsageConversationMessage, expanded: boolean): string {
    const body = messageBody(message);
    if (!isLongMessage(message) || expanded) return body;
    return `${body.slice(0, messagePreviewLimit).trimEnd()}...`;
  }

  /** Toggles the full body display for a long message. */
  function toggleMessageExpansion(messageId: string): void {
    expandedMessageIds = isMessageExpanded(messageId)
      ? expandedMessageIds.filter((id) => id !== messageId)
      : [...expandedMessageIds, messageId];
  }
</script>

{#if error}
  <main class="usage-loading">
    <section>
      <h1>Usage data unavailable</h1>
      <p>{error}</p>
    </section>
  </main>
{:else if loading || !view}
  <main class="usage-loading" aria-label="Loading Usage UI">
    <span class="usage-spinner"></span>
  </main>
{:else}
  <main class="usage-shell">
    <aside class="pane pane-finder" aria-label="Conversation picker">
      <div class="finder-content">
        <div class="finder-body">
          <label class="search">
            <span>Search sessions</span>
            <input bind:value={query} placeholder="Project or session" />
          </label>
          <div class="project-count">{projectCount(view.projects)} sessions</div>
          <div class="project-list">
            {#each view.projects as project}
              <section class="project-group">
                <button
                  type="button"
                  class:active={project.sessions.some((session) => session.id === selectedId)}
                  class="project-row"
                  aria-expanded={expandedProjectIds.includes(project.id)}
                  onclick={() => toggleProject(project)}
                >
                  <span>
                    <strong>{project.label}</strong>
                    <small>{project.sessions.length} sessions</small>
                  </span>
                  <span class="project-chevron" aria-hidden="true">v</span>
                </button>
                {#if expandedProjectIds.includes(project.id)}
                  <div class="session-stack">
                    {#each project.sessions as session}
                      <button
                        type="button"
                        class:active={session.id === selectedId}
                        class="session-row"
                        aria-label={sessionLabel(session)}
                        onclick={() => selectSession(session.id)}
                      >
                        <span class="session-row-identity">
                          {#each sessionIdentity(session) as item}
                            <span>{item}</span>
                          {/each}
                        </span>
                        <span class="session-row-meta">
                          {#each sessionMeta(session) as item}
                            <span>{item}</span>
                          {/each}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </section>
            {/each}
          </div>
        </div>
      </div>
    </aside>

    <section class:loading-pane={conversationLoading} class="pane pane-conversation" aria-label="Conversation">
      <div class="message-list">
        {#each view.messages as message}
          <div
            use:rememberMessage={message.id}
            class:active={message.id === activeMessageId}
            class={`message message-${message.role}`}
          >
            <button class="message-main" type="button" onclick={() => activate(message.id, "message")}>
              <p>{visibleMessageBody(message, expandedMessageIds.includes(message.id))}</p>
            </button>
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
                      {#if toolDuration(tool)}
                        <span class="tool-event-duration">{toolDuration(tool)}</span>
                      {/if}
                    </span>
                    <code class="tool-event-command">{toolPreview(tool)}</code>
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

    <aside class="pane pane-chart" aria-label="Tokens and duration chart">
      <div class="chart-inner">
        <header>
          <div>
            <p>Tokens × duration</p>
            <h1>Work Turns</h1>
          </div>
          <div class="chart-mode-toggle" aria-label="Token chart mode">
            <button
              type="button"
              class:active={chartTokenMode === "cumulative"}
              aria-pressed={chartTokenMode === "cumulative"}
              onclick={() => chartTokenMode = "cumulative"}
            >
              Cumulative
            </button>
            <button
              type="button"
              class:active={chartTokenMode === "added"}
              aria-pressed={chartTokenMode === "added"}
              onclick={() => chartTokenMode = "added"}
            >
              Added
            </button>
          </div>
        </header>
        <div class="chart-scroll">
          <div class="axis-labels">
            <span>Tokens</span>
            <span>Duration</span>
          </div>
          <div class="chart-rows">
            {#each chartRowsForMode(view.chart.rows, chartTokenMode) as row}
              <button
                type="button"
                use:rememberRow={row.messageIds || row.messageId}
                class:active={isRowActive(row)}
                class:anchor={row.anchor}
                class="chart-row"
                style={`--row-width:${row.displayWidthShare}; --row-height:${row.heightShare};`}
                aria-label={chartLabel(row)}
                onclick={() => activateChartRow(row)}
              >
                <span class="duration-ruler" aria-hidden="true">
                  <span class="duration-ruler-line"></span>
                  <span class="duration-ruler-label">{row.durationLabel || "unknown"}</span>
                </span>
                <span class="bar" aria-label={chartLabel(row)}>
                  {#if row.segments.length}
                    {#each row.segments as segment}
                      <span class={`segment segment-${segment.kind}`} style={`--segment-height:${segment.heightShare};`} title={`${segment.label}${segment.durationLabel ? ` · ${segment.durationLabel}` : ""}`}>
                        <span>{segment.label}</span>
                      </span>
                    {/each}
                  {/if}
                </span>
                <span class="row-metrics">{row.displayTokenLabel || "tokens unknown"}{row.durationLabel ? ` · ${row.durationLabel}` : ""}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </aside>
  </main>
{/if}
