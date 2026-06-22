<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createTreesApiClient, type TreesUiClient, type TreesUiEntity, type TreesUiProject, type TreesUiWorkspace } from "./client.js";
  import {
    createFocusApiClient, isDue, projectFocus,
    type AgentStatus, type FocusClient, type FocusEvent, type Task
  } from "./focus-client.js";

  export let client: TreesUiClient = createTreesApiClient();
  export let focus: FocusClient = createFocusApiClient();
  export let initialView: "focus" | "trees" = "focus";

  let view: "focus" | "trees" = initialView;

  // --- Command and control (focus) state ---
  let focusEvents: FocusEvent[] = [];
  let agentStatusMap: Record<string, AgentStatus> = {};
  let now = Date.now();
  let cmdEntity = "";
  let cmdIntent = "";
  let cmdOutcome = "";
  let cmdMinutes: number | null = null;
  let noteText = "";
  let justDone: Task | undefined;
  let rollupText = "";
  const DEFAULT_CHECKIN_MIN = 30;

  $: state = projectFocus(focusEvents, now, agentStatusMap);
  $: focusTask = state.focusId ? state.tasks.find((t) => t.id === state.focusId) : undefined;
  $: dueTask = state.incoming.find((t) => isDue(t, now));
  $: startReady = cmdEntity.trim().length > 0 && cmdIntent.trim().length > 0 && typeof cmdMinutes === "number" && cmdMinutes > 0;

  // --- Trees state ---
  type TreeNode = {
    entity: TreesUiEntity;
    name: string;
    depth: number;
    children: TreeNode[];
    hasChildren: boolean;
    configured: boolean;
    conflict: boolean;
  };
  type TreeRow = TreeNode & { connectors: boolean[]; last: boolean };

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
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let requestSequence = 0;

  onMount(() => {
    void loadWorkspace();
    void loadFocus();
    pollTimer = setInterval(() => {
      if (!saving) {
        void loadWorkspace({ polling: true });
        void loadFocus();
      }
    }, 2000);
    tickTimer = setInterval(() => { now = Date.now(); }, 1000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
  });

  async function loadFocus(): Promise<void> {
    try {
      focusEvents = await focus.listEvents();
      now = Date.now();
      const watching = projectFocus(focusEvents, now).tasks.filter((t) => t.agent?.transcriptDir);
      if (watching.length) agentStatusMap = await focus.agentStatuses(watching);
    } catch {
      // focus API not available — keep last good state
    }
  }

  /** Resolves the working directory for an entity (worktree or project path), if configured. */
  function entityCwdFor(entityPath: string): string {
    const entity = workspace.entities.find((e) => e.path === entityPath);
    if (!entity) return "";
    return entity.worktreePath ?? workspace.projects.find((p) => p.id === entity.projectId)?.path ?? "";
  }

  /** Starts a task from the command bar. Parks the current focus first so nothing slips into limbo. */
  async function startTask(): Promise<void> {
    if (!startReady) return;
    try {
      if (state.focusId) await focus.park(state.focusId, Date.now() + DEFAULT_CHECKIN_MIN * 60000);
      await focus.startTask({
        entity: cmdEntity.trim(),
        intent: cmdIntent.trim(),
        outcome: cmdOutcome.trim() || undefined,
        estimateMin: cmdMinutes as number
      });
      cmdEntity = ""; cmdIntent = ""; cmdOutcome = ""; cmdMinutes = null;
      justDone = undefined;
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  /** Makes a backgrounded task the focus, parking the current one with a default check-in. */
  async function makeFocus(taskId: string): Promise<void> {
    try {
      if (state.focusId && state.focusId !== taskId) await focus.park(state.focusId, Date.now() + DEFAULT_CHECKIN_MIN * 60000);
      await focus.focusOn(taskId);
      justDone = undefined;
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  async function addNoteToFocus(): Promise<void> {
    if (!focusTask || !noteText.trim()) return;
    try {
      await focus.addNote(focusTask.id, noteText.trim());
      noteText = "";
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  async function doneFocus(actualUnknown = false): Promise<void> {
    if (!focusTask) return;
    const task = focusTask;
    try {
      await focus.done(task.id, noteText.trim() || undefined, actualUnknown);
      noteText = "";
      await loadFocus();
      justDone = state.tasks.find((t) => t.id === task.id);
    } catch (caught) { error = friendlyError(caught); }
  }

  async function dropFocus(): Promise<void> {
    if (!focusTask) return;
    const task = focusTask;
    try {
      await focus.drop(task.id, noteText.trim() || undefined);
      noteText = "";
      await loadFocus();
      justDone = state.tasks.find((t) => t.id === task.id);
    } catch (caught) { error = friendlyError(caught); }
  }

  async function parkFocus(): Promise<void> {
    if (!focusTask) return;
    try {
      await focus.park(focusTask.id, Date.now() + DEFAULT_CHECKIN_MIN * 60000);
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  async function dispatchToFocus(): Promise<void> {
    if (!focusTask) return;
    const cwd = entityCwdFor(focusTask.entity);
    if (!cwd) { error = "Configure this entity's project in Trees before dispatching an agent."; return; }
    try {
      await focus.dispatchAgent(focusTask.id, "claude", cwd);
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  async function snooze(taskId: string, minutes: number): Promise<void> {
    try {
      await focus.setCheckin(taskId, Date.now() + minutes * 60000);
      await loadFocus();
    } catch (caught) { error = friendlyError(caught); }
  }

  /** Gathers an entity's free text (notes, completion notes, bet results) into a rollup. No LLM. */
  function rollup(entity: string): void {
    const tasks = state.tasks.filter((t) => t.entity === entity).sort((a, b) => a.startedAt - b.startedAt);
    const lines: string[] = [`# Rollup: ${entity}`, ""];
    for (const task of tasks) {
      lines.push(`## ${task.intent}${task.outcome ? ` -> ${task.outcome}` : ""}`);
      if (task.status === "done" || task.status === "dropped") {
        const took = task.actualMin == null ? "unknown" : durationLabel(task.actualMin);
        lines.push(`${task.status} · predicted ${durationLabel(task.estimateMin)} · took ${took}`);
      }
      for (const note of task.notes) lines.push(`- ${note}`);
      if (task.doneNote) lines.push(`- ${task.doneNote}`);
      lines.push("");
    }
    rollupText = lines.join("\n");
  }

  function elapsedMin(task: Task, at: number): number {
    let ms = 0;
    for (const segment of task.segments) ms += (segment.off ?? at) - segment.on;
    return ms / 60000;
  }

  const CLOCK_CIRCUMFERENCE = 2 * Math.PI * 52; // r = 52
  /** Geometry for the depleting time ring: the arc shrinks as the estimate is used up. */
  function focusClock(task: Task, at: number): { dash: number; over: boolean; centerLabel: string; subLabel: string } {
    const elapsed = elapsedMin(task, at);
    const remaining = task.estimateMin - elapsed;
    const ratio = Math.max(0, Math.min(1, remaining / task.estimateMin));
    return {
      dash: ratio * CLOCK_CIRCUMFERENCE,
      over: remaining < 0,
      centerLabel: remaining < 0 ? `${durationLabel(-remaining)} over` : `${durationLabel(remaining)} left`,
      subLabel: `${durationLabel(elapsed)} / ${durationLabel(task.estimateMin)}`
    };
  }

  function durationLabel(minutes: number): string {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m}m`;
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
  }

  function countdownLabel(task: Task, at: number): string {
    if (task.agent) return `agent ${task.agent.status}`;
    if (task.checkinAt == null) return "parked";
    const mins = (task.checkinAt - at) / 60000;
    return mins <= 0 ? "check-in due" : `check in ${durationLabel(mins)}`;
  }

  function betResult(task: Task): string {
    if (task.status === "dropped") return `dropped early · predicted ${durationLabel(task.estimateMin)} · took ${durationLabel(task.actualMin ?? 0)}`;
    if (task.actualMin == null) return `predicted ${task.outcome || task.intent} in ${durationLabel(task.estimateMin)} · finished, time unknown`;
    const verdict = task.actualMin <= task.estimateMin ? "on time" : "over";
    return `predicted ${task.outcome || task.intent} in ${durationLabel(task.estimateMin)} · took ${durationLabel(task.actualMin)} · ${verdict}`;
  }

  // --- Trees logic ---
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
    if (!normalized) { error = "Enter a path."; return; }
    const existing = workspace.entities.find((entity) => entity.path === normalized);
    if (existing) { selectEntity(existing.path); addPath = ""; error = ""; return; }
    const locked = lockedPrefix(normalized, workspace.entities);
    if (locked) { error = `${locked} is configured as a leaf. Clear its project and branch before adding children.`; return; }
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.createPath(normalized);
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, normalized);
      expandAncestors(normalized);
      addPath = "";
      error = "";
    } catch (caught) { error = friendlyError(caught); }
    finally { saving = false; }
  }

  async function saveLeaf(): Promise<void> {
    if (!selectedEntity) return;
    if (!formProjectId || !formBranch.trim()) { error = "Project and branch are required to lock a leaf."; return; }
    saving = true;
    const sequence = ++requestSequence;
    try {
      const next = await client.saveLeaf(selectedEntity.id || selectedEntity.path, {
        projectId: formProjectId, branch: formBranch.trim(), worktreePath: formWorktreePath.trim() || undefined
      });
      if (sequence !== requestSequence) return;
      receiveWorkspace(next, selectedEntity.path);
      error = "";
    } catch (caught) { error = friendlyError(caught); }
    finally { saving = false; }
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
    } catch (caught) { error = friendlyError(caught); }
    finally { saving = false; }
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
    } catch (caught) { error = friendlyError(caught); }
    finally { saving = false; }
  }

  function receiveWorkspace(next: TreesUiWorkspace, preferredPath = selectedPath): void {
    workspace = {
      entities: [...next.entities].sort((left, right) => left.path.localeCompare(right.path)),
      projects: [...next.projects].sort((left, right) => left.name.localeCompare(right.name))
    };
    selectedPath = preferredPath && workspace.entities.some((entity) => entity.path === preferredPath)
      ? preferredPath
      : workspace.entities[0]?.path || "";
    if (selectedPath) expandAncestors(selectedPath);
  }

  function selectEntity(path: string): void { selectedPath = path; error = ""; }

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
        children: [], hasChildren: false,
        configured: isConfiguredLeafEntity(entity), conflict: false
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
</script>

<div class="app-shell">
  <nav class="view-tabs" aria-label="Views">
    <button type="button" class:active={view === "focus"} on:click={() => view = "focus"}>Focus</button>
    <button type="button" class:active={view === "trees"} on:click={() => view = "trees"}>Trees</button>
  </nav>

  {#if view === "focus"}
    <main class="cc" aria-label="Command and control">
      <form class="command-bar card" aria-label="Start a task" on:submit|preventDefault={startTask}>
        <div class="cmd-row cmd-primary">
          <input class="cmd-entity" aria-label="Entity" bind:value={cmdEntity} list="cc-entities" placeholder="entity" autocomplete="off" />
          <input class="cmd-intent" aria-label="What are you doing" bind:value={cmdIntent} placeholder="what you're working on" autocomplete="off" />
        </div>
        <datalist id="cc-entities">
          {#each workspace.entities as entity}<option value={entity.path}></option>{/each}
        </datalist>
        <div class="cmd-row cmd-secondary">
          <input class="cmd-outcome" aria-label="Predicted outcome" bind:value={cmdOutcome} placeholder="predicted outcome (optional)" autocomplete="off" />
          <input class="cmd-minutes" aria-label="Estimate minutes" type="number" min="1" bind:value={cmdMinutes} placeholder="min" />
          <button type="submit" class="primary cmd-go" disabled={!startReady}>Start</button>
        </div>
      </form>

      {#if error}<div class="notice" role="alert">{error}</div>{/if}

      {#if dueTask}
        <div class="checkin-band" role="alert" aria-label="Check-in due">
          <div class="checkin-text">
            <strong>⏰ You wanted to check: {dueTask.intent}</strong>
            <span>{dueTask.agent ? `agent ${dueTask.agent.status}` : "parked"}{dueTask.agent?.status === "running" ? " · no input needed" : ""}</span>
          </div>
          <div class="checkin-actions">
            <button type="button" class="primary" on:click={() => makeFocus(dueTask.id)}>Make this my focus</button>
            <button type="button" class="secondary" on:click={() => snooze(dueTask.id, 15)}>snooze 15m</button>
          </div>
        </div>
      {/if}

      <section class="focus-zone card" aria-label="Focus">
        {#if focusTask}
          {@const clock = focusClock(focusTask, now)}
          <div class="focus-grid">
            <div class="clock" class:over={clock.over} aria-label="Time used against estimate">
              <svg viewBox="0 0 120 120" role="img" aria-hidden="true">
                <circle class="clock-track" cx="60" cy="60" r="52" />
                <circle class="clock-arc" cx="60" cy="60" r="52"
                  style={`stroke-dasharray: ${clock.dash} ${CLOCK_CIRCUMFERENCE}`} transform="rotate(-90 60 60)" />
              </svg>
              <div class="clock-center">
                <strong>{clock.centerLabel}</strong>
                <span>{clock.subLabel}</span>
              </div>
            </div>
            <div class="focus-meta">
              <p class="eyebrow">Now{#if focusTask.agent} · agent {focusTask.agent.status}{/if}</p>
              <h1>{focusTask.intent}</h1>
              <p class="focus-entity">{focusTask.entity}</p>
              {#if focusTask.outcome}<p class="focus-predict">predict: {focusTask.outcome}</p>{/if}
            </div>
          </div>

          <div class="focus-actions">
            <button type="button" class="primary big" on:click={() => doneFocus(false)}>Done</button>
            <button type="button" class="secondary" on:click={() => doneFocus(true)} title="Mark done but don't record a time (you finished earlier and forgot)">Done · don't know when</button>
            {#if focusTask.agent}
              <button type="button" class="secondary" disabled title="Agent already running for this task">Agent running</button>
            {:else}
              <button type="button" on:click={dispatchToFocus}>Dispatch agent</button>
            {/if}
            <button type="button" class="secondary" on:click={parkFocus}>Park</button>
            <button type="button" class="secondary" on:click={() => rollup(focusTask.entity)}>Roll up</button>
            <button type="button" class="danger" on:click={dropFocus}>Drop</button>
          </div>

          <div class="focus-note">
            <textarea aria-label="Notes" bind:value={noteText} rows="2" placeholder="dump a thought, a link, a finding; it feeds the rollup"></textarea>
            <button type="button" class="secondary" on:click={addNoteToFocus} disabled={!noteText.trim()}>Add note</button>
          </div>
          {#if focusTask.notes.length}
            <ul class="focus-notes">{#each focusTask.notes as note}<li>{note}</li>{/each}</ul>
          {/if}
        {:else if justDone}
          <div class="bet-result" aria-label="Bet result">
            <p class="eyebrow">Done</p>
            <h1>{justDone.intent}</h1>
            <p class="bet-line">{betResult(justDone)}</p>
          </div>
        {:else}
          <div class="focus-empty"><strong>Nothing in focus.</strong><span>Start a task above to begin.</span></div>
        {/if}
      </section>

      {#if state.incoming.length}
        <section class="waiting" aria-label="Incoming">
          <h2>Waiting on you</h2>
          {#each state.incoming as task}
            <div class="incoming-item" class:due={isDue(task, now)}>
              <button type="button" class="incoming-select" on:click={() => makeFocus(task.id)}>
                <span class="incoming-name">{task.entity} · {task.intent}</span>
                <span class="incoming-status">{countdownLabel(task, now)}</span>
              </button>
            </div>
          {/each}
        </section>
      {/if}

      {#if state.tasks.some((t) => t.segments.length)}
        <section class="timeline" aria-label="Today timeline">
          <h2>Today's attention · {state.switchCountToday} {state.switchCountToday === 1 ? "switch" : "switches"}</h2>
          <div class="timeline-track">
            {#each state.tasks.filter((t) => t.segments.length) as task}
              {#each task.segments as segment}
                <span class="timeline-seg" title={`${task.entity}: ${task.intent} (${durationLabel(((segment.off ?? now) - segment.on) / 60000)})`}
                  style={`--len: ${Math.max(1, ((segment.off ?? now) - segment.on) / 60000)}`}>{task.entity}</span>
              {/each}
            {/each}
          </div>
        </section>
      {/if}

      {#if rollupText}
        <section class="rollup" aria-label="Rollup">
          <pre class="rollup-text">{rollupText}</pre>
        </section>
      {/if}
    </main>
  {:else}
    <main class="trees-workspace" aria-label="Trees workspace">
      <section class="trees-pane trees-main" aria-label="Tree builder">
        <header class="workspace-header">
          <div class="workspace-header-top">
            <div><p>Tangent Trees</p><h1>Work tree</h1></div>
            <div class="summary" aria-label="Tree summary">
              <span>{entityCount} nodes</span>
              <span>{configuredCount} leaves</span>
            </div>
          </div>
        </header>

        <form class="add-path" aria-label="Add tree path" on:submit|preventDefault={addTreePath}>
          <label for="tree-path">Add path</label>
          <div>
            <input id="tree-path" bind:value={addPath} placeholder="foo/bar/baz" autocomplete="off" disabled={saving} />
            <button type="submit" disabled={saving}>Add</button>
          </div>
        </form>

        {#if error}<div class="notice" role="alert">{error}</div>{/if}

        <div class="tree-surface" aria-busy={loading}>
          {#if loading}
            <div class="empty-state">Loading trees</div>
          {:else if rows.length === 0}
            <div class="empty-state"><strong>No tree nodes yet.</strong><span>Add a path to create the first branch.</span></div>
          {:else}
            <div class="tree-list" role="tree" aria-label="Tree nodes">
              {#each rows as row}
                <div class="tree-row-wrap" style={`--depth: ${row.depth}`}>
                  <div class="tree-guides" aria-hidden="true">
                    {#each row.connectors as connector}<span class:draw={connector}></span>{/each}
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
                        <button type="button" aria-label={`${expandedPaths.includes(row.entity.path) ? "Collapse" : "Expand"} ${row.entity.path}`} on:click|stopPropagation={() => toggleExpanded(row.entity.path)}>
                          {expandedPaths.includes(row.entity.path) ? "▾" : "▸"}
                        </button>
                      {:else}<span></span>{/if}
                    </span>
                    <button type="button" class="node-select" on:click={() => selectEntity(row.entity.path)}>
                      <span class="node-name">{row.name}</span>
                      <span class="node-meta">
                        {#if row.conflict}Mixed
                        {:else if row.configured}{projectName(workspace.projects, row.entity.projectId)} · {row.entity.branch}
                        {:else if row.hasChildren}Group
                        {:else}Unassigned{/if}
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
          <header><p>Selected</p><h2>{selectedEntity.path}</h2></header>
          <dl class="node-facts">
            <div><dt>Kind</dt><dd>
              {#if selectedNode?.conflict}Group with leaf metadata
              {:else if selectedNode?.configured && !selectedNode?.hasChildren}Locked leaf
              {:else}Group-ready node{/if}
            </dd></div>
            <div><dt>Children</dt><dd>{selectedNode?.children.length || 0}</dd></div>
          </dl>

          {#if selectedNode?.conflict}
            <div class="notice subtle">This node has children and leaf metadata. Clear metadata to keep it as a group.</div>
          {/if}

          <form class="leaf-form" aria-label="Leaf metadata" on:submit|preventDefault={saveLeaf}>
            <label><span>Project</span>
              <select bind:value={formProjectId} disabled={saving || workspace.projects.length === 0 || Boolean(selectedNode?.hasChildren)}>
                <option value="">Select project</option>
                {#each workspace.projects as project}<option value={project.id}>{project.name}</option>{/each}
              </select>
            </label>
            <label><span>Branch</span>
              <input bind:value={formBranch} placeholder="feature/login-api" disabled={saving || Boolean(selectedNode?.hasChildren)} />
            </label>
            <label><span>Worktree</span>
              <input bind:value={formWorktreePath} placeholder="/optional/worktree/path" disabled={saving || Boolean(selectedNode?.hasChildren)} />
            </label>
            {#if selectedNode?.hasChildren}
              <div class="form-hint">Nodes with children stay group-ready. Select a child node to configure a leaf.</div>
            {:else if workspace.projects.length === 0}
              <div class="form-hint">Register a project before locking leaves.</div>
            {/if}
            <div class="actions">
              <button type="submit" disabled={saving || Boolean(selectedNode?.hasChildren) || !formProjectId || !formBranch.trim()}>Save leaf</button>
              <button type="button" class="secondary" on:click={clearLeaf} disabled={saving || !selectedNode?.configured}>Clear metadata</button>
              {#if confirmingDelete}
                <button type="button" class="danger" on:click={deleteNode} disabled={saving}>Really delete?</button>
                <button type="button" class="secondary" on:click={() => confirmingDelete = false} disabled={saving}>Cancel</button>
              {:else}
                <button type="button" class="secondary" on:click={() => confirmingDelete = true} disabled={saving}>Delete node</button>
              {/if}
            </div>
          </form>
        {:else}
          <div class="empty-inspector"><strong>No node selected.</strong><span>Add a path to begin.</span></div>
        {/if}
      </aside>
    </main>
  {/if}
</div>

<style>
  .cc {
    color-scheme: light;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 24px 20px 48px;
    max-width: 760px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .card {
    background: var(--pane, #fbfcf9);
    border: 1px solid var(--line, #d4dcd2);
    border-radius: 16px;
    box-sizing: border-box;
  }
  .cc button { cursor: pointer; border-radius: 10px; border: 1px solid var(--line, #d4dcd2); background: #fff; color: var(--text, #14231b); padding: 9px 16px; font-size: 14px; font-weight: 600; }
  .cc button:hover:not(:disabled) { border-color: var(--muted, #98a39a); }
  .cc button:disabled { opacity: 0.5; cursor: not-allowed; }
  .cc button.primary { background: var(--accent, #246b58); color: #fff; border-color: transparent; }
  .cc button.secondary { background: #fff; }
  .cc button.danger { color: #c0392b; border-color: transparent; background: transparent; }

  /* Command bar: large, two-row, the clear entry point. */
  .command-bar { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
  .cmd-row { display: flex; gap: 10px; }
  .command-bar input { padding: 13px 15px; font-size: 16px; background: #fff; color: var(--text, #14231b); border: 1px solid var(--line, #d4dcd2); border-radius: 11px; box-sizing: border-box; }
  .command-bar input::placeholder { color: var(--muted, #98a39a); }
  .command-bar input:focus-visible { outline: 2px solid var(--accent, #246b58); outline-offset: 1px; }
  .cmd-entity { flex: 0 0 200px; }
  .cmd-intent { flex: 1; }
  .cmd-outcome { flex: 1; }
  .cmd-minutes { flex: 0 0 96px; text-align: center; }
  .cmd-go { flex: 0 0 120px; font-size: 16px; }

  /* The single dominant focal point. */
  .focus-zone {
    padding: 28px;
    border: 2px solid var(--text, #1b1b1f);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.10);
    display: flex; flex-direction: column; gap: 20px;
  }
  .focus-grid { display: grid; grid-template-columns: 132px 1fr; gap: 24px; align-items: center; }
  .focus-meta { min-width: 0; }
  .focus-meta h1 { font-size: 30px; line-height: 1.15; margin: 4px 0 6px; word-break: break-word; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.09em; font-size: 11px; font-weight: 600; opacity: 0.55; margin: 0; }
  .focus-entity { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; opacity: 0.6; margin: 0; word-break: break-all; }
  .focus-predict { margin: 8px 0 0; font-size: 14px; opacity: 0.8; }

  /* The depleting time ring: the arc shrinks as the estimate is used up. */
  .clock { position: relative; width: 132px; height: 132px; }
  .clock svg { width: 132px; height: 132px; }
  .clock-track { fill: none; stroke: var(--line, #e3e8e2); stroke-width: 10; }
  .clock-arc { fill: none; stroke: var(--accent, #246b58); stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.6s linear; }
  .clock.over .clock-arc { stroke: #c0392b; }
  .clock-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .clock-center strong { font-size: 16px; font-variant-numeric: tabular-nums; }
  .clock.over .clock-center strong { color: #c0392b; }
  .clock-center span { font-size: 11px; opacity: 0.55; font-variant-numeric: tabular-nums; margin-top: 2px; }

  .focus-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .focus-actions .big { padding: 12px 28px; font-size: 16px; }
  .focus-actions .danger { margin-left: auto; }

  .focus-note { display: flex; gap: 10px; align-items: flex-start; }
  .focus-note textarea { flex: 1; padding: 11px 14px; font-size: 14px; background: #fff; color: var(--text, #14231b); border: 1px solid var(--line, #d4dcd2); border-radius: 11px; resize: vertical; box-sizing: border-box; font-family: inherit; }
  .focus-note textarea::placeholder { color: var(--muted, #98a39a); }
  .focus-notes { margin: 0; padding-left: 20px; opacity: 0.85; font-size: 14px; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
  .focus-notes li { word-break: break-word; }
  .focus-empty, .bet-result { display: flex; flex-direction: column; gap: 8px; padding: 24px 0; }
  .focus-empty strong { font-size: 20px; }
  .focus-empty span { opacity: 0.6; }
  .bet-result h1 { font-size: 26px; margin: 6px 0; }
  .bet-line { font-size: 17px; }

  /* Scheduled change of focus: the highest-prominence element when due. */
  .checkin-band {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    padding: 18px 22px; border-radius: 14px;
    background: #fff7e6; border: 2px solid #f5a623;
    box-shadow: 0 8px 28px rgba(245, 166, 35, 0.30);
  }
  .checkin-text { display: flex; flex-direction: column; gap: 3px; }
  .checkin-text span { font-size: 13px; opacity: 0.7; }

  /* Waiting + timeline: quiet, subordinate. */
  .waiting h2, .timeline h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.5; margin: 0 0 10px; font-weight: 600; }
  .incoming-item { border: 1px solid var(--color-border, #e3e3e6); border-radius: 11px; margin-bottom: 8px; background: var(--color-surface-raised, #fff); }
  .incoming-item.due { border-color: #f5a623; background: #fffaf0; }
  .incoming-select { display: flex; justify-content: space-between; width: 100%; padding: 13px 15px; background: none; border: none; gap: 12px; text-align: left; }
  .incoming-name { font-weight: 500; }
  .incoming-status { opacity: 0.6; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .timeline-track { display: flex; gap: 3px; height: 30px; }
  .timeline-seg { flex: var(--len) 1 0; min-width: 10px; background: #e3efe9; color: var(--accent, #246b58); border-radius: 6px; font-size: 10px; overflow: hidden; padding: 3px 6px; white-space: nowrap; text-overflow: ellipsis; }

  .rollup-text { width: 100%; font-family: var(--tangent-font-mono, ui-monospace, monospace); font-size: 13px; white-space: pre-wrap; padding: 16px; max-height: 320px; overflow: auto; margin: 0; box-sizing: border-box; color: var(--text, #14231b); }
  .notice { padding: 11px 14px; border-radius: 10px; background: #fdecea; color: #611a15; }
</style>
