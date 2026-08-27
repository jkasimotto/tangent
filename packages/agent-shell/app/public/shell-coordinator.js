import { clip, escapeHtml } from "./text-format.js";
import { rebuildCommitRows } from "./rebuild-commit-list.js";
import { rewriteAreaFocus, writeAreaFocus } from "./area-focus-core.js";

/** Coordinates navigation between capability-owned browser features. */
export function createShellCoordinator({ shell, chrome, work, areasFeature, programs, launch, documents }) {
  const { state, api, post, actionTelemetry, paint, refresh, showToast } = shell;
  const {
    screen, backButton, shellMenu, goToButton, goToLayer, goToInput, goToList, modalLayer, modalKicker, modalTitle, modalCopy,
    modalField, modalActions, buildGoToRows, goToCore, rememberScreenScroll, restoreReturnPoint, captureReturnPoint,
    restoreReturnScroll, disposeTerminal, mountTerminal, updateStatusPill, openSessionLayer, closeSessionLayer,
    documentPeekLayer, syncLayerInertness,
  } = chrome;
  const {
    areaLabel, humanName, agentName, goalByFile, currentGoal, sessionForGoal, describeWorkSession,
    goalTrees, filteredGoalTrees,
    describeWorkSessions, stopSession, brainForAreaCard, brainStateLabel, agentReference, saveDescribeDraft,
    saveDescribeSession, describeLaunchArea, openBrainSession, openOrStartBrain,
  } = work;
  const { allAreas, areaParent, preferredArea, areas, revealArea, selectedArea } = areasFeature;
  const { currentProgram, programById, programIsLive, programAreaDirectory } = programs;
  const {
    launchOptionsFor, launchSelection, launchRequestFields, launchFieldsForArea, syncLaunchDraft, commitActiveStep, launchStepDraft,
    launchStepRequest, pipelineMutationOperations, pipelineForGoal, pipelineRecordForGoal, syncDescribeDraft,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  } = launch;
  const { openDocument, refreshDocument, rememberDocumentPosition, documentGoal, openDocumentPeek, closeDocumentPeek } = documents;
  let modalConfirm = null;
  let modalReturnPoint = null;

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
    syncLayerInertness();
    renderGoToList();
    goToInput.focus();
  }

  /**
   * The control that takes focus when the finder closes. Above a quick
   * Document that control is always inside that Document: the surfaces below
   * it stay inert, so the origin the finder captured there can no longer hold
   * focus (design-quick-returnable-document-search 5.4).
   */
  function goToReturnTarget(origin) {
    const usable = Boolean(origin) && origin !== document.body && origin.isConnected;
    if (!state.documentPeek) return usable ? origin : null;
    if (usable && documentPeekLayer.contains(origin)) return origin;
    return documentPeekLayer.querySelector(".document-peek-surface");
  }

  /** Closes the finder and gives the keyboard back to the layer underneath. */
  function closeGoTo() {
    if (!state.goTo) return;
    const focus = state.goTo.returnFocus;
    state.goTo = null;
    goToLayer.hidden = true;
    goToList.innerHTML = "";
    // The layer below is no longer inert before it is asked to take focus.
    syncLayerInertness();
    const target = goToReturnTarget(focus);
    if (target) {
      try { target.focus(); } catch {}
    }
  }

  /** Draws the finder's list. It never touches #screen. */
  function renderGoToList() {
    if (!state.goTo) return;
    goToInput.removeAttribute("aria-activedescendant");
    const rows = goToRows();
    if (rows === null) {
      state.goTo.rows = [];
      goToList.innerHTML = state.error
        ? `<li class="go-to-empty go-to-error" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-close-go-to>Close</button></li>`
        : `<li class="go-to-empty" role="status">Loading the vault…</li>`;
      return;
    }
    state.goTo.rows = rows;
    if (state.goTo.view === "graph") {
      const documents = rows.filter((row) => row.kind !== "brain");
      state.goTo.rows = documents;
      if (!documents.length) {
        goToList.innerHTML = `<li class="go-to-empty" role="status">No Documents match these filters.</li>`;
        return;
      }
      const byStem = new Map(documents.map((row, index) => [String(row.file).split("/").pop().replace(/\.md$/i, ""), { row, index }]));
      const width = 560, height = Math.max(260, Math.ceil(documents.length / 4) * 120);
      const points = documents.map((row, index) => ({ row, x: 70 + (index % 4) * 140, y: 55 + Math.floor(index / 4) * 120 }));
      const edges = points.flatMap((point) => (point.row.links ?? []).map((target) => [point, byStem.get(String(target).split("/").pop().replace(/\.md$/i, ""))]).filter(([, hit]) => hit).map(([from, hit]) => [from, points[hit.index]]));
      goToList.innerHTML = `<li class="go-to-graph"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dependencies between filtered Documents">${edges.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`).join("")}${points.map((point, index) => `<g data-go-to-row="${index}" tabindex="0" role="button"><circle cx="${point.x}" cy="${point.y}" r="25"/><text x="${point.x}" y="${point.y + 40}">${escapeHtml(clip(point.row.name, 18))}</text>${point.row.disambiguator ? `<text class="go-to-graph-disambiguator" x="${point.x}" y="${point.y + 54}">${escapeHtml(clip(point.row.disambiguator, 22))}</text>` : ""}</g>`).join("")}</svg></li>`;
      return;
    }
    state.goTo.selected = rows.length ? Math.min(Math.max(state.goTo.selected, 0), rows.length - 1) : 0;
    if (!rows.length) {
      goToList.innerHTML = `<li class="go-to-empty" role="status">Nothing is named “${escapeHtml(state.goTo.query)}”.</li>`;
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

  /**
   * Goes to one chosen row. Enter never starts an agent. A Document opens in
   * the quick layer above the current surface, so the screen or session below
   * it is never replaced (design-quick-returnable-document-search D1). A brain
   * is a session, not a Document, so it leaves the quick path. A quiet or
   * missing brain opens its message composer; Julian's send remains the only
   * action that starts it.
   */
  function chooseGoToRow(row) {
    if (!row) return;
    // The finder's own input is never the return target: the layer inherits
    // the focus origin the finder captured when it opened.
    const origin = state.goTo?.returnFocus ?? null;
    closeGoTo();
    if (row.kind === "brain") {
      if (state.documentPeek) closeDocumentPeek();
      if (row.live && row.session) return openBrainSession(row.session);
      if (state.sessionPeek) closeSessionLayer();
      return openOrStartBrain(row.area, goToButton);
    }
    return openDocumentPeek(row.file, { origin });
  }

  /**
   * Opens the Work desk at one Area card, where the control that resumes a
   * inactive brain lives. Without a card for that Area the Areas screen is the
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

  /** The sentence above the commit rows of the rebuild confirmation. */
  function rebuildCommitCopy() {
    const lead = "Agent sessions keep running in tmux. This page reloads automatically when the new server is up.";
    return state.pendingCommits?.length
      ? `${lead}\n\nCommits included:`
      : `${lead}\n\nNo new commits. This rebuild will rebuild the currently deployed commit.`;
  }

  /** Rebuilds from the permanent recovery action after explicit confirmation. */
  function confirmRebuild({ immediate = false } = {}) {
    toggleShellMenu(false);
    if (immediate) return rebuildShell();
    openModal({
      kicker: "Agent Shell",
      title: "Rebuild and restart Agent Shell?",
      copy: rebuildCommitCopy(),
      commits: state.pendingCommits ?? [],
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
    state.goalDetail = null;
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
    state.agentReturn = state.view === "work" ? captureReturnPoint() : null;
    state.agentSessionName = null;
    state.document = null;
    state.goalDetail = null;
    state.documentTrail = [];
    state.documentTrailIndex = -1;
    const session = sessionForGoal(goal);
    if (!session) return openGoalAgent({ returnView: "work" });
    state.agentReturnView = "work";
    openSessionLayer(session, "agent", state.agentReturn ?? captureReturnPoint());
  }

  /** Returns to the work list and optionally focuses search. */
  function showWork({ focus = false } = {}) {
    state.view = "work";
    state.document = null;
    state.goalDetail = null;
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
    openSessionLayer({ name: program.sessionName ?? program.session.name ?? program.session }, "program", captureReturnPoint());
  }

  /** Executes one already-confirmed program control. */
  async function performProgramAction(action, id) {
    const program = programById(id);
    if (!program) return;
    await post("/api/operations/control", { id: program.id, action });
    if (["stop", "close"].includes(action) && state.view === "program-session") state.view = "program-detail";
    await refresh();
    // The refresh above joins a reading that started before this write, and it
    // installs a fresh list that still carries the old flag. So Pause and
    // Resume write what they just made true onto the program the screen reads,
    // after that list is in place. The next refresh brings the server's truth.
    if (["pause", "resume"].includes(action)) {
      const current = programById(program.id);
      if (current) current.paused = action === "pause";
    }
    paint(true);
    if (action === "stop" && program.type === "trigger") return showToast("The agent stopped. The Trigger keeps its schedule.");
    const messages = {
      start: "The process started.", restart: "The process restarted.", stop: "The program stopped.",
      close: "The saved session was removed.", run: "The command started.",
      check: "The Trigger ran its check.", acknowledge: "The attention message is cleared.",
      pause: "The Trigger is paused. It checks again only after you resume it.",
      resume: "The Trigger is back on its schedule.",
    };
    showToast(messages[action] || "The program changed.");
  }

  /** Adds confirmation where a program action starts or destroys work. */
  function controlProgram(action, id = state.programId) {
    const program = programById(id);
    if (!program) return;
    if (["start", "pause", "resume", "acknowledge"].includes(action)) {
      performProgramAction(action, id).catch((error) => showToast(error.message));
      return;
    }
    const trigger = program.type === "trigger";
    const descriptions = {
      run: `Run “${program.command}” in ${program.cwd}.`,
      restart: `Stop the current process, then run “${program.command}” again.`,
      check: "This runs the probe now. If the probe finds new work, the Trigger starts its agent.",
      stop: trigger
        ? "This ends the live agent. The Trigger keeps its schedule and checks again at its next interval."
        : "Stop the live program. A managed process keeps its session and scrollback.",
      close: "Remove the retained tmux session and its scrollback. The program definition stays here.",
    };
    const titles = { run: `Run ${program.label}?`, restart: `Restart ${program.label}?`, check: `Check ${program.label} now?`, close: "Remove the saved log?" };
    const confirmLabels = { run: "Run now", restart: "Restart", check: "Check now", close: "Remove log" };
    openModal({
      kicker: trigger ? "Trigger agent" : program.type === "command" ? "Command" : "Managed process",
      title: titles[action] || `Stop ${program.label}?`,
      copy: descriptions[action],
      confirmLabel: confirmLabels[action] || (trigger ? "Stop agent" : "Stop"),
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
      state.areaFocus = rewriteAreaFocus(state.areaFocus, moved.source, moved.destination);
      if (!writeAreaFocus(localStorage, state.areaFocus)) state.areaFocusStorageError = true;
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

  /** Adds one Document to a work description without duplicating its source link. */
  function addDescribeSource(source) {
    const sources = state.describeDraft?.sources ?? [];
    if (!sources.some((item) => item.file === source.file)) sources.push(source);
    state.describeDraft.sources = sources;
  }

  /** Opens a fresh or unfinished description without taking over another defining agent. */
  function showDescribe({ source = null, area = "" } = {}) {
    state.describeReturn = captureReturnPoint();
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
    if (!source) {
      state.document = null;
      state.goalDetail = null;
    }
    paint(true);
    window.setTimeout(() => document.querySelector("#describe-work")?.focus(), 0);
  }

  /** Opens one selected work-definition agent from its row in the work list. */
  function openDescribeSession(name) {
    const session = describeWorkSessions().find((item) => item.name === name);
    if (!session) return;
    openSessionLayer(session, session.kind === "brain" ? "brain" : "definition", captureReturnPoint());
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

  /**
   * Starts the Launch Editor's assignment list as one pipeline on the target
   * Goal. Co-assigned Goal data remains a server capability; Work no longer
   * builds it from transient browser checkboxes.
   */
  async function startPipeline(targetFile) {
    const goal = goalByFile(targetFile);
    if (!goal) return;
    const steps = commitActiveStep().map(launchStepRequest);
    try {
      const result = await post("/api/goals/start", { file: targetFile, steps });
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.launch.steps = [];
      state.launch.active = 0;
      state.launch.instruction = "";
      state.launch.assignmentKind = "implementation";
      state.launch.assignmentPath = "";
      state.launch.continueFrom = null;
      state.launch.queueMutation = null;
      await refresh();
      rememberGoal(targetFile);
      const opened = sessionForGoal(currentGoal());
      if (opened) openSessionLayer(opened, "agent", captureReturnPoint());
      else paint(true);
      if (result.status === "queued") showToast(`Queued ${steps.length} assignment${steps.length === 1 ? "" : "s"} for the exact Area brain.`);
      else showToast(steps.length > 1 ? `Started ${steps.length} steps; step 1 is ${result.pipeline?.steps?.[0]?.label || "running"}.` : "The agent started.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Saves every local pending-assignment change as one revision-guarded batch. */
  async function savePipelineChanges(targetFile) {
    const record = state.launch.record;
    if (!record) return;
    syncLaunchDraft();
    const operations = pipelineMutationOperations(record);
    if (!operations.length) return showToast("The pending assignments have no changes.");
    const batch = { goal: targetFile, expectedRevision: record.revision, operations };
    const fingerprint = JSON.stringify(batch);
    if (state.launch.queueMutation?.fingerprint !== fingerprint) {
      state.launch.queueMutation = { fingerprint, operationId: crypto.randomUUID() };
    }
    const operationId = state.launch.queueMutation.operationId;
    try {
      const result = await post("/api/pipelines/mutate", { ...batch, operationId });
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.launch.record = null;
      state.launch.steps = [];
      state.launch.active = 0;
      state.launch.instruction = "";
      state.launch.assignmentKind = "implementation";
      state.launch.assignmentPath = "";
      state.launch.continueFrom = null;
      state.launch.stale = null;
      state.launch.queueMutation = null;
      await refresh();
      paint(true);
      showToast(result.state === "repeated" ? "The assignment changes were already saved." : "The pending assignments were saved together.");
    } catch (error) {
      if (error.code === "stale-revision") {
        state.launch.stale = { currentRevision: error.currentRevision, pipeline: error.pipeline, operationId };
        paint(true);
        showToast("The queue changed. Your local assignment draft is still open.");
        return;
      }
      showToast(error.message);
    }
  }

  /** Starts or confirms one persisted exact-attempt replacement operation. */
  async function replaceGoalAttempt({ confirmed = false } = {}) {
    const replacement = state.launch.replacement;
    if (!replacement) return;
    const priorStatus = replacement.operation?.status ?? "";
    if (priorStatus === "complete") {
      const name = replacement.operation?.replacementTarget?.session;
      const session = state.sessions.find((item) => item.name === name);
      return session ? openSessionLayer(session, "agent", captureReturnPoint()) : showToast("The replacement session is no longer live.");
    }
    if (["failed", "rollback"].includes(priorStatus)) {
      replacement.operationId = crypto.randomUUID();
      replacement.operation = null;
      replacement.launch = null;
      replacement.requiresConfirmation = false;
      confirmed = false;
    }
    const selection = launchSelection();
    const launch = replacement.launch ?? (selection?.harness ? {
      harness: selection.harness.id,
      model: selection.model?.id ?? null,
      effort: selection.effort?.id ?? null,
    } : null);
    if (!launch?.harness) return showToast("Choose a registered harness before starting the replacement.");
    replacement.launch = launch;
    replacement.saving = true;
    paint(true);
    const body = {
      goal: replacement.goal,
      assignmentId: replacement.assignmentId,
      expectedRevision: replacement.expectedRevision,
      expectedAttemptId: replacement.expectedAttemptId,
      launch,
      operationId: replacement.operationId,
      ...(confirmed || replacement.operation ? { confirmed: true } : {}),
    };
    try {
      const result = await post("/api/goals/attempts/replace", body);
      replacement.operation = result.operation ?? replacement.operation;
      replacement.requiresConfirmation = Boolean(result.requiresConfirmation);
      replacement.saving = false;
      await refresh();
      paint(true);
      const name = result.session ?? result.operation?.replacementTarget?.session;
      const session = state.sessions.find((item) => item.name === name);
      if (session && replacement.inspectedSession !== name) {
        replacement.inspectedSession = name;
        openSessionLayer(session, "agent", captureReturnPoint());
      }
      const status = replacement.operation?.status ?? result.state;
      if (status === "complete") showToast("The replacement is current and the exact source retirement finished.");
      else if (result.requiresConfirmation) showToast("The replacement is live. Inspect it, then finish the same replacement operation.");
      else showToast(`Replacement ${String(status || "operation").replaceAll("-", " ")}.`);
    } catch (error) {
      replacement.operation = error.payload?.operation ?? replacement.operation;
      replacement.requiresConfirmation = replacement.operation?.status === "replacement-starting";
      replacement.saving = false;
      paint(true);
      showToast(error.message);
    }
  }

  /** Opens the agent for the selected Goal and remembers the return view. */
  async function openGoalAgent({ returnView = "work" } = {}) {
    const goal = currentGoal();
    if (!goal) return;
    const returnPoint = returnView === "work" && state.view === "work" ? captureReturnPoint() : null;
    try {
      const start = await launchFieldsForArea(goal.area);
      await post("/api/goals/agent", { file: goal.file, launch: true, ...start.fields });
      await refresh();
      state.agentReturnView = returnView;
      state.agentReturn = returnPoint;
      openSessionLayer(sessionForGoal(currentGoal()), "agent", returnPoint ?? captureReturnPoint());
      showToast(`The agent opened with this Goal and its linked Documents${start.label ? ` on ${start.label}` : ""}.`);
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
        const start = await launchFieldsForArea(goal.area);
        await post("/api/goals/agent", { file: goal.file, document: state.document.file, launch: true, ...start.fields });
        await refresh();
      }
      if (!sessionForGoal(currentGoal())) throw new Error("The agent session did not open.");
      state.agentReturnView = "document";
      state.agentReturn = null;
      openSessionLayer(sessionForGoal(currentGoal()), "agent", captureReturnPoint());
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
      const start = await launchFieldsForArea(goal.area);
      const body = session.phase === "collaborate"
        ? { file: goal.file, launch: true, ...start.fields }
        : { file: goal.file, approved: true, launch: true, ...start.fields };
      await post(endpoint, body);
      await refresh();
      state.agentReturnView = "work";
      const opened = sessionForGoal(currentGoal());
      if (opened) openSessionLayer(opened, "agent", captureReturnPoint());
      else paint(true);
      showToast(start.label ? `The agent started on ${start.label}.` : "The agent started.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Opens one confirmation modal with an explicit effect. */
  function openModal({ kicker = "", title, copy, commits = [], rows = [], field = null, confirmLabel, danger = false, wide = false, onConfirm }) {
    if (modalLayer.hidden) {
      const element = modalLayer.ownerDocument?.activeElement;
      modalReturnPoint = {
        element,
        id: element?.id ?? "",
        focusKey: element?.dataset?.focusKey ?? "",
      };
    }
    const modal = modalLayer.querySelector(".modal");
    modal?.classList.toggle("request-surface", wide);
    modal?.classList.toggle("key-sheet-surface", Boolean(rows.length));
    modal?.classList.toggle("action-surface", field?.kind === "actions");
    modalKicker.textContent = kicker;
    modalTitle.textContent = title;
    // Setting the text first drops any list a previous modal appended.
    modalCopy.textContent = copy;
    if (commits.length) modalCopy.insertAdjacentHTML("beforeend", `<ul class="update-commits">${rebuildCommitRows(commits)}</ul>`);
    if (rows.length) {
      modalCopy.tabIndex = 0;
      modalCopy.setAttribute("role", "region");
      modalCopy.setAttribute("aria-label", `${title} commands`);
      modalCopy.insertAdjacentHTML("beforeend", `<p class="key-sheet-hint"><kbd>j</kbd><kbd>k</kbd> move · <kbd>Ctrl-D</kbd><kbd>Ctrl-U</kbd> half page · <kbd>gg</kbd><kbd>G</kbd> ends</p><dl class="key-sheet">${rows.map((row) => `<div title="${escapeHtml(row.help)}"><dt><kbd>${escapeHtml(row.key)}</kbd></dt><dd class="key-sheet-label"><strong>${escapeHtml(row.label)}</strong></dd><dd class="key-sheet-help">${escapeHtml(row.help)}</dd></div>`).join("")}</dl>`);
    } else {
      modalCopy.removeAttribute("tabindex");
      modalCopy.removeAttribute("role");
      modalCopy.removeAttribute("aria-label");
    }
    modalField.hidden = !field;
    modalField.innerHTML = field?.kind === "actions"
      ? `<div class="modal-action-list" role="menu" aria-label="${escapeHtml(field.label || title)}">${field.options.map((option) => `<button type="button" role="menuitem" data-modal-action="${escapeHtml(option.value)}" data-modal-key="${escapeHtml(option.key || "")}"${option.enabled === false ? ` aria-disabled="true" data-disabled-reason="${escapeHtml(option.reason || "This action is not available.")}"` : ""}><span><kbd>${escapeHtml(option.key || "")}</kbd><strong>${escapeHtml(option.label)}</strong></span><small>${escapeHtml(option.enabled === false ? option.reason || option.help : option.help || "")}</small></button>`).join("")}</div>`
      : field?.kind === "select"
      ? `<label><span>${escapeHtml(field.label)}</span><select data-modal-select>${field.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select></label>`
      : field?.kind === "request"
        ? `<label><span>${escapeHtml(field.actionLabel)}</span><select data-modal-select>${field.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select></label><label><span>${escapeHtml(field.label)}</span><textarea data-modal-input placeholder="${escapeHtml(field.placeholder)}"></textarea></label>`
        : field
          ? `<label><span>${escapeHtml(field.label)}</span><textarea data-modal-input${field.required === false ? "" : " required"} placeholder="${escapeHtml(field.placeholder)}"></textarea></label>`
          : "";
    modalActions.innerHTML = field?.kind === "actions"
      ? `<button class="quiet-button" type="button" data-modal-cancel>Cancel <kbd>esc</kbd></button>`
      : `<button class="quiet-button" type="button" data-modal-cancel>Cancel</button>
      <button class="${danger ? "danger-button" : "primary-button"}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)} <kbd>${field ? "⌘↵" : "↵"}</kbd></button>`;
    modalConfirm = onConfirm;
    modalLayer.hidden = false;
    syncLayerInertness();
    window.setTimeout(() => (modalField.querySelector("[data-modal-action]:not([aria-disabled='true'])") || modalField.querySelector("[data-modal-action]") || modalField.querySelector("[data-modal-select]") || modalField.querySelector("[data-modal-input]") || (rows.length ? modalCopy : null) || modalActions.querySelector("[data-modal-confirm]"))?.focus(), 0);
  }

  /** Closes the confirmation modal without acting. */
  function closeModal({ restoreFocus = true } = {}) {
    const returnPoint = modalReturnPoint;
    modalReturnPoint = null;
    modalLayer.hidden = true;
    modalLayer.querySelector(".modal")?.classList.remove("request-surface", "key-sheet-surface", "action-surface");
    modalCopy.removeAttribute("tabindex");
    modalCopy.removeAttribute("role");
    modalCopy.removeAttribute("aria-label");
    modalField.hidden = true;
    modalField.innerHTML = "";
    modalConfirm = null;
    syncLayerInertness();
    if (!restoreFocus) return;
    const keyed = returnPoint?.focusKey
      ? [...screen.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === returnPoint.focusKey)
      : null;
    const ownerDocument = modalLayer.ownerDocument;
    const identified = returnPoint?.id ? ownerDocument?.getElementById(returnPoint.id) : null;
    const fallback = state.view === "work"
      ? screen.querySelector("[data-work-cursor].cursor [data-work-row-title], [data-work-cursor].cursor [data-work-cursor-control]")
      : backButton;
    const origin = returnPoint?.element;
    const target = origin?.isConnected && origin !== ownerDocument?.body && origin !== ownerDocument?.documentElement
      ? origin
      : keyed ?? identified ?? fallback;
    try { target?.focus?.({ preventScroll: true }); } catch {}
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
    const brain = session?.kind === "brain";
    if (!session || (!describing && !brain && !goal)) {
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
        if (brain) {
          await post("/api/brains/stop", {
            area: session.brain || session.area,
            expectedAttemptId: session.name,
            operationId: crypto.randomUUID(),
          });
        } else {
          await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
        }
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
      showToast(shell ? "The session closed." : brain ? "The brain stopped. Its work continues." : "The agent stopped. The work stays open.");
      return true;
    };
    if (immediate && !brain) {
      actionTelemetry.record("stop", `immediate:${session.name}`);
      void stopSelectedSession();
      return;
    }
    actionTelemetry.record("stop", `modal-open:${session.name}`);
    openModal({
      kicker: shell ? "Open session" : brain ? "Area brain" : "Live agent",
      title: shell ? "Close this session?" : brain ? `Stop the ${humanName((session.brain || session.area || "Area").split("/").pop())} brain?` : `Stop ${agentName(session)}?`,
      copy: brain
        ? "This makes the brain inactive. Its Goals, queues, and worker agents continue. A later message can wake it."
        : describing
        ? session.kind === "brain"
          ? "This ends the brain. Goals and pipelines it started keep running. Resume it later from the brain icon on the Area card."
          : "This ends the conversation about new work. Any Goals or Documents already created stay in Tangent."
        : pipeline
          ? `This ends the run${stepsLeft ? ` and its ${stepsLeft} remaining step${stepsLeft === 1 ? "" : "s"}` : ""}. The Goal, its notes, and its handovers stay here.`
          : "This ends the live session. The work and its notes stay here.",
      confirmLabel: shell ? "Close session" : brain ? "Stop brain" : "Stop agent",
      danger: true,
      /** Stops only the live run and preserves the goal. */
      onConfirm: stopSelectedSession,
    });
  }

  /** Confirms semantic completion separately from ending a run. */
  function confirmComplete(file = state.currentFile) {
    actionTelemetry.record("goal-close", `complete-handler:${file || "none"}`);
    const goal = goalByFile(file);
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

  return { toggleShellMenu, goToRows, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWorkAt, confirmRebuild, reloadChanges, selectGoal, rememberGoal, openGoalRun, showWork, showAreas, beginAreaCreate, beginAreaMove, showAreasAt, selectProgram, showProgramCreate, openProgramSession, performProgramAction, controlProgram, movedPath, confirmAreaMove, addDescribeSource, showDescribe, openDescribeSession, cancelDescribe, showDecision, startPipeline, savePipelineChanges, replaceGoalAttempt, openGoalAgent, openReaderAgent, launchOpenSession, openModal, closeModal, getModalConfirm, confirmStop, confirmComplete, confirmWontDo };
}
