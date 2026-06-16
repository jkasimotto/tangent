<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

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
  let dispose: void | (() => void);
  let mountedKey = "";

  onMount(() => {
    window.addEventListener("popstate", applyLocation);
    void loadApps();
  });

  onDestroy(() => {
    window.removeEventListener("popstate", applyLocation);
    disposeApp();
  });

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
    } catch (caught) {
      error = `Unable to load ${app.label}: ${(caught as Error).message}`;
    }
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
    if (dispose) dispose();
    dispose = undefined;
    mountedKey = "";
    if (mountNode) mountNode.replaceChildren();
  }
</script>

<main class="tangent-shell">
  <div class="app-switcher">
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
  </div>

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
</main>
