import areaMapCore from "./area-map-core.js";
import goalCardCore from "./goal-card-core.js";
import areaWorkCore from "./area-work-core.js";
import askCore from "./ask-core.js";
import goToCore from "./go-to-core.js";
import { cleanText, clip, escapeHtml, progressPoints } from "./text-format.js";
import { isInAreaFocus, normalizeAreaFocus, reconcileAreaFocus, writeAreaFocus } from "./area-focus-core.js";
import { readDismissedAskIds, writeDismissedAskIds } from "./ask-dismissal-core.js";

/** Creates the work desk from shell, launch, Area, and Program capabilities. */
export function createWorkDeskView({ shell, launch, areaModel, programs, chrome }) {
  const { state, api, post, paint, refresh, showToast, openModal, captureReturnPoint, saveDescribeSession, openSessionLayer } = shell;
  const {
    launchSelection, launchRequestFields, syncLaunchDraft, preferredArea, launchOptionsFor, pipelineForGoal,
    pipelineRecordForGoal, launchPopover, DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  } = launch;
  const { areas, allAreas, orderedGoalTrees } = areaModel;
  const { programRowControls, programIsLive, programState, localMoment } = programs;
  const { shortcutKbd, whatHappenedOverlay } = chrome;
  const openingBrains = new Set();
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
    const openGoals = tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
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
      if (["done", "dropped", "deferred"].includes(goal.status)) return false;
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
    const saved = writeAreaFocus(localStorage, state.areaFocus);
    state.areaFocusStorageError = !saved;
    if (!saved) showToast(state.areaFocus.length
      ? "Area Focus changed only for this tab. Reload can restore the prior Work scope."
      : "Focus cleared only for this tab. Reload can restore the prior Focus.");
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
    window.setTimeout(() => document.querySelector(areaFocusRoots().length ? "[data-change-area-focus]" : "[data-open-area-focus]")?.focus(), 0);
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
    window.setTimeout(() => document.querySelector(state.areaFocus.length ? "[data-change-area-focus]" : "[data-open-area-focus]")?.focus(), 0);
  }

  /** Clears the local scope and restores the complete Work projection. */
  function clearAreaFocus() {
    state.areaFocus = [];
    state.areaFocusPicker = null;
    persistAreaFocus();
    paint(true);
    window.setTimeout(() => document.querySelector("[data-open-area-focus]")?.focus(), 0);
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

  /** Renders the applied Focus summary or the control that opens the picker. */
  function areaFocusControl() {
    const roots = areaFocusRoots();
    const labels = areaFocusLabels(roots);
    const short = labels.length > 2 ? `${labels.slice(0, 2).join(" + ")} +${labels.length - 2}` : labels.join(" + ");
    const accessible = roots.map((path, index) => `${labels[index]}, ${path}`).join("; ");
    const control = roots.length
      ? `<div class="area-focus-summary" aria-label="Area Focus: ${escapeHtml(accessible)}"><span><b>Focus:</b> ${escapeHtml(short)}</span><button type="button" data-change-area-focus>Change</button><button type="button" data-clear-area-focus>Clear</button></div>`
      : `<button class="area-focus-open" type="button" data-open-area-focus>Focus Areas</button>`;
    const storageNote = state.areaFocusStorageError ? `<p class="area-focus-storage-note">Area Focus persistence is unavailable in this browser.</p>` : "";
    return `<div class="area-focus-control">${control}${storageNote}${areaFocusPickerMarkup()}</div>`;
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
    if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return null;
    const bound = state.sessions.filter((session) => session.goal === goal.file || session.name === goal.session);
    // A pipeline leaves earlier step sessions alive on the same Goal: the one
    // Julian opened by name wins, then the Goal's bound session, then any.
    return bound.find((session) => session.name === state.agentSessionName)
      ?? bound.find((session) => session.name === goal.session)
      ?? bound[0]
      ?? null;
  }

  /** Every live session bound to one Goal, for the agent count on its card. */
  function sessionsForGoal(goal) {
    if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return [];
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
    return state.sessions.filter((session) => session.kind === "brain");
  }

  /** The brain record of exactly this Area, or null. A parent card never shows a child brain. */
  function brainForAreaCard(areaPath) {
    return (state.brains ?? []).find((brain) => brain.area === areaPath) ?? null;
  }

  /** The desk word for a brain's state: live pane state, else its record status. */
  function brainStateLabel(brain) {
    if (!brain) return "No brain";
    if (brain.live) {
      if (brain.state === "working") return "Brain working";
      if (brain.state === "waiting") return brain.stateDetail === "decision" ? "Brain needs a decision" : "Brain waiting for you";
      if (brain.state === "shell") return "Brain did not start";
      return "Brain session open";
    }
    return brain.status === "ended" ? "Brain ended" : "Brain stopped";
  }

  /** The class that colours the brain icon: none, working, waiting, live, stopped, ended. */
  function brainKind(brain) {
    if (!brain) return "none";
    if (brain.live) return brain.state === "waiting" ? "waiting" : brain.state === "working" ? "working" : "live";
    return brain.status === "ended" ? "ended" : "stopped";
  }

  /** The brain icon in the Area card header: dim without a brain, stateful with one. */
  function deskBrainButton(areaPath) {
    const brain = brainForAreaCard(areaPath);
    const kind = brainKind(brain);
    const open = state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === areaPath;
    const title = !brain
      ? "Start a brain for this Area"
      : brain.live
        ? `Open the brain (generation ${brain.generation}, ${brainStateLabel(brain).toLowerCase()})`
        : `${brainStateLabel(brain)} after generation ${brain.generation}: resume or start over`;
    return `<button class="area-brain ${kind}${open ? " open" : ""}" type="button" data-launch-for="${BRAIN_LAUNCH_TARGET}" data-brain-area="${escapeHtml(areaPath)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-expanded="${open}"><span aria-hidden="true">🧠</span></button>`;
  }

  /** Opens the brain's terminal in the shared session layer. */
  function openBrainSession(name) {
    if (state.sessionPeek?.session === name) return;
    const session = brainSessions().find((item) => item.name === name);
    if (!session) return showToast("The brain session is not live.");
    openSessionLayer(session, "brain", captureReturnPoint());
  }

  /** Opens the Area brain, or starts the missing session before opening it. */
  async function openOrStartBrain(area, trigger = null) {
    const existing = brainForAreaCard(area);
    const live = brainSessions().find((session) => session.area === area || session.name === existing?.session);
    if (live) return openBrainSession(live.name);
    if (openingBrains.has(area)) return;
    openingBrains.add(area);
    if (trigger) trigger.disabled = true;
    showToast(existing ? "Resuming brain…" : "Starting brain…");
    try {
      const result = await post("/api/brains/start", existing
        ? { area, resume: true }
        : { area, instruction: "Work with Julian to understand, plan, and dispatch new work for this Area." });
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
  }

  /** Opens or closes the brain popover for one Area card; a live brain opens its terminal instead. */
  function toggleBrainPopover(button) {
    const area = button.dataset.brainArea;
    const brain = brainForAreaCard(area);
    if (brain?.live) return openBrainSession(brain.session);
    if (state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === area) {
      state.launchTarget = "";
      state.launchAnchor = null;
      return paint(true);
    }
    state.launchTarget = BRAIN_LAUNCH_TARGET;
    launchOptionsFor(area);
    state.launch.record = null;
    state.launch.steps = [];
    state.launch.active = 0;
    state.launch.command = "";
    state.launch.editing = false;
    state.launch.instruction = "";
    state.launch.continueFrom = null;
    // A prior brain retains its runtime. A new brain is seeded asynchronously
    // from the nearest explicit Area brain default (then the server fallback).
    state.launch.choice = brain?.launch ?? null;
    // Start over begins a new brain, so the box starts empty. Prefilling it
    // with the stopped brain's instruction let an instruction Julian typed for
    // an earlier brain become the new one's, and its first generation then read
    // an old order as today's. Resume never reads this box.
    state.brainDraft = { area, instruction: "" };
    const rect = button.getBoundingClientRect();
    state.launchAnchor = { top: Math.round(rect.bottom + 8), right: Math.round(rect.right) };
    state.launch.open = false;
    return paint(true);
  }

  /** Starts, resumes, or starts over the brain of the popover's Area. */
  async function startBrain({ resume = false } = {}) {
    syncLaunchDraft();
    const area = state.brainDraft?.area;
    const instruction = (state.brainDraft?.instruction ?? "").trim();
    if (!area) return;
    if (!resume && !instruction) return showToast("Tell the brain what this Area should get done.");
    try {
      const result = await post("/api/brains/start", { area, instruction, ...(resume ? {} : launchRequestFields()), resume });
      state.launchTarget = "";
      state.launchAnchor = null;
      state.brainDraft = null;
      await refresh();
      showToast(result.reattached ? "The brain already runs." : resume ? `Brain resumed (generation ${result.generation}).` : "Brain started.");
      openBrainSession(result.session);
    } catch (error) {
      showToast(error.message);
    }
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
    return Boolean(brain && (brain.status === "running" || brain.status === "stopped"));
  }

  /** True when a brain owns this Goal's Area: it is the brain's to raise, not a desk item for Julian. */
  function goalCoveredByBrain(goal) {
    return coveredByBrainRecord(goal?.area ?? "");
  }

  /** True when one stored handoff names the user, and no live brain already covers this Goal's Area. */
  function goalNeedsYou(goal) {
    if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return false;
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

  /** Filters the existing work desk without changing its information hierarchy. */
  function filteredDeskAreas(query) {
    const terms = searchTerms(query);
    if (!terms.length) return deskAreas();
    return deskAreas().filter((record) => {
      const parts = [record, ...record.sections];
      const searchText = parts.flatMap((part) => [
        part.area?.path,
        part.area?.name,
        part.area?.purpose,
        part.area?.body,
        ...part.trees.flatMap((tree) => tree.goals.flatMap((goal) => [goal.title, goal.doneWhen, goal.currentBrief, goal.stateText, goal.storyText])),
        ...part.descriptions.flatMap((session) => [session.workTitle, session.description]),
        ...(part.programs ?? []).flatMap((program) => [program.label, program.command, program.type]),
      ]).join(" ");
      return searchScore({ searchText }, terms, record.area?.path) > 0;
    });
  }

  /** Returns one compact, explicit state for an Area on the Work desk. */
  function deskAreaState(path, trees, descriptions) {
    const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
    const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...descriptions];
    // One list, one number: the Area pill counts the same asks the card shows.
    const waiting = forYouItems().filter((ask) => ask.area === path || ask.area.startsWith(`${path}/`)).length;
    const working = sessions.filter((session) => session.state === "working").length;
    if (waiting) return { kind: "waiting", label: `${waiting} ${waiting === 1 ? "item needs" : "items need"} you` };
    if (working) return { kind: "working", label: `${working} working` };
    // A live brain outranks the Goal count. A brain that waits while its
    // agents work says nothing new, so ranks 1 and 2 stay in front; a brain
    // that thinks or waits with no agent is the case Julian cannot see
    // otherwise (design-active-brains-show-on-work-even-with-no-agents).
    // "Reference Area" is the wrong word for an Area that thinks.
    const brain = brainForAreaCard(path);
    if (brain?.live) return { kind: brainKind(brain), label: brainStateLabel(brain) };
    const ready = goals.filter((goal) => !sessionForGoal(goal)).length;
    if (ready) return { kind: "ready", label: `${ready} ${ready === 1 ? "Goal" : "Goals"} ready` };
    return { kind: "quiet", label: "Reference Area" };
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
   * Groups the Areas with open work into stable subject panels. Descendant
   * Areas contribute Goal rows with path provenance instead of separate cards.
   * An Area needs its own Goal
   * trees or a live "Describe work" session to earn a panel or a section this
   * way. An Area with only Documents and no goal-bearing ancestor already on
   * the desk still gets its own flat panel, as before Decision 1: the desk
   * must not go quiet on a subject that has notes but no open Goal yet.
   * Panels keep hierarchy order. Runtime activity never moves a subject.
   */
  function deskAreas() {
    const roots = areaFocusRoots();
    /** True when one projected record stays inside the applied scope. */
    const inFocus = (path) => isInAreaFocus(path, roots);
    const trees = filteredGoalTrees(goalTrees().filter((tree) => goalTreeState(tree) !== "closed"))
      .filter((tree) => inFocus(tree.path));
    const descriptions = (state.workFilter === "inactive" ? [] : describeWorkSessions())
      .filter((session) => inFocus(session.area));
    const core = areaMapCore;
    const areaList = (roots.length ? allAreas() : areas()).filter((area) => inFocus(area.path));
    const byPath = new Map(areaList.map((area) => [area.path, area]));
    /** One Area's own open Goal trees and definition sessions, not its descendants'. */
    const workOf = (path) => ({
      trees: trees.filter((tree) => tree.path === path),
      descriptions: descriptions.filter((session) => session.area === path),
      programs: state.programs.programs.filter((program) => program.area === path),
    });
    const openCounts = new Map();
    for (const area of areaList) {
      const { trees: areaTrees, descriptions: areaDescriptions, programs: areaPrograms } = workOf(area.path);
      const openGoalCount = areaTrees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
      openCounts.set(area.path, Math.max(openGoalCount, areaDescriptions.length ? 1 : 0, roots.length ? areaPrograms.length : 0));
    }
    const liveBrainAreas = (state.brains ?? [])
      .filter((brain) => brain.status === "running" && brain.live)
      .map((brain) => brain.area)
      .filter(inFocus);
    const panelDefs = core.deskPanels(openCounts, roots.length ? [...roots, ...liveBrainAreas] : liveBrainAreas);
    const covered = new Set(panelDefs.flatMap((panel) => [panel.path, ...panel.sections]));
    const panels = panelDefs.map((panel) => {
      const area = byPath.get(panel.path);
      const own = workOf(panel.path);
      const sections = panel.sections
        .map((path) => ({ area: byPath.get(path), ...workOf(path) }))
        .filter((section) => section.area);
      const programs = own.programs;
      const brain = (state.brains ?? []).find((item) => item.area === panel.path && item.status === "running" && item.live) ?? null;
      const focusRoot = roots.includes(panel.path);
      const focusHasWork = !focusRoot || trees.some((tree) => core.isInside(tree.path, panel.path))
        || descriptions.some((session) => core.isInside(session.area, panel.path))
        || liveBrainAreas.some((path) => core.isInside(path, panel.path))
        || state.programs.programs.some((program) => core.isInside(program.area, panel.path));
      return { area, trees: own.trees, descriptions: own.descriptions, sections, programs, brain, focusRoot, focusHasWork };
    }).filter((record) => record.area);
    if (state.workFilter === "all") {
      for (const area of areaList) {
        if (covered.has(area.path)) continue;
        if (!(area.documents ?? []).length) continue;
        if (panels.some((panel) => core.isInside(area.path, panel.area.path))) continue;
        panels.push({ area, trees: [], descriptions: [], sections: [], programs: state.programs.programs.filter((program) => program.area === area.path) });
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

  /**
   * What Tangent itself may ask for an Area with no brain of its own: a
   * pipeline step that stopped, a session sitting at a dialog, and a handover
   * that names Julian. Brains are the primary path, so this stays the minimal
   * fallback and grows nothing (design-the-for-you-row-shows-only-direct-asks,
   * Julian's answer 3). Idle, waiting, draft, and shell sessions reach no
   * builder at all, so machine state on its own can never make a row.
   * Describe-work sessions ask even under a brain: they answer to Julian.
   */
  function fallbackAsks() {
    const ask = askCore;
    const goalAsks = allGoals().flatMap((goal) => {
      if (["done", "dropped", "deferred"].includes(goal.status)) return [];
      if (coveredByBrainRecord(goal.area)) return [];
      const pipeline = pipelineForGoal(goal);
      const step = pipeline ? currentPipelineStep(pipeline) : null;
      const stoppedStep = step && (step.status === "stopped" || (step.status === "running" && !step.live)) ? step : null;
      if (stoppedStep) return [ask.askFromStoppedStep(goal, stoppedStep)];
      const session = sessionForGoal(goal);
      if (session) {
        const action = { kind: "open-run", label: `Open ${agentName(session)}`, arg: { file: goal.file } };
        return [ask.askFromDialogSession(goal, session, { action })];
      }
      return [ask.askFromWaitingOn(goal, { finished: goalWorkFinished(goal) })];
    });
    const definitionAsks = describeWorkSessions().map((session) => ask.askFromDialogSession(
      null,
      session,
      { action: { kind: "select-definition", label: "Open", arg: { session: session.name } } }
    ));
    return [...goalAsks, ...definitionAsks]
      .filter(Boolean)
      .filter((item) => !state.dismissedAskIds.has(item.id))
      .sort((left, right) => left.area.localeCompare(right.area) || left.subject.localeCompare(right.subject));
  }

  let dockBadgeCount = null;

  /** Keeps the installed Safari web app's Dock badge equal to the For you count. */
  async function syncDockBadge() {
    const count = forYouItems().length;
    if (count === dockBadgeCount) return;
    const nativeBridge = window.__agentShellNativeDockBadge === true;
    if (!nativeBridge && (typeof Notification === "undefined" || Notification.permission !== "granted")) return;
    try {
      if (count > 0) {
        if (typeof navigator.setAppBadge !== "function") return;
        await navigator.setAppBadge(count);
      } else if (typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
      } else if (typeof navigator.setAppBadge === "function") {
        await navigator.setAppBadge(0);
      } else {
        return;
      }
      dockBadgeCount = count;
    } catch {
      // Badge support and permission are browser-owned; retry on the next refresh.
    }
  }

  /** Requests the notification permission WebKit requires before it displays app-icon badges. */
  async function enableDockBadge() {
    if (window.__agentShellNativeDockBadge === true) {
      dockBadgeCount = null;
      await syncDockBadge();
      return;
    }
    if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
      return showToast("This browser cannot enable Dock badges for Agent Shell.");
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      return showToast("Allow Agent Shell notifications in System Settings to show its Dock badge.");
    }
    dockBadgeCount = null;
    await syncDockBadge();
    paint(true);
    showToast("The Dock badge now follows For you. No notification banners are sent.");
  }

  /**
   * The brain-written asks, grouped by Area in brain record order. One group:
   * { area, brain, stopped, asks }. Only a running brain can ask Julian for
   * anything. Stopping it ends that authority immediately; its durable record
   * remains available for a later Resume from the Area card.
   */
  function askGroups() {
    const ask = askCore;
    return (state.brains ?? [])
      .map((brain) => {
        const requests = (brain.requests ?? []).map((request) => ask.askFromRequest(brain, request));
        const asks = requests.filter(Boolean).filter((item) => !state.dismissedAskIds.has(item.id));
        return { area: brain.area, brain, stopped: !brain.live, asks };
      })
      .filter((group) => group.asks.length);
  }

  /** Every ask Tangent shows Julian: what the brains wrote, then the fallback. One list, one number. */
  function forYouItems() {
    return [...askGroups().flatMap((group) => group.asks), ...fallbackAsks()];
  }

  /**
   * The brain-written For-you rows that belong on one Area's own panel: its
   * own brain's asks, and any brain's asks in a sub-Area. Empty when the Area
   * has no brain of its own, so a plain Area panel stays as it is today
   * (design-what-needs-julian-under-brains, goal-decisions-show-on-the-area-
   * view-not-just-a-count).
   */
  function areaForYouGroups(areaPath) {
    if (!coveredByBrainRecord(areaPath)) return [];
    const core = areaMapCore;
    return askGroups().filter((group) => core.isInside(group.area, areaPath));
  }

  /** The verbs that open something; the first one a row carries is its main button. */
  const ASK_PRIMARY_ACTIONS = ["open-request", "open-document", "open-brain", "open-run", "reveal-goal", "select-definition", "answer"];

  /** Carries one action's verb and its argument to the click delegation. */
  function askActionAttributes(ask, action) {
    const arg = action.arg ?? {};
    if (action.kind === "open-request") return `data-open-request-area="${escapeHtml(arg.area ?? ask.area)}" data-open-request-id="${escapeHtml(arg.id ?? "")}"`;
    if (action.kind === "open-document") return `data-open-document="${escapeHtml(arg.file ?? "")}"`;
    if (action.kind === "open-brain") return `data-open-brain="${escapeHtml(arg.session ?? "")}"`;
    if (action.kind === "open-run") return `data-open-goal-run="${escapeHtml(arg.file ?? "")}"`;
    if (action.kind === "reveal-goal") return `data-reveal-goal="${escapeHtml(arg.file ?? "")}"`;
    if (action.kind === "select-definition") return `data-select-work-definition="${escapeHtml(arg.session ?? "")}"`;
    if (action.kind === "answer" || action.kind === "reply") {
      return `data-reply-area="${escapeHtml(arg.area ?? ask.area)}" data-reply-session="${escapeHtml(arg.session ?? "")}" data-reply-subject="${escapeHtml(arg.subject ?? ask.subject)}"`;
    }
    if (action.kind === "request-answer") return `data-verdict-area="${escapeHtml(arg.area ?? ask.area)}" data-verdict-line="request:${escapeHtml(arg.id ?? "")}" data-verdict="${escapeHtml(arg.answer ?? "")}"`;
    return `data-verdict-area="${escapeHtml(arg.area ?? ask.area)}" data-verdict-line="${escapeHtml(arg.line ?? "")}" data-verdict="${escapeHtml(action.kind)}"`;
  }

  /** Hides one exact attention event and offers a local Undo. */
  async function dismissAsk(id) {
    const item = forYouItems().find((ask) => ask.id === id);
    if (!item) return;
    if (item.source.startsWith("request:")) {
      const action = item.actions.find((candidate) => candidate.kind === "open-request");
      try {
        await post("/api/brains/requests/dismiss", { area: item.area, id: action?.arg?.id ?? "" });
        showToast("Dismissed. The brain was told.");
        await refresh();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const next = readDismissedAskIds(localStorage);
    next.add(id);
    if (!writeDismissedAskIds(localStorage, next)) {
      showToast("The dismissal could not be saved.");
      return;
    }
    state.dismissedAskIds = next;
    paint(true);
    /** Restores only the dismissed attention event. */
    const undo = () => {
      const restored = readDismissedAskIds(localStorage);
      restored.delete(id);
      if (!writeDismissedAskIds(localStorage, restored)) {
        showToast("Undo could not be saved.");
        return;
      }
      state.dismissedAskIds = restored;
      paint(true);
    };
    showToast("Dismissed from For you.", { label: "Undo", run: undo });
  }

  /** Opens the complete Request away from its compact index row. */
  function openRequest(area, id) {
    const request = (state.brains ?? []).find((brain) => brain.area === area)?.requests?.find((item) => item.id === id);
    if (!request) return showToast("This Request is no longer open.");
    const copy = [request.proposal ? `Proposed transition\n${request.proposal}` : "", request.question, request.detail].filter(Boolean).join("\n\n");
    /** Closes the read-only Request detail. */
    const closeRequest = async () => {};
    openModal({ kicker: "Request", title: request.subject, copy, wide: true, confirmLabel: "Close", onConfirm: closeRequest });
  }

  /** The fallback asks grouped by Area, so every row says which Area it is from. */
  function fallbackAskGroups(asks) {
    const byArea = new Map();
    for (const ask of asks) byArea.set(ask.area, [...(byArea.get(ask.area) ?? []), ask]);
    return [...byArea].map(([area, items]) => ({ area, asks: items }));
  }

  /** The word for what one direct ask is: its kind, not its machine source. */
  function askKindLabel(ask) {
    const source = String(ask.source ?? "");
    if (source.startsWith("request:")) {
      const kind = source.slice("request:".length);
      return kind === "decision" ? "Decide" : kind === "test" ? "Test" : kind === "approval" ? "Approve" : "Plan";
    }
    if (source === "plan") return "Plan";
    if (source === "brain-dialog") return "Brain";
    if (source === "stopped-step") return "Stopped";
    if (source === "dialog") return "Dialog";
    return "Result";
  }

  /**
   * One direct ask as a table row: Area and kind as facts, the question as the
   * row header (it is the only part Julian must read), and the answer verbs in
   * the Action cell. The first opening verb stays the row's main button, as it
   * was on the card (design-the-for-you-row-shows-only-direct-asks). The
   * question cell also holds one narrow-width copy of the Area and kind,
   * because their own cells hide below 640 px; CSS shows exactly one copy at
   * each width, so nothing is read twice.
   */
  function askTableRow(ask) {
    const primary = ask.actions.find((action) => ASK_PRIMARY_ACTIONS.includes(action.kind));
    const rest = ask.actions.filter((action) => action !== primary);
    const context = ask.context ? `<small class="ask-context">${escapeHtml(ask.context)}</small>` : "";
    const proposal = ask.proposal ? `<small class="ask-proposal"><b>Proposed:</b> ${escapeHtml(ask.proposal)}</small>` : "";
    const question = primary
      ? `<button class="ask-question" type="button" ${askActionAttributes(ask, primary)} title="${escapeHtml(primary.label)}">${escapeHtml(ask.question)}</button>`
      : `<span class="ask-question">${escapeHtml(ask.question)}</span>`;
    const answers = rest.map((action) => `<button class="ask-answer${action.kind === "reply" ? " ask-reply" : ""}" type="button" ${askActionAttributes(ask, action)}>${escapeHtml(action.label)}</button>`).join("");
    const dismissLabel = `Dismiss ${ask.subject}: ${ask.question} from For you`;
    return `<tr class="ask-row" data-ask-id="${escapeHtml(ask.id)}">
      <td class="ask-cell-area">${escapeHtml(areaLabel(ask.area))}</td>
      <td class="ask-cell-kind">${escapeHtml(askKindLabel(ask))}</td>
      <th class="ask-cell-question" scope="row"><small class="ask-cell-facts">${escapeHtml(`${areaLabel(ask.area)} \u00b7 ${askKindLabel(ask)}`)}</small><span class="ask-subject">${escapeHtml(ask.subject)}</span>${question}${context}${proposal}</th>
      <td class="ask-cell-action"><span class="ask-actions${rest.length > 2 ? " choices" : ""}">${answers}<button class="ask-dismiss" type="button" data-dismiss-ask="${escapeHtml(ask.id)}" aria-label="${escapeHtml(dismissLabel)}" title="Dismiss from For you"><span aria-hidden="true">×</span></button></span></td>
    </tr>`;
  }

  /**
   * The For you table: what the brains asked, then what Tangent itself asks for
   * the Areas with no brain. Every row is a direct ask, and the number in the
   * header is the length of that one list. Rows of one Area share a row group,
   * so a single Area never earns a repeated heading
   * (design-redesign-work-as-a-compact-table Decision 2).
   */
  function deskAttentionQueue() {
    const roots = areaFocusRoots();
    const completeGroups = askGroups();
    const completeFallback = fallbackAsks();
    const total = completeGroups.reduce((count, group) => count + group.asks.length, 0) + completeFallback.length;
    if (!total && !roots.length) return "";
    const groups = roots.length
      ? completeGroups.map((group) => ({ ...group, asks: group.asks.filter((ask) => isInAreaFocus(ask.area, roots)) })).filter((group) => group.asks.length)
      : completeGroups;
    const fallback = roots.length ? completeFallback.filter((ask) => isInAreaFocus(ask.area, roots)) : completeFallback;
    const shown = groups.reduce((count, group) => count + group.asks.length, 0) + fallback.length;
    const enableBadge = typeof navigator.setAppBadge === "function"
      && window.__agentShellNativeDockBadge !== true
      && typeof Notification !== "undefined"
      && Notification.permission !== "granted";
    const bodies = [
      ...groups.map((group) => `<tbody class="ask-group${group.stopped ? " stopped" : ""}" data-ask-area="${escapeHtml(group.area)}">${group.asks.map(askTableRow).join("")}</tbody>`),
      ...fallbackAskGroups(fallback).map((group) => `<tbody class="ask-group fallback" data-ask-area="${escapeHtml(group.area)}">${group.asks.map(askTableRow).join("")}</tbody>`),
    ].join("");
    const scopeCopy = roots.length
      ? `<p class="attention-focus-count">${shown} shown in Focus · ${total - shown} outside Focus</p>`
      : "";
    const empty = roots.length && !shown ? `<p class="attention-focus-empty">No direct asks in Focus.</p>` : "";
    return `
      <section class="attention-queue" aria-labelledby="attention-heading">
        <header><p class="kicker">Attention</p><h2 id="attention-heading">For you</h2>${enableBadge ? `<button class="attention-badge-button" type="button" data-enable-dock-badge>Show in Dock</button>` : ""}<span>${roots.length ? `${total} total` : total}</span></header>
        ${scopeCopy}${empty}
        ${bodies ? `<table class="ask-table"><caption class="visually-hidden">Direct questions for you</caption><colgroup><col class="ask-col-area"><col class="ask-col-kind"><col class="ask-col-question"><col class="ask-col-action"></colgroup><thead><tr><th scope="col" class="ask-head-area">Area</th><th scope="col" class="ask-head-kind">Kind</th><th scope="col" class="ask-head-question">Question</th><th scope="col" class="ask-head-action">Action</th></tr></thead>${bodies}</table>` : ""}
      </section>`;
  }

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
  async function sendVerdict(area, line, verdict, note = "") {
    if (line.startsWith("request:") && verdict === "changes" && !note) {
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
          return sendVerdict(area, line, verdict, text);
        },
      });
      return;
    }
    state.verdictLines.add(line);
    paint(true);
    try {
      if (line.startsWith("request:")) {
        await post("/api/brains/requests/answer", { area, id: line.slice("request:".length), answer: verdict, note });
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
   * The desk fill label ("310k"), shown only once a session's carried context
   * reaches the handover threshold; below it the row shows nothing
   * (design-worker-context-handover D7, principle 3).
   */
  function deskFillLabel(context) {
    if (!context || !state.contextHandoverTokens) return "";
    if (context.usedTokens < state.contextHandoverTokens) return "";
    return `${Math.round(context.usedTokens / 1000)}k`;
  }

  /**
   * The state pill and the primary action of one Goal. The pill is one word:
   * the facts line under the title carries the duration, and the card keeps no
   * prose (design-goal-cards Decision 4).
   */
  function deskGoalAction(goal) {
    const line = { stepLine: "", stepShort: "", stepTitle: "", fill: "", launch: "" };
    if (["done", "dropped", "deferred"].includes(goal.status)) {
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
      return { ...line, state: idleState, action: "Start agent", kind: idleState === "Waiting" ? idle : "ready", route: "run" };
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
    const launch = launchRefText(session.launchRef);
    if (session.state === "working") return { state: "Working", action: `Open ${agentName(session)}`, launch, kind: "working", route: "run" };
    if (session.state === "waiting") return { state: "Waiting", action: `Open ${agentName(session)}`, launch, kind: idle, route: "run" };
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
    if (goal.status === "ready" || goalHasOpenTest(goal)) return "Ready for validation";
    if (goalRunEnded(goal)) return "Preparing validation";
    return goalNeedsYou(goal) ? "Waiting" : "Open";
  }

  /** The idle time (ms) after which an idle step is offered "Send to next". */
  const PIPELINE_SEND_AFTER_MS = 60_000;

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
      stepLine: `Step ${step.index} of ${total}`,
      stepShort: `${step.index}/${total}`,
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
    if (step.status === "stopped" || (step.status === "running" && !step.live)) return { state: "Stopped", action: "", launch: "", kind: idle, route: "" };
    if (step.status === "pending") return { state: "Not started", action: "", launch: "", kind: idle, route: "" };
    const launch = launchRefText(step.launch);
    if (step.state === "working") return { state: "Working", action: `Open step ${step.index}`, launch, kind: "working", route: "run" };
    if (step.state === "waiting") return { state: "Waiting", action: `Open step ${step.index}`, launch, kind: idle, route: "run" };
    if (step.state === "shell") return { state: "Stopped", action: `Open step ${step.index}`, launch, kind: idle, route: "run" };
    return { state: "Open", action: `Open step ${step.index}`, launch, kind: "ready", route: "run" };
  }

  /** Rare pipeline actions shown inside the Goal action menu, only when valid. */
  function deskPipelineControls(goal, pipeline) {
    const step = currentPipelineStep(pipeline);
    if (!step || step.status === "pending") return "";
    const last = step.index >= pipeline.steps.length;
    const stopped = step.status === "stopped" || (step.status === "running" && !step.live);
    if (stopped) {
      // A step whose session died on its own. Julian's own Stop agent already
      // ends the run, so Stop work here is the same exit for a crashed step.
      return `<button type="button" data-pipeline-control="restart" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Restart step ${step.index}</button>`
        + (last ? "" : `<button type="button" data-pipeline-control="skip" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Skip to step ${step.index + 1}</button>`)
        + `<button type="button" data-pipeline-control="end" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="End the run; the Goal stays open with its handovers">End work</button>`;
    }
    const idleLong = step.state === "waiting" && (step.stateDetail === "idle" || step.stateDetail === null) && step.idleSince && Date.now() - step.idleSince >= PIPELINE_SEND_AFTER_MS;
    if (idleLong && !last) {
      return `<button type="button" data-pipeline-control="send" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="Use the agent's last message as its handover">Send to step ${step.index + 1}</button>`;
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
   * The elapsed-time text beside the bar: the same total the bar's length
   * encodes (deskGoalBar, elapsedLengthShare), printed compact so Julian reads
   * the actual age without a hover (Julian's word 2026-08-22: the redesign
   * that moved this text to the hover only took it too far).
   */
  function deskGoalElapsed(facts, now) {
    const core = goalCardCore;
    if (!core || !facts) return "";
    const label = core.elapsedLabel(facts, now);
    if (!label) return "";
    const title = facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "";
    return `<span class="desk-goal-elapsed" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
  }

  /**
   * The bar: its drawn length encodes total elapsed time relative to the
   * longest-elapsed Goal on the desk right now, on a sqrt curve (Decision 2,
   * Julian's word 2026-08-20: a bar that was always full made every running
   * Goal look identical). Within that length, worked time (blue) splits from
   * the current wait (amber, or gray under a live brain: it waits for the
   * brain, not for Julian) at the start of the wait, the only split the
   * records can answer (Decision 1). The hover title carries the exact words
   * and the start time; a Goal nobody has started draws no bar.
   */
  function deskGoalBar(goal, facts, now, maxElapsedMs) {
    const core = goalCardCore;
    if (!core || !facts) return "";
    const shares = core.factsBarShares(facts, now, { waitsForBrain: goalCoveredByBrain(goal) });
    if (!shares) return "";
    const lengthShare = core.elapsedLengthShare(now - facts.startedAt, maxElapsedMs);
    const words = core.factsSegments(facts, now).filter((segment) => segment.kind !== "agents").map((segment) => segment.text).join(" · ");
    const started = facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "";
    const title = [words, started].filter(Boolean).join("\n");
    return `<span class="desk-goal-bar" title="${escapeHtml(title)}" role="img" aria-label="${escapeHtml(words || "no agent yet")}">
      <i class="desk-goal-bar-worked" style="width:${(shares.workedShare * lengthShare * 100).toFixed(2)}%"></i>
      ${facts.waiting ? `<i class="desk-goal-bar-wait ${shares.waitKind}" style="width:${(shares.waitShare * lengthShare * 100).toFixed(2)}%"></i>` : ""}
    </span>`;
  }

  /**
   * The longest elapsed time (first start to now) among every Goal this paint
   * of the desk will draw a bar for, so every bar's length can be scaled to it
   * (deskGoalBar, Decision 2). Walks the same records, sections, and trees the
   * desk renders from; a Goal outside this pass (a different filter, a
   * collapsed section) is not part of the scale it did not draw into.
   */
  function deskMaxElapsedMs(records, now) {
    let max = 0;
    /** Folds every started Goal of one list of Goal trees into the max. */
    const scanTrees = (trees) => {
      for (const tree of trees ?? []) {
        for (const goal of tree.goals ?? []) {
          const startedAt = deskGoalFactsData(goal).facts?.startedAt;
          if (startedAt) max = Math.max(max, now - startedAt);
        }
      }
    };
    for (const record of records ?? []) {
      scanTrees(record.trees);
      for (const section of record.sections ?? []) scanTrees(section.trees);
    }
    return max;
  }

  /** Valid lifecycle actions inside the Goal's contextual menu. */
  function deskGoalSecondaryActions(goal, liveSession) {
    const open = !["done", "dropped", "deferred"].includes(goal.status);
    return [
      liveSession ? `<button type="button" data-stop-goal="${escapeHtml(goal.file)}">End work</button>` : "",
      open ? `<button type="button" data-wont-do-goal="${escapeHtml(goal.file)}">Won't do</button>` : "",
      open ? `<button class="complete" type="button" data-complete-goal="${escapeHtml(goal.file)}">Done</button>` : "",
    ].filter(Boolean).join("");
  }

  // ---- The work table ----
  // One semantic table holds every open Goal (design-redesign-work-as-a-
  // compact-table). The lifecycle words, the readiness facts, the actions, the
  // order, and the selection rule are the settled ones; the table changes only
  // where each fact is drawn, so more work fits in one scan.

  /** The five columns, in reading order. Their widths live in shell.css. */
  const WORK_COLUMNS = [
    { key: "select", label: "Select", hidden: true },
    { key: "work", label: "Work" },
    { key: "state", label: "State" },
    { key: "time", label: "Time" },
    { key: "action", label: "Action" },
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
   * The shortest provenance label for each descendant Area of one group: its
   * own name while that name is unique inside the group, and the complete
   * relative path when two branches share a name.
   */
  function descendantLabels(groupPath, areaPaths) {
    const counts = new Map();
    for (const path of areaPaths) {
      if (path === groupPath) continue;
      const tail = humanName(path.split("/").at(-1));
      counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
    const labels = new Map();
    for (const path of areaPaths) {
      if (path === groupPath) continue;
      const tail = humanName(path.split("/").at(-1));
      labels.set(path, counts.get(tail) === 1 ? tail : descendantPath(path, groupPath));
    }
    return labels;
  }

  /** The Goals of one group whose row can be checked, in row order. */
  function selectedGoalFiles(trees) {
    const panelFiles = new Set(trees.flatMap((tree) => tree.goals.map((goal) => goal.file)));
    return state.goalSelection.filter((file) => panelFiles.has(file));
  }

  /**
   * The one action for a checked set of Goals: start a single agent that owns
   * them all and works them in checked order. Renders only while something in
   * this group is checked; checking itself never starts anything.
   */
  function deskSelectionBar(areaPath, trees) {
    const selected = selectedGoalFiles(trees);
    if (!selected.length) return "";
    const count = selected.length;
    const primary = selected[0];
    return `
      <span class="desk-selection-bar">
        <span class="desk-split">
          <button class="desk-action" type="button" data-start-selected="${escapeHtml(areaPath)}">Start agent on ${count} ${count === 1 ? "Goal" : "Goals"}</button>
          <button class="desk-action desk-launch-toggle${state.launchTarget === primary ? " open" : ""}" type="button" data-launch-for="${escapeHtml(primary)}" title="Choose agent or model" aria-label="Choose agent or model for the ${count} selected ${count === 1 ? "Goal" : "Goals"}" aria-expanded="${state.launchTarget === primary}">▾</button>
        </span>
        <button class="desk-icon-action" type="button" data-clear-selection>Clear <kbd>Esc</kbd></button>
      </span>`;
  }

  /**
   * The group header row: Area, aggregate state, Goal count, and the one brain
   * route for every row below it. The Action column never repeats that route
   * (design-redesign-work-as-a-compact-table Decision 4).
   */
  function workGroupHeaderRow(record) {
    const { area, trees, descriptions, sections } = record;
    const allTrees = [...trees, ...sections.flatMap((section) => section.trees)];
    const allDescriptions = [...descriptions, ...sections.flatMap((section) => section.descriptions)];
    const status = deskAreaState(area.path, allTrees, allDescriptions);
    const count = allTrees.reduce((total, tree) => total + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
    const brain = brainForAreaCard(area.path);
    const label = brain?.live ? "Open brain" : brain ? "Resume brain" : "Start brain";
    // A live brain opens its own session; only a missing or stopped one goes
    // through the start route, which is what Resume and Start mean.
    const route = brain?.live
      ? `data-open-brain="${escapeHtml(brain.session ?? "")}"`
      : `data-open-area-brain="${escapeHtml(area.path)}"`;
    const name = humanName(area.name);
    const cursor = `area:${area.path}`;
    return `<tr class="work-group-row${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(area.path)}">
      <th class="work-group-head" colspan="${WORK_COLUMNS.length}" scope="rowgroup" id="${workGroupId(area.path)}">
        <span class="work-group-name"><button type="button" data-work-cursor-control data-focus-key="area:${escapeHtml(area.path)}" data-open-area="${escapeHtml(area.path)}" title="Open the ${escapeHtml(name)} Area map">${escapeHtml(name)}</button></span>
        <span class="work-group-count">${count} ${count === 1 ? "Goal" : "Goals"}</span>
        <span class="desk-state ${status.kind}">${escapeHtml(status.label)}</span>
        ${deskSelectionBar(area.path, allTrees)}
        <button class="work-group-brain" type="button" ${route} data-focus-key="brain:${escapeHtml(area.path)}" aria-label="${escapeHtml(label)} for ${escapeHtml(areaLabel(area.path))}"><span class="work-group-brain-long">${escapeHtml(label)}</span><span class="work-group-brain-short">Brain</span></button>
      </th>
    </tr>`;
  }

  /** The State cell: one lifecycle word, its step, and one planned readiness line. */
  function workStateCell(goal, action, fact) {
    const step = action.stepShort ? `<small class="work-step" title="${escapeHtml(action.stepTitle)}">${escapeHtml(action.stepShort)}</small>` : "";
    const planned = state.workFilter === "inactive" && !["done", "dropped", "deferred"].includes(goal.status)
      ? `<small class="work-readiness ${fact?.kind ?? "ready"}">${escapeHtml(readinessLabel(fact))}</small>`
      : "";
    return `<td class="work-cell-state"><span class="desk-state ${action.kind}">${escapeHtml(action.state)}</span>${step}${planned}</td>`;
  }

  /** The Time cell: the exact elapsed label, then the worked-against-waiting bar. */
  function workTimeCell(goal, facts, now, maxElapsedMs) {
    const elapsed = deskGoalElapsed(facts, now);
    const bar = deskGoalBar(goal, facts, now, maxElapsedMs);
    if (!elapsed && !bar) return `<td class="work-cell-time"><span class="work-no-time">—</span></td>`;
    return `<td class="work-cell-time">${elapsed}${bar}</td>`;
  }

  /** The Action cell: the primary route, then the menu of rare and final actions. */
  function workActionCell(goal, action, pipeline, record) {
    const liveSession = sessionForGoal(goal);
    const launchTitle = record ? "Add or edit steps" : "Choose agent or model";
    const controls = pipeline ? deskPipelineControls(goal, pipeline) : "";
    const cleanup = ["done", "dropped"].includes(goal.status)
      ? (state.goalCleanups ?? []).find((item) => item.goal === goal.file)
      : null;
    const cleanupFailure = cleanup?.failures?.[0];
    const cleanupControl = cleanupFailure
      ? `<button class="desk-action cleanup-error" type="button" data-retry-goal-cleanup="${escapeHtml(goal.file)}" title="${escapeHtml(cleanupFailure.error)}">Worker cleanup failed · Retry</button>`
      : "";
    const route = action.route === "goal"
      ? `data-open-close="${escapeHtml(goal.file)}"`
      : `data-open-goal-run="${escapeHtml(goal.file)}"`;
    // The open control and the launch fact are one element: the button keeps
    // its route and shows `claude-otto/opus-5/medium` instead of its verb, and
    // the verb moves into the title and the accessible name
    // (design-see-the-harness-model-effort-and-open-that-agent Decision 1).
    const openLabel = action.launch ? `${action.action} on ${action.launch}` : action.action;
    const primary = action.action === "Start agent"
      ? `<span class="desk-split"><button class="desk-action" type="button" ${route} data-focus-key="start:${escapeHtml(goal.file)}" aria-label="Start an agent on ${escapeHtml(goal.title)}">Start agent</button><button class="desk-action desk-launch-toggle${state.launchTarget === goal.file ? " open" : ""}" type="button" data-launch-for="${escapeHtml(goal.file)}" title="${launchTitle}" aria-label="${launchTitle} for ${escapeHtml(goal.title)}" aria-expanded="${state.launchTarget === goal.file}">▾</button></span>`
      : action.action && action.launch
        ? `<button class="desk-launch-ref" type="button" ${route} data-focus-key="open:${escapeHtml(goal.file)}" title="${escapeHtml(openLabel)}" aria-label="${escapeHtml(openLabel)}: ${escapeHtml(goal.title)}">${escapeHtml(action.launch)}</button>`
        : action.action
          ? `<button class="desk-action" type="button" ${route} data-focus-key="open:${escapeHtml(goal.file)}" aria-label="${escapeHtml(action.action)}: ${escapeHtml(goal.title)}">${escapeHtml(action.action)}</button>`
          : "";
    return `<td class="work-cell-action"><span class="desk-goal-actions">${cleanupControl}${primary}
      <details class="desk-action-menu"><summary data-focus-key="menu:${escapeHtml(goal.file)}" aria-label="Actions for ${escapeHtml(goal.title)}">▾</summary><div role="menu">
        ${record ? `<button type="button" data-launch-for="${escapeHtml(goal.file)}">Steps and agents…</button>` : ""}
        ${controls}${deskGoalSecondaryActions(goal, liveSession)}
      </div></details></span></td>`;
  }

  /**
   * One Goal as one table row. The Goal title is the row header, so every
   * state, time, and action cell carries the Goal's name for a screen reader.
   * The Work cell also holds one narrow-width copy of the state and time
   * facts; CSS shows exactly one copy at each width, so nothing is read twice.
   */
  function workGoalRow(goal, { groupPath, labels, fact, maxElapsedMs = 0, subgoal = false, parent = "", hidden = false, subgoalCount = 0, expanded = true } = {}) {
    const pipeline = pipelineForGoal(goal);
    const record = pipelineRecordForGoal(goal);
    const projected = pipeline ? deskPipelineAction(goal, pipeline) : deskGoalAction(goal);
    // Only a Startable Goal offers Start or a checkbox. A blocked, broken, or
    // errored Goal opens instead, and its Area map holds the dependency detail
    // (design-redesign-work-as-a-compact-table Decision 6).
    const startable = projected.action === "Start agent" && (!fact || fact.kind === "ready");
    const action = projected.action === "Start agent" && !startable
      ? { ...projected, action: "Open", route: "goal" }
      : projected;
    const selectable = startable;
    const selected = selectable && state.goalSelection.includes(goal.file);
    const { facts, now } = deskGoalFactsData(goal);
    const path = labels?.get(goal.area) ?? descendantPath(goal.area, groupPath);
    const readiness = state.workFilter === "inactive" ? readinessLabel(fact) : "";
    const compact = [action.state, action.stepShort, readiness, deskGoalElapsedText(facts, now)].filter(Boolean).join(" · ");
    const disclosure = subgoalCount
      ? `<button class="work-subgoal-toggle" type="button" data-toggle-subgoals="${escapeHtml(goal.file)}" aria-expanded="${expanded}" aria-label="${expanded ? "Hide" : "Show"} ${subgoalCount} ${subgoalCount === 1 ? "Subgoal" : "Subgoals"} of ${escapeHtml(goal.title)}"><span aria-hidden="true">${expanded ? "−" : "+"}</span>${subgoalCount}</button>`
      : "";
    const cursor = `goal:${goal.file}`;
    return `<tr class="desk-goal work-row ${subgoal ? "subgoal" : "root-goal"} ${action.kind}${selected ? " selected" : ""}${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-goal-anchor="${escapeHtml(goal.file)}" data-work-area="${escapeHtml(goal.area)}"${subgoal ? ` data-subgoal-of="${escapeHtml(parent)}"` : ""}${hidden ? " hidden" : ""}>
      <td class="work-cell-select desk-select">${selectable ? `<input type="checkbox" data-check-goal="${escapeHtml(goal.file)}" data-focus-key="check:${escapeHtml(goal.file)}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(goal.title)} for one shared agent">` : ""}</td>
      <th class="work-cell-work" scope="row">
        <span class="work-cell-title">${disclosure}<button class="work-row-title" type="button" data-work-row-title data-open-close="${escapeHtml(goal.file)}" data-focus-key="title:${escapeHtml(goal.file)}" title="${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</button>${path ? `<small class="work-row-path">${escapeHtml(path)}</small>` : ""}</span>
        <small class="work-cell-facts">${escapeHtml(compact)}</small>
      </th>
      ${workStateCell(goal, action, fact)}
      ${workTimeCell(goal, facts, now, maxElapsedMs)}
      ${workActionCell(goal, action, pipeline, record)}
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
    return `<tr class="desk-definition work-row definition ${kind}${state.workCursor === cursor ? " cursor" : ""}" data-work-cursor="${escapeHtml(cursor)}" data-work-area="${escapeHtml(session.area ?? "")}">
      <td class="work-cell-select"></td>
      <th class="work-cell-work" scope="row">
        <span class="work-cell-title"><button class="work-row-title" type="button" data-work-row-title data-select-work-definition="${escapeHtml(session.name)}" data-focus-key="definition:${escapeHtml(session.name)}">${escapeHtml(session.workTitle || "Define new work")}</button><small class="work-row-path">Defining work</small></span>
        <small class="work-cell-facts">${escapeHtml(stateName)}</small>
      </th>
      <td class="work-cell-state"><span class="desk-state ${kind}">${escapeHtml(stateName)}</span></td>
      <td class="work-cell-time"><span class="work-no-time">—</span></td>
      <td class="work-cell-action"><span class="desk-goal-actions"><button class="desk-action" type="button" data-select-work-definition="${escapeHtml(session.name)}" aria-label="Open ${escapeHtml(name)} for ${escapeHtml(session.workTitle || "this description")}">Open ${escapeHtml(name)}</button></span></td>
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
    return [record, ...record.sections].some((part) => part.descriptions.length
      || part.trees.some((tree) => tree.goals.some((goal) => !["done", "dropped", "deferred"].includes(goal.status))));
  }

  /** One brain-owned Area group as one row group of the work table. */
  function workGroupBody(record, facts, maxElapsedMs) {
    const { area, trees, descriptions, sections } = record;
    const parts = [{ area, trees, descriptions }, ...sections];
    const labels = descendantLabels(area.path, parts.map((part) => part.area.path));
    const body = parts.flatMap((part) => [
      ...part.descriptions.map((session) => workDefinitionRow(session)),
      ...orderedGoalTrees(part.trees).map((tree) => workTreeRows(tree, area.path, labels, facts, maxElapsedMs)),
    ]).join("");
    // A focused Area stays on the screen with nothing in it, and says why, so
    // Julian can see that his Focus is what emptied the table.
    const empty = record.focusRoot && !record.focusHasWork
      ? `<tr class="work-empty-row"><td class="area-focus-empty" colspan="${WORK_COLUMNS.length}">No ${state.workFilter === "active" ? "current" : "planned"} work matches in this Focus.</td></tr>`
      : "";
    return `<tbody class="work-group" data-work-group="${escapeHtml(area.path)}" data-desk-area="${escapeHtml(area.path)}" aria-labelledby="${workGroupId(area.path)}">
      ${workGroupHeaderRow(record)}${body}${empty}
    </tbody>`;
  }

  /** One Goal tree as adjacent rows: the parent, then its open Subgoals. */
  function workTreeRows(tree, groupPath, labels, facts, maxElapsedMs) {
    const subgoals = tree.goals.slice(1).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
    const expanded = !state.collapsedGoalTrees.has(tree.root.file);
    const parentRow = workGoalRow(tree.root, { groupPath, labels, fact: facts.get(tree.root.file), maxElapsedMs, subgoalCount: subgoals.length, expanded });
    const subgoalRows = subgoals.map((goal) => workGoalRow(goal, { groupPath, labels, fact: facts.get(goal.file), maxElapsedMs, subgoal: true, parent: tree.root.file, hidden: !expanded }));
    return [parentRow, ...subgoalRows].join("");
  }

  /** Renders the Programs of one Area as a compact operational shelf. */
  function deskProgramShelf(programs) {
    return `<div class="desk-programs">${programs.map((program) => {
      return `
        <div class="desk-program ${programIsLive(program) ? "live" : ""}">
          <button type="button" data-select-program="${escapeHtml(program.id)}">
            <span aria-hidden="true">${program.type === "process" ? "SERVER" : program.type === "command" ? "COMMAND" : "TRIGGER"}</span>
            <strong>${escapeHtml(program.label)}</strong>
            <em>${escapeHtml(programState(program))}</em>
          </button>
          ${programRowControls(program).map((control) => `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>`).join("")}
        </div>`;
    }).join("")}</div>`;
  }

  /** Renders Programs once under the Area that owns them. */
  function deskProgramSection(area, programs, { root = false } = {}) {
    if (!programs?.length) return "";
    const title = root ? "Programs" : `${humanName(area.name)} · Programs`;
    return `<section class="area-desk-section programs" data-program-area="${escapeHtml(area.path)}">
      <div class="area-desk-section-heading"><h3>${escapeHtml(title)}</h3><span>${programs.length}</span></div>
      ${deskProgramShelf(programs)}
    </section>`;
  }

  /**
   * The Programs of every Area on the screen, in one shelf under the table.
   * A Program is not work: it never earns a Goal row, and it keeps the plain
   * operational controls it had on the Area panel.
   */
  function workProgramSections(records) {
    const sections = records.flatMap((record) => [
      deskProgramSection(record.area, record.programs, { root: true }),
      ...record.sections.map((section) => deskProgramSection(section.area, section.programs)),
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
  function toggleSubgoals(file) {
    if (state.collapsedGoalTrees.has(file)) state.collapsedGoalTrees.delete(file);
    else state.collapsedGoalTrees.add(file);
    localStorage.setItem("agent-shell.collapsed-goal-trees", JSON.stringify([...state.collapsedGoalTrees]));
    paint(true);
  }

  /** The complete work table: one caption, one header, one row group per Area. */
  function workTable(records, maxElapsedMs) {
    const facts = readinessFacts();
    // An Area with no row of its own does not earn a header. A chosen Focus
    // root is the one exception: it says that the Focus is what emptied it.
    const shown = records.filter(workGroupHasRows);
    const bodies = shown.map((record) => workGroupBody(record, facts, maxElapsedMs)).join("");
    const rowCount = shown.reduce((count, record) => count + [record, ...record.sections]
      .reduce((inner, part) => inner + part.trees.reduce((goals, tree) => goals + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0), 0), 0);
    const word = state.workFilter === "inactive" ? "Planned work" : "Current work";
    // The column group carries the widths. A narrow layout hides three cells,
    // and a fixed table keeps reserving width for a column whose cells are all
    // `display: none` unless a `<col>` states that width is zero.
    return `<table class="work-table">
      <caption class="work-caption"><span>${escapeHtml(word)}</span><span class="work-caption-count">${rowCount} ${rowCount === 1 ? "Goal" : "Goals"}</span><span class="work-keyboard-hint" aria-hidden="true">j k rows · ⌘J session · ? keys</span></caption>
      <colgroup>${WORK_COLUMNS.map((column) => `<col class="work-col-${column.key}">`).join("")}</colgroup>
      <thead><tr>${WORK_COLUMNS.map((column) => `<th scope="col" class="work-head-${column.key}">${column.hidden ? `<span class="visually-hidden">${escapeHtml(column.label)}</span>` : escapeHtml(column.label)}</th>`).join("")}</tr></thead>
      ${bodies}
    </table>`;
  }

  /** Renders the complete Work screen: the direct-ask table, then the work table. */
  function renderWork() {
    const query = state.query.trim();
    const records = filteredDeskAreas(query);
    // Every bar on this paint is scaled to the longest-elapsed Goal it draws
    // (deskGoalBar, design-compact-work-desk Decision 2).
    const maxElapsedMs = deskMaxElapsedMs(records, Date.now());
    const roots = areaFocusRoots();
    const focusNames = areaFocusLabels(roots).join(" + ");
    const emptyCopy = query
      ? `${roots.length ? `Area Focus (${escapeHtml(focusNames)}): ` : ""}No ${state.workFilter === "active" ? "current" : "planned"} work matches “${escapeHtml(query)}”.`
      : `${roots.length ? `Area Focus (${escapeHtml(focusNames)}): ` : ""}No ${state.workFilter === "active" ? "work is active" : "unstarted Goals"}.`;
    const content = `${records.length
      ? workTable(records, maxElapsedMs)
      : `<div class="empty-state">${emptyCopy}</div>`}`;

    return `
      <section class="work-page">
        ${roots.length ? areaFocusControl() : ""}
        <div class="work-tools${roots.length ? " focused" : ""}">
          <button class="work-area-browser" type="button" data-show-areas>Browse Areas</button>
          ${roots.length ? "" : areaFocusControl()}
          <label class="search-field">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <input id="work-search" type="search" value="${escapeHtml(state.query)}" placeholder="Filter work and Areas" autocomplete="off" />
            ${shortcutKbd("findWork")}
          </label>
          <div class="work-filter" role="group" aria-label="Choose current or planned work">
            ${[["active", "Current"], ["inactive", "Planned"]].map(([filter, label]) => `<button type="button" data-work-filter="${filter}" aria-pressed="${state.workFilter === filter}">${label}</button>`).join("")}
          </div>
        </div>
        ${content}
        ${launchPopover()}
      </section>
    `;
  }

  return { allGoals, goalGroups, goalTrees, goalTreeState, goalTreeIsActive, filteredGoalTrees, saveExpandedAreas, revealArea, goalByFile, currentGoal, sessionForGoal, sessionsForGoal, describeWorkSessions, describeWorkSession, brainSessions, brainForAreaCard, brainStateLabel, brainKind, deskBrainButton, openBrainSession, openOrStartBrain, toggleBrainPopover, startBrain, humanName, areaParts, areaLabel, areaPath, agentName, agentReference, ageText, stateLabel, describeWorkStateLabel, goalNeedsYou, goalWorkFinished, workCard, goalTreeCard, fallbackAsks, forgetVerdictLines, openRequest, sendVerdict, replyAboutRow, dismissAsk, syncDockBadge, enableDockBadge, forYouItems, areaForYouGroups, goalGroupRoot, toggleSubgoals, openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery, applyAreaFocus, clearAreaFocus, renderWork };
}
