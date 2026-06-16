<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createTreesApiClient, type TreesUiClient, type TreesUiEntity, type TreesUiProject, type TreesUiWorkspace } from "./client.js";

  export let client: TreesUiClient = createTreesApiClient();

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
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let requestSequence = 0;

  onMount(() => {
    void loadWorkspace();
    pollTimer = setInterval(() => {
      if (!saving) void loadWorkspace({ polling: true });
    }, 2000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  $: nodes = buildTree(workspace.entities);
  $: rows = flattenTree(nodes, expandedPaths);
  $: selectedEntity = selectedPath ? workspace.entities.find((entity) => entity.path === selectedPath) : undefined;
  $: selectedNode = selectedPath ? findNode(nodes, selectedPath) : undefined;
  $: entityCount = workspace.entities.length;
  $: configuredCount = workspace.entities.filter(isConfiguredLeafEntity).length;
  $: syncSelectedForm(selectedEntity);

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

  function receiveWorkspace(next: TreesUiWorkspace, preferredPath = selectedPath): void {
    const wasEmpty = expandedPaths.length === 0;
    workspace = {
      entities: [...next.entities].sort((left, right) => left.path.localeCompare(right.path)),
      projects: [...next.projects].sort((left, right) => left.name.localeCompare(right.name))
    };
    if (wasEmpty) expandedPaths = expandablePaths(workspace.entities);
    selectedPath = preferredPath && workspace.entities.some((entity) => entity.path === preferredPath)
      ? preferredPath
      : workspace.entities[0]?.path || "";
    if (selectedPath) expandAncestors(selectedPath);
  }

  function selectEntity(path: string): void {
    selectedPath = path;
    error = "";
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

  function expandablePaths(entities: TreesUiEntity[]): string[] {
    const paths = entities.map((entity) => entity.path);
    return paths.filter((path) => paths.some((candidate) => candidate.startsWith(`${path}/`)));
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
</script>

<main class="trees-workspace" aria-label="Trees workspace">
  <section class="trees-pane trees-main" aria-label="Tree builder">
    <header class="workspace-header">
      <div>
        <p>Tangent Trees</p>
        <h1>Work tree</h1>
      </div>
      <div class="summary" aria-label="Tree summary">
        <span>{entityCount} nodes</span>
        <span>{configuredCount} leaves</span>
      </div>
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
          {#each rows as row}
            <div class="tree-row-wrap" style={`--depth: ${row.depth}`}>
              <div class="tree-guides" aria-hidden="true">
                {#each row.connectors as connector}
                  <span class:draw={connector}></span>
                {/each}
                <span class="elbow" class:last={row.last}></span>
              </div>
              <div
                role="treeitem"
                aria-selected={selectedPath === row.entity.path}
                aria-expanded={row.hasChildren ? expandedPaths.includes(row.entity.path) : undefined}
                class="tree-row"
                class:selected={selectedPath === row.entity.path}
                class:locked={row.configured && !row.hasChildren}
                class:conflict={row.conflict}
              >
                <span class="disclosure">
                  {#if row.hasChildren}
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
                <button type="button" class="node-select" on:click={() => selectEntity(row.entity.path)}>
                  <span class="node-name">{row.name}</span>
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
        </div>
      </form>
    {:else}
      <div class="empty-inspector">
        <strong>No node selected.</strong>
        <span>Add a path to begin.</span>
      </div>
    {/if}
  </aside>
</main>
