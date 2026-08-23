import areaMapCore from "./area-map-core.js";
import areaMapView from "./area-map.js";
import { clip, escapeHtml } from "./text-format.js";

/** Creates the area directory view product boundary. */
export function createAreaDirectoryView({ state, api, post, paint, showToast, screen, openDocument, selectGoal, allGoals, goalTrees, goalTreeState, goalTreeIsActive, goalByFile, goalNeedsYou, goalWorkFinished, sessionForGoal, brainForAreaCard, brainStateLabel, brainKind, humanName, areaLabel, areaPath, agentName, ageText, deskBrainButton, workCard, goalTreeCard, programRow, programKind, programIsLive }) {
  /** Returns the Areas visible to the directory. */
  function areas() {
    return [...(state.vault?.areas ?? [])]
      .filter((area) => area.path && (state.showDoneAreas || !areaIsFolded(area.path)))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Every Area the vault knows, done ones included. */
  function allAreas() {
    return [...(state.vault?.areas ?? [])].filter((area) => area.path);
  }

  /** True when a done Area folds this path away: itself or an ancestor is done, and it is not the selected Area. */
  function areaIsFolded(path) {
    if (path === state.areaSelection) return false;
    const done = new Set(allAreas().filter((area) => area.status === "done").map((area) => area.path));
    const parts = String(path).split("/");
    return parts.some((part, index) => done.has(parts.slice(0, index + 1).join("/")));
  }

  /** Sets an Area's status on Julian's word and offers Undo. */
  async function setAreaStatus(area, status) {
    const result = await api("/api/areas/status", { method: "POST", body: JSON.stringify({ area, status }) }).catch(() => null);
    if (!result || result.error) return showToast(result?.error || "The Area status did not save.");
    await refresh();
    if (status === "done") {
      const kept = result.openGoals ? ` ${result.openGoals} open ${result.openGoals === 1 ? "Goal stays" : "Goals stay"} open and hidden.` : "";
      /** Undo puts the Area back to active. */
      const undo = () => setAreaStatus(area, "active");
      showToast(`${humanName(area.split("/").pop())} is done.${kept}`, { label: "Undo", run: undo });
    } else {
      /** Undo marks the Area done again. */
      const undo = () => setAreaStatus(area, "done");
      showToast(`${humanName(area.split("/").pop())} is active again.`, { label: "Undo", run: undo });
    }
    paint(true);
  }

  /** Returns the selected area when it still exists. */
  function selectedArea() {
    return areas().find((area) => area.path === state.areaSelection) ?? areas()[0] ?? null;
  }

  /** Returns the parent path of one area, or an empty root marker. */
  function areaParent(path) {
    return String(path ?? "").split("/").slice(0, -1).join("/");
  }

  /** Builds the collapsible Area tree. */
  function areaTreeRows() {
    const areaItems = areas();
    const byPath = new Map(areaItems.map((area) => [area.path, area]));
    const relevant = new Set(areaItems.map((area) => area.path));
    const children = new Map();
    for (const path of relevant) {
      const parent = relevant.has(areaParent(path)) ? areaParent(path) : "";
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(path);
    }
    for (const list of children.values()) list.sort((left, right) => left.localeCompare(right));

    /** Renders one area and its expanded children. */
    const branch = (path, depth) => {
      const area = byPath.get(path);
      const childPaths = children.get(path) || [];
      const expandable = childPaths.length > 0;
      const expanded = expandable && state.expandedAreas.has(path);
      const selected = selectedArea()?.path === path;
      const row = `
        <div class="area-tree-row ${selected ? "selected" : ""}" style="--area-depth:${depth}">
          ${expandable
            ? `<button class="area-toggle" type="button" data-toggle-area="${escapeHtml(path)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(humanName(area.name))}"><span aria-hidden="true">${expanded ? "▾" : "▸"}</span></button>`
            : `<span class="area-toggle-spacer" aria-hidden="true"></span>`}
          <button class="area-row ${area.status === "done" ? "done" : ""}" type="button" data-select-area="${escapeHtml(path)}"><span>${escapeHtml(humanName(area.name))}</span><small>${escapeHtml(path)}</small>${area.status === "done" ? `<span class="area-row-mark done">done</span>` : ""}${areaProgramMark(path, expanded)}</button>
        </div>`;
      if (!expanded) return row;
      return row + childPaths.map((child) => branch(child, depth + 1)).join("");
    };
    const doneCount = allAreas().filter((area) => area.status === "done").length;
    const doneToggle = doneCount
      ? `<button class="area-tree-done-toggle" type="button" data-toggle-done-areas aria-pressed="${state.showDoneAreas}">${state.showDoneAreas ? "Hide" : "Show"} ${doneCount} done ${doneCount === 1 ? "Area" : "Areas"}</button>`
      : "";
    return (children.get("") || []).map((root) => branch(root, 0)).join("") + doneToggle;
  }

  /**
   * Marks the Area rows that carry running Programs or a broken Program file.
   * The tree is the only place a Program in another Area can announce itself
   * now that the Programs tab is gone, so a collapsed row counts its whole
   * subtree.
   */
  function areaProgramMark(path, expanded) {
    /** True while one Program or problem belongs to the counted scope. */
    const inScope = (value) => value === path || (!expanded && value.startsWith(`${path}/`));
    const live = state.programs.programs.filter((program) => inScope(program.area) && programIsLive(program)).length;
    const broken = state.programs.errors.some((item) => inScope(item.area));
    if (live) return `<span class="area-row-mark live">${live} running</span>`;
    if (broken) return `<span class="area-row-mark warn">Program problem</span>`;
    return "";
  }

  /** Renders one Area Goal with its current brief. */
  function areaGoalRow(goal) {
    return `
      <button type="button" data-select-goal="${escapeHtml(goal.file)}">
        <span class="area-goal-main"><strong>${escapeHtml(goal.title)}</strong><small>${escapeHtml(clip(goal.doneWhen, 150))}</small></span>
        <span class="area-goal-brief"><em>Current brief</em><small>${escapeHtml(currentBriefFields(goal).wanted)}</small></span>
      </button>`;
  }

  /** The desk's word for one Goal: waiting (needs Julian), working (an agent runs), or ready. */
  function goalAttention(goal) {
    const projected = state.vault?.desk?.attention?.[goal.file];
    if (projected) return projected;
    const session = sessionForGoal(goal);
    if (goalNeedsYou(goal) || ["waiting", "shell"].includes(session?.state)) return "waiting";
    if (session) return "working";
    return "ready";
  }

  /** Desk order of Goal trees by their root's attention, then latest change (design-area-map Decision 2). */
  function orderedGoalTrees(trees) {
    const byRoot = new Map(trees.map((tree) => [tree.root.file, tree]));
    return areaMapCore.orderGoals(trees.map((tree) => tree.root), goalAttention).map((root) => byRoot.get(root.file));
  }

  /** Fetches the stored map state of one Area once; the map mounts again when it arrives. */
  function loadMapState(area) {
    if (state.mapStates.has(area)) return;
    state.mapStates.set(area, "loading");
    api(`/api/map-state?area=${encodeURIComponent(area)}`)
      .then((payload) => state.mapStates.set(area, payload?.state ?? {}))
      .catch(() => state.mapStates.set(area, {}))
      .then(() => { const host = [...screen.querySelectorAll("[data-area-map]")].find((element) => element.dataset.areaMap === area); if (host) mountAreaMap(host); });
  }

  /**
   * Mounts the Area map into its host after a repaint. The map keeps its own
   * DOM, positions, and filters across repaints (see public/area-map.js); this
   * only hands it the current facts and the shell's routes.
   */
  function mountAreaMap(host) {
    const view = areaMapView;
    const area = host.dataset.areaMap;
    if (!view || !area || !state.vault) return;
    loadMapState(area);
    const stored = state.mapStates.get(area);
    const selectFile = state.mapSelectFile;
    state.mapSelectFile = "";
    /** The readable name of an Area path. */
    const areaName = (path) => humanName(String(path).split("/").pop());
    /** A short date for the card. */
    const dateLabel = (at) => (at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
    /** The desk word for a Goal record. */
    const attentionOf = (record) => goalAttention(goalByFile(record.file) ?? record);
    /** Opens a Document in the reader. */
    const onOpenDocument = (file) => openDocument(file);
    /** Opens a Goal. */
    const onSelectGoal = (file) => selectGoal(file);
    /** Moves the map to another Area. */
    const onSelectArea = (path) => { state.areaSelection = path; localStorage.setItem("agent-shell.last-area", path); revealArea(path); paint(true); };
    /** Stores positions and filters for this Area outside the vault. */
    const onSaveState = (mapState) => {
      state.mapStates.set(area, mapState);
      api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state: mapState }) }).catch(() => {});
    };
    view.mount(host, {
      scope: area,
      records: state.vault.documents ?? [],
      areaPaths: areas().map((item) => item.path),
      now: Date.now(),
      timezoneOffset: new Date().getTimezoneOffset(),
      areaName, dateLabel, attentionOf,
      mapState: stored === "loading" ? null : stored,
      selectFile,
      onOpenDocument, onSelectGoal, onSelectArea, onSaveState,
    });
  }

  /** Renders the Area map screen: header, the map host, and the Area's Programs. */
  function areaContents(area) {
    const programs = state.programs.programs.filter((program) => program.area === area.path);
    const problems = state.programs.errors.filter((item) => item.area === area.path);
    const done = area.status === "done";
    const current = clip(area.current ?? "", 240);
    return `
      <section class="area-contents area-map-screen ${done ? "area-done" : ""}">
        <header class="area-contents-heading">
          <div>
            ${areaPath(area.path)}
            <h2>${escapeHtml(humanName(area.name))}${area.status ? `<span class="area-status ${escapeHtml(area.status)}">${escapeHtml(area.status)}</span>` : ""}</h2>
            ${area.purpose ? `<p class="area-purpose">${escapeHtml(area.purpose)}</p>` : ""}
            ${current ? `<p class="area-current">${escapeHtml(current)}</p>` : ""}
          </div>
          <div class="area-contents-actions">
            <button class="quiet-button" type="button" data-describe-area="${escapeHtml(area.path)}">Describe work</button>
            <button class="quiet-button" type="button" data-new-area>Add nested Area</button>
            ${area.path.split("/").length > 1 ? `<button class="quiet-button" type="button" data-rename-area>Rename or move</button>` : ""}
            <span class="area-contents-actions-spacer"></span>
            ${done
              ? `<button class="quiet-button" type="button" data-reopen-area="${escapeHtml(area.path)}">Reopen</button>`
              : `<button class="quiet-button" type="button" data-mark-area-done="${escapeHtml(area.path)}">Mark done</button>`}
          </div>
        </header>
        <div class="area-map-host" data-area-map="${escapeHtml(area.path)}"></div>
        <section class="area-content-section">
          <div class="memory-heading">
            <div><p class="kicker">Programs</p><h3>${programs.length} ${programs.length === 1 ? "Program" : "Programs"}</h3></div>
            <button class="quiet-button" type="button" data-new-program>New program</button>
          </div>
          ${programs.length
            ? `<div class="program-list">${programs.map(programRow).join("")}</div>`
            : `<p class="memory-empty">No Programs exist in this Area. Servers, commands, and daily agents belong here.</p>`}
          ${problems.length ? `<details class="program-errors"><summary>${problems.length} configuration ${problems.length === 1 ? "problem" : "problems"}</summary>${problems.map((item) => `<p>${escapeHtml(item.file)} — ${escapeHtml(item.error)}</p>`).join("")}</details>` : ""}
        </section>
      </section>`;
  }

  /** Renders the Area hierarchy and the contents of the selected Area. */
  function renderAreas() {
    const selected = selectedArea();
    const rows = areaTreeRows();
    return `
      <section class="areas-page">
        <header class="surface-heading">
          <div><p class="kicker">Areas</p><h1>Where work belongs</h1><p>Choose an Area. Change it only when you need to.</p></div>
        </header>
        <div class="area-layout">
          <div class="area-browser">${rows || `<div class="empty-state">No areas exist.</div>`}</div>
          ${selected ? areaContents(selected) : ""}
        </div>
      </section>`;
  }

  /** Renders valid destination parents for one area edit. */
  function areaParentOptions(selected, source = "") {
    return areas()
      .filter((area) => !source || (area.path !== source && !area.path.startsWith(`${source}/`)))
      .map((area) => `<option value="${escapeHtml(area.path)}" ${area.path === selected ? "selected" : ""}>${escapeHtml(areaLabel(area.path))}</option>`)
      .join("");
  }

  /** Renders area creation, rename, or move with an exact preview. */
  function renderAreaEditor() {
    const edit = state.areaEdit;
    if (!edit) return renderAreas();
    const moving = edit.kind === "move";
    const preview = edit.preview;
    return `
      <article class="create-page area-edit-page">
        <p class="kicker">${moving ? "Rename or move" : "New area"}</p>
        <h1>${moving ? escapeHtml(areaLabel(edit.area)) : "Add one area"}</h1>
        <p class="create-lede">${moving ? "Review every affected path before anything moves." : "Put the area under the area that gives it meaning."}</p>
        <form class="create-form" data-area-form data-command-enter-submit>
          <label><span>Inside Area</span><select name="parent" required>${areaParentOptions(edit.parent, moving ? edit.area : "")}</select></label>
          <label><span>Name</span><input name="name" value="${escapeHtml(edit.name)}" required autocomplete="off" /></label>
          ${preview ? `
            <section class="path-preview">
              <p class="kicker">Path preview</p>
              <ul>${preview.changedPaths.map((item) => `<li><span>${escapeHtml(item.from)}</span><strong>→</strong><span>${escapeHtml(item.to)}</span></li>`).join("")}</ul>
            </section>` : ""}
          <div class="create-actions">
            ${preview ? `<button class="primary-button" type="button" data-confirm-area-move>Move area</button>` : `<button class="primary-button" type="submit">${moving ? "Preview change" : "Create area"} <kbd>⌘↵</kbd></button>`}
            <button class="quiet-button" type="button" data-cancel-area-edit>Cancel</button>
          </div>
          <p class="form-note">${moving ? "Live sessions follow the new path. Pending vault edits must be saved first." : "This creates an empty area. It does not start work."}</p>
        </form>
      </article>`;
  }

  /** Returns one program by its stable UI identity. */

  return { areas, allAreas, areaIsFolded, setAreaStatus, selectedArea, areaParent, areaTreeRows, areaProgramMark, areaGoalRow, goalAttention, orderedGoalTrees, loadMapState, mountAreaMap, areaContents, renderAreas, areaParentOptions, renderAreaEditor };
}
