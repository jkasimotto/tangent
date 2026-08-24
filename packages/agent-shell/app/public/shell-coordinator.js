import { clip, escapeHtml } from "./text-format.js";

/** Coordinates navigation between capability-owned browser features. */
export function createShellCoordinator({ shell, chrome, work, areasFeature, programs, launch, documents }) {
  const { state, api, post, actionTelemetry, paint, refresh, showToast } = shell;
  const {
    screen, backButton, shellMenu, goToLayer, goToInput, goToList, modalLayer, modalKicker, modalTitle, modalCopy,
    modalField, modalActions, buildGoToRows, goToCore, rememberScreenScroll, restoreReturnPoint, captureReturnPoint,
    restoreReturnScroll, disposeTerminal, mountTerminal, updateStatusPill,
  } = chrome;
  const {
    areaLabel, humanName, agentName, goalByFile, currentGoal, sessionForGoal, describeWorkSession,
    describeWorkSessions, stopSession, brainForAreaCard, brainStateLabel, agentReference, saveDescribeDraft,
    saveDescribeSession, describeLaunchArea,
  } = work;
  const { allAreas, areaParent, preferredArea, areas, revealArea, selectedArea } = areasFeature;
  const { currentProgram, programById, programIsLive, programAreaDirectory } = programs;
  const {
    launchOptionsFor, launchSelection, launchRequestFields, syncLaunchDraft, commitActiveStep, launchStepDraft,
    launchStepRequest, launchDraftRows, pipelineForGoal, pipelineRecordForGoal, syncDescribeDraft,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  } = launch;
  const { openDocument, refreshDocument, rememberDocumentPosition, documentGoal } = documents;
  let modalConfirm = null;

  /** Opens, closes, or toggles the shell menu. */
  function toggleShellMenu(open = shellMenu.hidden) {
    if (!open) {
      shellMenu.hidden = true;
      return;
    }
    const awakeItem = shellMenu.querySelector("#menu-awake");
    if (awakeItem) awakeItem.textContent = state.caffeinate ? "Let Mac sleep normally" : "Keep Mac awake";
    updateStatusPill();
    const rect = backButton.getBoundingClientRect();
    shellMenu.style.top = `${Math.round(rect.bottom + 6)}px`;
    shellMenu.style.left = `${Math.round(rect.left)}px`;
    shellMenu.hidden = false;
  }

  // ---- Go to ----
  // One printed shortcut (⌘K) opens any Document, Area note, or Area brain by
  // name from any screen. The layer lives outside #screen, so the screen under
  // it never repaints, and Back or Esc returns to it exactly
  // (design-find-a-document-by-title).

  /**
   * The finder's rows for the typed query: every Document, every Area note that
   * exists, and every Area brain. Null while the vault is still loading.
   */
  function goToRows() {
    return buildGoToRows({ vault: state.vault, brains: state.brains, query: state.goTo.query, area: state.goTo.area, kind: state.goTo.kind, view: state.goTo.view, areaLabel, brainStateLabel });
  }

  /** Opens the finder over the current screen, or closes it when ⌘K repeats. */
  function openGoTo() {
    if (!modalLayer.hidden) return;
    if (state.goTo) return closeGoTo();
    if (!shellMenu.hidden) toggleShellMenu(false);
    state.goTo = { query: "", area: "", kind: "", view: "list", selected: 0, rows: [], returnFocus: document.activeElement };
    goToInput.value = "";
    const areaSelect = document.querySelector("#go-to-area");
    const kindSelect = document.querySelector("#go-to-kind");
    areaSelect.innerHTML = `<option value="">All Areas</option>${(state.vault?.areas ?? []).filter((item) => item.path).sort((a, b) => a.path.localeCompare(b.path)).map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(areaLabel(item.path))}</option>`).join("")}`;
    const kinds = [...new Set((state.vault?.documents ?? []).filter((item) => item.kind === "document").map((item) => item.docKind ?? "page"))].sort();
    kindSelect.innerHTML = `<option value="">All kinds</option>${kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`).join("")}`;
    document.querySelector("#go-to-view").textContent = "Graph";
    document.querySelector("#go-to-view").setAttribute("aria-pressed", "false");
    goToLayer.hidden = false;
    renderGoToList();
    goToInput.focus();
  }

  /** Closes the finder and gives the keyboard back to the screen underneath. */
  function closeGoTo() {
    if (!state.goTo) return;
    const focus = state.goTo.returnFocus;
    state.goTo = null;
    goToLayer.hidden = true;
    goToList.innerHTML = "";
    if (focus && focus !== document.body && focus.isConnected) {
      try { focus.focus(); } catch {}
    }
  }

  /** Draws the finder's list. It never touches #screen. */
  function renderGoToList() {
    if (!state.goTo) return;
    const rows = goToRows();
    if (rows === null) {
      state.goTo.rows = [];
      goToList.innerHTML = `<li class="go-to-empty">Loading the vault…</li>`;
      return;
    }
    state.goTo.rows = rows;
    if (state.goTo.view === "graph") {
      const documents = rows.filter((row) => row.kind !== "brain");
      state.goTo.rows = documents;
      if (!documents.length) {
        goToList.innerHTML = `<li class="go-to-empty">No Documents match these filters.</li>`;
        return;
      }
      const byStem = new Map(documents.map((row, index) => [String(row.file).split("/").pop().replace(/\.md$/i, ""), { row, index }]));
      const width = 560, height = Math.max(260, Math.ceil(documents.length / 4) * 120);
      const points = documents.map((row, index) => ({ row, x: 70 + (index % 4) * 140, y: 55 + Math.floor(index / 4) * 120 }));
      const edges = points.flatMap((point) => (point.row.links ?? []).map((target) => [point, byStem.get(String(target).split("/").pop().replace(/\.md$/i, ""))]).filter(([, hit]) => hit).map(([from, hit]) => [from, points[hit.index]]));
      goToList.innerHTML = `<li class="go-to-graph"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dependencies between filtered Documents">${edges.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`).join("")}${points.map((point, index) => `<g data-go-to-row="${index}" tabindex="0" role="button"><circle cx="${point.x}" cy="${point.y}" r="25"/><text x="${point.x}" y="${point.y + 40}">${escapeHtml(clip(point.row.name, 18))}</text></g>`).join("")}</svg></li>`;
      return;
    }
    state.goTo.selected = rows.length ? Math.min(Math.max(state.goTo.selected, 0), rows.length - 1) : 0;
    if (!rows.length) {
      goToList.innerHTML = `<li class="go-to-empty">Nothing is named “${escapeHtml(state.goTo.query)}”.</li>`;
      return;
    }
    goToList.innerHTML = rows.map((row, index) => `
      <li id="go-to-row-${index}" role="option" aria-selected="${index === state.goTo.selected}" data-go-to-row="${index}">
        <span class="search-result-kind">${escapeHtml(row.kindLabel)}</span>
        <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.detail || row.areaLabel)}</small></span>
      </li>`).join("");
    goToInput.setAttribute("aria-activedescendant", `go-to-row-${state.goTo.selected}`);
    goToList.children[state.goTo.selected]?.scrollIntoView?.({ block: "nearest" });
  }

  /** Goes to one chosen row. Enter never starts an agent. */
  function chooseGoToRow(row) {
    if (!row) return;
    closeGoTo();
    if (row.kind === "brain") {
      if (row.live) return openBrainSession(row.session);
      return showWorkAt(row.area);
    }
    return openDocument(row.file);
  }

  /**
   * Opens the Work desk at one Area card, where the control that resumes a
   * stopped brain lives. Without a card for that Area the Areas screen is the
   * next nearest place. Neither starts anything.
   */
  function showWorkAt(area) {
    if (!deskAreas().some((record) => record.area.path === area)) return showAreasAt(area);
    showWork();
    window.setTimeout(() => {
      const card = screen.querySelector(`[data-desk-area="${CSS.escape(area)}"]`);
      if (!card) return;
      try { card.scrollIntoView({ block: "start" }); } catch {}
      card.classList.add("flash");
      window.setTimeout(() => card.classList.remove("flash"), 1600);
    }, 0);
  }

  /** Starts a rebuild and makes its waiting state visible immediately. */
  async function rebuildShell() {
    const commits = state.pendingCommits ?? [];
    closeModal();
    state.rebuilding = true;
    state.rebuild = { phase: "building", commits, targetCommit: state.currentCommit };
    updateStatusPill();
    try {
      const result = await post("/api/shell/rebuild", {});
      state.rebuild = result.operation;
      updateStatusPill();
    } catch (error) {
      state.rebuilding = false;
      state.rebuild = { phase: "failed", commits, targetCommit: state.currentCommit, error: error.message };
      updateStatusPill();
    }
    return false;
  }

  /** Runs the advertised pending-change reload without a hidden second step. */
  async function reloadChanges() {
    toggleShellMenu(false);
    state.rebuild = { phase: "ready", commits: state.pendingCommits ?? [], targetCommit: state.currentCommit };
    updateStatusPill();
  }

  /** Human-readable commits included by the next rebuild. */
  function rebuildCommitCopy() {
    const commits = state.pendingCommits ?? [];
    const list = commits.length
      ? commits.map((commit) => `${commit.shortHash}  ${commit.subject} — ${commit.author}`).join("\n")
      : "No new commits. This rebuild will rebuild the currently deployed commit.";
    return `Agent sessions keep running in tmux. This page reloads automatically when the new server is up.\n\nCommits included:\n${list}`;
  }

  /** Rebuilds from the permanent recovery action after explicit confirmation. */
  function confirmRebuild({ immediate = false } = {}) {
    toggleShellMenu(false);
    if (immediate) return rebuildShell();
    openModal({
      kicker: "Agent Shell",
      title: "Rebuild and restart Agent Shell?",
      copy: rebuildCommitCopy(),
      confirmLabel: state.pendingCommits?.length ? `Reload with ${state.pendingCommits.length} commit${state.pendingCommits.length === 1 ? "" : "s"}` : "Rebuild and restart",
      onConfirm: rebuildShell,
    });
  }

  /**
   * Shows a Goal where it lives: its row on the Work desk. There is no
   * separate Goal page; the row carries the brief, Documents, handoff, and
   * actions. Selection never spawns anything.
   */
  function selectGoal(file) {
    const goal = rememberGoal(file);
    state.view = "work";
    state.query = "";
    state.document = null;
    state.documentTrail = [];
    state.documentTrailIndex = -1;
    if (goal && state.workFilter !== "all" && !filteredGoalTrees(goalTrees().filter((tree) => tree.goals.some((item) => item.file === file))).length) {
      state.workFilter = "all";
      localStorage.setItem("agent-shell.work-filter", state.workFilter);
    }
    paint(true);
    window.setTimeout(() => {
      const row = document.querySelector(`[data-goal-anchor='${String(file).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}']`);
      if (!row) return;
      try { row.scrollIntoView({ block: "center" }); } catch {}
      row.classList.add("flash");
      window.setTimeout(() => row.classList.remove("flash"), 1600);
    }, 0);
  }

  /** Stores one Goal as the active Run context without changing the view. */
  function rememberGoal(file) {
    state.currentFile = file;
    localStorage.setItem("agent-shell.current-goal", file);
    const goal = goalByFile(file);
    if (goal?.area) localStorage.setItem("agent-shell.last-area", goal.area);
    return goal;
  }

  /** Opens an existing Run, or starts a ready Goal, directly from Work. */
  async function openGoalRun(file) {
    const goal = rememberGoal(file);
    if (!goal) return;
    state.agentSessionName = null;
    state.document = null;
    state.documentTrail = [];
    state.documentTrailIndex = -1;
    const session = sessionForGoal(goal);
    if (!session) return openGoalAgent({ returnView: "work" });
    state.agentReturnView = "work";
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
  }

  /** Returns to the work list and optionally focuses search. */
  function showWork({ focus = false } = {}) {
    state.view = "work";
    state.document = null;
    state.documentTrail = [];
    state.documentTrailIndex = -1;
    paint(true);
    if (focus) window.setTimeout(() => document.querySelector("#work-search")?.focus(), 0);
  }

  /** Opens the temporary area hierarchy. */
  function showAreas() {
    if (!areas().some((area) => area.path === state.areaSelection)) state.areaSelection = preferredArea();
    revealArea(state.areaSelection);
    state.areaEdit = null;
    state.view = "areas";
    paint(true);
    window.setTimeout(() => {
      const input = document.querySelector("#area-search");
      input?.focus();
      input?.select();
    }, 0);
  }

  /** Opens area creation under the selected area. */
  function beginAreaCreate() {
    const parent = selectedArea()?.path || preferredArea();
    if (!parent) return showToast("Create a root area group outside Agent Shell first.");
    state.areaEdit = { kind: "new", parent, name: "", preview: null };
    state.view = "area-edit";
    paint(true);
    window.setTimeout(() => document.querySelector("[data-area-form] input[name='name']")?.focus(), 0);
  }

  /** Opens the safe rename and move preview for one area. */
  function beginAreaMove() {
    const selected = selectedArea();
    if (!selected || selected.path.split("/").length < 2) return;
    const parts = selected.path.split("/");
    state.areaEdit = { kind: "move", area: selected.path, parent: parts.slice(0, -1).join("/"), name: humanName(parts.at(-1)), preview: null };
    state.view = "area-edit";
    paint(true);
  }

  /** Returns to the Areas surface with one Area selected. */
  function showAreasAt(path) {
    if (path && areas().some((area) => area.path === path)) state.areaSelection = path;
    showAreas();
  }

  /** Opens one program without changing its runtime. */
  function selectProgram(id) {
    state.programId = id;
    state.view = "program-detail";
    paint(true);
  }

  /** Opens the new-program form with the selected area as its default. */
  function showProgramCreate() {
    const area = selectedArea()?.path || preferredArea();
    state.programDraft = { type: "process", area, name: "", command: "", time: "07:30", cwd: programAreaDirectory(area), model: "sonnet", prompt: "" };
    state.view = "program-create";
    paint(true);
    window.setTimeout(() => document.querySelector("[data-program-form] input[name='name']")?.focus(), 0);
  }

  /** Opens a program's existing tmux session. */
  function openProgramSession() {
    const program = currentProgram();
    if (!program?.session) return showToast("This program has no live or saved session.");
    state.view = "program-session";
    state.renderedKey = "";
    paint(true);
  }

  /** Executes one already-confirmed program control. */
  async function performProgramAction(action, id) {
    const program = programById(id);
    if (!program) return;
    await post("/api/programs/control", { id: program.id, action });
    if (["stop", "close"].includes(action) && state.view === "program-session") state.view = "program-detail";
    await refresh();
    paint(true);
    const messages = { start: "The process started.", restart: "The process restarted.", stop: "The program stopped.", close: "The saved session was removed.", run: "The command started." };
    showToast(messages[action] || "The program changed.");
  }

  /** Adds confirmation where a program action starts or destroys work. */
  function controlProgram(action, id = state.programId) {
    const program = programById(id);
    if (!program) return;
    if (["start", "pause", "resume"].includes(action)) {
      performProgramAction(action, id).catch((error) => showToast(error.message));
      return;
    }
    const descriptions = {
      run: `Run “${program.command}” in ${program.cwd}.`,
      restart: `Stop the current process, then run “${program.command}” again.`,
      stop: "Stop the live program. A managed process keeps its session and scrollback.",
      close: "Remove the retained tmux session and its scrollback. The program definition stays here.",
    };
    openModal({
      kicker: program.type === "command" ? "Command" : "Managed process",
      title: action === "run" ? `Run ${program.label}?` : action === "restart" ? `Restart ${program.label}?` : action === "close" ? "Remove the saved log?" : `Stop ${program.label}?`,
      copy: descriptions[action],
      confirmLabel: action === "run" ? "Run now" : action === "restart" ? "Restart" : action === "close" ? "Remove log" : "Stop",
      danger: ["stop", "close"].includes(action),
      /** Applies the confirmed Program action. */
      onConfirm: () => performProgramAction(action, id),
    });
  }

  /** Rewrites one stored path when its area subtree moves. */
  function movedPath(value, source, destination) {
    return value === source || value.startsWith(`${source}/`) ? `${destination}${value.slice(source.length)}` : value;
  }

  /** Applies the area move that is already visible in the path preview. */
  async function confirmAreaMove() {
    const edit = state.areaEdit;
    if (!edit?.preview) return;
    try {
      const moved = await post("/api/areas/move", { area: edit.area, parent: edit.parent, name: edit.name });
      state.currentFile = movedPath(state.currentFile, moved.source, moved.destination);
      state.areaSelection = moved.destination;
      localStorage.setItem("agent-shell.last-area", movedPath(localStorage.getItem("agent-shell.last-area") || "", moved.source, moved.destination));
      if (state.currentFile) localStorage.setItem("agent-shell.current-goal", state.currentFile);
      state.areaEdit = null;
      await refresh();
      state.view = "areas";
      paint(true);
      showToast("The Area moved. Its nested paths and live sessions followed it.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Opens the fast new-goal form. */
  function showCreate(area = "", returnView = state.view) {
    state.createReturnView = ["areas", "describe"].includes(returnView) ? returnView : "work";
    state.createArea = area || (state.createReturnView === "areas" ? selectedArea()?.path : "") || preferredArea();
    state.view = "create";
    state.document = null;
    state.documentTrail = [];
    state.documentTrailIndex = -1;
    paint(true);
    window.setTimeout(() => document.querySelector("#new-goal-title")?.focus(), 0);
  }

  /**
   * Moves from the describe form to manual Goal creation without losing the
   * typed description: the switch re-renders the page, so the textarea value
   * must land in the stored draft first. Cancel from manual create returns to
   * the describe form with the text intact.
   */
  function switchDescribeToManualCreate() {
    syncDescribeDraft();
    showCreate(describeLaunchArea(), "describe");
  }

  /** Returns from manual Goal creation to the surface that opened it. */
  function cancelCreate() {
    state.createArea = "";
    if (state.createReturnView === "areas") return showAreas();
    if (state.createReturnView === "describe") return showDescribe();
    return showWork();
  }

  /** Adds one Document to a work description without duplicating its source link. */
  function addDescribeSource(source) {
    const sources = state.describeDraft?.sources ?? [];
    if (!sources.some((item) => item.file === source.file)) sources.push(source);
    state.describeDraft.sources = sources;
  }

  /** Opens a fresh or unfinished description without taking over another defining agent. */
  function showDescribe({ source = null, area = "" } = {}) {
    // Cancelling the new-work form returns into this form; it is not a fresh
    // entry, so the return point it already holds stays.
    if (state.view !== "create") state.describeReturn = captureReturnPoint();
    if (source) {
      state.describeDraft = { area: source.area, description: "", sources: [] };
      addDescribeSource(source);
    } else if (area) {
      state.describeDraft = { area, description: "", sources: [] };
    } else if (!state.describeDraft) {
      state.describeDraft = { area: preferredArea(), description: "", sources: [] };
    }
    saveDescribeDraft();
    state.view = "describe";
    if (!source) state.document = null;
    paint(true);
    window.setTimeout(() => document.querySelector("#describe-work")?.focus(), 0);
  }

  /** Opens one selected work-definition agent from its row in the work list. */
  function openDescribeSession(name) {
    const session = describeWorkSessions().find((item) => item.name === name);
    if (!session) return;
    state.describeReturn = captureReturnPoint();
    state.describeSessionName = session.name;
    state.document = null;
    saveDescribeSession();
    state.view = "describe-agent";
    state.renderedKey = "";
    paint(true);
  }

  /** Returns from work definition to the exact screen that opened it. */
  function cancelDescribe() {
    restoreReturnPoint(state.describeReturn);
  }

  /** Saves the reading position before the reader changes or closes. */

  function showDecision(returnView = state.view) {
    state.decisionReturnView = "agent";
    state.view = "decision";
    state.renderedKey = "";
    paint(true);
  }

  /** Opens a native agent with the complete Goal context. */
  /** The checked Goal files that belong to one Area, in checked order. */
  function selectionForArea(areaPath) {
    return state.goalSelection.filter((file) => goalByFile(file)?.area === areaPath);
  }

  /**
   * Starts one agent that owns every Goal checked in one Area panel. The first
   * checked Goal is the primary: it names the session and leads the prompt; the
   * rest ride along as "Also in this session" and flip to active on the same
   * session binding.
   */
  /**
   * Starts the popover's step list as one pipeline on the target Goal (and the
   * other checked Goals of its Area, which ride along in every step). One step
   * without an instruction never comes here; that is a plain start.
   */
  async function startPipeline(targetFile) {
    const goal = goalByFile(targetFile);
    if (!goal) return;
    const steps = commitActiveStep().map(launchStepRequest);
    const selection = selectionForArea(goal.area);
    const extraFiles = selection[0] === targetFile ? selection.slice(1) : [];
    try {
      const result = await post("/api/goals/start", { file: targetFile, steps, extraFiles });
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.launch.steps = [];
      state.launch.active = 0;
      state.launch.instruction = "";
      state.launch.continueFrom = null;
      state.goalSelection = [];
      await refresh();
      rememberGoal(targetFile);
      state.agentReturnView = "work";
      state.view = "agent";
      state.renderedKey = "";
      paint(true);
      showToast(steps.length > 1 ? `Started ${steps.length} steps; step 1 is ${result.pipeline?.steps?.[0]?.label || "running"}.` : "The agent started.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Saves the active pending step of a running pipeline. */
  async function savePipelineStep(targetFile) {
    const record = state.launch.record;
    if (!record) return;
    const row = launchStepDraft();
    const step = record.steps[state.launch.active];
    if (!step || step.status !== "pending") return showToast("Only pending steps change.");
    const request = launchStepRequest(row);
    try {
      await post("/api/pipelines/edit", { goal: targetFile, step: step.index, instruction: request.instruction, ...(request.command ? { command: request.command } : request.launch ? { choice: request.launch } : {}), continueFrom: request.continueFrom });
      await refresh();
      state.launch.record = pipelineForGoal(goalByFile(targetFile));
      paint(true);
      showToast(`Step ${step.index} saved.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  /**
   * Appends the popover's draft rows to the Goal's pipeline. The server says
   * what happened: the steps wait behind the running step, the finished last
   * agent was asked to hand over again, or the first new step started.
   */
  async function appendPipelineSteps(targetFile) {
    const record = state.launch.record;
    if (!record) return;
    const drafts = launchDraftRows();
    if (!drafts.length) return showToast("Add a step first.");
    const steps = drafts.map(launchStepRequest);
    try {
      const result = await post("/api/pipelines/append", { goal: targetFile, steps });
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.launch.record = null;
      state.launch.steps = [];
      state.launch.active = 0;
      state.launch.instruction = "";
      state.launch.continueFrom = null;
      await refresh();
      paint(true);
      const added = result.added ?? [];
      const which = added.length > 1 ? `Steps ${added[0]} to ${added[added.length - 1]} added` : `Step ${added[0]} added`;
      if (result.status === "asked") showToast(`${which}; step ${result.after}'s agent was asked to hand over again.`);
      else if (result.status === "started") showToast(`${which}; step ${result.next?.index ?? added[0]} started.`);
      else showToast(`${which}; it starts when step ${result.after} hands over.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Starts one agent that owns every checked Goal in one Area. */
  async function startSelectedGoals(areaPath) {
    const files = selectionForArea(areaPath);
    const [primary, ...extraFiles] = files;
    if (!primary) return;
    try {
      rememberGoal(primary);
      await post("/api/goals/agent", { file: primary, launch: true, extraFiles, ...launchRequestFields() });
      state.goalSelection = state.goalSelection.filter((file) => !files.includes(file));
      await refresh();
      state.agentReturnView = "work";
      state.view = "agent";
      state.renderedKey = "";
      paint(true);
      showToast(files.length === 1 ? "The agent opened with this Goal." : `The agent opened with ${files.length} Goals.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Opens the agent for the selected Goal and remembers the return view. */
  async function openGoalAgent({ returnView = "work" } = {}) {
    const goal = currentGoal();
    if (!goal) return;
    try {
      await post("/api/goals/agent", { file: goal.file, launch: true, ...launchRequestFields() });
      await refresh();
      state.agentReturnView = returnView;
      state.view = "agent";
      state.renderedKey = "";
      paint(true);
      showToast("The agent opened with this Goal and its linked Documents.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Replaces the reader with the linked Goal agent. */
  async function openReaderAgent() {
    const goal = documentGoal();
    if (!goal || !state.document) return showToast("Link this Document to an open Goal before you open an agent.");
    rememberDocumentPosition();
    state.currentFile = goal.file;
    localStorage.setItem("agent-shell.current-goal", goal.file);
    localStorage.setItem("agent-shell.last-area", goal.area);
    try {
      if (!sessionForGoal(goal)) {
        await post("/api/goals/agent", { file: goal.file, document: state.document.file, launch: true });
        await refresh();
      }
      if (!sessionForGoal(currentGoal())) throw new Error("The agent session did not open.");
      state.agentReturnView = "document";
      state.view = "agent";
      state.renderedKey = "";
      paint(true);
      showToast("The agent opened with this Goal and all linked Documents.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Launches the agent inside an already-created shell session. */
  async function launchOpenSession() {
    const goal = currentGoal();
    const session = sessionForGoal(goal);
    if (!goal || !session) return;
    try {
      const endpoint = session.phase === "collaborate" ? "/api/goals/agent" : "/api/goals/start";
      const body = session.phase === "collaborate"
        ? { file: goal.file, launch: true, ...launchRequestFields() }
        : { file: goal.file, approved: true, launch: true, ...launchRequestFields() };
      await post(endpoint, body);
      await refresh();
      state.agentReturnView = "work";
      state.view = session.phase === "collaborate" ? "agent" : "work";
      state.renderedKey = "";
      paint(true);
      showToast("The agent started.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Opens one confirmation modal with an explicit effect. */
  function openModal({ kicker = "", title, copy, field = null, confirmLabel, danger = false, wide = false, onConfirm }) {
    modalLayer.querySelector(".modal")?.classList.toggle("request-surface", wide);
    modalKicker.textContent = kicker;
    modalTitle.textContent = title;
    modalCopy.textContent = copy;
    modalField.hidden = !field;
    modalField.innerHTML = field
      ? `<label><span>${escapeHtml(field.label)}</span><textarea data-modal-input required placeholder="${escapeHtml(field.placeholder)}"></textarea></label>`
      : "";
    modalActions.innerHTML = `
      <button class="quiet-button" type="button" data-modal-cancel>Cancel</button>
      <button class="${danger ? "danger-button" : "primary-button"}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}${field ? " <kbd>⌘↵</kbd>" : ""}</button>
    `;
    modalConfirm = onConfirm;
    modalLayer.hidden = false;
    window.setTimeout(() => (modalField.querySelector("[data-modal-input]") || modalActions.querySelector("[data-modal-confirm]"))?.focus(), 0);
  }

  /** Closes the confirmation modal without acting. */
  function closeModal() {
    modalLayer.hidden = true;
    modalLayer.querySelector(".modal")?.classList.remove("request-surface");
    modalField.hidden = true;
    modalField.innerHTML = "";
    modalConfirm = null;
  }

  /** Returns the current modal confirmation callback. */
  function getModalConfirm() {
    return modalConfirm;
  }

  /** Confirms and then stops the selected live session. */
  function confirmStop({ immediate = false } = {}) {
    actionTelemetry.record("stop", `handler-enter:${state.view}`);
    let goal;
    let describing;
    let session;
    try {
      goal = currentGoal();
      describing = state.view === "describe-agent";
      session = stopSession();
      actionTelemetry.record("stop", session ? `target:${session.name}` : "target:none");
    } catch (error) {
      actionTelemetry.record("stop", `resolve-error:${error?.name ?? "Error"}`);
      showToast("Stop agent failed before it found the session. The failure was logged.");
      return;
    }
    if (!session || (!describing && !goal)) {
      actionTelemetry.record("stop", `guard-rejected:${describing ? "describe" : "goal"}`);
      showToast("Stop agent could not find the displayed session. The failure was logged.");
      return;
    }
    const shell = session.state === "shell";
    const pipeline = describing ? null : pipelineForGoal(goal);
    const stepsLeft = pipeline ? pipeline.steps.filter((step) => step.status === "pending").length : 0;
    const returnToDocument = !describing && state.view === "agent" && state.agentReturnView === "document" && Boolean(state.document);
    /** Stops the resolved session and leaves its durable work intact. */
    const stopSelectedSession = async () => {
      actionTelemetry.record("stop", `confirm:${session.name}`);
      try {
        await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
        actionTelemetry.record("stop", `kill-succeeded:${session.name}`);
      } catch (error) {
        actionTelemetry.record("stop", `kill-failed:${session.name}:${error?.name ?? "Error"}`);
        showToast("Agent Shell could not stop the session. The failure was logged.");
        return false;
      }
      if (describing) {
        state.describeSessionName = "";
        saveDescribeSession();
        await refresh();
        restoreReturnPoint(state.describeReturn);
        showToast("The conversation ended. Saved work stays in Tangent.");
        return true;
      }
      state.view = returnToDocument ? "document" : "work";
      await refresh();
      paint(true);
      if (returnToDocument) await refreshDocument();
      showToast(shell ? "The session closed." : "The agent stopped. The work stays open.");
      return true;
    };
    if (immediate) {
      actionTelemetry.record("stop", `immediate:${session.name}`);
      void stopSelectedSession();
      return;
    }
    actionTelemetry.record("stop", `modal-open:${session.name}`);
    openModal({
      kicker: shell ? "Open session" : "Live agent",
      title: shell ? "Close this session?" : `Stop ${agentName(session)}?`,
      copy: describing
        ? session.kind === "brain"
          ? "This ends the brain. Goals and pipelines it started keep running. Resume it later from the brain icon on the Area card."
          : "This ends the conversation about new work. Any Goals or Documents already created stay in Tangent."
        : pipeline
          ? `This ends the run${stepsLeft ? ` and its ${stepsLeft} remaining step${stepsLeft === 1 ? "" : "s"}` : ""}. The Goal, its notes, and its handovers stay here.`
          : "This ends the live session. The work and its notes stay here.",
      confirmLabel: shell ? "Close session" : "Stop agent",
      danger: true,
      /** Stops only the live run and preserves the goal. */
      onConfirm: stopSelectedSession,
    });
  }

  /** Confirms semantic completion separately from ending a run. */
  function confirmComplete() {
    actionTelemetry.record("goal-close", `complete-handler:${state.currentFile || "none"}`);
    const goal = currentGoal();
    if (!goal) {
      actionTelemetry.record("goal-close", "complete-goal-not-found");
      showToast("Agent Shell could not find the displayed Goal. The failure was logged.");
      return;
    }
    actionTelemetry.record("goal-close", `complete-modal:${goal.file}`);
    openModal({
      kicker: "Complete work",
      title: `Mark “${goal.title}” complete?`,
      copy: "This closes the work and ends its live session. Use this only when the complete result is met.",
      confirmLabel: "Mark complete",
      /** Marks the complete goal done after explicit approval. */
      onConfirm: async () => {
        actionTelemetry.record("goal-close", `complete-confirm:${goal.file}`);
        try {
          await post("/api/goals/edit", { file: goal.file, status: "done" });
          actionTelemetry.record("goal-close", `complete-succeeded:${goal.file}`);
        } catch (error) {
          actionTelemetry.record("goal-close", `complete-failed:${goal.file}:${error?.name ?? "Error"}`);
          showToast("Agent Shell could not complete the Goal. The failure was logged.");
          return false;
        }
        state.view = "work";
        await refresh();
        paint(true);
        showToast("The work is complete.");
      },
    });
  }

  /** Requires a recallable reason before the selected goal closes as dropped. */
  function confirmWontDo() {
    actionTelemetry.record("goal-close", `wont-do-handler:${state.currentFile || "none"}`);
    const goal = currentGoal();
    if (!goal) {
      actionTelemetry.record("goal-close", "wont-do-goal-not-found");
      showToast("Agent Shell could not find the displayed Goal. The failure was logged.");
      return;
    }
    actionTelemetry.record("goal-close", `wont-do-modal:${goal.file}`);
    openModal({
      kicker: "Won't do",
      title: `Mark “${goal.title}” won't do?`,
      copy: "This closes the work and ends its live session. The goal file stays available for later recall.",
      field: {
        label: "Why won't this be done?",
        placeholder: "Give a brief reason",
      },
      confirmLabel: "Mark won't do",
      danger: true,
      /** Drops the goal only after a brief reason is present. */
      onConfirm: async () => {
        const reason = modalField.querySelector("[data-modal-input]")?.value.trim() || "";
        if (!reason) {
          actionTelemetry.record("goal-close", `wont-do-reason-missing:${goal.file}`);
          showToast("Give a brief reason before you mark this work won't do.");
          modalField.querySelector("[data-modal-input]")?.focus();
          return false;
        }
        actionTelemetry.record("goal-close", `wont-do-confirm:${goal.file}`);
        try {
          await post("/api/goals/edit", { file: goal.file, status: "dropped", reason });
          actionTelemetry.record("goal-close", `wont-do-succeeded:${goal.file}`);
        } catch (error) {
          actionTelemetry.record("goal-close", `wont-do-failed:${goal.file}:${error?.name ?? "Error"}`);
          showToast("Agent Shell could not mark the Goal won't do. The failure was logged.");
          return false;
        }
        state.view = "work";
        await refresh();
        paint(true);
        showToast("The work is marked won't do.");
        return true;
      },
    });
  }

  /** Toggles the server-owned macOS sleep assertion. */

  return { toggleShellMenu, goToRows, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWorkAt, confirmRebuild, reloadChanges, selectGoal, rememberGoal, openGoalRun, showWork, showAreas, beginAreaCreate, beginAreaMove, showAreasAt, selectProgram, showProgramCreate, openProgramSession, performProgramAction, controlProgram, movedPath, confirmAreaMove, showCreate, switchDescribeToManualCreate, cancelCreate, addDescribeSource, showDescribe, openDescribeSession, cancelDescribe, showDecision, selectionForArea, startPipeline, savePipelineStep, appendPipelineSteps, startSelectedGoals, openGoalAgent, openReaderAgent, launchOpenSession, openModal, closeModal, getModalConfirm, confirmStop, confirmComplete, confirmWontDo };
}
