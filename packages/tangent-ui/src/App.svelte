<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import ShellLayout from "./ShellLayout.svelte";
  import { formatUpdatedLabel, formatBuiltAtAbsolute } from "./relative-time.js";

  type UiApp = {
    id: string;
    label: string;
    modulePath: string;
    stylePaths?: string[];
    routePath?: string;
  };

  type EmbeddedAppModule = {
    mountApp?: (target: HTMLElement, context: { appId: string }) => void | (() => void);
  };

  let apps: UiApp[] = [];
  let activeId = "";
  let loading = true;
  let error = "";
  let switcherOpen = false;
  let mountNode: HTMLElement;
  let switcherNode: HTMLElement;
  let switcherHome: HTMLElement | undefined;
  let chromeHidden = false;
  let dispose: void | (() => void);
  let mountedKey = "";

  let feedbackOpen = false;
  let feedbackText = "";
  let feedbackSaved = false;
  let feedbackError = "";
  let feedbackCloseTimer: ReturnType<typeof setTimeout> | undefined;

  // Build-freshness loop: the installed PWA is a long-lived window, so it polls the server's build
  // identity and silently reloads into a new build. `builtAt`/`updatedLabel` drive the passive label.
  const VERSION_POLL_MS = 60_000;
  const UPDATED_MARKER = "tangent:just-updated";
  let buildId: string | undefined;
  let builtAt = "";
  let updatedLabel = "";
  let reloadPending = false;
  let justUpdated = false;
  let versionTimer: ReturnType<typeof setInterval> | undefined;
  let labelTimer: ReturnType<typeof setInterval> | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  // The asset-manifest hash is long; a 7-char prefix is the git-short-sha width the eye
  // pattern-matches and is enough to disambiguate builds across reloads. Full hash on hover.
  $: buildShort = buildId ? buildId.slice(0, 7) : "";
  $: buildLabel = buildId ? `build ${buildShort}` : "";

  onMount(() => {
    window.addEventListener("popstate", applyLocation);
    window.addEventListener("keydown", onGlobalKeydown);
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    window.addEventListener("focus", onVisibleOrFocus);
    document.addEventListener("focusout", onFocusOut, true);
    void loadApps();
    void pollVersion();
    versionTimer = setInterval(() => void pollVersion(), VERSION_POLL_MS);
    labelTimer = setInterval(tickFreshness, VERSION_POLL_MS);
    showPostReloadHighlight();
  });

  onDestroy(() => {
    window.removeEventListener("popstate", applyLocation);
    window.removeEventListener("keydown", onGlobalKeydown);
    document.removeEventListener("visibilitychange", onVisibleOrFocus);
    window.removeEventListener("focus", onVisibleOrFocus);
    document.removeEventListener("focusout", onFocusOut, true);
    if (versionTimer) clearInterval(versionTimer);
    if (labelTimer) clearInterval(labelTimer);
    if (highlightTimer) clearTimeout(highlightTimer);
    disposeApp();
  });

  /** Polls the server build identity; captures it on the first read, reloads on a later change.
      Fails quiet (no UI) on a missing route, non-OK response, or fetch error so an invisible
      mechanism never surfaces noise; the last-known label is kept. */
  async function pollVersion(): Promise<void> {
    try {
      const response = await fetch("/api/version");
      if (!response.ok) return;
      const payload = await response.json() as { buildId?: string; builtAt?: string };
      if (typeof payload.buildId !== "string" || typeof payload.builtAt !== "string") return;
      builtAt = payload.builtAt;
      updatedLabel = formatUpdatedLabel(builtAt);
      if (buildId === undefined) { buildId = payload.buildId; return; }
      if (payload.buildId !== buildId) maybeReload();
    } catch {
      // Swallow: poll failures are noise about an invisible mechanism.
    }
  }

  /** Reloads into the new build, or defers when the user is mid-input so no in-progress text is lost. */
  function maybeReload(): void {
    if (canReloadNow()) applyUpdate();
    else reloadPending = true;
  }

  /** False while the user is typing (shell composer or any focused editable element in the mounted app),
      so an auto-reload never destroys half-typed text. */
  function canReloadNow(): boolean {
    if (feedbackOpen || feedbackText.trim()) return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return true;
    return !(active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
  }

  /** Marks the reload so the freshly mounted shell highlights the label, then reloads into the new build. */
  function applyUpdate(): void {
    reloadPending = false;
    try { sessionStorage.setItem(UPDATED_MARKER, "1"); } catch { /* private mode: skip the highlight */ }
    location.reload();
  }

  /** Re-render the relative label and retry a deferred reload once the user is idle. */
  function tickFreshness(): void {
    if (builtAt) updatedLabel = formatUpdatedLabel(builtAt);
    if (reloadPending && canReloadNow()) applyUpdate();
  }

  /** On focus/visibility regain, re-poll and retry any reload that was deferred while hidden. */
  function onVisibleOrFocus(): void {
    void pollVersion();
    if (reloadPending && canReloadNow()) applyUpdate();
  }

  /** When focus leaves an input, retry a deferred reload on the next tick (activeElement has settled). */
  function onFocusOut(): void {
    if (!reloadPending) return;
    void tick().then(() => { if (reloadPending && canReloadNow()) applyUpdate(); });
  }

  /** One-shot, reduced-motion-safe highlight of the label right after an auto-reload explains the blink. */
  function showPostReloadHighlight(): void {
    let marked = false;
    try {
      marked = sessionStorage.getItem(UPDATED_MARKER) === "1";
      if (marked) sessionStorage.removeItem(UPDATED_MARKER);
    } catch { /* private mode: no marker, no highlight */ }
    if (!marked) return;
    justUpdated = true;
    highlightTimer = setTimeout(() => { justUpdated = false; }, 1100);
  }

  /** Cmd/Ctrl+/ opens the feedback composer from any app; Escape closes it. */
  function onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault();
      toggleFeedback();
    } else if (event.key === "Escape" && feedbackOpen) {
      event.preventDefault();
      closeFeedback();
    }
  }

  function toggleFeedback(): void {
    if (feedbackOpen) closeFeedback();
    else { feedbackOpen = true; feedbackSaved = false; feedbackError = ""; }
  }

  function closeFeedback(): void {
    if (feedbackCloseTimer) { clearTimeout(feedbackCloseTimer); feedbackCloseTimer = undefined; }
    feedbackOpen = false;
    feedbackSaved = false;
    feedbackError = "";
    feedbackText = "";
  }

  /** Focuses the composer the moment it mounts so the user can type immediately. */
  function autofocus(node: HTMLElement): void {
    node.focus();
  }

  function onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitFeedback();
    }
  }

  /** Appends the note (with the active app + route as context) to ~/.tangent/feedback.jsonl, which a coding agent reads directly. */
  async function submitFeedback(): Promise<void> {
    const text = feedbackText.trim();
    if (!text) return;
    feedbackError = "";
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, app: activeId, route: window.location.pathname })
      });
      if (!response.ok) throw new Error(await response.text());
      feedbackText = "";
      feedbackSaved = true;
      // Flash the confirmation, then dismiss on its own so ⌘↵ is the whole interaction — no mouse.
      feedbackCloseTimer = setTimeout(closeFeedback, 1100);
    } catch (caught) {
      feedbackError = (caught as Error).message;
    }
  }

  $: activeApp = apps.find((app) => app.id === activeId);
  $: activeApp && mountNode && void mountActiveApp(activeApp);

  async function loadApps(): Promise<void> {
    loading = true;
    try {
      const response = await fetch("/api/ui/apps");
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json() as { apps: UiApp[]; initialApp?: string };
      apps = payload.apps;
      activeId = appIdFromLocation(apps) || payload.initialApp || apps[0]?.id || "";
      error = "";
      syncLocation(false);
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      loading = false;
    }
  }

  function selectApp(app: UiApp): void {
    activeId = app.id;
    switcherOpen = false;
    syncLocation(true);
  }

  function applyLocation(): void {
    const next = appIdFromLocation(apps);
    if (next) activeId = next;
  }

  function appIdFromLocation(values: UiApp[]): string | undefined {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) return undefined;
    return values.find((app) => app.routePath?.replace(/^\/+|\/+$/g, "") === path || app.id === path)?.id;
  }

  function syncLocation(push: boolean): void {
    const app = apps.find((value) => value.id === activeId);
    const path = app?.routePath || `/${activeId}`;
    if (!path || window.location.pathname === path) return;
    const next = `${path}${window.location.search}${window.location.hash}`;
    if (push) window.history.pushState({}, "", next);
    else window.history.replaceState({}, "", next);
  }

  async function mountActiveApp(app: UiApp): Promise<void> {
    if (mountedKey === app.id) return;
    disposeApp();
    mountedKey = app.id;
    error = "";
    await tick();
    try {
      const load = globalThis.__dynamicImportForTest || ((path: string) => import(/* @vite-ignore */ path));
      const module = await load(app.modulePath) as EmbeddedAppModule;
      if (!module.mountApp) throw new Error("embedded module does not export mountApp.");
      loadStyles(app);
      dispose = module.mountApp(mountNode, { appId: app.id });
      placeSwitcher();
    } catch (caught) {
      error = `Unable to load ${app.label}: ${(caught as Error).message}`;
    }
  }

  /** Moves the switcher into a `[data-tangent-chrome-slot]` the mounted app exposes,
      so it sits inside the app's own top row. Apps without a slot keep it in the
      chrome header. The switcher node is stable once apps load, so a one-time move
      is safe. */
  function placeSwitcher(): void {
    if (!switcherNode || !mountNode) return;
    if (!switcherHome) switcherHome = switcherNode.parentElement ?? undefined;
    const slot = mountNode.querySelector<HTMLElement>("[data-tangent-chrome-slot]");
    const target = slot ?? switcherHome;
    if (target && switcherNode.parentElement !== target) target.appendChild(switcherNode);
    chromeHidden = Boolean(slot);
  }

  function loadStyles(app: UiApp): void {
    for (const stylePath of app.stylePaths || []) {
      const selector = `link[data-tangent-app-style="${stylePath}"]`;
      if (document.head.querySelector(selector)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = stylePath;
      link.dataset.tangentAppStyle = stylePath;
      document.head.appendChild(link);
    }
  }

  function disposeApp(): void {
    // Rescue the switcher before clearing the host, in case the app slotted it in.
    if (switcherNode && switcherHome && switcherNode.parentElement !== switcherHome) {
      switcherHome.appendChild(switcherNode);
    }
    chromeHidden = false;
    if (dispose) dispose();
    dispose = undefined;
    mountedKey = "";
    if (mountNode) mountNode.replaceChildren();
  }
</script>

<ShellLayout {chromeHidden}>
  <svelte:fragment slot="chrome">
    <div class="app-switcher" bind:this={switcherNode}>
      {#if apps.length}
        <button class="switcher-trigger" type="button" aria-label="Switch Tangent app" aria-expanded={switcherOpen} on:click={() => switcherOpen = !switcherOpen}>
          {activeApp?.label || "Apps"}
        </button>
        {#if switcherOpen}
          <nav aria-label="Tangent apps" class="switcher-menu">
            {#each apps as app}
              <button class:active={app.id === activeId} type="button" on:click={() => selectApp(app)}>
                {app.label}
              </button>
            {/each}
          </nav>
        {/if}
      {/if}
      {#if buildId}
        <span
          class="version-label"
          aria-label={"Build " + buildShort}
          title={buildId}
        >{buildLabel}</span>
      {/if}
      {#if buildId && builtAt}
        <span class="version-sep" aria-hidden="true">·</span>
      {/if}
      {#if builtAt}
        <span
          class="updated-label"
          class:just-updated={justUpdated}
          aria-label={"Last updated: " + updatedLabel}
          title={formatBuiltAtAbsolute(builtAt)}
        >{updatedLabel}</span>
      {/if}
    </div>
  </svelte:fragment>

  <section class="workspace" aria-busy={loading}>
    {#if loading}
      <div class="state">Loading apps</div>
    {:else if error}
      <div class="state error">{error}</div>
    {:else if !apps.length}
      <div class="state">No installed UI apps found.</div>
    {/if}
    <div class="app-host" bind:this={mountNode}></div>
  </section>
</ShellLayout>

{#if feedbackOpen}
  <div class="feedback-backdrop" role="presentation" on:click={closeFeedback}>
    <div class="feedback-card" role="dialog" aria-label="Send Tangent feedback" on:click|stopPropagation>
      {#if feedbackSaved}
        <div class="feedback-saved">Saved ✓</div>
        <div class="feedback-row">
          <span class="feedback-hint">Appended to ~/.tangent/feedback.jsonl</span>
          <button type="button" class="feedback-send" on:click={closeFeedback}>Close</button>
        </div>
      {:else}
        <header class="feedback-head">
          <span class="feedback-title">Feedback</span>
          <span class="feedback-context">{activeApp?.label || activeId || ""}</span>
        </header>
        <textarea
          class="feedback-input"
          bind:value={feedbackText}
          on:keydown={onComposerKeydown}
          use:autofocus
          placeholder="What should change about Tangent? An agent reads this directly."
          rows="4"
        ></textarea>
        {#if feedbackError}<div class="feedback-error">{feedbackError}</div>{/if}
        <div class="feedback-row">
          <span class="feedback-hint">⌘⏎ send · esc close</span>
          <button type="button" class="feedback-send" on:click={submitFeedback} disabled={!feedbackText.trim()}>Send</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Lowest-weight chrome on every screen: the build-identity cluster (version + freshness), anchored
     beside the switcher so it rides into /trees where the shell chrome is hidden. Both strings sit at
     the same muted weight so neither dominates; the token clears WCAG AA on the chrome background. */
  .updated-label, .version-label, .version-sep {
    font-size: 12px;
    line-height: 1;
    color: #5c6962;
    white-space: nowrap;
  }

  /* The version label leads the cluster, so it carries the gap from the switcher. */
  .version-label {
    margin-left: 8px;
  }

  /* Decorative join between the two strings; breathes equally on both sides. */
  .version-sep {
    margin: 0 4px;
  }

  /* Only the freshness label transitions/flashes; the version's changed value is its own signal. */
  .updated-label {
    transition: color 0.6s ease;
  }

  .updated-label.just-updated {
    color: #2c6e49;
  }

  @media (prefers-reduced-motion: reduce) {
    .updated-label {
      transition: none;
    }
  }

  .feedback-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 14vh;
    background: rgba(23, 32, 27, 0.28);
  }

  .feedback-card {
    width: min(560px, calc(100vw - 32px));
    display: grid;
    gap: 10px;
    padding: 16px;
    border: 1px solid #c9d1c8;
    border-radius: 12px;
    background: #f8faf6;
    box-shadow: 0 18px 50px rgba(23, 32, 27, 0.28);
  }

  .feedback-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .feedback-title {
    font-size: 14px;
    font-weight: 600;
    color: #17201b;
  }

  .feedback-context {
    font-size: 12px;
    color: #6b776f;
  }

  .feedback-input {
    width: 100%;
    resize: vertical;
    border: 1px solid #c9d1c8;
    border-radius: 8px;
    background: #ffffff;
    color: #17201b;
    padding: 10px;
    font: inherit;
    font-size: 14px;
    line-height: 1.4;
  }

  .feedback-input:focus-visible {
    outline: 2px solid #7a8f82;
    outline-offset: 1px;
  }

  .feedback-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .feedback-hint {
    font-size: 12px;
    color: #6b776f;
  }

  .feedback-send {
    border: 1px solid #c9d1c8;
    border-radius: 7px;
    background: #17201b;
    color: #f8faf6;
    padding: 7px 14px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .feedback-send:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .feedback-error {
    font-size: 12px;
    color: #b4452f;
  }

  .feedback-saved {
    font-size: 15px;
    font-weight: 600;
    color: #2c6e49;
  }
</style>
