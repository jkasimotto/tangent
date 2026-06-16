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
  let mode: "finder" | "chart" = "finder";
  let loading = true;
  let conversationLoading = false;
  let error = "";
  let activeMessageId = "";
  let selectedProjectId = "";
  let drilldownProject: UsageConversationProjectGroup | undefined;
  const messageElements = new Map<string, HTMLElement>();
  const rowElements = new Map<string, HTMLElement>();

  onMount(() => {
    void loadSessions();
  });

  $: selectedId && void loadConversation(selectedId, query);
  $: drilldownProject = view && selectedProjectId ? selectedProject(view.projects) : undefined;

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
    mode = "finder";
  }

  function activate(messageId: string, source: "message" | "chart"): void {
    activeMessageId = messageId;
    scrollToPair(messageId, source);
  }

  function scrollToPair(messageId: string, source: "message" | "chart"): void {
    const target = source === "message" ? rowElements.get(messageId) : messageElements.get(messageId);
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function rememberMessage(node: HTMLElement, id: string): { destroy(): void } {
    messageElements.set(id, node);
    return { destroy: () => messageElements.delete(id) };
  }

  function rememberRow(node: HTMLElement, id: string): { destroy(): void } {
    rowElements.set(id, node);
    return { destroy: () => rowElements.delete(id) };
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

  function selectedProject(projects: UsageConversationProjectGroup[]): UsageConversationProjectGroup | undefined {
    return projects.find((project) => project.id === selectedProjectId);
  }

  function selectProject(project: UsageConversationProjectGroup): void {
    selectedProjectId = project.id;
  }

  function backToProjects(): void {
    selectedProjectId = "";
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
  <main class:chart-mode={mode === "chart"} class="usage-shell">
    <aside class="pane pane-finder" aria-label="Conversation picker">
      <div class="finder-content">
        <header>
          <div>
            <p>Usage</p>
            <h1>{view.selected.title}</h1>
          </div>
          <button class="icon-button" type="button" aria-label="Show chart" on:click={() => mode = "chart"}>→</button>
        </header>
        <div class="finder-body">
          <label class="search">
            <span>Search sessions</span>
            <input bind:value={query} placeholder="Project or session" />
          </label>
          <div class="project-count">{projectCount(view.projects)} sessions</div>
          {#if drilldownProject}
            <section class="project-drilldown">
              <button class="back-row" type="button" on:click={backToProjects}>← Projects</button>
              <h2>{drilldownProject.label}</h2>
              <div class="session-stack">
                {#each drilldownProject.sessions as session}
                  <button
                    type="button"
                    class:active={session.id === selectedId}
                    class="session-row"
                    on:click={() => selectSession(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <span>{session.provider}{session.durationLabel ? ` · ${session.durationLabel}` : ""}{session.tokenLabel ? ` · ${session.tokenLabel}` : ""}</span>
                  </button>
                {/each}
              </div>
            </section>
          {:else}
            <div class="project-list">
              {#each view.projects as project}
                <button
                  type="button"
                  class:active={project.sessions.some((session) => session.id === selectedId)}
                  class="project-row"
                  on:click={() => selectProject(project)}
                >
                  <span>
                    <strong>{project.label}</strong>
                    <small>{project.sessions.length} sessions</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <button class="finder-rail" type="button" aria-label="Show sessions" disabled={mode !== "chart"} on:click={() => mode = "finder"}>
        <span>Sessions</span>
      </button>
    </aside>

    <section class:loading-pane={conversationLoading} class="pane pane-conversation" aria-label="Conversation">
      <header class="conversation-header">
        <div>
          <p>{view.selected.provider}{view.selected.model ? ` · ${view.selected.model}` : ""}</p>
          <h1>{view.selected.title}</h1>
        </div>
        <button class="chart-toggle" type="button" on:click={() => mode = mode === "chart" ? "finder" : "chart"}>
          {mode === "chart" ? "Sessions" : "Chart"}
        </button>
      </header>

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

    <button class="chart-rail" type="button" aria-label="Show metrics chart" disabled={mode === "chart"} on:click={() => mode = "chart"}>
      <span>Chart</span>
    </button>

    <section class="pane pane-chart" aria-label="Tokens and duration chart">
      <div class="chart-inner">
        <header>
          <div>
            <p>Tokens × duration</p>
            <h1>Assistant Messages</h1>
          </div>
          <button class="icon-button" type="button" aria-label="Hide chart" on:click={() => mode = "finder"}>→</button>
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
                use:rememberRow={row.messageId}
                class:active={row.messageId === activeMessageId}
                class:anchor={row.anchor}
                class="chart-row"
                style={`--row-width:${row.widthShare}; --row-height:${row.heightShare};`}
                on:click={() => activate(row.messageId, "chart")}
              >
                <span class="row-label">{row.label}</span>
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
          {#if view.caveats.length}
            <footer class="caveats">
              {#each view.caveats as caveat}
                <p>{caveat}</p>
              {/each}
            </footer>
          {/if}
        </div>
      </div>
    </section>
  </main>
{/if}
