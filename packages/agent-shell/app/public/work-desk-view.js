import areaMapCore from "./area-map-core.js";
import goalCardCore from "./goal-card-core.js";
import askCore from "./ask-core.js";
import goToCore from "./go-to-core.js";
import { cleanText, clip, escapeHtml, progressPoints } from "./text-format.js";

/** Creates the work desk view product boundary. */
export function createWorkDeskView({ state, api, post, paint, refresh, showToast, captureReturnPoint, saveDescribeSession, launchSelection, launchRequestFields, syncLaunchDraft, preferredArea, launchOptionsFor, pipelineForGoal, pipelineRecordForGoal, areas, orderedGoalTrees, programRowControl, programIsLive, programState, localMoment, shortcutKbd, launchPopover, whatHappenedOverlay, DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET }) {
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
    return tree.goals.some((goal) => !["done", "dropped", "deferred"].includes(goal.status) && Boolean(sessionForGoal(goal)));
  }

  /** Applies the selected session-presence filter without splitting Goal trees. */
  function filteredGoalTrees(trees) {
    const readyForYou = new Set((state.brains ?? []).flatMap((brain) => (brain.forJulian ?? []).filter((row) => row.kind === "test").map((row) => row.file)));
    /** Returns whether a Goal tree belongs in the current-work view. */
    const isCurrent = (tree) => goalTreeIsActive(tree) || tree.goals.some((goal) => goalNeedsYou(goal) || readyForYou.has(goal.file));
    if (state.workFilter === "active") return trees.filter(isCurrent);
    if (state.workFilter === "inactive") return trees.filter((tree) => !isCurrent(tree));
    return trees;
  }

  /** Stores the expansion state of the Area tree. */
  function saveExpandedAreas() {
    localStorage.setItem("agent-shell.expanded-areas", JSON.stringify([...state.expandedAreas].sort()));
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

  /** Opens the brain's terminal in the same view as a describe-work agent. */
  function openBrainSession(name) {
    const session = brainSessions().find((item) => item.name === name);
    if (!session) return showToast("The brain session is not live.");
    state.describeReturn = captureReturnPoint();
    state.describeSessionName = session.name;
    state.document = null;
    saveDescribeSession();
    state.view = "describe-agent";
    state.renderedKey = "";
    paint(true);
  }

  /** Opens the Area brain, or starts the missing session before opening it. */
  async function openOrStartBrain(area) {
    const existing = brainForAreaCard(area);
    const live = brainSessions().find((session) => session.area === area || session.name === existing?.session);
    if (live) return openBrainSession(live.name);
    if (openingBrains.has(area)) return;
    openingBrains.add(area);
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
    } finally {
      openingBrains.delete(area);
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
    launchOptionsFor(area);
    state.launch.record = null;
    state.launch.steps = [];
    state.launch.active = 0;
    state.launch.command = "";
    state.launch.editing = false;
    state.launch.instruction = "";
    state.launch.continueFrom = null;
    // Fable plans by default; the picker shows it selected when the registry
    // has it, and the server falls back to the Area default when it does not.
    state.launch.choice = brain?.launch ?? { harness: "claude", model: "fable-5", effort: null };
    state.brainDraft = { area, instruction: brain?.instruction ?? "" };
    const rect = button.getBoundingClientRect();
    state.launchTarget = BRAIN_LAUNCH_TARGET;
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
    if (working) return { kind: "working", label: `${working} ${working === 1 ? "agent" : "agents"} working` };
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
    const trees = filteredGoalTrees(goalTrees().filter((tree) => goalTreeState(tree) !== "closed"));
    const descriptions = state.workFilter === "inactive" ? [] : describeWorkSessions();
    const core = areaMapCore;
    const areaList = areas();
    const byPath = new Map(areaList.map((area) => [area.path, area]));
    /** One Area's own open Goal trees and definition sessions, not its descendants'. */
    const workOf = (path) => ({
      trees: trees.filter((tree) => tree.path === path),
      descriptions: descriptions.filter((session) => session.area === path),
    });
    const openCounts = new Map();
    for (const area of areaList) {
      const { trees: areaTrees, descriptions: areaDescriptions } = workOf(area.path);
      const openGoalCount = areaTrees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
      openCounts.set(area.path, Math.max(openGoalCount, areaDescriptions.length ? 1 : 0));
    }
    const projectedPanels = null;
    const panelDefs = projectedPanels?.length ? projectedPanels : core.deskPanels(openCounts);
    const covered = new Set(panelDefs.flatMap((panel) => [panel.path, ...panel.sections]));
    const panels = panelDefs.map((panel) => {
      const area = byPath.get(panel.path);
      const own = workOf(panel.path);
      const sections = panel.sections
        .map((path) => ({ area: byPath.get(path), ...workOf(path) }))
        .filter((section) => section.area);
      const programs = state.programs.programs.filter((program) => program.area === panel.path);
      return { area, trees: own.trees, descriptions: own.descriptions, sections, programs };
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
      const stoppedStep = pipeline?.steps.find((step) => step.status === "stopped" || (step.status === "running" && !step.live));
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
      .filter((brain) => brain.status === "running" && brain.live)
      .map((brain) => {
        const rows = (brain.forJulian ?? [])
          .filter((row) => !state.verdictLines.has(row.line))
          .map((row) => ask.askFromPlanRow(brain, row));
        // A brain stuck at its own dialog cannot write a plan line about being
        // stuck, so Tangent asks for it.
        const requests = (brain.requests ?? []).map((request) => ask.askFromRequest(brain, request));
        const asks = [...requests, ask.askFromBrainDialog(brain), ...rows].filter(Boolean);
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
  const ASK_PRIMARY_ACTIONS = ["open-document", "open-brain", "open-run", "reveal-goal", "select-definition", "answer"];

  /** Carries one action's verb and its argument to the click delegation. */
  function askActionAttributes(ask, action) {
    const arg = action.arg ?? {};
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

  /**
   * One ask, whoever built it: who it is about, the facts under the name, and
   * the question on a line of its own, because the question is the only part
   * Julian must read. The first opening verb becomes the row's main button;
   * the answering verbs sit beside it. There is one renderer, so nothing that
   * is not an ask can be drawn here.
   */
  function askRow(ask) {
    const text = `<span><strong>${escapeHtml(ask.subject)}</strong>${ask.detail ? `<small>${escapeHtml(ask.detail)}</small>` : ""}<span class="attention-question">${escapeHtml(ask.question)}</span></span>`;
    const primary = ask.actions.find((action) => ASK_PRIMARY_ACTIONS.includes(action.kind));
    const rest = ask.actions.filter((action) => action !== primary);
    const buttons = rest.length
      ? `<span class="attention-row-actions">${rest.map((action) => `<button class="attention-tried${action.kind === "reply" ? " attention-reply" : ""}" type="button" ${askActionAttributes(ask, action)}>${escapeHtml(action.label)}</button>`).join("")}</span>`
      : "";
    const head = primary
      ? `<button type="button" ${askActionAttributes(ask, primary)}>${text}<span>${escapeHtml(primary.label)} <b aria-hidden="true">→</b></span></button>`
      : text;
    return `<div class="attention-row">${head}${buttons}</div>`;
  }

  /** One live brain group's asks and its direct reply action. */
  function forYouGroupMarkup(group, label) {
    const reach = `<button class="attention-tried" type="button" data-open-brain="${escapeHtml(group.brain.session ?? "")}">Reply to brain</button>`;
    return `
      <div class="for-you-group${group.stopped ? " stopped" : ""}">
        <header><span>${escapeHtml(label)}</span>${reach}</header>
        <div class="attention-items">${group.asks.map(askRow).join("")}</div>
      </div>`;
  }

  /** The fallback asks grouped by Area, so every row says which Area it is from. */
  function fallbackAskGroups(asks) {
    const byArea = new Map();
    for (const ask of asks) byArea.set(ask.area, [...(byArea.get(ask.area) ?? []), ask]);
    return [...byArea].map(([area, items]) => ({ area, asks: items }));
  }

  /**
   * The For-you rows on one Area's own panel, directly under its brain line:
   * Julian decides what the brain is asking without leaving the Area he is
   * looking at (design-what-needs-julian-under-brains, goal-decisions-show-
   * on-the-area-view-not-just-a-count). Empty when the Area has no brain of
   * its own; the panel then stays as it was before this Goal.
   */
  function areaForYouSection(areaPath) {
    const groups = areaForYouGroups(areaPath);
    if (!groups.length) return "";
    const markup = groups.map((group) => forYouGroupMarkup(group, group.area === areaPath ? "For you" : areaLabel(group.area))).join("");
    return `<div class="area-for-you">${markup}</div>`;
  }

  /**
   * The For you card: what the brains asked, then what Tangent itself asks for
   * the Areas with no brain. Every row is a direct ask, and the number in the
   * header is the length of that one list.
   */
  function deskAttentionQueue() {
    const groups = askGroups();
    const fallback = fallbackAsks();
    const count = groups.reduce((total, group) => total + group.asks.length, 0) + fallback.length;
    if (!count) return "";
    const enableBadge = typeof navigator.setAppBadge === "function"
      && window.__agentShellNativeDockBadge !== true
      && typeof Notification !== "undefined"
      && Notification.permission !== "granted";
    const groupMarkup = groups.map((group) => forYouGroupMarkup(group, areaLabel(group.area))).join("");
    const fallbackMarkup = fallbackAskGroups(fallback)
      .map((group) => `<div class="for-you-group fallback"><header><span>${escapeHtml(areaLabel(group.area))} · no brain</span></header><div class="attention-items">${group.asks.map(askRow).join("")}</div></div>`)
      .join("");
    return `
      <section class="attention-queue" aria-labelledby="attention-heading">
        <header><p class="kicker">Attention</p><h2 id="attention-heading">For you</h2>${enableBadge ? `<button class="attention-badge-button" type="button" data-enable-dock-badge>Show in Dock</button>` : ""}<span>${count}</span></header>
        ${groupMarkup}${fallbackMarkup}
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
  async function sendVerdict(area, line, verdict) {
    state.verdictLines.add(line);
    paint(true);
    try {
      if (line.startsWith("request:")) {
        await post("/api/brains/requests/answer", { area, id: line.slice("request:".length), answer: verdict });
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
    const line = { stepLine: "", stepTitle: "", fill: "" };
    if (["done", "dropped", "deferred"].includes(goal.status)) {
      return { ...line, state: goal.status === "done" ? "Complete" : humanName(goal.status), action: "", kind: "complete", route: "" };
    }
    const session = sessionForGoal(goal);
    line.fill = deskFillLabel(session?.context);
    // Under a live brain a static pane waits for the brain, not for Julian: the
    // state stays as a fact, without the amber that means "you".
    const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
    if (!session) return { ...line, state: goalNeedsYou(goal) ? "Waiting" : "Ready", action: "Start agent", kind: goalNeedsYou(goal) ? idle : "ready", route: "run" };
    if (session.state === "working") return { ...line, state: "Working", action: `Open ${agentName(session)}`, kind: "working", route: "run" };
    if (session.state === "waiting") return { ...line, state: "Waiting", action: `Open ${agentName(session)}`, kind: idle, route: "run" };
    if (session.state === "shell") return { ...line, state: "Stopped", action: "Open session", kind: idle, route: "run" };
    return { ...line, state: "Ready", action: "Open agent", kind: "ready", route: "run" };
  }

  /** The idle time (ms) after which an idle step is offered "Send to next". */
  const PIPELINE_SEND_AFTER_MS = 60_000;

  /**
   * The pipeline row's state pill, primary action, and the small `Step N of M`
   * line above the pill. The step's agent and instruction stay in that line's
   * hover title: Julian reads the step in the launch popover, not on the card.
   */
  function deskPipelineAction(goal, pipeline) {
    const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped") ?? pipeline.steps.find((item) => item.status === "pending");
    if (!step) return deskGoalAction(goal);
    const line = { stepLine: `Step ${step.index} of ${pipeline.steps.length}`, stepTitle: `${step.label || "agent"}: ${step.instruction ?? ""}`, fill: deskFillLabel(step.context) };
    const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
    if (step.status === "stopped" || (step.status === "running" && !step.live)) return { ...line, state: "Stopped", action: "", kind: idle, route: "" };
    if (step.status === "pending") return { ...line, state: "Not started", action: "", kind: idle, route: "" };
    if (step.state === "working") return { ...line, state: "Working", action: `Open step ${step.index}`, kind: "working", route: "run" };
    if (step.state === "waiting") return { ...line, state: "Waiting", action: `Open step ${step.index}`, kind: idle, route: "run" };
    if (step.state === "shell") return { ...line, state: "Stopped", action: `Open step ${step.index}`, kind: idle, route: "run" };
    return { ...line, state: "Ready", action: `Open step ${step.index}`, kind: "ready", route: "run" };
  }

  /** Restart, Skip, Stop work, and Send-to-next, only when they apply. */
  function deskPipelineControls(goal, pipeline) {
    const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped");
    if (!step) return "";
    const last = step.index >= pipeline.steps.length;
    const stopped = step.status === "stopped" || (step.status === "running" && !step.live);
    if (stopped) {
      // A step whose session died on its own. Julian's own Stop agent already
      // ends the run, so Stop work here is the same exit for a crashed step.
      return `<button class="desk-action" type="button" data-pipeline-control="restart" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Restart step ${step.index}</button>`
        + (last ? "" : `<button class="desk-action" type="button" data-pipeline-control="skip" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Skip to step ${step.index + 1}</button>`)
        + `<button class="desk-action" type="button" data-pipeline-control="end" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="End the run; the Goal stays open with its handovers">Stop work</button>`;
    }
    const idleLong = step.state === "waiting" && (step.stateDetail === "idle" || step.stateDetail === null) && step.idleSince && Date.now() - step.idleSince >= PIPELINE_SEND_AFTER_MS;
    if (idleLong && !last) {
      return `<button class="desk-action" type="button" data-pipeline-control="send" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="Use the agent's last message as its handover">Send to step ${step.index + 1}</button>`;
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
   * The agent-count fact, the only text fact left on the card: how long the
   * Goal runs or waits is now the bar (design-compact-work-desk).
   */
  function deskGoalFacts(facts, names, now) {
    const core = goalCardCore;
    if (!core || !facts) return "";
    const segment = core.factsSegments(facts, now, names).find((item) => item.kind === "agents");
    if (!segment) return "";
    return `<span class="desk-goal-facts"><span title="${escapeHtml(segment.title)}">${escapeHtml(segment.text)}</span></span>`;
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

  /**
   * The fixed `End · Won't do · Done` row. Every action stays visible and in
   * the same place: one that does not apply is disabled, never removed, so
   * Done never moves under the cursor (design-goal-cards Decision 4).
   */
  function deskGoalSecondaryActions(goal, liveSession) {
    const open = !["done", "dropped", "deferred"].includes(goal.status);
    const buttons = [
      liveSession
        ? `<button class="desk-icon-action" type="button" data-stop-goal="${escapeHtml(goal.file)}" aria-label="End the agent run for ${escapeHtml(goal.title)}">End</button>`
        : `<button class="desk-icon-action" type="button" disabled title="No live agent to end">End</button>`,
      open
        ? `<button class="desk-icon-action" type="button" data-wont-do-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} won't do">Won't do</button>`
        : `<button class="desk-icon-action" type="button" disabled title="This Goal is closed">Won't do</button>`,
      open
        ? `<button class="desk-icon-action complete" type="button" data-complete-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} complete">Done</button>`
        : `<button class="desk-icon-action complete" type="button" disabled title="This Goal is closed">Done</button>`,
    ];
    return `<span class="desk-secondary-actions">${buttons.join(`<i aria-hidden="true">·</i>`)}</span>`;
  }

  /**
   * Renders one Goal as a compact two-line card: title with step and status
   * on line one, the bar with the agent count and the actions on line two,
   * pipeline controls on a rare third line (design-compact-work-desk
   * Decision 3). The kicker and the Documents chip are gone; a Subgoal reads
   * from its indent and smaller title under the `To do that` disclosure.
   */
  function deskGoalRow(goal, { subgoal = false, maxElapsedMs = 0 } = {}) {
    const pipeline = pipelineForGoal(goal);
    const record = pipelineRecordForGoal(goal);
    const action = pipeline ? deskPipelineAction(goal, pipeline) : deskGoalAction(goal);
    const liveSession = sessionForGoal(goal);
    const launchTitle = record ? "Add or edit steps" : "Choose agent or model";
    /** The ▾ that opens this Goal's launch popover: agent choice, or the step list once a pipeline exists. */
    const launchToggle = (label) => `<button class="desk-action desk-launch-toggle${state.launchTarget === goal.file ? " open" : ""}" type="button" data-launch-for="${escapeHtml(goal.file)}" title="${launchTitle}" aria-label="${launchTitle} for ${escapeHtml(goal.title)}" aria-expanded="${state.launchTarget === goal.file}">${label}</button>`;
    const route = `data-open-goal-run="${escapeHtml(goal.file)}"`;
    const controls = pipeline ? deskPipelineControls(goal, pipeline) : "";
    const selectable = action.action === "Start agent";
    const selected = selectable && state.goalSelection.includes(goal.file);
    const { facts, names, now } = deskGoalFactsData(goal);
    return `
      <article class="desk-goal ${subgoal ? "subgoal" : "root-goal"} ${action.kind}${selected ? " selected" : ""}" data-goal-anchor="${escapeHtml(goal.file)}">
        ${selectable ? `<label class="desk-select" title="Select for one shared agent"><input type="checkbox" data-check-goal="${escapeHtml(goal.file)}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(goal.title)} for one shared agent"></label>` : ""}
        <div class="desk-goal-main">
          <div class="desk-goal-line1">
            <strong title="${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</strong>
            <span class="desk-goal-status">
              ${action.stepLine ? `<small class="desk-step-line" title="${escapeHtml(action.stepTitle)}">${escapeHtml(action.stepLine)}</small><i aria-hidden="true">·</i>` : ""}
              ${action.fill ? `<small class="desk-fill" title="Carried context">${escapeHtml(action.fill)}</small><i aria-hidden="true">·</i>` : ""}
              <span class="desk-state ${action.kind}">${escapeHtml(action.state)}</span>
            </span>
          </div>
          <div class="desk-goal-line2">
            <span class="desk-goal-bar-group">
              ${deskGoalBar(goal, facts, now, maxElapsedMs)}
              ${deskGoalElapsed(facts, now)}
              ${deskGoalFacts(facts, names, now)}
            </span>
            <span class="desk-goal-actions">
              ${action.action === "Start agent"
                ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>Start agent</button>${launchToggle("▾")}</span>`
                : action.action
                  ? (record ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>${launchToggle("▾")}</span>` : `<button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>`)
                  : record ? launchToggle("Steps ▾") : ""}
              ${deskGoalSecondaryActions(goal, liveSession)}
            </span>
          </div>
          ${controls ? `<div class="desk-goal-line3"><span class="desk-pipeline-controls">${controls}</span></div>` : ""}
        </div>
      </article>`;
  }

  /** The checked Goal files that belong to one Area panel, in checked order. */
  function selectedGoalFiles(trees) {
    const panelFiles = new Set(trees.flatMap((tree) => tree.goals.map((goal) => goal.file)));
    return state.goalSelection.filter((file) => panelFiles.has(file));
  }

  /**
   * The one action for a checked set of Goals: start a single agent that owns
   * them all and works them in checked order. Renders only while something in
   * this Area panel is checked; checking itself never starts anything.
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

  /** Renders a root Goal and visually distinct Subgoals as one group. */
  function deskGoalGroup(tree, maxElapsedMs = 0) {
    const subgoals = tree.goals.slice(1).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
    const expanded = subgoals.some((goal) => sessionForGoal(goal) || goalNeedsYou(goal));
    return `
      <section class="desk-goal-group">
        ${deskGoalRow(tree.root, { maxElapsedMs })}
        ${subgoals.length ? `<details class="desk-subgoal-disclosure" ${expanded ? "open" : ""}><summary><span>To do that</span><small>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</small></summary><div class="desk-subgoals">${subgoals.map((goal) => deskGoalRow(goal, { subgoal: true, maxElapsedMs })).join("")}</div></details>` : ""}
      </section>`;
  }

  /** Renders one work-definition Run inside its durable Area. */
  function deskDefinitionRow(session) {
    const name = agentName(session);
    const stateName = describeWorkStateLabel(session);
    const kind = session.state === "working" ? "working" : "waiting";
    return `
      <button class="desk-definition ${kind}" type="button" data-select-work-definition="${escapeHtml(session.name)}">
        <span><small>Defining work</small><strong>${escapeHtml(session.workTitle || "Define new work")}</strong></span>
        <span><em class="desk-state ${kind}">${escapeHtml(stateName)}</em><b>Open ${escapeHtml(name)} →</b></span>
      </button>`;
  }

  /** Renders the Programs of one Area as a compact operational shelf. */
  function deskProgramShelf(programs) {
    return `<div class="desk-programs">${programs.map((program) => {
      const control = programRowControl(program);
      return `
        <div class="desk-program ${programIsLive(program) ? "live" : ""}">
          <button type="button" data-select-program="${escapeHtml(program.id)}">
            <span aria-hidden="true">${program.type === "process" ? "SERVER" : program.type === "command" ? "COMMAND" : "TRIGGER"}</span>
            <strong>${escapeHtml(program.label)}</strong>
            <em>${escapeHtml(programState(program))}</em>
          </button>
          ${control ? `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>` : ""}
        </div>`;
    }).join("")}</div>`;
  }

  /** Renders one stable Area landmark with work and knowledge together. */
  function deskAreaPanel(record, position, maxElapsedMs = 0) {
    const { area, trees, descriptions, sections, programs } = record;
    const allTrees = [...trees, ...sections.flatMap((section) => section.trees)];
    const allDescriptions = [...descriptions, ...sections.flatMap((section) => section.descriptions)];
    const status = deskAreaState(area.path, allTrees, allDescriptions);
    const parentPath = area.path.split("/").slice(0, -1).join("/");
    const parent = areaParts(area.path).slice(0, -1).join(" / ") || "Top level";
    const openGoalCount = allTrees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
    const goalSectionTitle = state.workFilter === "inactive" ? "Planned work" : "Current work";
    return `
      <article class="area-desk-panel ${status.kind}" data-desk-area="${escapeHtml(area.path)}" style="--desk-order:${position}">
        <header class="area-desk-header">
          <span class="area-desk-index" aria-hidden="true">${String(position + 1).padStart(2, "0")}</span>
          <div>${parentPath ? `<small>${areaPath(parentPath)}</small>` : `<small>${escapeHtml(parent)}</small>`}<h2><button type="button" data-open-area="${escapeHtml(area.path)}" title="Open the ${escapeHtml(humanName(area.name))} Area map">${escapeHtml(humanName(area.name))}</button></h2></div>
          <span class="area-desk-state ${status.kind}">${escapeHtml(status.label)}</span>
          <button class="area-desk-what-happened" type="button" data-what-happened-for="${escapeHtml(area.path)}" aria-haspopup="dialog" aria-expanded="${state.whatHappened?.area === area.path}">What happened</button>
          ${deskBrainButton(area.path)}
        </header>
        ${areaForYouSection(area.path)}
        <div class="area-desk-body">
          ${descriptions.length ? `<section class="area-desk-section definitions"><div class="area-desk-section-heading"><h3>Dispatches</h3><span>${descriptions.length}</span></div>${descriptions.map(deskDefinitionRow).join("")}</section>` : ""}
          <section class="area-desk-section goals">
            <div class="area-desk-section-heading"><h3>${goalSectionTitle}</h3><span>${openGoalCount}</span>${deskSelectionBar(area.path, trees)}</div>
            ${allTrees.length ? orderedGoalTrees(trees).map((tree) => deskGoalGroup(tree, maxElapsedMs)).join("") : `<p class="desk-empty">No active Goals.</p>`}
            ${sections.flatMap((section) => orderedGoalTrees(section.trees).map((tree) => `<div class="desk-descendant-goal"><small>${escapeHtml(areaLabel(section.area.path))}</small>${deskGoalGroup(tree, maxElapsedMs)}</div>`)).join("")}
          </section>
          ${programs.length ? `<section class="area-desk-section programs">
            <div class="area-desk-section-heading"><h3>Programs</h3><span>${programs.length}</span></div>
            ${deskProgramShelf(programs)}
          </section>` : ""}
        </div>
        <footer class="area-desk-actions">
          <button type="button" data-describe-area="${escapeHtml(area.path)}">Describe work here</button>
          <button type="button" data-open-area="${escapeHtml(area.path)}">Organize Area</button>
        </footer>
      </article>`;
  }

  /**
   * Renders one descendant Area with open work as an indented, collapsible
   * section of its ancestor's desk panel (design-area-map Decision 1). The
   * state pill stays visible even collapsed, so a live agent below cannot
   * hide behind a closed section.
   */
  function deskAreaSection(section, maxElapsedMs = 0) {
    const { area, trees, descriptions } = section;
    const status = deskAreaState(area.path, trees, descriptions);
    const openGoalCount = trees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
    const expanded = !state.collapsedDeskSections.has(area.path);
    return `
      <section class="area-desk-section desk-subarea ${status.kind}${expanded ? "" : " collapsed"}">
        <div class="desk-subarea-head">
          <button class="desk-subarea-toggle" type="button" data-toggle-desk-section="${escapeHtml(area.path)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(humanName(area.name))}">
            <span class="desk-subarea-caret" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            <strong>${escapeHtml(humanName(area.name))}</strong>
            <span class="desk-subarea-count">${openGoalCount} ${openGoalCount === 1 ? "Goal" : "Goals"}</span>
            <span class="desk-subarea-state desk-state ${status.kind}">${escapeHtml(status.label)}</span>
          </button>
          <button class="desk-subarea-open" type="button" data-open-area="${escapeHtml(area.path)}" title="Open the ${escapeHtml(humanName(area.name))} Area map" aria-label="Open the ${escapeHtml(humanName(area.name))} Area map">Map ↗</button>
        </div>
        ${expanded ? `
          <div class="desk-subarea-body">
            ${descriptions.length ? descriptions.map(deskDefinitionRow).join("") : ""}
            ${trees.length ? orderedGoalTrees(trees).map((tree) => deskGoalGroup(tree, maxElapsedMs)).join("") : ""}
          </div>` : ""}
      </section>`;
  }

  /** Renders the complete area-first work desk. */
  function renderWork() {
    const query = state.query.trim();
    const records = filteredDeskAreas(query);
    const maxElapsedMs = deskMaxElapsedMs(records, Date.now());
    const emptyCopy = query
      ? `No ${state.workFilter === "active" ? "current" : "planned"} work matches “${escapeHtml(query)}”.`
      : `No ${state.workFilter === "active" ? "work is active" : "unstarted Goals"}.`;
    const content = `${!query && state.workFilter === "active" ? deskAttentionQueue() : ""}${records.length
      ? `<section class="area-desk-grid" aria-label="Work by Area">${records.map((record, position) => deskAreaPanel(record, position, maxElapsedMs)).join("")}</section>`
      : `<div class="empty-state">${emptyCopy}</div>`}`;

    return `
      <section class="work-page">
        <div class="work-tools">
          <button class="work-area-browser" type="button" data-show-areas>Browse Areas</button>
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
        ${whatHappenedOverlay()}
      </section>
    `;
  }

  return { allGoals, goalGroups, goalTrees, goalTreeState, goalTreeIsActive, filteredGoalTrees, saveExpandedAreas, revealArea, goalByFile, currentGoal, sessionForGoal, sessionsForGoal, describeWorkSessions, describeWorkSession, brainSessions, brainForAreaCard, brainStateLabel, brainKind, deskBrainButton, openBrainSession, openOrStartBrain, toggleBrainPopover, startBrain, humanName, areaParts, areaLabel, areaPath, agentName, agentReference, ageText, stateLabel, describeWorkStateLabel, goalNeedsYou, goalWorkFinished, workCard, goalTreeCard, fallbackAsks, forgetVerdictLines, sendVerdict, replyAboutRow, syncDockBadge, enableDockBadge, forYouItems, areaForYouGroups, renderWork };
}
