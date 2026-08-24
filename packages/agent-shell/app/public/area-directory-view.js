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

  /** Areas that match the browser query, plus their ancestors for context. */
  function filteredAreas() {
    const source = areas();
    const query = state.areaQuery.trim().toLowerCase();
    if (!query) return source;
    const keep = new Set();
    for (const area of source) {
      if (!`${humanName(area.name)} ${area.path}`.toLowerCase().includes(query)) continue;
      const parts = area.path.split("/");
      for (let count = 1; count <= parts.length; count += 1) keep.add(parts.slice(0, count).join("/"));
    }
    return source.filter((area) => keep.has(area.path));
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
    const areaItems = filteredAreas();
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
    const planned = goalTrees().filter((tree) => tree.path === area.path && goalTreeState(tree) !== "closed" && !goalTreeIsActive(tree));
    const documents = areaDocuments(area.path);
    const brain = brainForAreaCard(area.path);
    const brainClass = brainKind(brain);
    const brainAction = `<button class="primary-button area-brain ${escapeHtml(brainClass)}" type="button" data-open-area-brain="${escapeHtml(area.path)}" data-brain-area="${escapeHtml(area.path)}">${brain?.live ? "Open brain" : brain ? "Resume brain" : "Start brain"}</button>`;
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
            <span class="area-brain-state ${escapeHtml(brainKind(brain))}">${escapeHtml(brainStateLabel(brain))}</span>
            ${brainAction}
          </div>
        </header>
        <section class="area-workspace-section" aria-labelledby="area-not-started">
          <div class="area-section-heading"><div><p class="kicker">Work</p><h3 id="area-not-started" tabindex="-1">Not started</h3></div><span>${planned.length}</span></div>
          ${planned.length ? `<div class="area-planned-list">${planned.map((tree) => goalTreeCard(tree)).join("")}</div>` : `<p class="memory-empty">No not-started work exists in this Area.</p>`}
        </section>
        ${documentSection(area.path, documents)}
        <details class="area-more"><summary>More</summary>
          <details><summary>Relationship map</summary><div class="area-map-host" data-area-map="${escapeHtml(area.path)}"></div></details>
          <details><summary>Programs · ${programs.length}</summary><section class="area-content-section"><div class="memory-heading"><h3>Programs</h3><button class="quiet-button" type="button" data-new-program>New program</button></div>${programs.length ? `<div class="program-list">${programs.map(programRow).join("")}</div>` : `<p class="memory-empty">No Programs exist in this Area.</p>`}${problems.length ? `<div class="program-errors">${problems.map((item) => `<p>${escapeHtml(item.file)} — ${escapeHtml(item.error)}</p>`).join("")}</div>` : ""}</section></details>
          <details><summary>Area settings</summary><div class="area-settings-actions"><button class="quiet-button" type="button" data-new-area>Add nested Area</button>${area.path.split("/").length > 1 ? `<button class="quiet-button" type="button" data-rename-area>Rename or move</button>` : ""}${done ? `<button class="quiet-button" type="button" data-reopen-area="${escapeHtml(area.path)}">Reopen</button>` : `<button class="quiet-button" type="button" data-mark-area-done="${escapeHtml(area.path)}">Mark done</button>`}</div></details>
        </details>
      </section>`;
  }

  /** Applies the Area's Document query, type, date, and order controls. */
  function areaDocuments(path) {
    const query = state.areaDocumentQuery.trim().toLowerCase();
    const cutoffDays = { today: 1, week: 7, month: 30 }[state.areaDocumentPeriod];
    const cutoff = cutoffDays ? Date.now() - cutoffDays * 86_400_000 : 0;
    const documents = (state.vault?.documents ?? []).filter((item) => item.kind === "document" && item.area === path)
      .filter((item) => !query || `${item.title} ${item.file}`.toLowerCase().includes(query))
      .filter((item) => !state.areaDocumentOnly || (item.docKind ?? "page") === state.areaDocumentOnly)
      .filter((item) => !state.areaDocumentExcluded.has(item.docKind ?? "page"))
      .filter((item) => !cutoff || Number(item.changedAt ?? item.mtime ?? 0) >= cutoff);
    const direction = state.areaDocumentOrder === "oldest" ? 1 : -1;
    return documents.sort((left, right) => direction * (Number(left.changedAt ?? left.mtime ?? 0) - Number(right.changedAt ?? right.mtime ?? 0)));
  }

  /** Renders the filtered Document inventory for one Area. */
  function documentSection(path, documents) {
    const kinds = [...new Set((state.vault?.documents ?? []).filter((item) => item.kind === "document" && item.area === path).map((item) => item.docKind ?? "page"))].sort();
    const controls = kinds.map((kind) => {
      const included = state.areaDocumentOnly ? state.areaDocumentOnly === kind : !state.areaDocumentExcluded.has(kind);
      return `<span class="area-kind-control"><label title="Include or exclude ${escapeHtml(humanName(kind))}"><input type="checkbox" data-area-kind-toggle="${escapeHtml(kind)}" ${included ? "checked" : ""}><span aria-hidden="true"></span></label><button type="button" data-area-kind-only="${escapeHtml(kind)}" aria-pressed="${state.areaDocumentOnly === kind}" title="Show only ${escapeHtml(humanName(kind))}">${escapeHtml(humanName(kind))}</button></span>`;
    }).join("");
    return `<section class="area-workspace-section area-documents" aria-labelledby="area-documents-heading"><div class="area-section-heading"><div><p class="kicker">Knowledge</p><h3 id="area-documents-heading">Documents</h3></div><span>${documents.length}</span></div><div class="area-document-tools"><input id="area-document-search" type="search" value="${escapeHtml(state.areaDocumentQuery)}" placeholder="Filter Documents" aria-label="Filter Documents"><select id="area-document-period" aria-label="Modified date"><option value="any" ${state.areaDocumentPeriod === "any" ? "selected" : ""}>Any time</option><option value="today" ${state.areaDocumentPeriod === "today" ? "selected" : ""}>Today</option><option value="week" ${state.areaDocumentPeriod === "week" ? "selected" : ""}>7 days</option><option value="month" ${state.areaDocumentPeriod === "month" ? "selected" : ""}>30 days</option></select><select id="area-document-order" aria-label="Document order"><option value="newest" ${state.areaDocumentOrder === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${state.areaDocumentOrder === "oldest" ? "selected" : ""}>Oldest first</option></select></div><fieldset class="area-kind-filters"><legend>Type</legend>${controls}${kinds.length ? `<button class="area-filter-reset" type="button" data-area-kind-reset>All types</button>` : ""}</fieldset>${documents.length ? `<div class="document-list">${documents.map((item) => `<button class="document-row" type="button" data-open-document="${escapeHtml(item.file)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(humanName(item.docKind ?? "page"))} · ${escapeHtml(item.file)}</small></span><span>${item.changedAt || item.mtime ? new Date(item.changedAt ?? item.mtime).toLocaleDateString() : ""}</span></button>`).join("")}</div>` : `<p class="memory-empty">No Documents match these filters.</p>`}</section>`;
  }

  /** Renders the Area hierarchy and the contents of the selected Area. */
  function renderAreas() {
    const selected = selectedArea();
    const rows = areaTreeRows();
    return `
      <section class="areas-page area-browser-page">
        <div class="area-layout">
          <aside class="area-browser"><label class="area-search-label" for="area-search">Find an Area</label><input id="area-search" type="search" value="${escapeHtml(state.areaQuery)}" placeholder="Type an Area name or path" autocomplete="off">${rows || `<div class="empty-state">No Areas match “${escapeHtml(state.areaQuery)}”.</div>`}</aside>
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
