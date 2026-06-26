<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { createPipelineApiClient, type PipelineUiClient, type PipelineFeatureSummary, type PipelineScope } from "./client.js";
  import { renderScopeMarkdown } from "./markdown.js";

  export let client: PipelineUiClient = createPipelineApiClient();

  let features: PipelineFeatureSummary[] = [];
  let selectedSlug = "";
  let scope: PipelineScope | undefined;
  let loading = true;
  let scopeLoading = false;
  let listError = "";
  let scopeError = "";
  let detailEl: HTMLElement | undefined;

  onMount(() => {
    void loadFeatures();
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisibility);
  });

  onDestroy(() => {
    window.removeEventListener("focus", refetch);
    document.removeEventListener("visibilitychange", onVisibility);
  });

  /** Refetches the feature list when the Designs tab or window regains focus. */
  function onVisibility(): void {
    if (document.visibilityState === "visible") refetch();
  }

  /** Reloads the list without showing the initial skeleton, preserving the current selection. */
  function refetch(): void {
    void loadFeatures({ keepSelection: true });
  }

  /** Loads the feature list and auto-selects the newest feature if nothing valid is selected. */
  async function loadFeatures(options: { keepSelection?: boolean } = {}): Promise<void> {
    if (!options.keepSelection) loading = true;
    try {
      features = await client.loadFeatures();
      listError = "";
      const stillThere = features.some((feature) => feature.slug === selectedSlug);
      if (!stillThere) {
        const next = features[0]?.slug ?? "";
        if (next) await selectFeature(next);
        else { selectedSlug = ""; scope = undefined; }
      }
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  /** Selects a feature, scrolls the detail pane to the top, and loads its scope. */
  async function selectFeature(slug: string): Promise<void> {
    selectedSlug = slug;
    scopeError = "";
    scopeLoading = true;
    await tick();
    if (detailEl) detailEl.scrollTop = 0;
    try {
      scope = await client.loadScope(slug);
    } catch (error) {
      scope = undefined;
      scopeError = error instanceof Error ? error.message : String(error);
    } finally {
      scopeLoading = false;
    }
  }

  /** Moves the selection up or down the list with the arrow keys. */
  function onListKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = features.findIndex((feature) => feature.slug === selectedSlug);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = features[Math.min(Math.max(index + delta, 0), features.length - 1)];
    if (next && next.slug !== selectedSlug) void selectFeature(next.slug);
  }
</script>

<div class="app-shell">
  <nav class="view-tabs" aria-label="Views">
    <span class="chrome-slot" data-tangent-chrome-slot></span>
  </nav>

  {#if !loading && !listError && features.length === 0}
    <main class="empty-state" aria-label="No designs yet">
      <strong>No designs yet</strong>
      <p>As the scope agent works through your feedback, its real-problem framing and proposed designs land here.</p>
    </main>
  {:else}
    <div class="designs-workspace">
      <section class="list-pane" aria-label="Features">
        {#if listError}
          <div class="list-error" role="alert">
            <span>{listError}</span>
            <button type="button" on:click={() => loadFeatures()}>Retry</button>
          </div>
        {/if}
        {#if loading}
          <div class="list-skeleton" aria-hidden="true">
            {#each Array(5) as _, index (index)}
              <span class="skeleton-row"></span>
            {/each}
          </div>
        {:else}
          <ul class="feature-list" role="listbox" aria-label="Feature designs" tabindex="0" on:keydown={onListKeydown}>
            {#each features as feature (feature.slug)}
              <li role="option" aria-selected={feature.slug === selectedSlug}>
                <button type="button" class="feature-row" class:selected={feature.slug === selectedSlug} on:click={() => selectFeature(feature.slug)}>
                  <span class="feature-title">{feature.title}</span>
                  {#if feature.status}<span class="status-badge">{feature.status}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="detail-pane" bind:this={detailEl} aria-label="Design detail">
        {#if loading || scopeLoading}
          <div class="detail-skeleton" aria-hidden="true">
            <span class="skeleton-eyebrow"></span>
            <span class="skeleton-block"></span>
            <span class="skeleton-eyebrow"></span>
            <span class="skeleton-block short"></span>
          </div>
        {:else if scopeError}
          <div class="detail-error" role="alert">{scopeError}</div>
        {:else if scope}
          <header class="detail-header">
            <h1>{scope.title}</h1>
            {#if scope.status}<span class="status-badge">{scope.status}</span>{/if}
          </header>
          <section class="real-problem" aria-label="Real problem">
            <p class="eyebrow">Real problem</p>
            {#if scope.realProblem}
              <div class="prose lead">{@html renderScopeMarkdown(scope.realProblem)}</div>
            {:else}
              <p class="missing">No real-problem section in this design yet.</p>
            {/if}
          </section>
          <section class="proposed-design" aria-label="Proposed design">
            <p class="eyebrow muted">Proposed design</p>
            {#if scope.proposedDesign}
              <div class="prose">{@html renderScopeMarkdown(scope.proposedDesign)}</div>
            {:else}
              <p class="missing">No proposed-design section in this design yet.</p>
            {/if}
          </section>
        {/if}
      </section>
    </div>
  {/if}
</div>
