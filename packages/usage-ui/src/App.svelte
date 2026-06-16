<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    createUsageApiClient,
    type UsageConversationChartRow,
    type UsageConversationMessage,
    type UsageConversationProjectGroup,
    type UsageConversationSessionItem,
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
  const messageElements = new Map<string, HTMLElement>();
  const rowElements = new Map<string, HTMLElement>();

  onMount(() => {
    void loadSessions();
  });

  $: selectedId && void loadConversation(selectedId, query);
  $: if (view) {
    const nextExpandedProjectIds = expandedIdsWithSelected(view.projects, selectedId, expandedProjectIds);
    if (nextExpandedProjectIds !== expandedProjectIds) expandedProjectIds = nextExpandedProjectIds;
  }

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
      target.scrollIntoView({ block: "center" });
    }
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

  function isProjectExpanded(project: UsageConversationProjectGroup): boolean {
    return expandedProjectIds.includes(project.id);
  }

  function expandedIdsWithSelected(projects: UsageConversationProjectGroup[], id: string | undefined, expanded: string[]): string[] {
    const selectedProject = projects.find((project) => project.sessions.some((session) => session.id === id));
    if (!selectedProject || expanded.includes(selectedProject.id)) return expanded;
    return [...expanded, selectedProject.id];
  }

  function sessionMeta(session: UsageConversationSessionItem): string[] {
    return [
      session.lastActivityLabel ? `Last ${session.lastActivityLabel}` : undefined,
      session.durationLabel,
      session.tokenLabel ? `${session.tokenLabel} tokens` : undefined
    ].filter((value): value is string => Boolean(value));
  }

  function sessionTotals(session: UsageConversationSessionItem): string[] {
    return [session.messageCountLabel, session.toolCallLabel, session.status].filter((value): value is string => Boolean(value));
  }

  function chartLabel(row: UsageConversationChartRow): string {
    return `${row.label}: ${row.tokenLabel || "tokens unknown"}${row.durationLabel ? `, ${row.durationLabel}` : ""}`;
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
                  aria-expanded={isProjectExpanded(project)}
                  on:click={() => toggleProject(project)}
                >
                  <span>
                    <strong>{project.label}</strong>
                    <small>{project.sessions.length} sessions</small>
                  </span>
                  <span class="project-chevron" aria-hidden="true">v</span>
                </button>
                {#if isProjectExpanded(project)}
                  <div class="session-stack">
                    {#each project.sessions as session}
                      <button
                        type="button"
                        class:active={session.id === selectedId}
                        class="session-row"
                        on:click={() => selectSession(session.id)}
                      >
                        <span class="session-row-main">
                          <strong>{session.title}</strong>
                          <span>{session.provider}</span>
                        </span>
                        <span class="session-row-meta">
                          {#each sessionMeta(session) as item}
                            <span>{item}</span>
                          {/each}
                        </span>
                        <span class="session-row-totals">
                          {#each sessionTotals(session) as item}
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
          <button
            type="button"
            use:rememberMessage={message.id}
            class:active={message.id === activeMessageId}
            class={`message message-${message.role}`}
            on:click={() => activate(message.id, "message")}
          >
            <header>
              <strong>{message.title || message.role}</strong>
              <span>{message.tokenLabel || ""}{message.durationLabel ? ` · ${message.durationLabel}` : ""}</span>
            </header>
            <p>{message.text || message.textPreview || "No transcript text available."}</p>
            {#if message.toolCalls.length}
              <div class="tool-list">
                {#each message.toolCalls as tool}
                  <span>{tool.name}{tool.durationLabel ? ` · ${tool.durationLabel}` : ""}</span>
                {/each}
              </div>
            {/if}
          </button>
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
        </header>
        <div class="chart-scroll">
          <div class="axis-labels">
            <span>Tokens</span>
            <span>Duration</span>
          </div>
          <div class="chart-rows">
            {#each view.chart.rows as row}
              <button
                type="button"
                use:rememberRow={row.messageIds || row.messageId}
                class:active={isRowActive(row)}
                class:anchor={row.anchor}
                class="chart-row"
                style={`--row-width:${row.widthShare}; --row-height:${row.heightShare};`}
                aria-label={chartLabel(row)}
                on:click={() => activate(row.messageId, "chart")}
              >
                <span class="bar" aria-label={chartLabel(row)}>
                  {#if row.segments.length}
                    {#each row.segments as segment}
                      <span class={`segment segment-${segment.kind}`} style={`--segment-height:${segment.heightShare};`} title={`${segment.label}${segment.durationLabel ? ` · ${segment.durationLabel}` : ""}`}>
                        <span>{segment.label}</span>
                      </span>
                    {/each}
                  {/if}
                </span>
                <span class="row-metrics">{row.tokenLabel || "tokens unknown"}{row.durationLabel ? ` · ${row.durationLabel}` : ""}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </aside>
  </main>
{/if}
