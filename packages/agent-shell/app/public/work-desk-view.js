import areaMapCore from "./area-map-core.js";
import goalCardCore from "./goal-card-core.js";
import areaWorkCore from "./area-work-core.js";
import goToCore from "./go-to-core.js";
import { cleanText, clip, escapeHtml, progressPoints } from "./text-format.js";
import { isInAreaFocus, normalizeAreaFocus, reconcileAreaFocus, toggleAreaFocusRoot, writeAreaFocus } from "./area-focus-core.js";
import { workCommand, workCaptionKeys, workRowKind } from "./work-commands.js";

const PRESENTED_ROWS_PER_GOAL = 3;

/** Creates the work desk from shell, launch, Area, and Program capabilities. */
export function createWorkDeskView({ shell, launch, areaModel, programs, chrome }) {
  const { state, api, post, paint, refresh, showToast, openModal, captureReturnPoint, saveDescribeSession, openSessionLayer, updateAreaMapFocus = null } = shell;
  const {
    launchSelection, launchRequestFields, syncLaunchDraft, preferredArea, launchOptionsFor, pipelineForGoal,
    pipelineRecordForGoal, launchPopover, DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  } = launch;
  const { areas, allAreas, orderedGoalTrees } = areaModel;
  const { programRowControls, programIsLive, programState, localMoment } = programs;
  const { shortcutKbd, whatHappenedOverlay } = chrome;
  const openingBrains = new Set();

  /** Repaints Focus in place while the persistent Area-map world is mounted. */
  function repaintFocus() {
    if (!updateAreaMapFocus?.()) paint(true);
  }

  /**
   * The Area note that Enter on an Area row opens: `neara/neara.md` for
   * `neara`, `neara/portland/portland.md` for `neara/portland`. The server
   * names it the same way, and serves a fresh note when none exists yet.
   */
  function areaNoteFile(area) {
    return `${area}/${area.split("/").pop()}.md`;
  }

  /** Shared command attributes teach the same shortcut on every pointer. */
  function workCommandAttributes(id, title = "") {
    const command = workCommand(id);
    if (!command) return "";
    const tooltip = title || `${command.help} (${command.keyDisplay})`;
    return `data-work-command="${escapeHtml(id)}"${command.ariaKeyshortcuts ? ` aria-keyshortcuts="${escapeHtml(command.ariaKeyshortcuts)}"` : ""} title="${escapeHtml(tooltip)}"`;
  }

  /** Visible command label plus its taught key. */
  function workCommandContent(id, label = "") {
    const command = workCommand(id);
    return command ? `${escapeHtml(label || command.label)} <kbd>${escapeHtml(command.keyDisplay)}</kbd>` : "";
  }
  /** The taught key of one command as the one `kbd` style every Work button prints. */
  function workKey(id) {
    const command = workCommand(id);
    return command ? `<kbd aria-hidden="true">${escapeHtml(command.keyDisplay)}</kbd>` : "";
  }

  /**
   * The one fold glyph in Work: a triangle at the far left of the row that
   * rotates (work-view-affordances D1). Click toggles; `h` and `l` stay the
   * keys, printed in the caption line, never inside the triangle.
   */
  function workFoldTriangle({ open, area = "", goal = "", name }) {
    const command = open ? "collapse" : "expand";
    const target = goal ? `data-work-tree-goal="${escapeHtml(goal)}"` : `data-work-tree-area="${escapeHtml(area)}"`;
    return `<button class="work-fold" type="button" data-work-tree-action="${command}" ${target} aria-expanded="${open}" ${workCommandAttributes(command)} aria-label="${escapeHtml(workCommand(command).label)}: ${escapeHtml(name)}"><span aria-hidden="true">${open ? "▾" : "▸"}</span></button>`;
  }

  /** Keeps titles aligned on rows that have nothing to fold. */
  const WORK_FOLD_SPACE = `<span class="work-fold-space" aria-hidden="true"></span>`;

  /** Returns every Goal represented in the current desk projection. */
  function allGoals() {
    const byFile = new Map();
    for (const group of state.vault?.map ?? []) {
      for (const goal of group.goals ?? []) byFile.set(goal.file, goal);
    }
    return [...byFile.values()];
  }

  /** Retains the vault's area grouping for a selected goal subset. */
  function goalGroups(goals) {
    const rank = new Map(goals.map((goal, index) => [goal.file, index]));
    return (state.vault?.map ?? [])
      .map((group) => ({
        ...group,
        goals: (group.goals ?? []).filter((goal) => rank.has(goal.file)),
      }))
      .filter((group) => group.goals.length)
      .sort((a, b) => {
        const aRank = Math.min(...a.goals.map((goal) => rank.get(goal.file)));
        const bRank = Math.min(...b.goals.map((goal) => rank.get(goal.file)));
        return aRank - bRank;
      });
  }

  /** Splits the ordered vault projection into user-selectable Goal trees. */
  function goalTrees() {
    const trees = [];
    for (const group of state.vault?.map ?? []) {
      let tree = null;
      for (const goal of group.goals ?? []) {
        if (!tree || Number(goal.depth || 0) === 0) {
          tree = { path: group.path, root: goal, goals: [goal] };
          trees.push(tree);
        } else {
          tree.goals.push(goal);
        }
      }
    }
    return trees;
  }

  /**
   * Places one complete work tree in a single attention group. A tree in an Area
   * a live brain runs is never "waiting": what waits on Julian there is the
   * brain's own list, so the tree does not sort in front of it.
   */
  function goalTreeState(tree) {
    const openGoals = tree.goals.filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status));
    if (!openGoals.length) return "closed";
    const covered = goalCoveredByBrain(tree.root);
    const sessions = openGoals.map(sessionForGoal).filter(Boolean);
    if (sessions.some((session) => ["waiting", "shell"].includes(session.state))) return covered ? "open" : "waiting";
    if (sessions.some((session) => session.state === "working")) return "working";
    if (sessions.length) return "open";
    if (openGoals.some(goalNeedsYou)) return "waiting";
    return "ready";
  }

  /** True when any open Goal in one complete Goal tree owns a live session. */
  function goalTreeIsActive(tree) {
    return tree.goals.some((goal) => {
      if (["done", "dropped", "parked", "deferred"].includes(goal.status)) return false;
      if (sessionForGoal(goal)) return true;
      return Boolean(pipelineRecordForGoal(goal)?.steps?.some((step) => ["running", "stopped"].includes(step.status)));
    });
  }

  /** Applies the selected session-presence filter without splitting Goal trees. */
  function filteredGoalTrees(trees) {
    // A finished result stays in the live table until Julian accepts it, so an
    // open Test keeps its Goal current, on the durable Request or the legacy
    // plan line (design-redesign-work-as-a-compact-table, "Problem contract").
    const readyForYou = new Set((state.brains ?? []).flatMap((brain) => [
      ...(brain.forJulian ?? []).filter((row) => row.kind === "test").map((row) => row.file),
      ...(brain.requests ?? []).filter((request) => request.status === "open" && request.kind === "test").map((request) => request.subjectRef?.goal ?? request.goal),
    ]).filter(Boolean));
    /** Returns whether any Goal in the tree is current. */
    const isCurrent = (tree) => tree.goals.some((goal) => {
      if (sessionForGoal(goal) || goalNeedsYou(goal) || readyForYou.has(goal.file)) return true;
      return Boolean(pipelineRecordForGoal(goal)?.steps?.some((step) => ["running", "stopped"].includes(step.status)));
    });
    return state.workFilter === "active" ? trees.filter(isCurrent)
      : state.workFilter === "inactive" ? trees.filter((tree) => !isCurrent(tree)) : trees;
  }

  /** Stores the expansion state of the Area tree. */
  function saveExpandedAreas() {
    localStorage.setItem("agent-shell.expanded-areas", JSON.stringify([...state.expandedAreas].sort()));
  }

  /** Returns the normalized Area roots that currently scope Work. */
  function areaFocusRoots() {
    return normalizeAreaFocus(state.areaFocus);
  }

  /** Returns the complete Area records that the Focus picker can select. */
  function focusAreaRecords() {
    return allAreas().filter((area) => area.path).sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Returns the short labels for selected Area roots. */
  function areaFocusLabels(paths = areaFocusRoots()) {
    const byPath = new Map(focusAreaRecords().map((area) => [area.path, area]));
    return paths.map((path) => humanName(byPath.get(path)?.name ?? path.split("/").at(-1)));
  }

  /** Stores the applied Focus without changing any durable work record. */
  function persistAreaFocus() {
    if (!state.areaFocus.length) state.areaFocusOnly = false;
    const saved = writeAreaFocus(localStorage, state.areaFocus, state.areaFocusOnly);
    state.areaFocusStorageError = !saved;
    if (!saved) showToast(state.areaFocus.length
      ? "Area Focus changed only for this tab. Reload can restore the prior Work scope."
      : "Focus cleared only for this tab. Reload can restore the prior Focus.");
  }

  /**
   * Stars or unstars one Area from its row (design area-star-focus, Decision
   * 1). The cursor names its row by path, so it survives the reorder. When
   * the row leaves the desk (unstar while only starred Areas show) the cursor
   * moves to the nearest row that stays (Decision 8).
   */
  function toggleAreaStar(path) {
    const result = toggleAreaFocusRoot(state.areaFocus, path);
    if (result.change === "insideAncestor") return showToast(`Inside starred ${areaLabel(result.ancestor)}. Unstar ${areaLabel(result.ancestor)} first.`);
    if (result.change === "none") return showToast("Choose an Area row first.");
    if (result.change === "removed" && state.areaFocusOnly) moveCursorOffArea(path);
    state.areaFocus = result.roots;
    persistAreaFocus();
    repaintFocus();
    showToast(result.change === "added" ? `Starred ${areaLabel(path)}.` : `Unstarred ${areaLabel(path)}.`);
    return focusWorkCursor();
  }

  /** Shows only the starred Areas, or every Area again (Decision 2). */
  function toggleStarredOnly() {
    if (!areaFocusRoots().length) return showToast("Star an Area first with f.");
    state.areaFocusOnly = !state.areaFocusOnly;
    const cursorArea = commandAreaOfCursor();
    if (state.areaFocusOnly && cursorArea && !isInAreaFocus(cursorArea, areaFocusRoots())) moveCursorOffArea(cursorArea);
    persistAreaFocus();
    repaintFocus();
    return focusWorkCursor();
  }

  /**
   * Shows only the active little brains and their running work, or every
   * Area again (Julian, 2026-08-28: "shift A to focus the active little
   * brains and work, similar to shift F"). Active means a live brain, a live
   * agent on a Goal, or a Describe session; a Goal that merely waits on
   * Julian is not active.
   */
  function toggleActiveOnly() {
    state.activeOnly = !state.activeOnly;
    const cursorArea = commandAreaOfCursor();
    if (state.activeOnly && cursorArea && !activeAreas().has(cursorArea)) moveCursorOffArea(cursorArea);
    try { localStorage.setItem("agent-shell.active-only", String(state.activeOnly)); } catch { /* the switch still works for this page */ }
    repaintFocus();
    return focusWorkCursor();
  }

  /**
   * The Areas that own something live right now: a live brain, a Goal tree
   * with a live agent or a running pipeline step, or a Describe session.
   * Ancestors are not included; the desk nests a live sub-Area under its
   * parent header on its own.
   */
  function activeAreas() {
    const paths = new Set();
    for (const brain of state.brains ?? []) if (brain.status === "active" && brain.live) paths.add(brain.area);
    for (const tree of goalTrees()) if (goalTreeIsActive(tree)) paths.add(tree.path);
    for (const session of describeWorkSessions()) if (session.area) paths.add(session.area);
    for (const item of state.programs.processes ?? []) {
      if (item.loop && item.status === "active" && !item.error) paths.add(item.area);
    }
    return paths;
  }

  /** The valid active loops owned by one exact Area. */
  function activeLoopsForArea(areaPath) {
    return (state.programs.processes ?? []).filter((item) => item.area === areaPath && item.loop === true && item.status === "active" && !item.error);
  }

  /** Active and paused process notes owned by one exact Area. */
  function areaProcessesForArea(areaPath) {
    return (state.programs.processes ?? []).filter((item) => item.area === areaPath && ["active", "paused"].includes(item.status));
  }

  /** The Area that owns the current cursor row, read from the painted desk. */
  function commandAreaOfCursor() {
    const row = document.querySelector("[data-work-cursor].cursor");
    return row?.closest("tbody[data-work-group]")?.dataset.workGroup ?? "";
  }

  /** Moves the cursor to the row after one Area's group, or the row before it. */
  function moveCursorOffArea(path) {
    const rows = [...document.querySelectorAll("[data-work-cursor]")].filter((row) => !row.hidden);
    const index = rows.findIndex((row) => row.classList.contains("cursor"));
    if (index < 0) return;
    const group = rows[index].closest("tbody[data-work-group]");
    const after = rows.slice(index + 1).find((row) => row.closest("tbody[data-work-group]") !== group && !isInsideGroupOf(row, path));
    const before = rows.slice(0, index).reverse().find((row) => row.closest("tbody[data-work-group]") !== group && !isInsideGroupOf(row, path));
    const next = after ?? before;
    if (!next) return;
    state.workCursor = next.dataset.workCursor;
    localStorage.setItem("agent-shell.work-cursor", state.workCursor);
  }

  /** True when a row sits in the group of one Area path or of an Area below it. */
  function isInsideGroupOf(row, path) {
    const group = row.closest("tbody[data-work-group]")?.dataset.workGroup ?? "";
    return group === path || group.startsWith(`${path}/`);
  }

  /** Puts keyboard focus back on the cursor row after a paint. */
  function focusWorkCursor() {
    window.setTimeout(() => {
      const row = document.querySelector("[data-work-cursor].cursor [data-work-row-title], [data-work-cursor].cursor [data-work-cursor-control]");
      (row ?? document.querySelector("#work-tab"))?.focus();
      row?.scrollIntoView?.({ block: "nearest" });
    }, 0);
    return undefined;
  }

  /** Opens a staged copy of the applied Area Focus. */
  function openAreaFocusPicker() {
    state.areaFocusPicker = { query: "", areas: [...areaFocusRoots()] };
    paint(true);
    window.setTimeout(() => document.querySelector("#area-focus-search")?.focus(), 0);
  }

  /** Closes the picker without applying its staged selection. */
  function cancelAreaFocusPicker() {
    state.areaFocusPicker = null;
    paint(true);
    focusWorkCursor();
  }

  /** Adds or removes one staged Area root without changing the Work projection. */
  function toggleAreaFocusDraft(path, selected) {
    const picker = state.areaFocusPicker;
    if (!picker) return;
    const scrollTop = document.querySelector(".area-focus-options")?.scrollTop ?? 0;
    const paths = new Set(picker.areas);
    if (selected) paths.add(path);
    else paths.delete(path);
    picker.areas = [...paths].sort((left, right) => left.localeCompare(right));
    refreshAreaFocusPicker({ focusPath: path, scrollTop });
  }

  /** Filters the open picker while leaving the Work projection untouched. */
  function updateAreaFocusQuery(query, cursor = query.length) {
    if (!state.areaFocusPicker) return;
    state.areaFocusPicker.query = query;
    refreshAreaFocusPicker({ focus: true, cursor });
  }

  /** Replaces only the picker after a staged edit. */
  function refreshAreaFocusPicker({ focus = false, focusPath = "", cursor = 0, scrollTop = 0 } = {}) {
    const picker = document.querySelector("[data-area-focus-picker]");
    if (!picker || !state.areaFocusPicker) return;
    picker.outerHTML = areaFocusPickerMarkup();
    const options = document.querySelector(".area-focus-options");
    if (options) options.scrollTop = scrollTop;
    if (focusPath) {
      const checkbox = [...document.querySelectorAll("[data-area-focus-path]")]
        .find((input) => input.dataset.areaFocusPath === focusPath);
      checkbox?.focus();
      return;
    }
    if (focus) {
      const input = document.querySelector("#area-focus-search");
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    }
  }

  /** Applies every staged Area change in one Work rebuild. */
  function applyAreaFocus() {
    if (!state.areaFocusPicker) return;
    state.areaFocus = reconcileAreaFocus(state.areaFocusPicker.areas, focusAreaRecords().map((area) => area.path));
    state.areaFocusPicker = null;
    persistAreaFocus();
    paint(true);
    focusWorkCursor();
  }

  /** Clears the local scope and restores the complete Work projection. */
  function clearAreaFocus() {
    state.areaFocus = [];
    state.areaFocusOnly = false;
    state.areaFocusPicker = null;
    persistAreaFocus();
    paint(true);
    window.setTimeout(() => {
      const row = document.querySelector("[data-work-cursor].cursor [data-work-row-title], [data-work-cursor].cursor [data-work-cursor-control]");
      (row ?? document.querySelector("#work-tab"))?.focus();
    }, 0);
  }

  /** Renders the staged searchable multi-Area picker. */
  function areaFocusPickerMarkup() {
    const picker = state.areaFocusPicker;
    if (!picker) return "";
    const query = goToCore.normalizedSearchText(picker.query);
    const records = focusAreaRecords().filter((area) => !query || goToCore.normalizedSearchText(`${area.name} ${area.path}`).includes(query));
    const selected = new Set(picker.areas);
    const normalized = normalizeAreaFocus(picker.areas);
    const labels = areaFocusLabels(picker.areas);
    const action = normalized.length ? `Focus on ${normalized.length} ${normalized.length === 1 ? "Area" : "Areas"}` : "Show all Areas";
    return `<form class="area-focus-picker" data-area-focus-picker data-area-focus-form role="dialog" aria-labelledby="area-focus-title">
      <header><div><p class="kicker">Work scope</p><h2 id="area-focus-title">Focus Areas</h2></div><button type="button" data-cancel-area-focus aria-label="Close Area Focus picker">×</button></header>
      <label class="area-focus-search" for="area-focus-search">Find an Area<input id="area-focus-search" type="search" value="${escapeHtml(picker.query)}" placeholder="Type an Area name or path" autocomplete="off"></label>
      <p class="area-focus-result-count" aria-live="polite">${records.length} ${records.length === 1 ? "Area" : "Areas"}</p>
      <div class="area-focus-options">${records.length ? records.map((area) => `<label><input type="checkbox" data-area-focus-path="${escapeHtml(area.path)}" ${selected.has(area.path) ? "checked" : ""}><span><strong>${escapeHtml(humanName(area.name))}</strong><small>${escapeHtml(area.path)}</small></span></label>`).join("") : `<p>No Areas match “${escapeHtml(picker.query)}”.</p>`}</div>
      <p class="area-focus-selected">Selected: ${labels.length ? escapeHtml(labels.join(", ")) : "All Areas"}</p>
      <footer><button class="quiet-button" type="button" data-cancel-area-focus>Cancel</button><button class="primary-button" type="submit">${escapeHtml(action)}</button></footer>
    </form>`;
  }

  /**
   * The one switch between every Area and the starred ones, on the Work
   * caption line. Stars alone never change the desk, so the switch is the only
   * place the view changes, and it is always in the same spot.
   */
  function starredOnlyButton() {
    const roots = areaFocusRoots();
    const only = Boolean(state.areaFocusOnly);
    const labels = areaFocusLabels(roots);
    const title = roots.length
      ? `${only ? "Show every Area" : "Show only the starred Areas"}: ${labels.join(", ")} (F)`
      : "Star an Area with f, then F shows only the starred Areas";
    const storageNote = state.areaFocusStorageError ? `<p class="area-focus-storage-note">Area Focus persistence is unavailable in this browser.</p>` : "";
    return `<span class="area-focus-control"><button class="work-caption-toggle area-focus-switch${only ? " on" : ""}" type="button" data-starred-only aria-pressed="${only}" ${workCommandAttributes("starredOnly", title)}>${only ? "★" : "☆"} Starred${roots.length ? ` <span class="area-focus-count">${roots.length}</span>` : ""}${workKey("starredOnly")}</button>${storageNote}${areaFocusPickerMarkup()}</span>`;
  }

  /**
   * The switch between every Area and the active ones, next to the starred
   * switch. Both scope the desk; together they show the active work inside
   * the starred Areas.
   */
  function activeOnlyButton() {
    const only = Boolean(state.activeOnly);
    const count = activeAreas().size;
    const title = `${only ? "Show every Area" : "Show only the active brains and running work"} (A)`;
    return `<button class="work-caption-toggle area-focus-switch${only ? " on" : ""}" type="button" data-active-only aria-pressed="${only}" ${workCommandAttributes("activeOnly", title)}>${only ? "●" : "○"} Active${count ? ` <span class="area-focus-count">${count}</span>` : ""}${workKey("activeOnly")}</button>`;
  }

  /** Expands the ancestors of one area so the selected row stays visible. */
  function revealArea(path) {
    const parts = String(path ?? "").split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) state.expandedAreas.add(parts.slice(0, index).join("/"));
    saveExpandedAreas();
  }

  /** Finds one indexed goal by its vault-relative file. */
  function goalByFile(file) {
    return allGoals().find((goal) => goal.file === file) || null;
  }

  /** Returns the goal selected in the shell. */
  function currentGoal() {
    return goalByFile(state.currentFile);
  }

  /** Finds the live session bound to one goal. */
  function sessionForGoal(goal) {
    if (!goal || ["done", "dropped", "parked", "deferred"].includes(goal.status)) return null;
    const record = pipelineRecordForGoal(goal);
    if (record) {
      const current = record.steps?.find((step) => step.id === record.currentAssignmentId && ["running", "waiting"].includes(step.status))
        ?? record.steps?.find((step) => ["running", "waiting"].includes(step.status));
      if (!current) return null;
      const attempt = current.attempts?.findLast?.((item) => !item.endedAt) ?? current.attempts?.at?.(-1);
      // A Job is authoritative over the Goal's old Markdown binding. Once its
      // current Assignment is complete, that old pane remains history and
      // must not replace the next pending Assignment's state.
      return state.sessions.find((session) => session.kind !== "brain" && session.name === attempt?.session)
        ?? state.sessions.find((session) => session.kind !== "brain" && session.name === current.session)
        ?? null;
    }
    const bound = state.sessions.filter((session) => session.kind !== "brain" && (session.goal === goal.file || session.name === goal.session));
    return bound.find((session) => session.name === goal.session)
      ?? bound.find((session) => session.name === state.agentSessionName)
      ?? bound[0]
      ?? null;
  }

  /** Every live session bound to one Goal, for the agent count on its card. */
  function sessionsForGoal(goal) {
    if (!goal || ["done", "dropped", "parked", "deferred"].includes(goal.status)) return [];
    return state.sessions.filter((session) => session.goal === goal.file || session.name === goal.session);
  }

  /** Returns every live conversation that is defining work, newest first. */
  function describeWorkSessions() {
    return state.sessions
      .filter((session) => session.kind === "work-definition")
      .sort((left, right) => Number(right.created || 0) - Number(left.created || 0));
  }

  /** Finds only the work-definition (or brain) conversation the user selected. */
  function describeWorkSession() {
    return describeWorkSessions().find((session) => session.name === state.describeSessionName)
      ?? brainSessions().find((session) => session.name === state.describeSessionName)
      ?? null;
  }

  // ---- Area brains ----
  // One long-lived orchestrating agent per Area (ADR-0024). The server keeps
  // the record; the desk shows it as an icon and one line on the Area card,
  // and opens its terminal through the same view as a describe-work agent.

  /** Every live brain session. */
  function brainSessions() {
    return state.sessions.filter((session) => session.kind === "brain" || session.kind === "repair");
  }

  /** The brain record of exactly this Area, or null. A parent card never shows a child brain. */
  function brainForAreaCard(areaPath) {
    return (state.brains ?? []).find((brain) => brain.area === areaPath) ?? null;
  }

  /** The desk word for a brain's logical lifecycle and separate runtime health. */
  function brainStateLabel(brain) {
    if (!brain) return "No brain";
    if (brain.pendingStop) return "Stopping";
    if (brain.agentState?.word) return brain.agentState.word;
    if (brain.status === "inactive") return "Brain stopped";
    if (brain.live) {
      if (brain.state === "working") return "Brain working";
      if (brain.state === "waiting") return brain.stateDetail === "decision" ? "Brain needs a decision" : "Brain waiting for you";
      if (brain.state === "shell") return "Brain did not start";
      return "Brain session open";
    }
    if (brain.health?.status === "recovering") return "Brain recovering";
    if (brain.health?.status === "failed") return "Brain has a problem";
    return "Brain active";
  }

  /** The class that colours the brain icon without inventing lifecycle states. */
  function brainKind(brain) {
    if (!brain) return "none";
    if (brain.live) return brain.state === "waiting" ? "waiting" : brain.state === "working" ? "working" : "live";
    return brain.status === "inactive" ? "ended" : "stopped";
  }

  /** The brain icon in the Area card header: dim without a brain, stateful with one. */
  function deskBrainButton(areaPath) {
    const brain = brainForAreaCard(areaPath);
    const crew = brain?.repair?.current ?? null;
    const kind = brainKind(brain);
    const open = state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === areaPath;
    const title = !brain
      ? "Start a brain for this Area"
      : crew
        ? `Open the repair crew (${brainStateLabel(brain).toLowerCase()})`
        : brain.live
        ? `Open the brain (${brainStateLabel(brain).toLowerCase()})`
        : `${brainStateLabel(brain)}: send it a message to resume, or start over`;
    return `<span class="area-brain-controls"><button class="area-brain ${kind}${open ? " open" : ""}" type="button" data-launch-for="${BRAIN_LAUNCH_TARGET}" data-brain-area="${escapeHtml(areaPath)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-expanded="${open}"><span aria-hidden="true">🧠</span></button>${brain?.live ? `<button class="quiet-button" type="button" data-stop-brain-area="${escapeHtml(areaPath)}" data-stop-brain-attempt="${escapeHtml(brain.currentAttemptId ?? brain.session ?? "")}">Stop brain</button>` : ""}</span>`;
  }

  /** Opens the brain's terminal in the shared session layer. */
  function openBrainSession(name) {
    if (state.sessionPeek?.session === name) return;
    const session = brainSessions().find((item) => item.name === name);
    if (!session) return showToast("The brain session is not live.");
    openSessionLayer(session, "brain", captureReturnPoint());
  }

  /**
   * Opens the Area brain, or opens the box that starts one.
   *
   * A brain that is not live never wakes from this route on its own. Tangent
   * used to send a canned instruction here, so `b` on a quiet Area started a
   * brain that nobody had asked anything. Now the same key opens the message
   * box, and the brain wakes with Julian's own words in the send action that
   * writes them (design-record-tangent-around-the-area-brain, "A message to an
   * inactive brain activates it in the same explicit send action").
   */
  async function openOrStartBrain(area, trigger = null) {
    const existing = brainForAreaCard(area);
    const live = brainSessions().find((session) => session.name === existing?.repair?.current?.session || (session.area === area && session.kind === "brain") || session.name === existing?.session);
    if (live) return openBrainSession(live.name);
    // A brain the record still calls live lost its process, not its orders.
    // Reattaching it is runtime recovery, not a cold wake, so it needs no new
    // message. Everything else waits for Julian's words.
    if (existing?.live) return resumeLiveBrain(area, trigger);
    return openBrainComposer(area, trigger);
  }

  /** Reattaches a brain whose record is live while its session list is stale. */
  async function resumeLiveBrain(area, trigger = null) {
    if (openingBrains.has(area)) return;
    openingBrains.add(area);
    if (trigger) trigger.disabled = true;
    showToast("Resuming brain…");
    try {
      const result = await post("/api/brains/start", { area, resume: true });
      state.sessions = [...state.sessions.filter((session) => session.name !== result.session), { name: result.session, area, kind: "brain", state: "shell" }];
      if (result.brain) state.brains = [...(state.brains ?? []).filter((brain) => brain.area !== area), { ...result.brain, live: true }];
      openBrainSession(result.session);
      void refresh();
    } catch (error) {
      showToast(error.message);
      trigger?.focus();
    } finally {
      openingBrains.delete(area);
      if (trigger?.isConnected) trigger.disabled = false;
    }
    return undefined;
  }

  /** Opens the brain message box for one Area, anchored to whatever asked for it. */
  function openBrainComposer(area, trigger = null) {
    if (!area) return showToast("Choose an Area row first.");
    const anchor = trigger?.isConnected
      ? trigger
      : document.querySelector(`[data-open-area-brain="${cssAttribute(area)}"], [data-brain-area="${cssAttribute(area)}"]`);
    if (!anchor) return showToast("Open this Area's brain from its row.");
    seedBrainDraft(area, anchor);
    return undefined;
  }

  /** Escapes one Area path for a CSS attribute selector. */
  function cssAttribute(value) {
    return String(value ?? "").replace(/["\\]/g, "\\$&");
  }

  /** Opens or closes the brain popover for one Area card; a live brain opens its terminal instead. */
  function toggleBrainPopover(button) {
    const area = button.dataset.brainArea;
    const brain = brainForAreaCard(area);
    if (brain?.repair?.current?.session) return openBrainSession(brain.repair.current.session);
    if (brain?.live) return openBrainSession(brain.session);
    if (state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === area) {
      state.launchTarget = "";
      state.launchAnchor = null;
      return paint(true);
    }
    return seedBrainDraft(area, button);
  }

  /** Opens an empty brain message box for one Area, anchored under one element. */
  function seedBrainDraft(area, anchor) {
    const brain = brainForAreaCard(area);
    state.launchTarget = BRAIN_LAUNCH_TARGET;
    launchOptionsFor(area);
    state.launch.record = null;
    state.launch.steps = [];
    state.launch.active = 0;
    state.launch.command = "";
    state.launch.editing = false;
    state.launch.instruction = "";
    state.launch.assignmentKind = "implementation";
    state.launch.assignmentPath = "";
    state.launch.continueFrom = null;
    state.launch.stale = null;
    // A prior brain retains its runtime. A new brain is seeded asynchronously
    // from the nearest explicit Area brain default (then the server fallback).
    state.launch.choice = null;
    // The box always starts empty. Prefilling it with the inactive brain's
    // instruction let an instruction Julian typed for an earlier brain become
    // the new one's, and the next attempt then read an old order as today's.
    state.brainDraft = { area, instruction: "" };
    const rect = anchor.getBoundingClientRect();
    state.launchAnchor = { top: Math.round(rect.bottom + 8), above: Math.round(rect.top - 8), right: Math.round(rect.right) };
    state.launch.open = false;
    return paint(true);
  }

  /**
   * Starts, resumes, or starts over the brain of the message box's Area.
   *
   * Both routes need Julian's words. A new brain needs its founding
   * instruction; an inactive brain wakes only for a message, and that message
   * travels with the resume so the woken brain reads why it is awake.
   */
  async function startBrain({ resume = false } = {}) {
    syncLaunchDraft();
    const area = state.brainDraft?.area;
    const instruction = (state.brainDraft?.instruction ?? "").trim();
    if (!area) return;
    try {
      const selection = launchSelection();
      const expectedLaunch = [selection?.harness?.id, selection?.model?.id, selection?.effort?.id].filter(Boolean).join("/");
      // A clicked picker value is an override for this attempt. An untouched
      // picker sends only the launch it displayed as an optimistic check; the
      // server still resolves the Area's durable default at start time.
      const choice = state.launch.choice?.harness
        ? {
          harness: state.launch.choice.harness,
          ...(state.launch.choice.model ? { model: state.launch.choice.model } : {}),
          ...(state.launch.choice.effort ? { effort: state.launch.choice.effort } : {}),
        }
        : null;
      const result = await post("/api/brains/start", { area, instruction, expectedLaunch, ...(choice ? { choice } : {}), resume });
      // The resume message is the wake reason. The server records it as an
      // unread notice, so the woken attempt reads it in its first message.
      state.launchTarget = "";
      state.launchAnchor = null;
      state.brainDraft = null;
      await refresh();
      showToast(result.reattached ? "The brain already runs." : resume ? "Brain awake." : "Brain started.");
      openBrainSession(result.session);
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Confirms one Area-scoped brain stop and preserves its Goals and workers. */
  function confirmStopBrain(area, expectedAttemptId = "") {
    const brain = brainForAreaCard(area);
    if (!brain?.live) return showToast("The brain is not live.");
    openModal({
      kicker: "Area brain",
      title: `Stop the ${humanName(area.split("/").pop())} brain?`,
      copy: "This makes the Brain inactive. Its Goals, Jobs, and worker Agents continue. A later message can wake it.",
      confirmLabel: "Stop brain",
      danger: true,
      /** Stops the exact attempt that the Area control displayed. */
      async onConfirm() {
        try {
          await post("/api/brains/stop", { area, expectedAttemptId: expectedAttemptId || brain.currentAttemptId || brain.session, operationId: crypto.randomUUID() });
          await refresh();
          showToast("The brain stopped. Its work continues.");
        } catch (error) {
          await refresh();
          showToast(error.message);
        }
      },
    });
  }

  const NAME_MAP = new Map([
    ["otto", "Otto"],
    ["dnd", "D&D"],
    ["tangent", "Tangent"],
    ["neara", "Neara"],
    ["pgande", "PG&E"],
    ["pyth", "Python"],
  ]);

  /** Converts a stored area segment into its human label. */
  function humanName(value) {
    const key = String(value ?? "").toLowerCase();
    if (NAME_MAP.has(key)) return NAME_MAP.get(key);
    return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  /** Converts an Area path into readable segments. */
  function areaParts(area) {
    return String(area ?? "").split("/").filter(Boolean).map(humanName);
  }

  /** Formats one complete readable area path. */
  function areaLabel(area) {
    return areaParts(area).join(" / ");
  }

  /** Renders one compact Area breadcrumb with a direct route to each level. */
  function areaPath(area) {
    const segments = String(area ?? "").split("/").filter(Boolean);
    return `<nav class="area-path" aria-label="Area path">${segments.map((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      return `<button type="button" data-open-area="${escapeHtml(path)}">${escapeHtml(humanName(segment))}</button>`;
    }).join("")}</nav>`;
  }

  /** Identifies the selected agent from its command. */
  function agentName(sessionOrCommand) {
    const command = typeof sessionOrCommand === "string" ? sessionOrCommand : sessionOrCommand?.command || "";
    const lower = command.toLowerCase();
    if (lower.includes("codex")) return "Codex";
    if (lower.includes("claude")) return "Claude";
    if (lower.includes("agy")) return "Agy";
    if (lower.includes("gemini")) return "Gemini";
    return "Agent";
  }

  /** Returns a sentence-safe reference to an agent. */
  function agentReference(name) {
    return name === "Agent" ? "the agent" : name;
  }

  /** Formats a session start time as a compact relative age. */
  function ageText(created) {
    const minutes = Math.max(0, Math.floor((Date.now() - Number(created || Date.now())) / 60000));
    if (minutes < 1) return "Started now";
    if (minutes < 60) return `Started ${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Started ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.floor(hours / 24);
    return `Started ${days} ${days === 1 ? "day" : "days"} ago`;
  }

  /**
   * True when this Area has a brain of its own that has not ended: its work
   * reports to the brain, so Tangent never infers a row for it. Coverage
   * follows the record, not the session, or a brain that stopped for a minute
   * would hand its Area back to the fallback and feed the card twice
   * (design-the-for-you-row-shows-only-direct-asks, Decision 6).
   */
  function coveredByBrainRecord(areaPath) {
    const brain = brainForAreaCard(areaPath ?? "");
    return Boolean(brain && brain.status === "active");
  }

  /** True when a brain owns this Goal's Area: it is the brain's to raise, not a desk item for Julian. */
  function goalCoveredByBrain(goal) {
    return coveredByBrainRecord(goal?.area ?? "");
  }

  /** True when one stored handoff names the user, and no live brain already covers this Goal's Area. */
  function goalNeedsYou(goal) {
    if (!goal || ["done", "dropped", "parked", "deferred"].includes(goal.status)) return false;
    // Check it: the brain marked a Goal Julian flagged done, and it waits for him (D13).
    if (goal.status === "verify") return true;
    if (goalCoveredByBrain(goal)) return false;
    return /\b(julian|you)\b/i.test(String(goal.waitingOn ?? ""));
  }

  /** The refined waiting label: why the static agent needs (or can wait for) you. */
  function waitingLabel(session) {
    if (session.stateDetail === "decision") return "Needs your decision";
    if (session.stateDetail === "idle") return "Finished · ready for you";
    if (session.stateDetail === "draft") return "Holding your draft";
    return "Waiting for you";
  }

  /** Describes one Goal and Run state in user terms. */
  function stateLabel(goal, session) {
    if (goal.status === "done") return "Complete";
    if (goal.status === "verify") return "Check it";
    if (!session) return goalNeedsYou(goal) ? "Waiting for you" : "Ready";
    if (session.state === "waiting") return waitingLabel(session);
    if (session.state === "working") return "Agent working";
    if (session.state === "shell") return "Agent did not start";
    return "Session open";
  }

  /** Describes one work-definition conversation without a Goal status. */
  function describeWorkStateLabel(session) {
    if (!session) return "Agent session ended";
    if (session.state === "waiting") return waitingLabel(session);
    if (session.state === "working") return "Agent working";
    if (session.state === "shell") return "Agent did not start";
    return "Session open";
  }

  /** Renders one work-definition conversation as a first-class work row. */
  function describeWorkCard(session, className = "") {
    const name = agentName(session);
    const reference = name === "Agent" ? "A native agent" : name;
    return `
      <button class="work-card work-definition ${className}" type="button" data-select-work-definition="${escapeHtml(session.name)}">
        <span>
          <span class="work-area">${escapeHtml(areaLabel(session.area))} · Defining work</span>
          <span class="work-title">${escapeHtml(session.workTitle || "Define new work")}</span>
          <span class="work-goal">${escapeHtml(reference)} is turning your description into confirmed Goals.</span>
        </span>
        <span class="work-state">${escapeHtml(describeWorkStateLabel(session))}</span>
      </button>
    `;
  }

  /** Renders one selectable goal row. */
  function workCard(goal, className = "", { grouped = false, depthBase = 0, label = "" } = {}) {
    const session = sessionForGoal(goal);
    const depth = Math.max(0, Number(goal.depth || 0) - depthBase);
    return `
      <button class="work-card ${className} ${depth ? "nested" : ""}" style="--goal-depth: ${depth}" type="button" data-select-goal="${escapeHtml(goal.file)}">
        <span>
          ${grouped ? "" : `<span class="work-area">${escapeHtml(areaLabel(goal.area))}</span>`}
          <span class="work-title">${escapeHtml(goal.title)}</span>
          <span class="work-goal">${escapeHtml(clip(goal.doneWhen, 180))}</span>
        </span>
        <span class="work-state">${escapeHtml(label || stateLabel(goal, session))}</span>
      </button>
    `;
  }

  /** Describes attention anywhere inside one Goal tree. */
  function goalTreeLabel(tree) {
    const stateName = goalTreeState(tree);
    const count = tree.goals.map(sessionForGoal).filter(Boolean).length;
    if (stateName === "waiting") return count > 1 ? `${count} runs · needs you` : "Waiting for you";
    if (stateName === "working") return count > 1 ? `${count} agents working` : "Agent working";
    if (stateName === "open") return count > 1 ? `${count} sessions open` : "Session open";
    return stateLabel(tree.root, sessionForGoal(tree.root));
  }

  /** Renders one Goal and its collapsible Subgoal chain. */
  function goalTreeCard(tree, className = "") {
    const subgoals = tree.goals.slice(1);
    const hasActiveSubgoal = subgoals.some((goal) => sessionForGoal(goal));
    return `
      <section class="goal-tree">
        ${workCard(tree.root, className, { grouped: true, label: goalTreeLabel(tree) })}
        ${subgoals.length ? `
          <details class="goal-subgoals" ${hasActiveSubgoal ? "open" : ""}>
            <summary><span>To do that</span><small>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</small></summary>
            <div class="work-list">${subgoals.map((goal) => workCard(goal, className, { grouped: true, depthBase: 0 })).join("")}</div>
          </details>` : ""}
      </section>`;
  }

  /** Renders complete Goal trees under one Area path. */
  function goalTreeAreaGroup(path, trees, className = "") {
    return `
      <details class="area-work-group" open>
        <summary class="area-work-heading"><span>${escapeHtml(areaLabel(path))}</span><span>${trees.length}</span></summary>
        <div class="goal-tree-list">${trees.map((tree) => goalTreeCard(tree, className)).join("")}</div>
      </details>`;
  }

  /** Renders Goal trees and defining conversations together under one Area. */
  function workAttentionAreaGroup(path, trees, descriptions, className = "") {
    const count = trees.length + descriptions.length;
    return `
      <details class="area-work-group" open>
        <summary class="area-work-heading"><span>${escapeHtml(areaLabel(path))}</span><span>${count}</span></summary>
        <div class="goal-tree-list">
          ${descriptions.map((session) => describeWorkCard(session, className)).join("")}
          ${trees.map((tree) => goalTreeCard(tree, className)).join("")}
        </div>
      </details>`;
  }

  /** Renders one attention group containing Goal runs and work-definition agents. */
  function workAttentionSection(title, trees, descriptions = [], className = "") {
    if (!trees.length && !descriptions.length) return "";
    const byPath = new Map();
    for (const tree of trees) {
      if (!byPath.has(tree.path)) byPath.set(tree.path, { trees: [], descriptions: [] });
      byPath.get(tree.path).trees.push(tree);
    }
    for (const session of descriptions) {
      if (!byPath.has(session.area)) byPath.set(session.area, { trees: [], descriptions: [] });
      byPath.get(session.area).descriptions.push(session);
    }
    return `
      <section class="work-section">
        <div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${trees.length + descriptions.length}</span></div>
        <div class="area-work-list">${[...byPath].map(([path, items]) => workAttentionAreaGroup(path, items.trees, items.descriptions, className)).join("")}</div>
      </section>`;
  }

  /** Renders one attention group as complete, collapsible Goal trees. */
  function goalTreeSection(title, trees, className = "") {
    return workAttentionSection(title, trees, [], className);
  }

  /** Renders the goals that belong to one area group. */
  function workAreaGroup(group, className = "") {
    const depthBase = Math.min(...group.goals.map((goal) => Number(goal.depth || 0)));
    return `
      <section class="area-work-group">
        <div class="area-work-heading">
          <span>${escapeHtml(areaLabel(group.path))}</span>
          <span>${group.goals.length}</span>
        </div>
        <div class="work-list">${group.goals.map((goal) => workCard(goal, className, { grouped: true, depthBase })).join("")}</div>
      </section>
    `;
  }

  /** Renders one status section of grouped work. */
  function workSection(title, goals, className = "", note = "") {
    if (!goals.length) return "";
    const groups = goalGroups(goals);
    return `
      <section class="work-section">
        <div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(note || String(goals.length))}</span></div>
        <div class="area-work-list">${groups.map((group) => workAreaGroup(group, className)).join("")}</div>
      </section>
    `;
  }

  const SEARCH_FILLER = new Set(["a", "an", "and", "built", "did", "do", "for", "in", "it", "of", "on", "the", "thing", "things", "to", "we", "when"]);

  // Normalizes conversational wording for forgiving local search. The work
  // search, the Go to finder, and the tests share one copy (see go-to-core.js).
  const normalizedSearchText = goToCore.normalizedSearchText;

  /** Extracts the meaningful terms from one conversational query. */
  function searchTerms(query) {
    return [...new Set(normalizedSearchText(query).split(" ").filter((word) => word && !SEARCH_FILLER.has(word)))];
  }

  /** Scores one record only when all meaningful query terms are present. */
  function searchScore(record, terms, emphasis = "") {
    if (!terms.length) return 0;
    const text = normalizedSearchText(record.searchText || `${record.title || ""} ${record.area || ""} ${record.body || ""}`);
    const joinedText = text.replaceAll(" ", "");
    if (!terms.every((term) => text.includes(term) || joinedText.includes(term))) return 0;
    const strong = normalizedSearchText(emphasis || record.title || "");
    return terms.reduce((score, term) => score + 1 + (strong.includes(term) ? 4 : 0), 0) + Number(record.mtime || 0) / 1e15;
  }

  /**
   * The open Questions of one Area and its child Areas. Only a brain writing
   * an explicit Request makes one. A waiting worker, a stopped step, and a
   * finished Goal make none: Tangent does not infer an ask from machine state.
   * A sub-header asks for its own brain only: its deeper sub-Areas are flat
   * siblings with their own row, so a roll-up prints one question twice.
   */
  function areaQuestions(path, { ownBrainOnly = false } = {}) {
    return (state.brains ?? [])
      .filter((brain) => brain.area === path || (!ownBrainOnly && brain.area.startsWith(`${path}/`)))
      .flatMap((brain) => (brain.requests ?? []).filter((request) => request.status === "open").map((request) => ({ area: brain.area, brain, request })));
  }

  /**
   * The blockers of one Area, owner first. The design orders them by who can
   * move them: Julian's own Questions, then a dependency or an outside party,
   * then the brain's own recovery. A folded Area shows the first one, which is
   * the next fact that can change what Julian does.
   */
  function areaBlockers(path, trees, facts, { ownBrainOnly = false } = {}) {
    const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status));
    const questions = areaQuestions(path, { ownBrainOnly }).map((item) => ({ owner: "You", cause: item.request.question || item.request.subject, rank: 0 }));
    const dependencies = goals
      .map((goal) => ({ goal, fact: facts.get(goal.file) }))
      .filter((item) => ["blocked", "broken", "error"].includes(item.fact?.kind))
      .map((item) => ({ owner: "Dependency", cause: `${item.goal.title}: ${readinessLabel(item.fact).toLowerCase()}`, rank: 1 }));
    const brain = brainForAreaCard(path);
    const attemptBlockers = goals.flatMap((goal) => (pipelineRecordForGoal(goal)?.steps ?? []))
      .filter((step) => step.attemptState?.owner === "you")
      .map((step) => ({ owner: "You", cause: step.attemptState.evidence?.text || step.attemptState.word, rank: 0 }));
    const brainBlocker = brain?.agentState?.owner === "you"
      ? [{ owner: "You", cause: brain.agentState.evidence?.text || brain.agentState.word, rank: 0 }]
      : [];
    return [...questions, ...attemptBlockers, ...brainBlocker, ...dependencies].sort((left, right) => left.rank - right.rank);
  }

  /**
   * The one summary line of an Area group: how much work is open, how much is
   * moving, what is blocked, and how many Questions its brains asked. It counts
   * work and explicit asks. It never counts agents, waits, or handovers, which
   * are the brain's business and turn agent volume into a demand on Julian.
   */
  function deskAreaSummary(path, trees, descriptions, facts, { ownBrainOnly = false } = {}) {
    const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status));
    const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...descriptions];
    const working = sessions.filter((session) => session.state === "working").length;
    const blockers = areaBlockers(path, trees, facts, { ownBrainOnly });
    const questions = areaQuestions(path, { ownBrainOnly }).length;
    // The running count prints once, in the pill, as `N working`
    // (work-screen-refresh D2): two words for one number read as two facts.
    const parts = [`${goals.length} open`];
    if (blockers.length) parts.push(`${blockers.length} ${blockers.length === 1 ? "blocker" : "blockers"}`);
    if (questions) parts.push(`${questions} ${questions === 1 ? "question" : "questions"}`);
    return { text: parts.join(" · "), questions, blockers, working };
  }

  /**
   * The brain words the Area pill prints, with their hover sentences. A live
   * brain at an empty composer is the normal rest between turns and asks
   * nothing of Julian, so it is not in this table and the pill says nothing
   * for it (work-screen-refresh D3).
   */
  const AREA_BRAIN_PILLS = Object.freeze({
    "Brain needs a decision": "The brain shows a choice only you can make. Enter its agent with Command-Shift-Enter.",
    "Brain working": "The brain is producing output now, with no agent under it.",
    "Brain did not start": "The brain's session opened but no agent runs in it.",
    "Brain has a problem": "The brain's last start failed. Enter its agent with Command-Shift-Enter to see why.",
    "Brain recovering": "Tangent is bringing the brain back after a failure.",
    "Brain idle": "Nothing waits for the brain. Entering it will not help.",
    "Brain stopped": "The brain is stopped. Its live work continues under the repair crew.",
    "Brain hit a wall": "The brain cannot continue. The repair crew handles its live work.",
    "Brain unknown": "Tangent's last observation is stale. Open the brain only if this state lasts for ten minutes.",
    "repair crew working": "The repair crew is finishing live work in this Area.",
    "repair crew idle": "The repair crew has stopped producing output.",
    "repair crew needs your decision": "The repair crew shows a decision dialog.",
  });

  /**
   * Returns one compact, explicit state for an Area on the Work desk, or
   * null when the Area neither needs Julian nor moves. Rank: questions, then
   * running agents, then a brain condition worth a word, then Goals ready.
   */
  function deskAreaState(path, trees, descriptions, { ownBrainOnly = false } = {}) {
    const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status));
    const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...descriptions];
    const waiting = areaQuestions(path, { ownBrainOnly }).length;
    const working = sessions.filter((session) => session.state === "working").length;
    if (waiting) return { kind: "waiting", label: `${waiting} ${waiting === 1 ? "question" : "questions"}`, title: "Open questions from this Area's brains. r reviews them." };
    if (working) return { kind: "working", label: `${working} working`, title: `${working === 1 ? "One agent is" : `${working} agents are`} producing output now.` };
    // A brain that waits while its agents work says nothing new, so ranks 1
    // and 2 stay in front; a brain that thinks or has a problem with no agent
    // is the case Julian cannot see otherwise. A brain resting at its
    // composer says nothing: that is not a condition.
    const brain = brainForAreaCard(path);
    const recentRepair = brain?.repair?.history?.at(-1);
    if (!brain?.live && recentRepair?.endedAt && Date.now() - Date.parse(recentRepair.endedAt) < 60 * 60_000) {
      return { kind: recentRepair.result === "blocked" ? "waiting" : "fact", label: `Brain stopped · repair crew ${recentRepair.result}`, title: recentRepair.report || `The repair crew ${recentRepair.result} ${shortStateAge(Date.parse(recentRepair.endedAt))} ago.` };
    }
    const brainWord = brain?.agentState || brain?.live || brain?.health?.status ? brainStateLabel(brain) : "";
    if (AREA_BRAIN_PILLS[brainWord]) return { kind: brainKind(brain), label: brainWord, title: AREA_BRAIN_PILLS[brainWord] };
    const ready = goals.filter((goal) => !sessionForGoal(goal)).length;
    if (ready) return { kind: "ready", label: `${ready} ${ready === 1 ? "Goal" : "Goals"} ready`, title: "Open Goals with no agent on them." };
    return null;
  }

  /**
   * Whether a live session anywhere in a desk panel (its own Area or its
   * nested sections) is presently working, and the latest Goal or Document
   * change across them (recently-worked-areas-sort-to-the-top). Panels order
   * by this: working now first, then most recent activity.
   */
  function panelActivity(record) {
    const parts = [
      { trees: record.trees, descriptions: record.descriptions, documents: record.area?.documents ?? [] },
      ...record.sections.map((section) => ({ trees: section.trees, descriptions: section.descriptions, documents: section.area?.documents ?? [] })),
    ];
    let working = false;
    let mtime = 0;
    for (const part of parts) {
      const goals = part.trees.flatMap((tree) => tree.goals);
      const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...part.descriptions];
      if (sessions.some((session) => session.state === "working")) working = true;
      for (const goal of goals) mtime = Math.max(mtime, goal.changedAt ?? goal.mtime ?? 0);
      for (const doc of part.documents) mtime = Math.max(mtime, doc.changedAt ?? doc.mtime ?? 0);
    }
    return { working, mtime };
  }

  /**
   * Groups every Area into stable subject panels: one panel per top-level
   * Area, and one section per Area below it, whether or not it has open work
   * (work-view-sub-areas, every Area has a row). Julian could not see Areas
   * without Goals, so their brains were out of reach. A done Area, or one
   * under a done Area, earns a row only while it still has open work.
   * Panels keep hierarchy order. Runtime activity never moves a subject.
   */
  function deskAreas(scope = null) {
    // Stars alone never change the desk (Julian, 2026-08-28: "I don't want my
    // view to change unless I press F"). Only starred-only scopes it.
    const roots = state.areaFocusOnly ? areaFocusRoots() : [];
    /** True when one projected record stays inside the applied scope. */
    const inFocus = scope ?? ((path) => isInAreaFocus(path, roots));
    // Active-only (A) keeps only the trees an agent runs on; the Areas with
    // nothing live lose their rows below, so they earn no header.
    const activeOnly = Boolean(state.activeOnly);
    const trees = filteredGoalTrees(goalTrees().filter((tree) => goalTreeState(tree) !== "closed"))
      .filter((tree) => inFocus(tree.path))
      .filter((tree) => !activeOnly || goalTreeIsActive(tree));
    const descriptions = (state.workFilter === "inactive" ? [] : describeWorkSessions())
      .filter((session) => inFocus(session.area));
    const core = areaMapCore;
    // Every Area, done and archived ones included, so a hidden sub-Area with
    // open Goals still earns its sub-header under an open parent
    // (work-view-sub-areas). Without a Focus, a hidden Area still earns no
    // top-level header of its own (area-archive Decision 4).
    const areaList = allAreas().filter((area) => inFocus(area.path));
    const doneAreas = new Set(allAreas().filter((area) => ["done", "archived"].includes(area.status)).map((area) => area.path));
    /** True when the Area or one of its ancestors is done or archived. */
    const underDoneArea = (path) => path.split("/").some((_part, index, parts) => doneAreas.has(parts.slice(0, index + 1).join("/")));
    const headerAreas = new Set((roots.length ? allAreas() : areas()).map((area) => area.path));
    /** The focus roots this pass renders as roots; a scoped pass has none. */
    const panelRoots = scope ? [] : roots;
    const byPath = new Map(areaList.map((area) => [area.path, area]));
    /** One Area's own open Goal trees and definition sessions, not its descendants'. */
    const workOf = (path) => ({
      trees: trees.filter((tree) => tree.path === path),
      descriptions: descriptions.filter((session) => session.area === path),
      programs: state.programs.operations.filter((program) => program.area === path),
    });
    const liveBrainAreas = (state.brains ?? [])
      .filter((brain) => brain.status === "active" && brain.live)
      .map((brain) => brain.area)
      .filter(inFocus);
    const openCounts = new Map();
    for (const area of areaList) {
      const { trees: areaTrees, descriptions: areaDescriptions, programs: areaPrograms } = workOf(area.path);
      const openGoalCount = areaTrees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status)).length, 0);
      // A live brain counts as work, the way a Describe session does: its
      // Area earns a header at the top level and a sub-header below one
      // (work-view-sub-areas Decision 1), never a peer panel of its parent.
      openCounts.set(area.path, Math.max(openGoalCount, areaDescriptions.length ? 1 : 0, liveBrainAreas.includes(area.path) ? 1 : 0, areaProcessesForArea(area.path).length ? 1 : 0, panelRoots.length ? areaPrograms.length : 0));
    }
    // Every not-done Area earns a row. A done Area keeps its row only while
    // it has open work under the current filter. Active-only keeps only the
    // Areas with something live.
    const rowCounts = new Map([...openCounts].filter(([path, count]) => count > 0 || (!activeOnly && !underDoneArea(path))));
    const panelDefs = core.deskPanels(rowCounts, panelRoots).filter((panel) => headerAreas.has(panel.path));
    const covered = new Set(panelDefs.flatMap((panel) => [panel.path, ...panel.sections]));
    const panels = panelDefs.map((panel) => {
      const area = byPath.get(panel.path);
      const own = workOf(panel.path);
      const sections = panel.sections
        .map((path) => ({ area: byPath.get(path), ...workOf(path) }))
        .filter((section) => section.area);
      const programs = own.programs;
      const brain = (state.brains ?? []).find((item) => item.area === panel.path && item.status === "active" && item.live) ?? null;
      const focusRoot = panelRoots.includes(panel.path);
      const focusHasWork = !focusRoot || trees.some((tree) => core.isInside(tree.path, panel.path))
        || descriptions.some((session) => core.isInside(session.area, panel.path))
        || liveBrainAreas.some((path) => core.isInside(path, panel.path))
        || (state.programs.processes ?? []).some((item) => activeLoopsForArea(item.area).includes(item) && core.isInside(item.area, panel.path))
        || state.programs.operations.some((program) => core.isInside(program.area, panel.path));
      return { area, trees: own.trees, descriptions: own.descriptions, sections, programs, brain, focusRoot, focusHasWork };
    }).filter((record) => record.area);
    if (state.workFilter === "all" && !activeOnly) {
      for (const area of areaList) {
        if (covered.has(area.path)) continue;
        if (!(area.documents ?? []).length) continue;
        if (panels.some((panel) => core.isInside(area.path, panel.area.path))) continue;
        panels.push({ area, trees: [], descriptions: [], sections: [], programs: state.programs.operations.filter((program) => program.area === area.path) });
      }
    }
    return core.orderPanels(panels, panelActivity).map((record, index) => ({ ...record, index }));
  }


  /**
   * Whether the work on one Goal is over: its pipeline ran every step, or it
   * never had a pipeline and no session is live. Only a finished Goal asks
   * Julian to accept its result; work still running asks nothing by itself.
   */
  function goalWorkFinished(goal) {
    const pipeline = pipelineRecordForGoal(goal);
    if (pipeline) return (pipeline.steps ?? []).every((step) => ["complete", "skipped"].includes(step.status));
    return !sessionForGoal(goal);
  }

  /** Opens the complete Request away from its compact index row. */
  function openRequest(area, id) {
    const request = (state.brains ?? []).find((brain) => brain.area === area)?.requests?.find((item) => item.id === id);
    if (!request) return showToast("This Request is no longer open.");
    const operation = request.effectOperation;
    const effectState = operation?.status === "failed" ? `Effect problem\n${operation.problem}`
      : operation?.status && operation.status !== "idle" ? `Effect state\n${operation.status}` : "";
    const anchor = request.conversationAnchor
      ? `Native conversation\n${areaLabel(area)} brain`
      : `Native conversation\n${area} brain`;
    const context = request.precedingContext ? `Preceding context\n${request.precedingContext}` : "";
    const effectRevision = request.effectRevision ? `Exact effect revision\n${request.effectRevision}` : "";
    const copy = [anchor, context, request.proposal ? `Proposed transition\n${request.proposal}` : "", request.question, request.detail, effectRevision, effectState].filter(Boolean).join("\n\n");
    const options = [
      ...(request.documents ?? []).map((file) => {
        const record = (state.vault?.documents ?? []).find((item) => item.file === file);
        return { value: `document:${file}`, label: `Read ${record?.title ?? file}` };
      }),
      { value: "reply", label: "Reply to the brain" },
      ...(request.effect ? [{ value: "authorize", label: operation?.status === "failed" ? `Retry exact effect: ${request.proposal}` : `Authorize exact effect: ${request.proposal}` }] : []),
      { value: "dismiss", label: "Dismiss this Question" },
    ];
    /** Stores a reply or starts the selected exact effect. */
    const answerRequest = async () => {
      const answer = document.querySelector("[data-modal-select]")?.value || "reply";
      const note = document.querySelector("[data-modal-input]")?.value.trim() || "";
      if (answer.startsWith("document:")) {
        openDocumentPeek(answer.slice("document:".length));
        return;
      }
      if (answer === "dismiss") {
        await post("/api/brains/requests/dismiss", { area, id });
        await refresh();
        return;
      }
      if (answer === "reply" && !note) throw new Error("Write the reply that the brain must receive.");
      await sendVerdict(area, `request:${id}`, answer, note, request.effectRevision || "");
    };
    openModal({
      kicker: "Request",
      title: request.subject,
      copy,
      wide: true,
      field: { kind: "request", actionLabel: "Effect", options, label: "Reply", placeholder: "Write the exact reply for the Area brain." },
      confirmLabel: "Apply response",
      onConfirm: answerRequest,
    });
  }

  /** Opens the explicit Questions review without changing the Work cursor. */
  function openQuestionsReview(area = "") {
    const questions = (state.brains ?? []).filter((brain) => !area || brain.area === area || brain.area.startsWith(`${area}/`))
      .flatMap((brain) => (brain.requests ?? []).filter((request) => request.status === "open").map((request) => ({ area: brain.area, request })));
    if (!questions.length) {
      /** Closes the empty Questions review. */
      const closeQuestions = async () => {};
      openModal({ kicker: "Questions", title: "No open questions", copy: "No Area brain needs a reply.", confirmLabel: "Return to Work", onConfirm: closeQuestions });
      return;
    }
    /** Opens the selected Question without changing the Work cursor. */
    const selectQuestion = async () => {
      const index = Number(document.querySelector("[data-modal-select]")?.value || 0);
      const selected = questions[index];
      if (!selected) throw new Error("Choose a current Question.");
      openRequest(selected.area, selected.request.id);
      return false;
    };
    openModal({
      kicker: "Questions",
      title: `${questions.length} from Area brains`,
      copy: "Choose a Question. Then reply or authorize its exact effect.",
      field: { kind: "select", label: "Question", options: questions.map((item, index) => ({ value: String(index), label: `${item.area} — ${item.request.subject}: ${item.request.question}` })) },
      confirmLabel: "Open question",
      onConfirm: selectQuestion,
    });
  }

  /** Opens one note composer for the selected Work Area. */
  function openAreaCapture(area) {
    if (!area) return showToast("Choose an Area row first.");
    const idempotencyKey = crypto.randomUUID();
    /** Sends the exact modal text to the Area brain. */
    const saveCapture = async () => {
      const text = document.querySelector("[data-modal-input]")?.value.trim() || "";
      if (!text) throw new Error("Write a note.");
      const delivery = await post("/api/agents/send", { to: area, text, from: "Agent Shell", idempotencyKey });
      showToast(delivery.live ? "Sent." : "Queued.");
      await refresh();
    };
    openModal({ kicker: "Message", title: `Send to ${area} brain`, copy: "The Area inbox keeps this note until the brain reads it.", field: { label: "Message", placeholder: "Write or dictate a note." }, confirmLabel: "Send", onConfirm: saveCapture });
  }

  /** The fallback asks grouped by Area, so every row says which Area it is from. */

  /**
   * Drops from `state.verdictLines` every line the server no longer lists, once
   * the plan commit has landed. A line is hidden only while its press is in
   * flight; a line the brain writes again later is shown again.
   */
  function forgetVerdictLines() {
    if (!state.verdictLines.size) return;
    const listed = new Set((state.brains ?? []).flatMap((brain) => (brain.forJulian ?? []).map((row) => row.line)));
    for (const line of [...state.verdictLines]) if (!listed.has(line)) state.verdictLines.delete(line);
  }

  /**
   * Julian answered one row with Accept or Reject: the row goes now and the
   * plan follows, and the brain hears the verdict either way. An Undo puts the
   * line back and withdraws the verdict, so a mis-press costs one click and
   * never leaves the brain acting on an answer Julian took back.
   */
  async function sendVerdict(area, line, verdict, note = "", effectRevision = "") {
    if (line.startsWith("request:") && ["changes", "reply"].includes(verdict) && !note) {
      openModal({
        kicker: "Changes",
        title: "What must change?",
        copy: "The brain receives this text with the returned work.",
        field: { label: "Required changes", placeholder: "State the change that you want." },
        confirmLabel: "Send changes",
        /** Sends the required text with the rejected proposal. */
        onConfirm: async () => {
          const text = document.querySelector("[data-modal-input]")?.value.trim() || "";
          if (!text) throw new Error("State the change that you want.");
          return sendVerdict(area, line, verdict, text, effectRevision);
        },
      });
      return;
    }
    state.verdictLines.add(line);
    paint(true);
    try {
      if (line.startsWith("request:")) {
        await post("/api/brains/requests/answer", { area, id: line.slice("request:".length), answer: verdict, note, ...(effectRevision ? { effectRevision } : {}) });
        showToast("Answer sent to the brain.");
        await refresh();
        return;
      }
      const result = await post("/api/brains/verdict", { area, line, verdict });
      /** Puts the line (and any continuation line it left with) back, and tells the brain the verdict is off. */
      const undo = async () => {
        try {
          await post("/api/brains/verdict/undo", { area, line: result.removedText ?? line, index: result.index });
          state.verdictLines.delete(line);
          await refresh();
          paint(true);
        } catch (error) {
          showToast(error.message);
        }
      };
      showToast(verdict === "accept" ? "Accepted. The brain was told." : "Rejected. The brain parks it.", { label: "Undo", run: undo });
    } catch (error) {
      state.verdictLines.delete(line);
      paint(true);
      showToast(error.message);
    }
  }

  /**
   * Julian pressed `Reply`, or `Answer` on a question the brain asked with no
   * Document: tells the brain the row's subject, then opens its terminal, so
   * whatever he types next carries that context. Opens the terminal even when
   * the notice fails to send; the reply matters more.
   */
  async function replyAboutRow(area, session, subject) {
    try {
      await post("/api/brains/reply", { area, subject });
    } catch (error) {
      showToast(error.message);
    }
    openBrainSession(session);
  }

  /**
   * The desk fill label ("310k"), shown on every row whose pane reports its
   * carried context (ADR-0042, D23). A pane with no readable fill shows nothing.
   */
  function deskFillLabel(context) {
    if (!context || typeof context.usedTokens !== "number") return "";
    return `${Math.round(context.usedTokens / 1000)}k`;
  }

  /**
   * The state pill and the primary action of one Goal. The pill is one word:
   * the facts line under the title carries the duration, and the card keeps no
   * prose (design-goal-cards Decision 4).
   */
  function deskGoalAction(goal) {
    const line = { stepLine: "", stepShort: "", stepTitle: "", fill: "", launch: "" };
    if (["done", "dropped", "parked", "deferred"].includes(goal.status)) {
      return { ...line, state: goal.status === "done" ? "Complete" : humanName(goal.status), action: "", kind: "complete", route: "" };
    }
    const session = sessionForGoal(goal);
    line.fill = deskFillLabel(session?.context);
    // Under a live brain a static pane waits for the brain, not for Julian: the
    // state stays as a fact, without the amber that means "you".
    const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
    if (!session) {
      const idleState = idleGoalState(goal);
      if (idleState === "Ready for validation") return { ...line, state: idleState, action: "Review", kind: "ready", route: "goal" };
      if (idleState === "Preparing validation") return { ...line, state: idleState, action: "Open", kind: "fact", route: "goal" };
      // No session: the row opens the Goal reader. Only the brain starts an
      // agent (D8), so Work offers no start of its own.
      return { ...line, state: idleState, action: "Open", kind: idleState === "Waiting" ? idle : "ready", route: "goal" };
    }
    return { ...line, ...deskSessionAction(session, idle) };
  }

  /**
   * The `harness/model/effort` text a row prints as its open control, from the
   * ids the server recorded at start time. Never derived from a command or a
   * display label: `agentName` cannot tell `claude` from `claude-otto`, and the
   * label `Claude · Otto · Opus 5` hides which part is the model
   * (design-see-the-harness-model-effort-and-open-that-agent Decision 5).
   */
  function launchRefText(launch) {
    if (typeof launch === "string") return launch;
    return [launch?.harness, launch?.model, launch?.effort].filter(Boolean).join("/");
  }

  /**
   * The state pill and route of one live session, shared by the plain Goal row
   * and the pipeline row. A session that is alive always carries a route: the
   * pill says what it is doing, the action opens it. `launch` is the text the
   * action button shows; a session started before the ids were recorded has
   * none, and keeps its verb.
   */
  function deskSessionAction(session, idle) {
    if (session.pendingStop) return { state: "Stopping", action: `Open ${agentName(session)}`, launch: launchRefText(session.launchRef), kind: "waiting", route: "run" };
    const launch = launchRefText(session.launchRef);
    if (session.state === "working") return { state: "Working", action: `Open ${agentName(session)}`, launch, kind: "working", route: "run" };
    if (session.state === "waiting") return { state: waitingLabel(session), action: `Open ${agentName(session)}`, launch, kind: idle, route: "run" };
    if (session.state === "shell") return { state: "Stopped", action: "Open session", launch, kind: idle, route: "run" };
    return { state: "Open", action: "Open agent", launch, kind: "ready", route: "run" };
  }

  /** True when a brain holds an open Test for exactly this Goal, on either record. */
  function goalHasOpenTest(goal) {
    return (state.brains ?? []).some((brain) => [
      ...(brain.requests ?? []).filter((request) => request.status === "open" && request.kind === "test")
        .map((request) => request.subjectRef?.goal ?? request.goal),
      ...(brain.forJulian ?? []).filter((row) => row.kind === "test").map((row) => row.file),
    ].filter(Boolean).includes(goal.file));
  }

  /** True when agents ran on this Goal and none runs on it now. */
  function goalRunEnded(goal) {
    if (sessionForGoal(goal)) return false;
    const pipeline = pipelineRecordForGoal(goal);
    if (pipeline) return (pipeline.steps ?? []).every((step) => ["complete", "skipped"].includes(step.status));
    return Boolean(goal.firstStartAt || (goal.agents ?? []).length);
  }

  /**
   * The lifecycle word for a Goal with no live agent. `Ready for validation`
   * belongs to a finished result Julian must accept, and to nothing else:
   * dependency-free planned work reads `Open`, and its Startable fact lives in
   * the readiness line (design-redesign-work-as-a-compact-table Decision 11).
   */
  function idleGoalState(goal) {
    if (goal.status === "verify") return "Check it";
    if (goal.status === "ready" || goalHasOpenTest(goal)) return "Ready for validation";
    if (goalRunEnded(goal)) return "Preparing validation";
    return goalNeedsYou(goal) ? "Waiting" : "Open";
  }

  /** The idle time (ms) after which an idle step is offered "Send to next". */

  /**
   * The pipeline row's state pill, primary action, and the small `Step N of M`
   * line above the pill. The step's agent and instruction stay in that line's
   * hover title: Julian reads the step in the launch popover, not on the card.
   */
  function deskPipelineAction(goal, pipeline) {
    const steps = pipeline.steps ?? [];
    const step = currentPipelineStep(pipeline);
    if (!step) return deskGoalAction(goal);
    const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
    const liveSession = sessionForGoal(goal);
    if (liveSession?.pendingStop) return { ...deskStepLine(step, steps.length), fill: deskFillLabel(liveSession.context), ...deskSessionAction(liveSession, idle) };
    const projected = { ...deskStepLine(step, steps.length), ...deskStepAction(step, idle) };
    if (projected.action) return projected;
    // No step offers a route. A record can still lag a session that is alive:
    // a step relaunched by hand, or a reconcile that has not run yet. While
    // any agent on this Goal lives, the card opens it instead of sitting
    // inert (goal-every-goal-card-on-work-has-a-way-to-open-its-ag).
    const session = sessionForGoal(goal);
    if (!session) return projected;
    const sessionStep = steps.find((item) => item.session === session.name);
    return {
      ...projected,
      ...(sessionStep ? deskStepLine(sessionStep, steps.length) : {}),
      fill: deskFillLabel(session.context),
      ...deskSessionAction(session, idle),
    };
  }

  /**
   * The step a Goal card speaks for. One rule, shared with the facts line:
   * goalCardCore.currentPipelineStep. Null means the run is over.
   */
  function currentPipelineStep(pipeline) {
    return goalCardCore.currentPipelineStep(pipeline?.steps ?? []);
  }

  /** The small `Step N of M` line above the pill, and the step facts in its hover title. */
  function deskStepLine(step, total) {
    return {
      stepLine: `Assignment ${step.index} of ${total}`,
      stepShort: `${step.index}/${total}`,
      stepLabel: step.label || "agent",
      stepTitle: `${step.label || "agent"}: ${step.instruction ?? ""}`,
      fill: deskFillLabel(step.context),
    };
  }

  /**
   * The state pill and route of one pipeline step. An action of "" means no
   * route, and a step with no route shows no launch either: what you can read
   * you can click (design-see-the-harness-model-effort-and-open-that-agent
   * Decision 3).
   */
  function deskStepAction(step, idle) {
    if (step.attemptState) {
      const route = step.live ? "run" : "";
      const ownerKind = step.attemptState.owner === "you" ? "waiting" : step.attemptState.word === "Working" ? "working" : "fact";
      return {
        state: `${step.attemptState.word} · ${shortStateAge(step.attemptState.since)}`,
        action: route ? `Open Assignment ${step.index}` : "",
        launch: route ? launchRefText(step.launch) : "",
        cwd: route ? step.launchDisclosure?.cwd ?? "" : "",
        kind: ownerKind,
        route,
        title: `${step.attemptState.evidence?.text ?? ""} Next: ${step.attemptState.next ?? ""}`.trim(),
      };
    }
    if (step.status === "stopped" || (step.status === "running" && !step.live)) return { state: "Stopped", action: "", launch: "", cwd: "", kind: idle, route: "" };
    if (step.status === "pending") return { state: "Not started", action: "", launch: "", cwd: "", kind: idle, route: "" };
    const launch = launchRefText(step.launch);
    // The folder the step was started in, disclosed with its harness before
    // the session existed, so the row can say where the agent works.
    const cwd = step.launchDisclosure?.cwd ?? "";
    if (step.state === "working") return { state: "Working", action: `Open Assignment ${step.index}`, launch, cwd, kind: "working", route: "run" };
    if (step.state === "waiting") return { state: waitingLabel(step), action: `Open Assignment ${step.index}`, launch, cwd, kind: idle, route: "run" };
    if (step.state === "shell") return { state: "Stopped", action: `Open Assignment ${step.index}`, launch, cwd, kind: idle, route: "run" };
    return { state: "Open", action: `Open Assignment ${step.index}`, launch, cwd, kind: "ready", route: "run" };
  }

  /** Formats the time since a server-derived word started. */
  function shortStateAge(since) {
    const elapsed = Math.max(0, Date.now() - Number(since || Date.now()));
    if (elapsed < 60_000) return "0m";
    if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m`;
    if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / 3_600_000)}h`;
    return `${Math.floor(elapsed / 86_400_000)}d`;
  }

  /** Rare pipeline actions shown inside the Goal action menu, only when valid. */
  function deskPipelineControls(goal, pipeline) {
    const step = currentPipelineStep(pipeline);
    if (!step) return "";
    // A pending step waits for the brain: only the brain starts workers (D8).
    if (step.status === "pending") return "";
    const last = step.index >= pipeline.steps.length;
    const stopped = step.status === "stopped" || (step.status === "running" && !step.live);
    if (stopped) {
      return (last ? "" : `<button type="button" data-pipeline-control="skip" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Skip to Assignment ${step.index + 1}</button>`)
        + `<button type="button" data-pipeline-control="end" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="${escapeHtml(pipeline.migrationProblem ? `${pipeline.migrationProblem} End every live attempt and keep its audit history.` : "End the run; the Goal stays open with its handovers")}">End work</button>`;
    }
    return "";
  }

  /**
   * The Goal's facts (pure, from the vault git log, live sessions, and the
   * pipeline record) plus the clock they were read at, computed once per row
   * so the bar and the agent-count fact stay in step (design-compact-work-desk).
   */
  function deskGoalFactsData(goal) {
    const core = goalCardCore;
    const now = Date.now();
    const sessions = sessionsForGoal(goal);
    const facts = core ? core.goalCardFacts({ goal, sessions, pipeline: pipelineRecordForGoal(goal), now, handoffNeedsYou: goalNeedsYou(goal) }) : null;
    const names = [...new Set([...(goal.agents ?? []), ...sessions.map((session) => session.name)])];
    return { facts, names, now };
  }

  /**
   * The elapsed-time text of the Status cell: first start to now, printed
   * compact so Julian reads the actual age without a hover (Julian's word
   * 2026-08-22). The start time is the hover. The bar that used to sit beside
   * it is gone (work-screen-refresh D6): a ratio no decision needs.
   */
  function deskGoalElapsed(facts, now) {
    const core = goalCardCore;
    if (!core || !facts) return "";
    const label = core.elapsedLabel(facts, now);
    if (!label) return "";
    const title = facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "";
    return `<span class="desk-goal-elapsed" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
  }

  // ---- The work table ----
  // One semantic table holds every open Goal (design-redesign-work-as-a-
  // compact-table). The lifecycle words, the readiness facts, the actions, the
  // order, and the selection rule are the settled ones; the table changes only
  // where each fact is drawn, so more work fits in one scan.

  /**
   * The columns, in reading order. Their widths live in shell.css. The
   * controls column has no printed header: it holds the row-end `⋯` and the
   * Area brain control (work-screen-refresh D4, D8).
   */
  const WORK_COLUMNS = [
    { key: "work", label: "Goal" },
    { key: "agent", label: "Agent" },
    { key: "status", label: "Status" },
    { key: "controls", label: "Controls", hidden: true },
  ];

  /**
   * Every Goal's readiness fact, derived once for one paint. Work reuses the
   * Area map's derivation instead of keeping a second dependency model
   * (design-redesign-work-as-a-compact-table, "Data ownership").
   */
  function readinessFacts() {
    const goals = allGoals();
    const byFile = new Map(goals.map((goal) => [goal.file, goal]));
    const facts = new Map(goals.map((goal) => [goal.file, areaWorkCore.readiness(goal, byFile)]));
    for (const file of areaWorkCore.cycleFiles(goals)) facts.set(file, { kind: "error", blockers: ["dependency cycle"] });
    return facts;
  }

  /** The readiness line of a planned row: what stops this Goal from starting. */
  function readinessLabel(fact) {
    if (!fact) return "";
    if (fact.kind === "ready") return "Startable";
    if (fact.kind === "blocked") return `Blocked by ${fact.blockers.length}`;
    if (fact.kind === "broken") return "Broken dependency";
    return "Dependency error";
  }

  /** A DOM id that survives every repaint of one Area group. */
  function workGroupId(areaPath) {
    return `work-group-${String(areaPath).replace(/[^a-z0-9]+/gi, "-")}`;
  }

  /**
   * The Area group one Goal belongs to: the brain-owned or focused root that
   * owns its subtree. Selection stays inside one such group.
   */
  function goalGroupRoot(file) {
    const goal = goalByFile(file);
    if (!goal) return "";
    const roots = deskAreas().map((record) => record.area.path);
    return roots.filter((path) => areaMapCore.isInside(goal.area, path)).sort((left, right) => right.length - left.length)[0] ?? goal.area;
  }

  /** The quiet descendant path a Work cell prints when a Goal sits below its group. */
  function descendantPath(areaPath, groupPath) {
    if (areaPath === groupPath) return "";
    const rest = areaPath.startsWith(`${groupPath}/`) ? areaPath.slice(groupPath.length + 1) : areaPath;
    return areaParts(rest).join(" / ");
  }

  /**
   * The one small mark that says this Area's brain has a loop: an active
   * `every:`-only process note (design agent-shell-brain-loop, Decision 5).
   * Hover names the interval and the first words of the message. The full
   * Process row sits below the exact Area header with its lifecycle controls.
   */
  function brainLoopMark(areaPath) {
    const loops = activeLoopsForArea(areaPath);
    if (!loops.length) return "";
    const title = loops.map((item) => `Loop every ${item.every}: ${String(item.body ?? "").split("\n")[0].slice(0, 60)}`).join("\n");
    const count = loops.length;
    const runtime = loops[0].brainLive ? "on" : "waiting";
    const noun = count === 1 ? "loop" : "loops";
    const label = `${areaLabel(areaPath)} has ${count} active ${noun}, ${runtime}. Open Processes.`;
    return `<span class="work-group-loop-controls"><button class="work-group-loop" type="button" data-open-area-processes="${escapeHtml(areaPath)}" data-focus-key="loops:${escapeHtml(areaPath)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}">↻ ${count} ${noun} · ${runtime}</button></span>`;
  }

  /**
   * The group header row: Area, aggregate state, Goal count, and the one brain
   * route for every row below it. The Action column never repeats that route
   * (design-redesign-work-as-a-compact-table Decision 4).
   *
   * With `parentPath` it is a sub-header: one thin indented row for a sub-Area
   * inside an open group, named by its path below the parent, with its own
   * fold, count, brain button, and menu. It prints the brain state only when
   * a brain is live or asking, and never the note signal line
   * (work-view-sub-areas Decisions 1 to 3).
   */
  function workGroupHeaderRow(record, facts = new Map(), { parentPath = "" } = {}) {
    const { area, trees, descriptions, sections } = record;
    const sub = Boolean(parentPath);
    const folded = sub ? subAreaIsFoldedOnWork(area.path) : areaIsFoldedOnWork(area.path);
    // An open sub-header counts only its own work and its own brain. A folded
    // one stands for its hidden subtree, so it rolls up its descendants'
    // Goals, blockers, and questions (the caller passes them as `sections`).
    const ownBrainOnly = sub && !folded;
    const allTrees = [...trees, ...sections.flatMap((section) => section.trees)];
    const allDescriptions = [...descriptions, ...sections.flatMap((section) => section.descriptions)];
    const summary = deskAreaSummary(area.path, allTrees, allDescriptions, facts, { ownBrainOnly });
    // The pill keeps saying what the Area is doing, so a live brain with no
    // agent under it still states itself (design-active-brains-show-on-work-
    // even-with-no-agents). Only its "waiting" case changed source: it counts
    // the Questions brains asked, never an inferred ask.
    const status = deskAreaState(area.path, allTrees, allDescriptions, { ownBrainOnly });
    const brain = brainForAreaCard(area.path);
    const label = brain?.live ? "Open brain" : brain ? "Resume brain" : "Start brain";
    // A live brain opens its own session; only a missing or stopped one goes
    // through the start route, which is what Resume and Start mean.
    const route = brain?.live
      ? `data-open-brain="${escapeHtml(brain.session ?? "")}"`
      : `data-open-area-brain="${escapeHtml(area.path)}"`;
    const name = sub ? descendantPath(area.path, parentPath) : humanName(area.name);
    const cursor = `area:${area.path}`;
    const showState = !sub || summary.questions || brain?.live;
    // A quiet sub-Area (no open work, no live brain, no question) prints in
    // the muted style so the eye skips it, and keeps its fold, brain button,
    // and menu so its brain stays reachable.
    const quiet = sub && !allTrees.some((tree) => tree.goals.some((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status)))
      && !allDescriptions.length && !summary.questions && !brain?.live && !activeLoopsForArea(area.path).length;
    const starred = areaFocusRoots().includes(area.path);
    const starButton = `<button class="work-star${starred ? " starred" : ""}" type="button" data-star-area="${escapeHtml(area.path)}" aria-pressed="${starred}" ${workCommandAttributes("starArea", `${starred ? "Unstar" : "Star"} ${areaLabel(area.path)} (f)`)} aria-label="${starred ? "Unstar" : "Star"} ${escapeHtml(areaLabel(area.path))}"><span aria-hidden="true">${starred ? "★" : "☆"}</span></button>`;
    const mapButton = `<button class="desk-action" type="button" data-open-area-map="${escapeHtml(area.path)}" ${workCommandAttributes("map", `Open map for ${areaLabel(area.path)} (m)`)}>Map <kbd>m</kbd></button>`;
    // The visible text identifies the agent as the brain. The shared agent
    // entry command supplies its key and keyboard label.
    const brainButton = `<button class="work-group-brain" type="button" ${route} ${workCommandAttributes("session", `${label} for ${areaLabel(area.path)} (${workCommand("session").keyDisplay})`)} data-focus-key="brain:${escapeHtml(area.path)}" aria-label="${escapeHtml(label)} for ${escapeHtml(areaLabel(area.path))}" data-brain-verb="${escapeHtml(label)}"><span class="work-group-brain-text">brain</span>${workKey("session")}</button>${brainLoopMark(area.path)}`;
    return `<tr class="work-group-row${sub ? " work-sub-area-row" : ""}${quiet ? " quiet" : ""}${folded ? " folded" : ""}${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-search-text="${escapeHtml(`${name} ${area.path}`)}" data-work-area="${escapeHtml(area.path)}"${sub ? ` data-work-sub-area="${escapeHtml(area.path)}"` : ""}>
      <th class="work-group-head" colspan="${WORK_COLUMNS.length}" scope="${sub ? "row" : "rowgroup"}" id="${workGroupId(area.path)}">
        <div class="work-group-layout">
          <div class="work-group-identity">
            <span class="work-group-name">${workFoldTriangle({ open: !folded, area: area.path, name })}<button type="button" data-work-cursor-control data-focus-key="area:${escapeHtml(area.path)}" data-open-document="${escapeHtml(areaNoteFile(area.path))}" ${workCommandAttributes("open", `Read the ${areaLabel(area.path)} note (↵)`)}>${escapeHtml(name)}</button>${starButton}</span>
            <span class="work-group-count">${escapeHtml(summary.text)}</span>
            ${!showState || !status
              ? ""
              : summary.questions
                ? `<button class="desk-state ${status.kind}" type="button" data-review-questions="${escapeHtml(area.path)}" ${workCommandAttributes("questions")}>${escapeHtml(status.label)}${workKey("questions")}</button>`
                : `<span class="desk-state ${status.kind}" title="${escapeHtml(status.title)}">${escapeHtml(status.label)}</span>`}
          </div>
          <div class="work-group-controls work-row-controls">
            ${mapButton}${brainButton}
            <button class="desk-action-menu-trigger" type="button" data-work-object-actions data-work-object-area="${escapeHtml(area.path)}" data-focus-key="menu:area:${escapeHtml(area.path)}" ${workCommandAttributes("keys")} aria-label="Keys for ${escapeHtml(name)}">⋯${workKey("keys")}</button>
          </div>
        </div>
      </th>
    </tr>`;
  }

  /**
   * The one-sentence hover of every state word the table prints, so a word
   * never has to be decoded (work-screen-refresh D6). A word outside the
   * table falls back to a sentence built from its kind.
   */
  const WORK_STATE_TITLES = Object.freeze({
    "Working": "The agent is producing output now.",
    "Waiting": "The agent stopped at its prompt and needs your next message.",
    "Waiting for you": "The agent stopped at its prompt and needs your next message.",
    "Needs your decision": "The agent shows a choice only you can make.",
    "Finished · ready for you": "The agent reported done. Read it and close the Goal.",
    "Holding your draft": "You typed a message there and did not send it.",
    "Agent did not start": "The session opened but no agent runs in it.",
    "Stopped": "The agent's session is gone. The brain decides what runs next.",
    "Not started": "This Assignment waits for the Brain to start it.",
    "Open": "No agent runs. Enter reads the Goal; the brain starts agents.",
    "Ready": "No agent runs. Enter starts one.",
    "Ready for validation": "The work is done and waits for its check.",
    "Preparing validation": "The run ended; the check is being set up.",
    "Check it": "You asked to verify this yourself.",
    "Complete": "Done.",
    "Parked": "Set aside on purpose. Nothing runs and nothing waits.",
    "Deferred": "Pushed back. Nothing runs and nothing waits.",
  });

  /** The hover sentence for one state word, never empty. */
  function workStateTitle(word, kind = "") {
    if (WORK_STATE_TITLES[word]) return WORK_STATE_TITLES[word];
    if (kind === "working") return "An agent is producing output now.";
    if (kind === "waiting") return "Stopped and waiting for you.";
    if (kind === "complete") return "Done.";
    return `${word}.`;
  }

  /**
   * The Status cell: one state word and the elapsed time, one line
   * (work-screen-refresh D6). The word's hover explains it; the elapsed
   * hover keeps the start time; a wait's hover keeps its reason.
   */
  function workStatusCell(action, facts, now) {
    const stateReason = action.title || workStateTitle(action.state, action.kind);
    const reason = facts?.waiting?.title && action.kind !== "working" ? `${stateReason}\n${facts.waiting.title}` : stateReason;
    const word = `<span class="desk-state ${action.kind}" title="${escapeHtml(reason)}">${escapeHtml(action.state)}</span>`;
    const elapsed = deskGoalElapsed(facts, now);
    return `<td class="work-cell-status">${word}${elapsed ? `<span class="work-status-sep" aria-hidden="true"> · </span>${elapsed}` : ""}</td>`;
  }

  /**
   * The agent control: agent name, launch, and step, printed once, as the one
   * button that enters the run with its registered key (work-screen-refresh
   * D5). A finished or stopped run prints its last launch muted with no key;
   * a Goal that never had an agent prints a dash. The wide Agent cell and the
   * narrow copy under the title print the same markup; CSS shows one.
   */
  function workAgentControl(goal, action, pipeline, liveSession, { inline = false } = {}) {
    const hover = [action.launch ? `${action.action} on ${action.launch}` : action.action, action.stepTitle, action.cwd ? `in ${action.cwd}` : ""].filter(Boolean).join("\n");
    if (action.route === "run") {
      const text = [liveSession ? agentName(liveSession) : "", action.launch, action.stepShort].filter(Boolean).join(" · ") || action.action;
      // One focus key per row: the wide cell owns it, the narrow copy does not.
      const focusKey = inline ? "" : ` data-focus-key="open:${escapeHtml(goal.file)}"`;
      return `<button class="work-agent-ref" type="button" data-open-goal-run="${escapeHtml(goal.file)}"${focusKey} ${workCommandAttributes("session", hover)} aria-label="${escapeHtml(action.launch ? `${action.action} on ${action.launch}` : action.action)}: ${escapeHtml(goal.title)}"><span class="work-agent-ref-text">${escapeHtml(text)}</span>${workKey("session")}</button>`;
    }
    const steps = pipeline?.steps ?? [];
    const last = steps.find((step) => step.index === Number(action.stepShort?.split("/")[0])) ?? steps.at(-1);
    // A step recorded before launch ids existed keeps its label as the name.
    const launch = launchRefText(last?.launch) || last?.label || "";
    const text = [launch, action.stepShort].filter(Boolean).join(" · ");
    return text
      ? `<span class="work-agent-ref past" title="${escapeHtml(action.stepTitle || `Last agent: ${launch}`)}">${escapeHtml(text)}</span>`
      : `<span class="work-no-agent">—</span>`;
  }

  /** The Agent cell of the wide layout; `workAgentControl` is its content. */
  function workAgentCell(goal, action, pipeline, liveSession) {
    return `<td class="work-cell-agent">${workAgentControl(goal, action, pipeline, liveSession)}</td>`;
  }

  /**
   * The row-end controls cell: the `⋯` route into the key sheet, revealed on
   * the cursor row, hover, and focus (work-screen-refresh D4), and a cleanup
   * failure that must stay visible whatever the pointer does.
   */
  function workControlsCell(goal) {
    const cleanup = ["done", "dropped"].includes(goal.status)
      ? (state.goalCleanups ?? []).find((item) => item.goal === goal.file)
      : null;
    const cleanupFailure = cleanup?.failures?.[0];
    const cleanupControl = cleanupFailure
      ? `<button class="desk-action cleanup-error" type="button" data-retry-goal-cleanup="${escapeHtml(goal.file)}" title="${escapeHtml(cleanupFailure.error)}">Worker cleanup failed · Retry</button>`
      : "";
    return `<td class="work-cell-controls">${cleanupControl}<span class="work-row-controls">
      <button class="desk-action-menu-trigger" type="button" data-work-object-actions data-work-object-goal="${escapeHtml(goal.file)}" data-focus-key="menu:${escapeHtml(goal.file)}" ${workCommandAttributes("keys")} aria-label="Keys for ${escapeHtml(goal.title)}">⋯${workKey("keys")}</button></span></td>`;
  }

  /**
   * One Goal as one table row: Goal, Agent, Status, controls. The Goal title
   * is the row header, so every other cell carries the Goal's name for a
   * screen reader. The Goal cell also holds one narrow-width copy of the
   * status facts; CSS shows exactly one copy at each width, so nothing is
   * read twice.
   */
  function workGoalRow(goal, { groupPath, labels, fact, subgoal = false, subArea = false, parent = "", hidden = false, subgoalCount = 0, expanded = true } = {}) {
    const pipeline = pipelineForGoal(goal);
    const action = pipeline ? deskPipelineAction(goal, pipeline) : deskGoalAction(goal);
    const { facts, now } = deskGoalFactsData(goal);
    const path = labels?.get(goal.area) ?? descendantPath(goal.area, groupPath);
    const compact = [action.state, deskGoalElapsedText(facts, now)].filter(Boolean).join(" · ");
    const liveSession = sessionForGoal(goal);
    // Plain Enter and the title open the Goal itself. The live agent is one
    // chord away, Command-Shift-Enter (design agent-shell-enter-key).
    const titleRoute = `data-open-close="${escapeHtml(goal.file)}"`;
    const subgoalWord = `${subgoalCount} ${subgoalCount === 1 ? "Subgoal" : "Subgoals"}`;
    const disclosure = subgoalCount ? workFoldTriangle({ open: expanded, goal: goal.file, name: `${subgoalWord} of ${goal.title}` }) : WORK_FOLD_SPACE;
    // A folded Goal names what it hides. Open, the Subgoal rows are the count.
    const subgoalNote = subgoalCount && !expanded
      ? `<small class="work-subgoal-count">${escapeHtml(subgoalWord)}</small>`
      : "";
    const cursor = `goal:${goal.file}`;
    const searchText = [goal.title, areaLabel(goal.area), action.state, action.stepShort].filter(Boolean).join(" ");
    return `<tr class="desk-goal work-row ${subgoal ? "subgoal" : "root-goal"}${subArea ? " under-sub-area" : ""} ${action.kind}${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-search-text="${escapeHtml(searchText)}" data-goal-anchor="${escapeHtml(goal.file)}" data-work-area="${escapeHtml(goal.area)}"${subgoal ? ` data-subgoal-of="${escapeHtml(parent)}"` : ""}${hidden ? " hidden" : ""}>
      <th class="work-cell-work" scope="row">
        <span class="work-cell-title">${disclosure}<span class="work-goal-copy"><span class="work-goal-primary"><button class="work-row-title" type="button" data-work-row-title ${titleRoute} data-focus-key="title:${escapeHtml(goal.file)}" title="${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</button>${subgoalNote}${path ? `<small class="work-row-path">${escapeHtml(path)}</small>` : ""}</span><span class="work-cell-agent-inline">${workAgentControl(goal, action, pipeline, liveSession, { inline: true })}</span></span></span>
        <small class="work-cell-facts">${escapeHtml(compact)}</small>
      </th>
      ${workAgentCell(goal, action, pipeline, liveSession)}
      ${workStatusCell(action, facts, now)}
      ${workControlsCell(goal)}
    </tr>`;
  }

  /** The elapsed text without its markup, for the narrow row's one-line facts. */
  function deskGoalElapsedText(facts, now) {
    const core = goalCardCore;
    if (!core || !facts) return "";
    return core.elapsedLabel(facts, now) ?? "";
  }

  /** One work-definition conversation as a table row of its own. */
  function workDefinitionRow(session) {
    const name = agentName(session);
    const stateName = describeWorkStateLabel(session);
    const kind = session.state === "working" ? "working" : "waiting";
    const cursor = `definition:${session.name}`;
    return `<tr class="desk-definition work-row definition ${kind}${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-search-text="${escapeHtml(`${name} ${stateName}`)}" data-work-area="${escapeHtml(session.area ?? "")}">
      <th class="work-cell-work" scope="row">
        <span class="work-cell-title">${WORK_FOLD_SPACE}<button class="work-row-title" type="button" data-work-row-title data-select-work-definition="${escapeHtml(session.name)}" data-focus-key="definition:${escapeHtml(session.name)}">${escapeHtml(session.workTitle || "Define new work")}</button><small class="work-row-path">Defining work</small></span>
        <small class="work-cell-facts">${escapeHtml(stateName)}</small>
      </th>
      <td class="work-cell-agent"><button class="work-agent-ref" type="button" data-select-work-definition="${escapeHtml(session.name)}" ${workCommandAttributes("session", `Open ${name}`)} aria-label="Open ${escapeHtml(name)} for ${escapeHtml(session.workTitle || "this description")}"><span class="work-agent-ref-text">${escapeHtml(name)}</span>${workKey("session")}</button></td>
      <td class="work-cell-status"><span class="desk-state ${kind}" title="${escapeHtml(workStateTitle(stateName, kind))}">${escapeHtml(stateName)}</span></td>
      <td class="work-cell-controls"></td>
    </tr>`;
  }

  /** True when one group has a row to show, or is a chosen Focus root that must say it has none. */
  function workGroupHasRows(record) {
    if (record.focusRoot) return true;
    // A live brain earns its Area a header with no row under it, so Work
    // shows that the brain is alive even when it dispatched no agent
    // (design-active-brains-show-on-work-even-with-no-agents). Planned work
    // is about unstarted Goals, so that filter alone does not force the group.
    // Every other filter does, "all" included: that view shows more than
    // Current, so it must not be the one place a live brain disappears.
    if (state.workFilter !== "inactive" && record.brain?.live) return true;
    if (state.workFilter !== "inactive" && (record.brain?.repair?.current || record.brain?.agentState?.owner === "you")) return true;
    if (state.workFilter !== "inactive" && record.sections.some((section) => brainForAreaCard(section.area.path)?.live)) return true;
    if (state.workFilter !== "inactive" && record.sections.some((section) => {
      const brain = brainForAreaCard(section.area.path);
      return brain?.repair?.current || brain?.agentState?.owner === "you";
    })) return true;
    return [record, ...record.sections].some((part) => part.descriptions.length
      || areaProcessesForArea(part.area.path).length
      || (part.area.presentations ?? []).length
      || part.trees.some((tree) => tree.goals.some((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status))));
  }

  /** One brain-owned Area group as one row group of the work table. */
  function workGroupBody(record, facts) {
    const { area, trees, descriptions, sections } = record;
    // The Area's own rows sit under its header. Each sub-Area with work gets
    // one flat sub-header in path order, and its rows sit under that, so no
    // row needs a path tag (work-view-sub-areas Decision 1).
    const own = [
      ...areaPresentationRows(area),
      ...areaProcessesForArea(area.path).map((item) => workProcessRow(item)),
      ...descriptions.map((session) => workDefinitionRow(session)),
      ...orderedGoalTrees(trees).map((tree) => workTreeRows(tree, area.path, null, facts)),
    ].join("");
    const body = own + workSubAreaSections(sections, area, facts);
    // A focused Area stays on the screen with nothing in it, and says why, so
    // Julian can see that his Focus is what emptied the table.
    const empty = record.focusRoot && !record.focusHasWork
      ? `<tr class="work-empty-row"><td class="area-focus-empty" colspan="${WORK_COLUMNS.length}">No work matches in this Focus.</td></tr>`
      : "";
    const folded = areaIsFoldedOnWork(area.path);
    return `<tbody class="work-group${folded ? " folded" : ""}" data-work-group="${escapeHtml(area.path)}" data-desk-area="${escapeHtml(area.path)}" aria-labelledby="${workGroupId(area.path)}">
      ${workGroupHeaderRow(record, facts)}${folded ? "" : `${body}${empty}`}
    </tbody>`;
  }

  /**
   * The sub-headers of one open Area group in path order, each with its rows.
   * A folded sub-Area hides its whole subtree: every deeper sub-Area's row and
   * Goals go with it, and its own row rolls up what it hides. A hidden
   * sub-Area keeps its own fold state in the store for when its ancestor
   * opens again. Julian folded `otto/dnd` and `otto/dnd/players` stayed.
   */
  function workSubAreaSections(sections, parentArea, facts) {
    const sorted = [...sections].sort((left, right) => left.area.path.localeCompare(right.area.path));
    const foldedPaths = sorted.map((section) => section.area.path).filter(subAreaIsFoldedOnWork);
    /** True when a folded sub-Area above this path hides it. */
    const underFold = (path) => foldedPaths.some((folded) => path.startsWith(`${folded}/`));
    return sorted
      .filter((section) => !underFold(section.area.path))
      .map((section) => workSubAreaRows(section, parentArea, facts, sorted.filter((other) => other.area.path.startsWith(`${section.area.path}/`))))
      .join("");
  }

  /**
   * One sub-Area inside an open Area group: its thin sub-header, then its own
   * rows unless the sub-Area is folded. A folded sub-Area keeps its count and
   * its brain state on the sub-header, rolled up over the `descendants` it
   * hides (work-view-sub-areas Decision 6).
   */
  function workSubAreaRows(section, parentArea, facts, descendants = []) {
    const folded = subAreaIsFoldedOnWork(section.area.path);
    const header = workGroupHeaderRow({ area: section.area, trees: section.trees, descriptions: section.descriptions, sections: folded ? descendants : [] }, facts, { parentPath: parentArea.path });
    if (folded) return header;
    const rows = [
      ...areaPresentationRows(section.area),
      ...areaProcessesForArea(section.area.path).map((item) => workProcessRow(item)),
      ...section.descriptions.map((session) => workDefinitionRow(session)),
      ...orderedGoalTrees(section.trees).map((tree) => workTreeRows(tree, section.area.path, null, facts, { subArea: true })),
    ].join("");
    return header + rows;
  }

  /** One exact-Area Process row with inspect and authorized lifecycle controls. */
  function workProcessRow(item) {
    const stateText = item.error ? `Broken note: ${item.error}` : item.state || (item.status === "paused" ? "Paused" : "Active");
    const stateKind = item.error ? "waiting" : item.status === "paused" ? "complete" : item.due ? "waiting" : "working";
    const action = item.status === "paused" ? "resume" : "pause";
    const actionWord = action === "pause" ? "Pause" : "Resume";
    const identity = `data-process-area="${escapeHtml(item.area)}" data-process-slug="${escapeHtml(item.slug)}" data-process-file="${escapeHtml(item.file)}"`;
    const lifecycle = item.error ? "" : `<button class="work-process-control" type="button" data-control-process data-process-action="${action}" ${identity} aria-label="${actionWord} process ${escapeHtml(item.slug)} in ${escapeHtml(areaLabel(item.area))}">${actionWord}</button>`;
    const remove = item.loop ? `<button class="work-process-control danger" type="button" data-remove-process ${identity} aria-label="Remove loop ${escapeHtml(item.slug)} from ${escapeHtml(areaLabel(item.area))}">Remove</button>` : "";
    return `<tr class="work-process-row work-row ${item.status === "paused" ? "paused" : ""}" data-search-text="${escapeHtml(`${item.title} ${item.slug} ${item.when} ${stateText}`)}" data-work-area="${escapeHtml(item.area)}">
      <th class="work-cell-work" scope="row">
        <span class="work-cell-title">${WORK_FOLD_SPACE}<button class="work-row-title" type="button" data-open-document="${escapeHtml(item.file)}" data-focus-key="process:${escapeHtml(item.file)}" aria-label="Inspect process ${escapeHtml(item.title)}">${escapeHtml(item.title)}</button><small class="work-row-path">Process</small></span>
        <small class="work-cell-facts">${escapeHtml(item.when)}</small>
      </th>
      <td class="work-cell-agent"><span class="work-process-when" title="${escapeHtml(item.when)}">${escapeHtml(item.when)}</span></td>
      <td class="work-cell-status"><span class="desk-state ${stateKind}" title="${escapeHtml(stateText)}">${escapeHtml(stateText)}</span></td>
      <td class="work-cell-controls"><span class="work-process-controls"><button class="work-process-control" type="button" data-open-document="${escapeHtml(item.file)}" aria-label="Inspect process ${escapeHtml(item.title)}">Inspect</button>${lifecycle}${remove}</span></td>
    </tr>`;
  }

  /**
   * Whether one sub-Area is folded on Work. A sub-Area opens by default and
   * folds only when Julian folded it, whatever the Focus says: the Focus
   * rule that folds every top-level Area but the first is about attention
   * between subjects, not inside one (work-view-sub-areas Decision 7).
   */
  function subAreaIsFoldedOnWork(path) {
    return state.foldedWorkAreas.has(path);
  }

  /**
   * Whether one Area group is folded on Work.
   *
   * The primary focused Area opens expanded and every other Area folds, which
   * is what makes Focus an attention control rather than a filter. Folding no
   * longer needs a Focus to exist: without one the Areas Julian expanded stay
   * open and the rest stay quiet, so `z` works on the plain desk too.
   */
  function areaIsFoldedOnWork(path) {
    // A star never changes which groups are open (area-star-focus Decision 5):
    // with stars added one at a time, "only the first root opens" folded the
    // Area Julian had just starred whenever it sorted after another root.
    return state.foldedWorkAreas.has(path);
  }

  /** Sets one Area tree node without changing Area Focus. */
  function setWorkAreaFolded(area, folded) {
    if (!area) return;
    if (folded) {
      state.foldedWorkAreas.add(area);
      state.expandedAreas.delete(area);
    } else {
      state.foldedWorkAreas.delete(area);
      state.expandedAreas.add(area);
    }
    saveExpandedAreas();
    saveFoldedWorkAreas();
    paint(true);
  }

  /** Compatibility pointer for non-tree callers. */
  function toggleWorkArea(area) {
    setWorkAreaFolded(area, !areaIsFoldedOnWork(area));
  }

  /** Keeps the folded Areas across reloads, the same way the expanded ones persist. */
  function saveFoldedWorkAreas() {
    try {
      localStorage.setItem("agent-shell.folded-work-areas", JSON.stringify([...state.foldedWorkAreas]));
    } catch {
      showToast("The folded Areas could not be saved.");
    }
  }

  /**
   * One preorder Goal tree as adjacent rows.
   *
   * Depth, rather than list position, owns parentage. Each rendered Goal gets
   * only its direct open children, and a collapsed ancestor hides its complete
   * descendant branch even when an intermediate Goal remains expanded.
   */
  function workTreeRows(tree, groupPath, labels, facts, { subArea = false } = {}) {
    const closed = new Set(["done", "dropped", "parked", "deferred"]);
    const goals = tree.goals.filter((goal, index) => index === 0 || !closed.has(goal.status));
    const stack = [];
    const nodes = goals.map((goal) => {
      const parsedDepth = Number(goal.depth ?? 0);
      const depth = Number.isFinite(parsedDepth) ? Math.max(0, Math.trunc(parsedDepth)) : 0;
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      const parent = stack.at(-1) ?? null;
      const node = { goal, depth, parent, children: [] };
      if (parent) parent.children.push(node);
      stack.push(node);
      return node;
    });
    /** True when any rendered ancestor owns the collapsed branch. */
    const hiddenByAncestor = (node) => {
      for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (state.collapsedGoalTrees.has(ancestor.goal.file)) return true;
      }
      return false;
    };
    return nodes.map((node) => {
      const expanded = !state.collapsedGoalTrees.has(node.goal.file);
      const goalRow = workGoalRow(node.goal, {
        groupPath,
        labels,
        fact: facts.get(node.goal.file),
        subgoal: Boolean(node.parent),
        subArea,
        parent: node.parent?.goal.file ?? "",
        hidden: hiddenByAncestor(node),
        subgoalCount: node.children.length,
        expanded,
      });
      const children = [...(node.goal.presentations ?? []).map((item) => ({ type: "document", item })), ...(node.goal.cards ?? []).map((item) => ({ type: "card", item }))];
      const visible = children.slice(0, PRESENTED_ROWS_PER_GOAL);
      const presentationRows = visible.map(({ type, item }) => type === "card" ? workCardRow(node.goal, item) : workPresentedDocumentRow(node.goal, item)).join("");
      const overflow = children.length - visible.length;
      return `${goalRow}${presentationRows}${overflow > 0 ? workPresentationOverflowRow(node.goal, overflow) : ""}`;
    }).join("");
  }

  /** One product-owned row for validated card data. */
  function workCardRow(goal, card) {
    const cursor = `card:${goal.file}:${card.id}`;
    const action = card.kind === "copy" ? "copy" : card.kind === "link" ? "open" : "show";
    const stopped = card.presenterLive === false ? " (brain stopped)" : "";
    const presentedBy = card.presentedBy?.session || "brain";
    return `<tr class="desk-document work-row presented-card${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(goal.area)}" data-card-goal="${escapeHtml(goal.file)}" data-card-id="${escapeHtml(card.id)}" data-card-kind="${escapeHtml(card.kind)}" data-search-text="${escapeHtml(`${card.kind} ${card.title} ${card.summary ?? ""}`)}">
      <th class="work-cell-work" scope="row"><span class="work-cell-title">${WORK_FOLD_SPACE}<span class="work-goal-copy"><span class="work-goal-primary"><button type="button" class="work-row-title" data-work-row-title data-card-action aria-label="${escapeHtml(`${card.kind}: ${card.title}, presented by ${presentedBy}`)}" aria-keyshortcuts="Enter" title="${escapeHtml(`Presented by ${presentedBy}${stopped}`)}">↳ ${escapeHtml(card.kind)} · ${escapeHtml(card.title)}</button></span></span></span></th>
      <td><small>${escapeHtml(card.summary ?? "")}</small></td><td></td>
      <td><span class="work-row-controls"><button type="button" data-card-action aria-keyshortcuts="Enter">↵ ${action}</button><button type="button" data-card-goal-open aria-keyshortcuts="o">o goal</button><button type="button" data-card-dismiss aria-keyshortcuts="x">x dismiss</button></span></td>
    </tr>`;
  }

  /** One temporary attention row for a Document that an agent presented. */
  function workPresentedDocumentRow(goal, item) {
    const cursor = `document:${goal.file}:${item.file}`;
    return `<tr class="desk-document work-row presented-document${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(goal.area)}" data-presentation-goal="${escapeHtml(goal.file)}" data-presentation-file="${escapeHtml(item.file)}" data-presentation-hash="${escapeHtml(item.presentedHash ?? "")}" data-search-text="${escapeHtml(`${item.title} ${item.file}`)}">
      <th class="work-cell-work" scope="row"><span class="work-cell-title">${WORK_FOLD_SPACE}<span class="work-goal-copy"><span class="work-goal-primary"><button type="button" class="work-row-title" data-work-row-title data-open-document="${escapeHtml(item.file)}" data-document-root="${escapeHtml(item.root ?? "vault")}" title="${escapeHtml(item.file)}">↳ Read · ${escapeHtml(item.title)}</button></span></span></span></th>
      <td><small>${escapeHtml(item.note || item.presentedBy?.session || "Presented")}</small></td><td></td>
      <td><span class="work-row-controls"><button type="button" data-presentation-full="${escapeHtml(item.file)}" title="Open full reader">o full</button><button type="button" data-withdraw-presentation="${escapeHtml(item.file)}" title="Dismiss presentation">x dismiss</button></span></td>
    </tr>`;
  }

  /** Area-scoped attention rows use the same Document surface without a Goal. */
  function areaPresentationRows(area) {
    const items = area.presentations ?? [];
    const rows = items.slice(0, PRESENTED_ROWS_PER_GOAL).map((item) => {
      const cursor = `area-document:${area.path}:${item.file}`;
      const presenter = item.presentedBy?.session || "brain";
      return `<tr class="desk-document work-row presented-document${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(area.path)}" data-presentation-area="${escapeHtml(area.path)}" data-presentation-file="${escapeHtml(item.file)}" data-presentation-hash="${escapeHtml(item.presentedHash ?? "")}" data-search-text="${escapeHtml(`${item.title} ${item.file}`)}">
        <th class="work-cell-work" scope="row"><span class="work-cell-title">${WORK_FOLD_SPACE}<span class="work-goal-copy"><span class="work-goal-primary"><button type="button" class="work-row-title" data-work-row-title data-open-document="${escapeHtml(item.file)}" data-document-root="vault" aria-label="${escapeHtml(`Read ${item.title}, in ${area.path}, presented by ${presenter}`)}" title="${escapeHtml(item.file)}">↳ Read · ${escapeHtml(item.title)}</button></span></span></span></th>
        <td><small>${escapeHtml(item.note || presenter)}</small></td><td></td>
        <td><span class="work-row-controls"><button type="button" data-presentation-full="${escapeHtml(item.file)}" title="Open full reader">o full</button><button type="button" data-withdraw-presentation="${escapeHtml(item.file)}" title="Dismiss presentation">x dismiss</button></span></td>
      </tr>`;
    });
    if (items.length > PRESENTED_ROWS_PER_GOAL) {
      const hidden = items[PRESENTED_ROWS_PER_GOAL];
      rows.push(`<tr class="desk-document work-row presented-document overflow" data-work-area="${escapeHtml(area.path)}"><th class="work-cell-work" scope="row"><span class="work-cell-title">${WORK_FOLD_SPACE}<button type="button" data-open-document="${escapeHtml(hidden.file)}" data-presentation-area="${escapeHtml(area.path)}">and ${items.length - PRESENTED_ROWS_PER_GOAL} more · o</button></span></th><td></td><td></td><td></td></tr>`);
    }
    return rows;
  }

  /** One compact row for presentations beyond the desk cap. */
  function workPresentationOverflowRow(goal, count) {
    const cursor = `document-more:${goal.file}`;
    return `<tr class="desk-document work-row presented-document overflow${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(goal.area)}"><th class="work-cell-work" scope="row"><span class="work-cell-title">${WORK_FOLD_SPACE}<button type="button" data-work-row-title data-open-document="${escapeHtml(goal.file)}">and ${count} more · o</button></span></th><td></td><td></td><td></td></tr>`;
  }

  /** Renders the Programs of one Area as a compact operational shelf. */
  function deskProgramShelf(programs) {
    return `<div class="desk-programs">${programs.map((program) => {
      return `
        <div class="desk-program ${programIsLive(program) ? "live" : ""}">
          <button type="button" data-select-program="${escapeHtml(program.id)}">
            <span aria-hidden="true">${escapeHtml(String(program.mode ?? "on-demand").toUpperCase())}</span>
            <strong>${escapeHtml(program.label)}</strong>
            <em>${escapeHtml(program.problem ? clip(program.problem, 80) : programState(program))}</em>
          </button>
          ${programRowControls(program).map((control) => `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>`).join("")}
        </div>`;
    }).join("")}</div>`;
  }

  /** Renders Programs once under the Area that owns them. */
  function deskProgramSection(area, programs, { root = false } = {}) {
    if (!programs?.length) return "";
    const title = root ? "Operation problems" : `${humanName(area.name)} · Operation problems`;
    return `<section class="area-desk-section programs" data-program-area="${escapeHtml(area.path)}">
      <div class="area-desk-section-heading"><h3>${escapeHtml(title)}</h3><span>${programs.length}</span></div>
      ${deskProgramShelf(programs)}
    </section>`;
  }

  /**
   * The processes on the screen whose due note waits for a brain that is
   * not running (D17). A waiting or running process is a fact the Area page
   * holds; only this state asks Julian to start the brain.
   */
  function workProcessSections(records) {
    const areas = records.flatMap((record) => [record.area.path, ...record.sections.map((section) => section.area.path)]);
    const due = (state.programs.processes ?? []).filter((item) => item.due && !item.brainLive && areas.includes(item.area));
    if (!due.length) return "";
    return `<div class="work-processes"><section class="area-desk-section processes">
      <div class="area-desk-section-heading"><h3>Processes due</h3><span>${due.length}</span></div>
      <div class="desk-programs">${due.map((item) => `
        <div class="desk-program">
          <button type="button" data-open-document="${escapeHtml(item.file)}">
            <span aria-hidden="true">${escapeHtml(item.area)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <em>${escapeHtml(item.state)}</em>
          </button>
          <button class="desk-icon-action" type="button" data-open-area-brain="${escapeHtml(item.area)}" data-brain-area="${escapeHtml(item.area)}" aria-label="Start the ${escapeHtml(item.area)} brain">Start brain</button>
        </div>`).join("")}</div>
    </section></div>`;
  }

  /**
   * The Operations of every Area on the screen that have a problem.
   *
   * A healthy Operation adds nothing to Work: a running service and a
   * scheduled command that succeeded are facts the Area page holds. Only a
   * problem can change what Julian does, so only a problem earns space here
   * and the whole shelf disappears when every Operation is quiet.
   */
  function workProgramSections(records) {
    /** Keeps only the Operations whose state is a problem. */
    const problems = (programs) => (programs ?? []).filter((program) => program.state === "problem" || program.problem);
    const sections = records.flatMap((record) => [
      deskProgramSection(record.area, problems(record.programs), { root: true }),
      ...record.sections.map((section) => deskProgramSection(section.area, problems(section.programs))),
    ]).filter(Boolean).join("");
    if (!sections) return "";
    return `<div class="work-programs">${sections}</div>`;
  }

  /**
   * Shows or hides one parent Goal's Subgoal rows. The state is local to the
   * browser and survives a repaint, so a poll never reopens a chain Julian
   * closed. The rows stay `<tr>` children of their row group; the disclosure
   * hides them, it does not move them into another element.
   */
  function setSubgoalsExpanded(file, expanded) {
    if (expanded) state.collapsedGoalTrees.delete(file);
    else state.collapsedGoalTrees.add(file);
    localStorage.setItem("agent-shell.collapsed-goal-trees", JSON.stringify([...state.collapsedGoalTrees]));
    paint(true);
  }

  /** Compatibility pointer for callers that still ask for a toggle. */
  function toggleSubgoals(file) {
    setSubgoalsExpanded(file, state.collapsedGoalTrees.has(file));
  }

  /**
   * The caption's key line follows the cursor row (work-view-affordances D6):
   * an Area row prints `⌘⇧↵ agent · h/l fold`, a Goal row `↵ open · o
   * read`. The same registry feeds the `?` sheet.
   */
  function workCaptionHint() {
    const kind = workRowKind(state.workCursor);
    // Each entry is a button that runs its command on click (work-screen-
    // refresh D7): the line teaches the key and takes the pointer. The search
    // and keys entries keep the data attributes the toolbar buttons carried.
    const keys = workCaptionKeys(kind).map(({ ids, keyDisplay, word }) => {
      const id = ids[0];
      const extra = id === "search" ? " data-work-search" : id === "keys" ? " data-work-keys" : "";
      return `<button class="work-caption-key" type="button" data-work-caption-command="${escapeHtml(id)}"${extra} ${workCommandAttributes(id)}><kbd>${escapeHtml(keyDisplay)}</kbd> ${escapeHtml(word)}</button>`;
    }).join(`<span class="work-caption-dot" aria-hidden="true"> · </span>`);
    return `<span class="work-keyboard-hint" data-work-caption-row="${escapeHtml(kind)}">${keys}</span>`;
  }

  /**
   * Repaints only the caption's key line inside `root`. A cursor move that
   * toggles classes without a full paint calls this, so the caption never
   * lags the row it describes.
   */
  function paintWorkCaption(root) {
    const hint = root?.querySelector?.(".work-table .work-keyboard-hint");
    if (hint) hint.outerHTML = workCaptionHint();
  }

  /** The complete work table: one caption, one header, one row group per Area. */
  function workTable(records) {
    const facts = readinessFacts();
    // Every top-level Area keeps its header, with `0 open` when nothing is
    // under it, so its brain and its sub-Areas stay reachable (work-view-
    // sub-areas, every Area has a row).
    const shown = records;
    const bodies = shown.map((record) => workGroupBody(record, facts)).join("");
    const rowCount = shown.reduce((count, record) => count + [record, ...record.sections]
      .reduce((inner, part) => inner + part.trees.reduce((goals, tree) => goals + tree.goals.filter((goal) => !["done", "dropped", "parked", "deferred"].includes(goal.status)).length, 0), 0), 0);
    // The column group carries the widths. A narrow layout hides three cells,
    // and a fixed table keeps reserving width for a column whose cells are all
    // `display: none` unless a `<col>` states that width is zero.
    return `<table class="work-table">
      <caption class="work-caption"><span class="work-caption-scope"><span>Work</span><span class="work-caption-count">${rowCount} ${rowCount === 1 ? "Goal" : "Goals"}</span>${starredOnlyButton()}${activeOnlyButton()}</span>${workCaptionHint()}</caption>
      <colgroup>${WORK_COLUMNS.map((column) => `<col class="work-col-${column.key}">`).join("")}</colgroup>
      <thead><tr>${WORK_COLUMNS.map((column) => `<th scope="col" class="work-head-${column.key}">${column.hidden ? `<span class="visually-hidden">${escapeHtml(column.label)}</span>` : escapeHtml(column.label)}</th>`).join("")}</tr></thead>
      ${bodies}
    </table>`;
  }

  /** Renders the complete Work screen: the direct-ask table, then the work table. */
  function renderWork() {
    const records = deskAreas();
    const roots = areaFocusRoots();
    const focusNames = areaFocusLabels(roots).join(" + ");
    const emptyCopy = `${state.areaFocusOnly ? `Starred Areas (${escapeHtml(focusNames)}): ` : ""}${state.activeOnly ? "Nothing is running. " : ""}No open work.`;
    const content = `${records.length
      ? workTable(records)
      : `<div class="empty-state">${emptyCopy}</div>`}${workProcessSections(records)}`;

    return `
      <section class="work-page">
        ${content}
        ${launchPopover()}
      </section>
    `;
  }

  return { allGoals, goalGroups, goalTrees, goalTreeState, goalTreeIsActive, filteredGoalTrees, saveExpandedAreas, revealArea, goalByFile, currentGoal, sessionForGoal, sessionsForGoal, describeWorkSessions, describeWorkSession, brainSessions, brainForAreaCard, brainStateLabel, brainKind, deskBrainButton, openBrainSession, openOrStartBrain, toggleBrainPopover, startBrain, confirmStopBrain, humanName, areaParts, areaLabel, areaPath, agentName, agentReference, ageText, stateLabel, describeWorkStateLabel, goalNeedsYou, goalWorkFinished, workCard, goalTreeCard, forgetVerdictLines, openRequest, openQuestionsReview, openAreaCapture, sendVerdict, replyAboutRow, areaQuestions, areaBlockers, goalGroupRoot, setSubgoalsExpanded, toggleSubgoals, setWorkAreaFolded, toggleWorkArea, openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery, applyAreaFocus, clearAreaFocus, toggleAreaStar, toggleStarredOnly, toggleActiveOnly, renderWork, paintWorkCaption };
}
