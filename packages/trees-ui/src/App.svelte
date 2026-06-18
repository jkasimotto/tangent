<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createTreesApiClient, type TreesUiClient, type TreesUiEntity, type TreesUiProject, type TreesUiWorkspace } from "./client.js";
  import { createLauncherApiClient, type LauncherClient, type LaunchConfig, type LaunchSession } from "./launcher-client.js";
  import { createWorklogApiClient, type WorklogClient } from "./worklog-client.js";
  import Worklog from "./Worklog.svelte";

  export let client: TreesUiClient = createTreesApiClient();
  export let launcher: LauncherClient = createLauncherApiClient();
  export let worklog: WorklogClient = createWorklogApiClient();

  let view: "trees" | "worklog" = "trees";

  // Intent captured before opening an agent: what + how long.
  let intentName = "";
  let intentEstimate: number | null = null;
  let intentDescription = "";

  type TreeNode = {
    entity: TreesUiEntity;
    name: string;
    depth: number;
    children: TreeNode[];
    hasChildren: boolean;
    configured: boolean;
    conflict: boolean;
  };

  type TreeRow = TreeNode & {
    connectors: boolean[];
    last: boolean;
  };

  type SessionRow = {
    kind: "session";
    session: LaunchSession;
    entity: TreesUiEntity;
    depth: number;
    connectors: boolean[];
    last: boolean;
  };

  type AnyRow = ({ kind: "entity" } & TreeRow) | SessionRow;

  let workspace: TreesUiWorkspace = { entities: [], projects: [] };
  let loading = true;
  let saving = false;
  let error = "";
  let addPath = "";
  let selectedPath = "";
  let expandedPaths: string[] = [];
  let formProjectId = "";
  let formBranch = "";
  let formWorktreePath = "";
  let confirmingDelete = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let requestSequence = 0;

  let launcherConfig: LaunchConfig | null = null;
  let activeSessions: LaunchSession[] = [];
  let selectedSessionKey = "";
  let driverSelectValue = "iterm2-tab";
  let customDriverTemplate = "";

  onMount(() => {
    void loadWorkspace();
    void loadLauncherData();
    pollTimer = setInterval(() => {
      if (!saving) {
        void loadWorkspace({ polling: true });
        void refreshActiveSessions();
      }
    }, 2000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  $: nodes = buildTree(workspace.entities);
  $: rows = flattenTree(nodes, expandedPaths);
  $: displayRows = injectSessionRows(rows, activeSessions, workspace.projects, expandedPaths);
  $: selectedEntity = selectedPath ? workspace.entities.find((entity) => entity.path === selectedPath) : undefined;
  $: selectedNode = selectedPath ? findNode(nodes, selectedPath) : undefined;
  $: selectedSession = selectedSessionKey ? activeSessions.find((s) => sessionKey(s) === selectedSessionKey) : undefined;
  $: entityCount = workspace.entities.length;
  $: configuredCount = workspace.entities.filter(isConfiguredLeafEntity).length;
  $: syncSelectedForm(selectedEntity);
  $: syncLauncherForm(launcherConfig);
  $: selectedOpenPath = selectedEntity
    ? (selectedEntity.worktreePath || workspace.projects.find((p) => p.id === selectedEntity?.projectId)?.path)
    : undefined;
  $: intentReady = intentName.trim().length > 0 && typeof intentEstimate === "number" && intentEstimate > 0;

  async function loadWorkspace(options: { polling?: boolean } = {}): Promise<void> {
    const sequence = ++requestSequence;
    if (!options.polling) loading = true;
    try {
      const next = await client.loadWorkspace();
      if (sequence !== requestSequence) return;
      receiveWorkspace(next);
      error = "";
    } catch (caught) {
      if (!options.polling) error = friendlyError(caught);
    } finally {
      if (sequence === requestSequence && !options.polling) loading = false;
    }
  }

  async function loadLauncherData(): Promise<void> {
    try {
      const [config, sessions] = await Promise.all([launcher.loadConfig(), launcher.listSessions()]);
      launcherConfig = config;
      activeSessions = sessions;
    } catch {
      // launcher API not available — hide launcher UI gracefully
    }
  }

  async function refreshActiveSessions(): Promise<void> {
    try {
      activeSessions = await launcher.listSessions();
    } catch {
      // ignore polling errors
    }
  }

  async function saveLauncherConfig(): Promise<void> {
    if (!launcherConfig) return;
    try {
      await launcher.saveConfig(launcherConfig);
    } catch (caught) {
      error = friendlyError(caught);
    }
  }

  function handleDriverChange(): void {
    if (!launcherConfig) return;
    if (driverSelectValue === "custom") {
      launcherConfig = { ...launcherConfig, driver: { type: "custom", template: customDriverTemplate } };
    } else {
      launcherConfig = { ...launcherConfig, driver: driverSelectValue as "iterm2-tab" | "iterm2-window" };
    }
    void saveLauncherConfig();
  }

  async function openSession(type: "agent" | "terminal", tmux?: boolean): Promise<void> {
    if (!selectedOpenPath) return;
    try {
      const title = selectedEntity?.path;
      if (type === "agent") {
        await launcher.openAgent(selectedOpenPath, {
          tmux,
          title,
          name: intentName.trim(),
          description: intentDescription.trim() || undefined,
          estimateMinutes: intentEstimate ?? undefined
        });
        intentName = "";
        intentEstimate = null;
        intentDescription = "";
      } else {
        await launcher.openTerminal(selectedOpenPath, { title });
      }
      activeSessions = await launcher.listSessions();
      if (selectedEntity?.path) expandedPaths = [...new Set([...expandedPaths, selectedEntity.path])];
    } catch (caught) {
      error = friendlyError(caught);
    }
  }

  async function focusSession(session: LaunchSession): Promise<void> {
    try {
      await launcher.focusSession(session);
    } catch (caught) {
      error = friendlyError(caught);
    }
  }

  async function stopSession(session: LaunchSession): Promise<void> {
    try {
      await launcher.stopSession(session);
      activeSessions = await launcher.listSessions();
      if (selectedSessionKey === sessionKey(session)) selectedSessionKey = "";
    } catch (caught) {
      error = friendlyError(caught);
    }
  }

  let syncedDriverKey = "";
  function syncLauncherForm(config: LaunchConfig | null): void {
    const key = config ? JSON.stringify(config.driver) : "";
    if (syncedDriverKey === key) return;
    syncedDriverKey = key;
    driverSelectValue = typeof config?.driver === "string" ? config.driver : "custom";
    customDriverTemplate = typeof config?.driver === "object" ? config.driver.template : "";
  }

  async function addTreePath(): Promise<void> {
    const normalized = normalizePath(addPath);
    if (!normalized) {
      error = "Enter a path.";
      return;
    }
    const existing = workspace.entities.find((entity) => entity.path === normalized);
    if (existing) {
      selectEntity(existing.path);
      addPath = "";
      error = "";
      return;
    }
    const locked = lockedPrefix(normalized, workspace.entities);
    if (locked) {
      error = `${locked} is configured as a leaf. Clear its project and branch before adding children.`;
      return;
    }
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.createPath(normalized);
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, normalized);
      expandAncestors(normalized);
      addPath = "";
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      saving = false;
    }
  }

  async function saveLeaf(): Promise<void> {
    if (!selectedEntity) return;
    if (!formProjectId || !formBranch.trim()) {
      error = "Project and branch are required to lock a leaf.";
      return;
    }
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.saveLeaf(selectedEntity.id || selectedEntity.path, {
        projectId: formProjectId,
        branch: formBranch.trim(),
        worktreePath: formWorktreePath.trim() || undefined
      });
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, selectedEntity.path);
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      saving = false;
    }
  }

  async function clearLeaf(): Promise<void> {
    if (!selectedEntity) return;
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.clearLeaf(selectedEntity.id || selectedEntity.path);
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, selectedEntity.path);
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      saving = false;
    }
  }

  async function deleteNode(): Promise<void> {
    if (!selectedEntity) return;
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.deleteEntity(selectedEntity.id || selectedEntity.path);
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, "");
      confirmingDelete = false;
      error = "";
    } catch (caught) {
      error = friendlyError(caught);
    } finally {
      saving = false;
    }
  }

  function receiveWorkspace(next: TreesUiWorkspace, preferredPath = selectedPath): void {
    workspace = {
      entities: [...next.entities].sort((left, right) => left.path.localeCompare(right.path)),
      projects: [...next.projects].sort((left, right) => left.name.localeCompare(right.name))
    };
    // If a session is selected and no explicit entity path was requested, don't clobber the empty selectedPath.
    if (!preferredPath && selectedSessionKey) return;
    selectedPath = preferredPath && workspace.entities.some((entity) => entity.path === preferredPath)
      ? preferredPath
      : workspace.entities[0]?.path || "";
    if (selectedPath) expandAncestors(selectedPath);
  }

  function selectEntity(path: string): void {
    selectedPath = path;
    selectedSessionKey = "";
    error = "";
  }

  function selectSession(session: LaunchSession): void {
    selectedSessionKey = sessionKey(session);
    selectedPath = "";
    error = "";
  }

  function sessionKey(session: LaunchSession): string {
    return `${session.cwd}:${session.startedAt}`;
  }

  function toggleExpanded(path: string): void {
    expandedPaths = expandedPaths.includes(path)
      ? expandedPaths.filter((value) => value !== path)
      : [...expandedPaths, path];
  }

  function expandAncestors(path: string): void {
    const parts = path.split("/");
    const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    expandedPaths = [...new Set([...expandedPaths, ...ancestors])];
  }

  let syncedFormPath = "";
  function syncSelectedForm(entity: TreesUiEntity | undefined): void {
    const key = entity ? `${entity.path}:${entity.projectId || ""}:${entity.branch || ""}:${entity.worktreePath || ""}` : "";
    if (syncedFormPath === key) return;
    syncedFormPath = key;
    formProjectId = entity?.projectId || "";
    formBranch = entity?.branch || "";
    formWorktreePath = entity?.worktreePath || "";
    confirmingDelete = false;
  }

  function buildTree(entities: TreesUiEntity[]): TreeNode[] {
    const sorted = [...entities].sort((left, right) => left.path.localeCompare(right.path));
    const nodesByPath = new Map<string, TreeNode>();
    for (const entity of sorted) {
      nodesByPath.set(entity.path, {
        entity,
        name: entity.title || entity.path.split("/").at(-1) || entity.path,
        depth: entity.path.split("/").length - 1,
        children: [],
        hasChildren: false,
        configured: isConfiguredLeafEntity(entity),
        conflict: false
      });
    }
    const roots: TreeNode[] = [];
    for (const node of nodesByPath.values()) {
      const parentPath = parentPathFor(node.entity.path);
      const parent = parentPath ? nodesByPath.get(parentPath) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    for (const node of nodesByPath.values()) {
      node.children.sort((left, right) => left.entity.path.localeCompare(right.entity.path));
      node.hasChildren = node.children.length > 0;
      node.conflict = node.hasChildren && node.configured;
    }
    return roots.sort((left, right) => left.entity.path.localeCompare(right.entity.path));
  }

  function flattenTree(values: TreeNode[], expanded: string[], prefix: boolean[] = []): TreeRow[] {
    const output: TreeRow[] = [];
    values.forEach((node, index) => {
      const last = index === values.length - 1;
      output.push({ ...node, connectors: prefix, last });
      if (node.hasChildren && expanded.includes(node.entity.path)) {
        output.push(...flattenTree(node.children, expanded, [...prefix, !last]));
      }
    });
    return output;
  }

  function findNode(values: TreeNode[], path: string): TreeNode | undefined {
    for (const node of values) {
      if (node.entity.path === path) return node;
      const child = findNode(node.children, path);
      if (child) return child;
    }
    return undefined;
  }

  function isConfiguredLeafEntity(entity: TreesUiEntity): boolean {
    return Boolean(entity.projectId && entity.branch);
  }

  function lockedPrefix(path: string, entities: TreesUiEntity[]): string | undefined {
    const parts = path.split("/");
    const entityPaths = new Set(entities.map((entity) => entity.path));
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join("/");
      const entity = entities.find((candidate) => candidate.path === prefix);
      const hasChildren = [...entityPaths].some((candidate) => candidate.startsWith(`${prefix}/`));
      if (entity && isConfiguredLeafEntity(entity) && !hasChildren) return prefix;
    }
    return undefined;
  }

  function parentPathFor(path: string): string | undefined {
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : undefined;
  }

  function normalizePath(value: string): string {
    return value.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  }

  function projectName(projects: TreesUiProject[], id: string | undefined): string {
    return projects.find((project) => project.id === id)?.name || "";
  }

  function friendlyError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }

  function entityCwd(entity: TreesUiEntity, projects: TreesUiProject[]): string {
    return entity.worktreePath ?? projects.find((p) => p.id === entity.projectId)?.path ?? "";
  }

  function entityHasSessions(entity: TreesUiEntity): boolean {
    const cwd = entityCwd(entity, workspace.projects);
    return Boolean(cwd) && activeSessions.some((s) => s.cwd === cwd);
  }

  function injectSessionRows(entityRows: TreeRow[], sessions: LaunchSession[], projects: TreesUiProject[], expanded: string[]): AnyRow[] {
    const result: AnyRow[] = [];
    for (const row of entityRows) {
      result.push({ kind: "entity", ...row });
      if (!expanded.includes(row.entity.path)) continue;
      const cwd = entityCwd(row.entity, projects);
      if (!cwd) continue;
      const entitySessions = sessions.filter((s) => s.cwd === cwd);
      for (let j = 0; j < entitySessions.length; j++) {
        result.push({
          kind: "session",
          session: entitySessions[j],
          entity: row.entity,
          depth: row.depth + 1,
          connectors: [...row.connectors, !row.last],
          last: j === entitySessions.length - 1
        });
      }
    }
    return result;
  }

  function relativeTime(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
</script>

<div class="app-shell">
  <nav class="view-tabs" aria-label="Views">
    <button type="button" class:active={view === "trees"} on:click={() => view = "trees"}>Trees</button>
    <button type="button" class:active={view === "worklog"} on:click={() => view = "worklog"}>Worklog</button>
  </nav>
  {#if view === "worklog"}
    <Worklog {worklog} />
  {:else}
<main class="trees-workspace" aria-label="Trees workspace">
  <section class="trees-pane trees-main" aria-label="Tree builder">
    <header class="workspace-header">
      <div class="workspace-header-top">
        <div>
          <p>Tangent Trees</p>
          <h1>Work tree</h1>
        </div>
        <div class="summary" aria-label="Tree summary">
          <span>{entityCount} nodes</span>
          <span>{configuredCount} leaves</span>
        </div>
      </div>
      {#if launcherConfig}
        <div class="launcher-settings" aria-label="Terminal launcher settings">
          <label>
            <span>Driver</span>
            <select bind:value={driverSelectValue} on:change={handleDriverChange}>
              <option value="iterm2-tab">iTerm2 tab</option>
              <option value="iterm2-window">iTerm2 window</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {#if driverSelectValue === "custom"}
            <label>
              <span>Template</span>
              <input bind:value={customDriverTemplate} placeholder="kitty --directory {'{cwd}'} -- {'{cmd}'}" on:change={handleDriverChange} />
            </label>
          {/if}
          <label class="tmux-toggle" title="Wrap new sessions in tmux by default">
            <input type="checkbox" bind:checked={launcherConfig.tmux} on:change={saveLauncherConfig} />
            <span>Tmux</span>
          </label>
        </div>
      {/if}
    </header>

    <form class="add-path" aria-label="Add tree path" on:submit|preventDefault={addTreePath}>
      <label for="tree-path">Add path</label>
      <div>
        <input id="tree-path" bind:value={addPath} placeholder="foo/bar/baz" autocomplete="off" disabled={saving} />
        <button type="submit" disabled={saving}>Add</button>
      </div>
    </form>

    {#if error}
      <div class="notice" role="alert">{error}</div>
    {/if}

    <div class="tree-surface" aria-busy={loading}>
      {#if loading}
        <div class="empty-state">Loading trees</div>
      {:else if rows.length === 0}
        <div class="empty-state">
          <strong>No tree nodes yet.</strong>
          <span>Add a path to create the first branch.</span>
        </div>
      {:else}
        <div class="tree-list" role="tree" aria-label="Tree nodes">
          {#each displayRows as row}
            <div class="tree-row-wrap" style={`--depth: ${row.depth}`}>
              <div class="tree-guides" aria-hidden="true">
                {#each row.connectors as connector}
                  <span class:draw={connector}></span>
                {/each}
                <span class="elbow" class:last={row.last}></span>
              </div>
              {#if row.kind === "session"}
                <div class="tree-row session-row" class:selected={selectedSessionKey === sessionKey(row.session)}>
                  <span class="disclosure"><span></span></span>
                  <button type="button" class="node-select session-select" on:click={() => selectSession(row.session)}>
                    <span class="node-name">
                      <span class="session-kind-dot" aria-hidden="true">●</span>
                      {row.session.kind}
                    </span>
                    <span class="node-meta">{relativeTime(row.session.startedAt)}</span>
                  </button>
                  <button type="button" class="session-stop" aria-label="Stop session" on:click|stopPropagation={() => stopSession(row.session)}>×</button>
                </div>
              {:else}
                {@const expandable = row.hasChildren || entityHasSessions(row.entity)}
                <div
                  role="treeitem"
                  aria-selected={selectedPath === row.entity.path}
                  aria-expanded={expandable ? expandedPaths.includes(row.entity.path) : undefined}
                  class="tree-row"
                  class:selected={selectedPath === row.entity.path}
                  class:locked={row.configured && !row.hasChildren && !entityHasSessions(row.entity)}
                  class:conflict={row.conflict}
                >
                  <span class="disclosure">
                    {#if expandable}
                      <button
                        type="button"
                        aria-label={`${expandedPaths.includes(row.entity.path) ? "Collapse" : "Expand"} ${row.entity.path}`}
                        on:click|stopPropagation={() => toggleExpanded(row.entity.path)}
                      >
                        {expandedPaths.includes(row.entity.path) ? "▾" : "▸"}
                      </button>
                    {:else}
                      <span></span>
                    {/if}
                  </span>
                  <button type="button" class="node-select" on:click={() => { selectEntity(row.entity.path); if (expandable) toggleExpanded(row.entity.path); }}>
                    <span class="node-name">
                      {row.name}
                    </span>
                    <span class="node-meta">
                      {#if row.conflict}
                        Mixed
                      {:else if row.configured}
                        {projectName(workspace.projects, row.entity.projectId)} · {row.entity.branch}
                      {:else if row.hasChildren}
                        Group
                      {:else}
                        Unassigned
                      {/if}
                    </span>
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <aside class="trees-pane inspector" aria-label="Selected node">
    {#if selectedEntity}
      <header>
        <p>Selected</p>
        <h2>{selectedEntity.path}</h2>
      </header>

      <dl class="node-facts">
        <div>
          <dt>Kind</dt>
          <dd>
            {#if selectedNode?.conflict}
              Group with leaf metadata
            {:else if selectedNode?.configured && !selectedNode?.hasChildren}
              Locked leaf
            {:else}
              Group-ready node
            {/if}
          </dd>
        </div>
        <div>
          <dt>Children</dt>
          <dd>{selectedNode?.children.length || 0}</dd>
        </div>
      </dl>

      {#if selectedNode?.conflict}
        <div class="notice subtle">This node has children and leaf metadata. Clear metadata to keep it as a group.</div>
      {/if}

      <form class="leaf-form" aria-label="Leaf metadata" on:submit|preventDefault={saveLeaf}>
        <label>
          <span>Project</span>
          <select bind:value={formProjectId} disabled={saving || workspace.projects.length === 0 || Boolean(selectedNode?.hasChildren)}>
            <option value="">Select project</option>
            {#each workspace.projects as project}
              <option value={project.id}>{project.name}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Branch</span>
          <input bind:value={formBranch} placeholder="feature/login-api" disabled={saving || Boolean(selectedNode?.hasChildren)} />
        </label>

        <label>
          <span>Worktree</span>
          <input bind:value={formWorktreePath} placeholder="/optional/worktree/path" disabled={saving || Boolean(selectedNode?.hasChildren)} />
        </label>

        {#if selectedNode?.hasChildren}
          <div class="form-hint">Nodes with children stay group-ready. Select a child node to configure a leaf.</div>
        {:else if workspace.projects.length === 0}
          <div class="form-hint">Register a project before locking leaves.</div>
        {/if}

        <div class="actions">
          <button type="submit" disabled={saving || Boolean(selectedNode?.hasChildren) || !formProjectId || !formBranch.trim()}>
            Save leaf
          </button>
          <button type="button" class="secondary" on:click={clearLeaf} disabled={saving || !selectedNode?.configured}>
            Clear metadata
          </button>
          {#if confirmingDelete}
            <button type="button" class="danger" on:click={deleteNode} disabled={saving}>
              Really delete?
            </button>
            <button type="button" class="secondary" on:click={() => confirmingDelete = false} disabled={saving}>
              Cancel
            </button>
          {:else}
            <button type="button" class="secondary" on:click={() => confirmingDelete = true} disabled={saving}>
              Delete node
            </button>
          {/if}
        </div>
      </form>

      {#if selectedOpenPath && launcherConfig}
        <div class="open-actions">
          <p class="open-actions-label">Start work</p>
          <div class="intent-form">
            <label>
              <span>What are you working on?</span>
              <input bind:value={intentName} placeholder="e.g. Wire up worklog API" autocomplete="off" />
            </label>
            <label>
              <span>Estimate (minutes)</span>
              <div class="estimate-row">
                <input type="number" min="1" bind:value={intentEstimate} placeholder="60" />
                <div class="chips">
                  {#each [15, 30, 60, 120] as preset}
                    <button type="button" class:active={intentEstimate === preset} on:click={() => intentEstimate = preset}>
                      {preset >= 60 ? `${preset / 60}h` : `${preset}m`}
                    </button>
                  {/each}
                </div>
              </div>
            </label>
            <label>
              <span>Notes (optional)</span>
              <textarea bind:value={intentDescription} rows="2" placeholder="Optional context"></textarea>
            </label>
          </div>
          <div class="actions">
            <button type="button" disabled={!intentReady} title={intentReady ? "" : "Add a name and estimate first"} on:click={() => openSession("agent")}>
              Open Agent
            </button>
            <button type="button" disabled={!intentReady} title={intentReady ? "" : "Add a name and estimate first"} on:click={() => openSession("agent", true)}>
              Open Agent in tmux
            </button>
            <button type="button" class="secondary" on:click={() => openSession("terminal")}>
              Open Terminal
            </button>
          </div>
        </div>
      {/if}
    {:else if selectedSession}
      <header>
        <p>Session</p>
        <h2>{selectedSession.title || selectedSession.cwd}</h2>
      </header>
      <dl class="node-facts">
        <div>
          <dt>Kind</dt>
          <dd>{selectedSession.kind}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{relativeTime(selectedSession.startedAt)}</dd>
        </div>
        {#if selectedSession.tmuxSession}
          <div>
            <dt>Tmux</dt>
            <dd>{selectedSession.tmuxSession}</dd>
          </div>
        {/if}
      </dl>
      <div class="open-actions">
        <div class="actions">
          <button type="button" on:click={() => focusSession(selectedSession)}>Open</button>
          <button type="button" class="danger" on:click={() => stopSession(selectedSession)}>Close</button>
        </div>
      </div>
    {:else}
      <div class="empty-inspector">
        <strong>No node selected.</strong>
        <span>Add a path to begin.</span>
      </div>
    {/if}
  </aside>
</main>
  {/if}
</div>
