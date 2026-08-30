import { journalCaptureNeedsRetry, journalCaptureToast } from "./journal-capture-core.js";
import { keyboardEventIsComposing, resolveKeyboardContext } from "./keyboard-context.js";
import { documentReadingCommands, documentReadingScrollTarget, matchDocumentReadingCommand } from "./document-reading-commands.js";
import { workCommandMatches, workCommandsFor } from "./work-commands.js";
import { countedRowIndex, createChordEngine, motions, resolveMotion } from "./motion-keys.js";
import { createWorkSearchBar } from "./work-search-bar.js";
import { activeBrainForArea, nearestActiveBrain } from "./brain-ownership.js";

/** Binds browser events through capability-owned feature ports. */
export function bindShellEvents({ shell, chrome, prompts, work, areas, programs, launch, documents }) {
  const { state, post, paint, refresh, showToast } = shell;
  const {
    screen, backButton, workTab, areasTab, promptsTab, findButton, secondaryAction, shellMenu, goToButton, goToLayer,
    goToInput, workSearch, workSearchInput, workSearchCount, workSearchKeys, modalLayer, documentPeekLayer, terminalFit, KEYMAP, shortcutMatches, shortcutKbd, toggleShellMenu, confirmRebuild,
    reloadChanges, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWork, showAreas, showPrompts, showDecision,
    showDescribe, toggleAwake, openModal, closeModal, modalConfirm, restoreReturnPoint, openSessionLayer, closeSessionLayer, openAreaMap, drillAreaMap, closeAreaMap,
  } = chrome;
  const {
    loadGoalPrompt, loadBrainPrompt, closePromptPreview, selectBestiaryLifecycle, selectBestiaryTransition,
    selectModelMode, selectModelConcept,
  } = prompts;
  const {
    selectGoal, rememberGoal, openGoalRun, goalByFile, currentGoal, sessionForGoal, startBrain, brainForAreaCard,
    openBrainSession, openOrStartBrain, toggleBrainPopover, confirmStopBrain, saveDescribeDraft, saveDescribeSession, describeWorkSession,
    openDescribeSession, addDescribeSource,
    openGoalAgent, confirmStop, confirmComplete, confirmWontDo, openRequest, openQuestionsReview, openAreaCapture, sendVerdict,
    replyAboutRow, openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery,
    applyAreaFocus, clearAreaFocus, toggleAreaStar, toggleStarredOnly, toggleActiveOnly, renderWork, paintWorkCaption, describeLaunchArea, describeWorkSessions,
    goalGroupRoot, setSubgoalsExpanded, toggleSubgoals, setWorkAreaFolded,
  } = work;
  const {
    showAreasAt, beginAreaCreate, beginAreaMove, confirmAreaMove, cancelDescribe, areaIsFolded,
    saveExpandedAreas, revealArea, setAreaStatus, controlProcess, preferredArea, areaLabel, loadAreaJournal,
  } = areas;
  const {
    showProgramCreate, selectProgram, openProgramSession, controlProgram, performProgramAction, currentProgram,
    programAreaDirectory,
  } = programs;
  const {
    syncDescribeDraft, launchSelection, launchRequestFields, syncLaunchDraft,
    launchStepsForRecord, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, leaveHarnessEditor, saveHarnesses,
    launchOptionsFor, pipelineRecordForGoal, loadLaunchStep,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET,
  } = launch;
  const {
    openDocument, navigateDocumentHistory, openVaultLink, openDocumentHeading, openCommentComposer, setCommentScope,
    cancelCommentComposer, submitCommentComposer, commentIdentity, syncCommentCursor, activeCommentIdentity, focusCommentIdentity,
    editActiveComment, replyToActiveComment, resolveActiveComment, stepComment, saveVisibleIdea,
    notifyDocumentComments, refreshDocument, leaveReader, updateSelectionCommentButton, readerCopyPayload, openReaderAgent,
    closeDocumentPeek, promoteDocumentPeek, retryDocumentPeek, navigateDocumentPeekHistory, openPeekLink, openPeekHeading, openDocumentPeek,
    leaveQuickPath,
  } = documents;
  const awakeButton = document.querySelector("#awake-button");
  // One chord engine for every surface (design agent-shell-keymap 4.2).
  const chords = createChordEngine(window.setTimeout.bind(window), window.clearTimeout.bind(window));
  let launchFocusObserver = null;
  let launchReturnPoint = null;
  let launchParentSurface = null;
  let harnessReturnPoint = null;
  let areaProcessesReturnPoint = null;
  const copyOperations = { full: { serial: 0, timer: null, cached: null }, quick: { serial: 0, timer: null, cached: null } };

  /** Returns from one worker agent to its exact Work or Document context. */
  function leaveGoalAgent() {
    if (state.agentReturnView === "document" && state.document) {
      state.view = "document";
      state.renderedKey = "";
      paint(true);
      return refreshDocument();
    }
    const point = state.agentReturn;
    state.agentReturn = null;
    return point ? restoreReturnPoint(point) : showWork();
  }

  /** Stores one cursor without rebuilding the element that received a pointer event. */
  function rememberWorkCursor(row) {
    if (!row?.dataset.workCursor) return false;
    state.workCursor = row.dataset.workCursor;
    localStorage.setItem("agent-shell.work-cursor", state.workCursor);
    for (const item of visibleCursorRows()) item.classList.toggle("cursor", item === row);
    paintWorkCaption(screen);
    return true;
  }

  /** Stores and paints one cursor row, then optionally gives its control focus. */
  function setWorkCursor(row, focus = true) {
    if (!rememberWorkCursor(row)) return false;
    paint(true);
    if (focus) window.setTimeout(() => [...document.querySelectorAll("[data-work-cursor]")].find((item) => item.dataset.workCursor === state.workCursor)?.querySelector("[data-work-row-title], [data-work-cursor-control]")?.focus(), 0);
    return true;
  }

  /** Writes one sentence into the polite Work live region. */
  function announceWork(text) {
    const region = document.querySelector("#filter-count");
    if (region) region.textContent = String(text ?? "");
  }

  /**
   * Opens every fold that hides one Work row, so a search can land on it
   * (design agent-shell-work-search decision 6). Each opened fold is recorded
   * on the search origin, so Escape while typing can close it again.
   */
  function revealCursor(cursor) {
    for (let guard = 0; guard < 8; guard += 1) {
      const row = [...screen.querySelectorAll("[data-work-cursor]")].find((item) => item.dataset.workCursor === cursor);
      if (!row || !row.hidden) return Boolean(row);
      const parentFile = row.dataset.subgoalOf;
      const parentRow = parentFile ? [...screen.querySelectorAll("[data-goal-anchor]")].find((item) => item.dataset.goalAnchor === parentFile) : null;
      if (parentRow && workRowIsCollapsed(parentRow)) {
        setSubgoalsExpanded(parentFile, true);
        state.searchOrigin?.openedFolds.push({ kind: "goal", id: parentFile });
        continue;
      }
      if (parentRow?.hidden) { revealCursor(parentRow.dataset.workCursor); continue; }
      const header = ownerHeaderRow(row);
      if (header && workRowIsCollapsed(header)) {
        const area = header.dataset.workArea;
        setWorkAreaFolded(area, false);
        state.searchOrigin?.openedFolds.push({ kind: "area", id: area });
        continue;
      }
      return false;
    }
    return false;
  }

  /** Closes one fold a search opened, so Escape while typing restores the tree. */
  function closeRevealedFold(fold) {
    if (fold.kind === "goal") setSubgoalsExpanded(fold.id, false);
    else setWorkAreaFolded(fold.id, true);
  }

  const searchBar = createWorkSearchBar({
    state, document, bar: workSearch, input: workSearchInput, count: workSearchCount, keys: workSearchKeys, screen,
    paint, setWorkCursor, revealCursor, closeRevealedFold, announce: announceWork,
  });

  /**
   * True when Enter means the row, not the focused control. A focused button
   * other than the row's title keeps its native press, so `⋯` and `Open brain`
   * still act on Enter.
   */
  function enterOwnsWorkRow(target, row) {
    if (!row) return false;
    const control = target?.closest?.("button, a, input, textarea, select");
    if (!control) return true;
    return control.matches("[data-work-row-title], [data-work-cursor-control]") && row.contains(control);
  }

  /** Returns the visible rows that participate in Work cursor movement. */
  function visibleCursorRows(selector = "[data-work-cursor]") {
    return [...screen.querySelectorAll(selector)].filter((row) => !row.hidden);
  }

  /** Resolves the stored cursor, with the first visible row as its fallback. */
  function cursorRow() {
    return visibleCursorRows().find((row) => row.dataset.workCursor === state.workCursor) ?? visibleCursorRows()[0] ?? null;
  }

  /**
   * The nearest header row at or above one Work row: the row itself when it
   * is a header, else the last header before it in its row group. A
   * sub-Area header owns the rows under it, the top-level header owns the
   * rest (work-view-sub-areas Decision 2).
   */
  function ownerHeaderRow(row) {
    if (!row) return null;
    if (row.classList.contains("work-group-row")) return row;
    for (let item = row.previousElementSibling; item; item = item.previousElementSibling) {
      if (item.classList.contains("work-group-row")) return item;
    }
    return null;
  }

  /** True when one header row carries the brain route that Area commands act through. */
  function headerHasBrainRoute(header) {
    return Boolean(header?.querySelector(".work-group-brain[data-open-brain], .work-group-brain[data-open-area-brain]"));
  }

  /** Returns the exact Area whose nearest header owns commands for this row. */
  function commandAreaForRow(row) {
    const header = ownerHeaderRow(row);
    if (!headerHasBrainRoute(header)) return "";
    return header.dataset.workArea ?? "";
  }

  /** Returns the Area that owns a map action, independent of brain state. */
  function mapAreaForRow(row) {
    return ownerHeaderRow(row)?.dataset.workArea ?? "";
  }

  /** Finds one pointer action in the exact Area header that owns this row. */
  function areaCommandPointer(row, selector) {
    const header = ownerHeaderRow(row);
    if (!commandAreaForRow(row)) return null;
    return header?.querySelector(selector) ?? null;
  }

  /** Every visible Area header, top-level and sub-Area, that carries a brain route. Other Areas has none. */
  function visibleAreaHeaders() {
    return visibleCursorRows(".work-group-row[data-work-cursor^='area:']").filter(headerHasBrainRoute);
  }

  /**
   * Moves the Work cursor to the previous or next visible Area header,
   * top-level or sub-Area, in document order, clamped at both ends
   * (work-view-sub-areas Decision 4). A folded Area hides its sub-headers,
   * so they are not visited. The synthetic Other Areas group is skipped.
   */
  function moveAreaCursor(direction, row = cursorRow()) {
    const headers = visibleAreaHeaders();
    if (!headers.length) return false;
    const currentHeader = ownerHeaderRow(row);
    const current = headers.indexOf(currentHeader);
    let target;
    if (current >= 0) target = headers[Math.max(0, Math.min(headers.length - 1, current + Math.sign(direction)))];
    else {
      const all = visibleCursorRows();
      const documentIndex = all.indexOf(row);
      const candidates = direction < 0
        ? headers.filter((header) => all.indexOf(header) < documentIndex)
        : headers.filter((header) => all.indexOf(header) > documentIndex);
      target = direction < 0 ? candidates.at(-1) : candidates[0];
      target ??= direction < 0 ? headers[0] : headers.at(-1);
    }
    return setWorkCursor(target);
  }

  /** Returns the semantic parent of one visible Work tree row. */
  function parentWorkRow(row) {
    if (!row) return null;
    const parentGoal = row.dataset.subgoalOf;
    if (parentGoal) return visibleCursorRows().find((item) => item.dataset.goalAnchor === parentGoal) ?? null;
    if (row.dataset.workSubArea) return row.closest("tbody[data-work-group]")?.querySelector(".work-group-row:not([data-work-sub-area])") ?? null;
    if (row.classList.contains("work-group-row")) return null;
    return ownerHeaderRow(row);
  }

  /** Returns the first visible child of one expanded Work tree row. */
  function firstChildWorkRow(row) {
    if (!row) return null;
    if (row.classList.contains("work-group-row")) {
      // A top-level header's first child is the next row, a Goal or a
      // sub-header. A sub-header's children end at the next header.
      for (let item = row.nextElementSibling; item; item = item.nextElementSibling) {
        if (item.hidden || !item.dataset.workCursor) continue;
        if (row.dataset.workSubArea && item.classList.contains("work-group-row")) return null;
        return item;
      }
      return null;
    }
    const file = row.dataset.goalAnchor;
    if (!file) return null;
    return visibleCursorRows().find((item) => item.dataset.subgoalOf === file) ?? null;
  }

  /** True when one Work row owns children that are currently hidden. */
  function workRowIsCollapsed(row) {
    if (row?.classList.contains("work-group-row")) return row.querySelector(".work-fold")?.getAttribute("aria-expanded") === "false";
    if (!row?.dataset.goalAnchor) return false;
    return state.collapsedGoalTrees.has(row.dataset.goalAnchor);
  }

  /** Applies Vim `h`: collapse this node, then move to its parent. */
  function collapseWorkTree(row = cursorRow()) {
    if (!row) return false;
    if (row.classList.contains("work-group-row")) {
      // A folded sub-header moves to its top-level header. A folded top-level
      // header has no parent on Work.
      if (workRowIsCollapsed(row)) {
        const parent = parentWorkRow(row);
        return parent ? setWorkCursor(parent) : false;
      }
      setWorkAreaFolded(row.dataset.workArea, true);
      return true;
    }
    const firstChild = firstChildWorkRow(row);
    if (firstChild && !workRowIsCollapsed(row)) {
      setSubgoalsExpanded(row.dataset.goalAnchor, false);
      return true;
    }
    const parent = parentWorkRow(row);
    return parent ? setWorkCursor(parent) : false;
  }

  /** Applies Vim `l`: expand this node, then move to its first child. */
  function expandWorkTree(row = cursorRow()) {
    if (!row) return false;
    if (row.classList.contains("work-group-row")) {
      if (workRowIsCollapsed(row)) {
        setWorkAreaFolded(row.dataset.workArea, false);
        return true;
      }
      const child = firstChildWorkRow(row);
      return child ? setWorkCursor(child) : false;
    }
    const file = row.dataset.goalAnchor;
    const children = file ? [...screen.querySelectorAll("[data-subgoal-of]")].filter((item) => item.dataset.subgoalOf === file) : [];
    if (!children.length) return false;
    if (workRowIsCollapsed(row)) {
      setSubgoalsExpanded(file, true);
      return true;
    }
    return setWorkCursor(children.find((item) => !item.hidden));
  }

  /** Captures the semantic browser position that a child surface must restore. */
  function captureNavigationPoint(element = document.activeElement) {
    const focus = element?.closest?.("[data-focus-key]") ?? document.activeElement?.closest?.("[data-focus-key]");
    return {
      view: state.view,
      workCursor: state.workCursor,
      focusKey: focus?.dataset.focusKey ?? "",
      scrollTop: screen.scrollTop,
    };
  }

  /** Restores an exact opener, with the Work cursor as the durable fallback. */
  function restoreNavigationPoint(point) {
    if (!point) return;
    window.setTimeout(() => {
      if (point.view === state.view && Number.isFinite(point.scrollTop)) screen.scrollTop = point.scrollTop;
      const exact = point.focusKey
        ? [...screen.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === point.focusKey)
        : null;
      const row = state.view === "work"
        ? [...screen.querySelectorAll("[data-work-cursor]")].find((item) => item.dataset.workCursor === (point.workCursor || state.workCursor))
        : null;
      (exact ?? row?.querySelector("[data-work-row-title], [data-work-cursor-control]") ?? workTab)?.focus?.({ preventScroll: true });
    }, 0);
  }

  /** Remembers one launch opener until that complete chooser closes. */
  function rememberLaunchReturn(trigger) {
    launchReturnPoint ??= captureNavigationPoint(trigger);
  }

  /** Stops a pending request to focus controls created by an async launch load. */
  function stopLaunchFocusRequest() {
    launchFocusObserver?.disconnect?.();
    launchFocusObserver = null;
  }

  /** Focuses the useful first control after the chooser and its options exist. */
  function requestLaunchFocus(preference = "auto") {
    stopLaunchFocusRequest();
    /** Tries to focus the requested launch control after one paint. */
    const attempt = () => {
      const popover = screen.querySelector("[data-launch-popover]");
      if (!popover) return false;
      if (state.launch.loading) {
        popover.focus?.({ preventScroll: true });
        return false;
      }
      const active = document.activeElement;
      if (preference === "auto" && popover.contains(active) && active !== popover) return true;
      const choice = popover.querySelector("[data-launch-column='harness'] .launch-option.selected")
        ?? popover.querySelector("[data-launch-column='harness'] .launch-option");
      const summaryKind = String(preference).startsWith("default:") ? preference.slice("default:".length) : "";
      const summary = summaryKind
        ? popover.querySelector(`[data-default-agent-edit='${summaryKind}']`)
        : popover.querySelector("[data-default-agent-edit]");
      const exact = String(preference).startsWith("key:")
        ? [...popover.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === preference.slice("key:".length))
        : null;
      let candidate;
      if (preference === "summary" || summaryKind) candidate = summary;
      else if (exact) candidate = exact;
      else if (preference === "choices") candidate = choice;
      else if (state.launchTarget === DEFAULT_AGENTS_TARGET && !state.defaultAgents.editing) candidate = summary;
      // The brain's common path is Enter on its default, so focus starts on Start.
      else if (state.launchTarget === BRAIN_LAUNCH_TARGET) candidate = popover.querySelector("[data-launch-primary]:not([disabled])") ?? choice;
      else candidate = choice ?? popover.querySelector("textarea, input, select, button:not([disabled])");
      (candidate ?? popover).focus?.({ preventScroll: true });
      (candidate ?? popover).scrollIntoView?.({ block: "nearest" });
      return Boolean(candidate);
    };
    if (attempt()) return;
    launchFocusObserver = new window.MutationObserver(() => {
      if (!attempt()) return;
      stopLaunchFocusRequest();
    });
    launchFocusObserver.observe(screen, { childList: true, subtree: true });
    window.setTimeout(stopLaunchFocusRequest, 2500);
  }

  /** Whether this Goal has an attempt to resume: a live session or a recorded one. */
  function resumeAvailabilityForGoal(goal) {
    if (!goal) return { enabled: false, reason: "Choose a Goal row first." };
    if (sessionForGoal(goal)) return { enabled: true, reason: null };
    const record = pipelineRecordForGoal(goal);
    const attempts = (record?.steps ?? []).flatMap((step) => step.attempts ?? []);
    if (!attempts.length) return { enabled: false, reason: "This Goal has no attempts to resume." };
    return { enabled: true, reason: null };
  }

  /** Resolves the exact mutable identity required for safe attempt replacement. */
  function replacementTargetForGoal(goal) {
    if (!goal) return { enabled: false, reason: "Choose a Goal first." };
    if (["done", "dropped", "parked", "deferred"].includes(goal.status)) return { enabled: false, reason: "A closed or parked Goal has no replaceable current attempt." };
    const detail = state.goalDetail?.goal?.file === goal.file ? state.goalDetail : null;
    const record = (state.pipelines ?? []).find((item) => item.goal === goal.file) ?? detail?.queue ?? null;
    if (!record) return { enabled: false, reason: "This Goal has no current assignment." };
    const assignments = record.steps ?? record.assignments ?? [];
    const assignmentId = record.currentAssignmentId ?? detail?.current?.assignmentId;
    const assignment = assignments.find((item) => item.id === assignmentId)
      ?? assignments.find((item) => ["running", "waiting", "stopped"].includes(item.status));
    if (!assignment || !["running", "waiting", "stopped"].includes(assignment.status)) return { enabled: false, reason: "This Goal has no live or stopped assignment to replace." };
    const attempts = assignment.attempts ?? [];
    const attemptId = detail?.current?.assignmentId === assignment.id ? detail?.current?.attemptId ?? null : null;
    const attempt = attempts.find((item) => item.id === attemptId) ?? attempts.at(-1)
      ?? detail?.attempts?.find((item) => item.assignmentId === assignment.id && item.current);
    const expectedAttemptId = attempt?.id ?? attemptId;
    if (!expectedAttemptId) return { enabled: false, reason: "The current assignment has no fenced attempt identity." };
    if (!Number.isInteger(record.revision)) return { enabled: false, reason: "The current queue has no revision fence." };
    return { enabled: true, record, assignment, attempt, assignmentId: assignment.id, expectedAttemptId };
  }

  /**
   * Change agent is a message to the brain (D8): only the brain starts a new
   * worker attempt, so `c` opens the Area's composer with the request typed.
   */
  function openChangeAgent(goal) {
    const target = replacementTargetForGoal(goal);
    if (!target.enabled) return showToast(target.reason);
    showDescribe({ area: goal.area, description: `Replace the agent on ${goal.title} (${goal.file})` });
    return true;
  }

  /** Scrolls the chooser so its focused control is visible after a move or repaint. */
  function revealLaunchFocus() {
    const active = document.activeElement;
    if (active?.closest?.("[data-launch-popover]")) active.scrollIntoView?.({ block: "nearest" });
  }

  /**
   * Moves the chooser cursor onto one option. Moving is choosing: the option
   * is checked at once, as in a native radio group, and the repaint keeps
   * focus on it by focus key (design: brain-launch-keyboard, decision 1).
   */
  function chooseLaunchOption(option) {
    if (!option) return;
    option.focus({ preventScroll: true });
    if (option.getAttribute("aria-checked") !== "true") option.click();
    revealLaunchFocus();
  }

  /**
   * Owns keyboard movement inside the shared brain, Goal, and defaults
   * chooser. `h/l` pick a column, `j/k` move the checked value, Enter runs
   * the primary action, printed letters run the secondary ones.
   */
  function handleLaunchPopoverKey(event) {
    const popover = screen.querySelector("[data-launch-popover]");
    if (!popover) return false;
    const active = event.target;
    // Tab visits controls, and each column once, on its checked value. The
    // options inside a column are walked with j/k, not Tab.
    const stops = [...popover.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex='0']")]
      .filter((stop) => !stop.classList.contains("launch-option") || stop.getAttribute("aria-checked") === "true");
    if (event.key === "Tab") {
      if (!stops.length) {
        event.preventDefault();
        event.stopPropagation();
        popover.focus?.({ preventScroll: true });
        return true;
      }
      const current = document.activeElement?.closest?.("[data-launch-column]")
        ? stops.findIndex((stop) => stop.closest("[data-launch-column]") === document.activeElement.closest("[data-launch-column]"))
        : stops.indexOf(document.activeElement);
      const next = current < 0
        ? event.shiftKey ? stops.length - 1 : 0
        : (current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next].focus({ preventScroll: true });
      revealLaunchFocus();
      return true;
    }
    if (event.key === "Escape") return false;
    if (active.closest?.("input, textarea, select, [contenteditable='true']")) return false;
    const plain = !event.ctrlKey && !event.altKey && !event.shiftKey;
    const button = active.closest?.("button");
    const option = button?.classList.contains("launch-option") ? button : null;
    if (event.key === "Enter" && (!button || option || event.metaKey)) {
      const primary = popover.querySelector("[data-launch-primary]:not([disabled])");
      if (!primary) return false;
      event.preventDefault();
      event.stopPropagation();
      primary.click();
      return true;
    }
    if (["Enter", " "].includes(event.key) && button && popover.contains(button)) {
      event.preventDefault();
      event.stopPropagation();
      button.click();
      return true;
    }
    if (plain && !event.metaKey && event.key.length === 1 && !/^[hjkl]$/.test(event.key)) {
      const command = popover.querySelector(`[data-launch-key="${event.key}"]:not([disabled])`);
      if (!command) return false;
      event.preventDefault();
      event.stopPropagation();
      command.click();
      return true;
    }
    const assignment = active.closest?.("[data-launch-assignment]");
    const assignmentRegion = active.closest?.("[data-launch-assignment-region]");
    if (assignmentRegion && plain && !event.metaKey) {
      const rows = [...assignmentRegion.querySelectorAll("[data-launch-assignment]")];
      const current = rows.indexOf(assignment);
      if (["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const delta = ["j", "ArrowDown"].includes(event.key) ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, current + delta));
        rows[next]?.querySelector("[data-launch-step-select]")?.focus({ preventScroll: true });
        revealLaunchFocus();
        return true;
      }
    }
    const vertical = plain && !event.metaKey && ["j", "k", "ArrowDown", "ArrowUp"].includes(event.key);
    const horizontal = plain && !event.metaKey && ["h", "l", "ArrowLeft", "ArrowRight"].includes(event.key);
    if (!vertical && !horizontal) return false;
    const columns = [...popover.querySelectorAll("[data-launch-column]")].filter((column) => column.querySelector(".launch-option"));
    if (!columns.length) return false;
    const column = active.closest?.("[data-launch-column]");
    /** The checked option of one column, or its first option. */
    const checkedIn = (target) => target.querySelector(".launch-option[aria-checked='true']") ?? target.querySelector(".launch-option");
    if (horizontal) {
      event.preventDefault();
      event.stopPropagation();
      const delta = ["l", "ArrowRight"].includes(event.key) ? 1 : -1;
      const columnIndex = columns.indexOf(column);
      // From outside the columns, l enters the first column and h the last.
      const next = columnIndex < 0 ? (delta > 0 ? 0 : columns.length - 1) : Math.max(0, Math.min(columns.length - 1, columnIndex + delta));
      chooseLaunchOption(checkedIn(columns[next]));
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    // From outside the columns (focus opens on Start), j/k act on the first
    // column straight away instead of waiting for l to enter it.
    const target = column ?? columns[0];
    const choices = [...target.querySelectorAll(".launch-option")];
    const current = choices.indexOf(column ? option : checkedIn(target));
    const delta = ["j", "ArrowDown"].includes(event.key) ? 1 : -1;
    const index = current < 0 ? (delta > 0 ? 0 : choices.length - 1) : Math.max(0, Math.min(choices.length - 1, current + delta));
    chooseLaunchOption(choices[index]);
    return true;
  }

  /** Restores the brain chooser under a nested defaults editor. */
  function restoreLaunchParentSurface() {
    const parent = launchParentSurface;
    if (!parent) return false;
    launchParentSurface = null;
    stopLaunchFocusRequest();
    state.launchTarget = parent.target;
    state.launchAnchor = parent.anchor;
    state.brainDraft = parent.brainDraft;
    state.defaultAgents = { area: "", editing: "", mode: "" };
    launchOptionsFor(parent.brainDraft.area);
    state.launch.choice = parent.choice;
    state.launch.command = parent.command;
    state.launch.editing = parent.editing;
    paint(true);
    requestLaunchFocus("key:launch:brain:default");
    return true;
  }

  /** Closes the complete launch/default chooser and restores its opener. */
  function dismissLaunchSurface({ restore = true } = {}) {
    if (!state.launchTarget) return false;
    if (restoreLaunchParentSurface()) return true;
    stopLaunchFocusRequest();
    const point = launchReturnPoint;
    launchReturnPoint = null;
    launchParentSurface = null;
    state.launch.open = false;
    state.launch.editing = false;
    state.launchTarget = "";
    state.launchAnchor = null;
    state.defaultAgents = { area: "", editing: "", mode: "" };
    paint(true);
    if (restore) restoreNavigationPoint(point);
    return true;
  }

  /** Cancels only the innermost launch edit before the chooser itself closes. */
  function cancelLaunchEditStage() {
    if (state.launchTarget === DEFAULT_AGENTS_TARGET && state.defaultAgents.editing) {
      const kind = state.defaultAgents.editing;
      state.defaultAgents = { ...state.defaultAgents, editing: "", mode: "" };
      state.launch.choice = null;
      state.launch.command = "";
      state.launch.editing = false;
      paint(true);
      requestLaunchFocus(`default:${kind}`);
      return true;
    }
    if (state.launch.editing) {
      state.launch.command = "";
      state.launch.editing = false;
      paint(true);
      window.setTimeout(() => screen.querySelector("[data-launch-edit]")?.focus({ preventScroll: true }), 0);
      return true;
    }
    return false;
  }

  /**
   * Opens the live thing owned by the cursor row: a Goal's agent, a
   * definition session, or an Area's brain. A Goal with no live session
   * opens its launch editor, so the agent is reachable from this one key on
   * every Goal; starting still takes an explicit key inside that editor.
   */
  function enterCursorSession() {
    const row = cursorRow();
    if (!row) return showToast("There is no Work row to enter.");
    setWorkCursor(row, false);
    const value = row.dataset.workCursor;
    if (value.startsWith("goal:")) return openGoalRun(value.slice(5));
    if (value.startsWith("definition:")) {
      const session = describeWorkSessions().find((item) => item.name === value.slice(11));
      return session ? openSessionLayer(session, "definition") : showToast("This row has no live session to enter.");
    }
    return executeWorkCommand("openBrain", row);
  }

  /** Lets the shared modal close its informational key sheet. */
  function closeKeySheet() { return true; }

  /**
   * `?` and its button open the one Work key sheet: every registered command
   * with its key, scoped to the cursor row, and each row runs when picked. It
   * is the same surface the row's `⋯` opens, so keys and commands are one list.
   */
  function openWorkKeySheet(row = cursorRow()) {
    return openObjectActions(row);
  }

  /** Opens every Goal outcome behind one keyboard and pointer surface. */
  function openGoalStatus(goal) {
    if (!goal) return showToast("Choose a Goal row first.");
    const open = !["done", "dropped", "parked", "deferred"].includes(goal.status);
    const flagged = goal.verify === true;
    const options = [
      { value: "done", key: "d", label: "Done", help: goal.status === "verify" ? "You checked it. Close the Goal." : "Close the Goal because its done condition is met.", enabled: open, reason: "This Goal is already closed." },
      { value: "verify", key: "c", label: flagged ? "Check it myself: on" : "Check it myself", help: flagged ? "Turn it off: the brain's done closes the Goal." : "When the brain marks this done, it waits for you as Check it.", enabled: open, reason: "This Goal is already closed." },
      { value: "dropped", key: "w", label: "Won't do", help: "Close the Goal with a required reason.", enabled: open, reason: "This Goal is already closed." },
      { value: "parked", key: "p", label: "Park", help: "Hide the Goal from default Work without deleting its history.", enabled: open, reason: "This Goal is already closed." },
      { value: "open", key: "r", label: "Reopen", help: "Return this Goal to open without starting an agent.", enabled: !open, reason: "This Goal is already open." },
    ];
    /** Applies or confirms the chosen Goal state. */
    const chooseStatus = async (status) => {
      rememberGoal(goal.file);
      if (status === "done") {
        confirmComplete(goal.file);
        return false;
      }
      if (status === "verify") {
        try {
          await post("/api/goals/edit", { file: goal.file, verify: !flagged });
          await refresh();
          paint(true);
          showToast(flagged ? "The brain's done closes this Goal." : "When the brain marks this done, it waits for you as Check it.");
          return true;
        } catch (error) {
          showToast(error.message);
          return false;
        }
      }
      if (status === "dropped") {
        confirmWontDo();
        return false;
      }
      if (status === "parked") {
        /** Parks after an optional note and exact-attempt confirmation on the server. */
        const parkGoal = async () => {
          const reason = modalLayer.querySelector("[data-modal-input]")?.value.trim() || "";
          try {
            await post("/api/goals/edit", { file: goal.file, status: "parked", ...(reason ? { reason } : {}) });
            await refresh();
            paint(true);
            showToast("The Goal is parked. Its history is unchanged.");
            return true;
          } catch (error) {
            showToast(error.message);
            return false;
          }
        };
        openModal({
          kicker: "Park Goal",
          title: `Park “${goal.title}”?`,
          copy: sessionForGoal(goal) ? "The server detaches this Goal from its exact live attempt. It does not stop unrelated work." : "The Goal leaves default Work. Its queue, comments, and attempts remain.",
          field: { label: "Reason (optional)", placeholder: "Why is this Goal being parked?", required: false },
          confirmLabel: "Park Goal",
          danger: Boolean(sessionForGoal(goal)),
          onConfirm: parkGoal,
        });
        return false;
      }
      if (status === "open") {
        try {
          await post("/api/goals/edit", { file: goal.file, status: "open" });
          await refresh();
          paint(true);
          showToast("The Goal is open again. No agent started.");
          return true;
        } catch (error) {
          showToast(error.message);
          return false;
        }
      }
      return false;
    };
    return openModal({
      kicker: "Goal status",
      title: goal.title,
      copy: "Choose the outcome. Escape returns to the exact Goal row.",
      field: { kind: "actions", label: "Goal status", options },
      confirmLabel: "",
      onConfirm: chooseStatus,
    });
  }

  /** Reports whether one directional tree command can act on this object. */
  function treeCommandAvailability(id, row) {
    if (id === "collapse") {
      if (row?.classList.contains("work-group-row")) return workRowIsCollapsed(row) && !parentWorkRow(row) ? { enabled: false, reason: "This Area is already collapsed and has no parent on Work." } : { enabled: true };
      return { enabled: Boolean(parentWorkRow(row) || firstChildWorkRow(row)), reason: "This Goal has no parent or children on Work." };
    }
    if (id === "expand") {
      const child = firstChildWorkRow(row);
      return { enabled: Boolean(workRowIsCollapsed(row) || child), reason: "This Goal has no children." };
    }
    return { enabled: true };
  }

  /** Resolves the fenced route for the exact owner/file pair painted on a row. */
  function presentedDocumentDismissal(row, file = row?.dataset.presentationFile) {
    if (!row || !file) return null;
    if (row.dataset.presentationArea) return { path: "/api/areas/dismiss-presentation", body: { area: row.dataset.presentationArea, file } };
    if (row.dataset.presentationGoal) return { path: "/api/goals/dismiss-presentation", body: { goal: row.dataset.presentationGoal, file } };
    return null;
  }

  /** Dismisses one exact presented Document through Julian's fenced route. */
  async function dismissPresentedDocument(row, file = row?.dataset.presentationFile) {
    const dismissal = presentedDocumentDismissal(row, file);
    if (!dismissal) return false;
    const rows = visibleCursorRows();
    const index = rows.indexOf(row);
    const survivor = rows[index + 1] ?? rows[index - 1] ?? null;
    await post(dismissal.path, dismissal.body);
    if (state.workCursor === row.dataset.workCursor && survivor?.dataset.workCursor) {
      state.workCursor = survivor.dataset.workCursor;
      localStorage.setItem("agent-shell.work-cursor", state.workCursor);
    }
    await refresh();
    return true;
  }

  /** Resolves the Goal and card painted on one Work row. */
  function cardForRow(row) {
    const goal = goalByFile(row?.dataset.cardGoal ?? "");
    return { goal, card: (goal?.cards ?? []).find((item) => item.id === row?.dataset.cardId) };
  }

  /** Runs the primary action of one presented card. */
  async function runCardAction(row) {
    const { goal, card } = cardForRow(row);
    if (!goal || !card) return showToast("This card is no longer available.");
    if (card.kind === "copy") {
      try { await navigator.clipboard.writeText(card.fields.text); announceWork("Copied"); showToast("Copied"); }
      catch { announceWork("Could not copy"); showToast("Could not copy"); }
      return true;
    }
    if (card.kind === "link") {
      const url = card.fields.url;
      if (url.href) {
        if (!window.open(url.href, "_blank", "noopener")) { announceWork(`Could not open ${url.host}`); showToast(`Could not open ${url.host}`); }
        return true;
      }
      return openDocumentPeek(url.file, { origin: row.querySelector("[data-card-action]") });
    }
    return openDocument(goal.file, { heading: "presented" });
  }

  /** Dismisses one exact card and refreshes Work. */
  async function dismissCard(row) {
    if (!row?.dataset.cardGoal || !row?.dataset.cardId) return false;
    try { await post("/api/goals/dismiss-card", { goal: row.dataset.cardGoal, id: row.dataset.cardId }); await refresh(); }
    catch { announceWork("Could not dismiss"); }
    return true;
  }

  /** Runs one Work command against one semantic row. Pointer and keys share it. */
  function executeWorkCommand(id, row = cursorRow()) {
    const area = commandAreaForRow(row);
    const goal = goalByFile(row?.dataset.goalAnchor ?? "");
    if (id === "fullDocument" && row?.dataset.presentationFile) return openDocument(row.dataset.presentationFile, { presentation: row });
    if (id === "dismissPresentation" && row?.dataset.presentationFile) {
      return dismissPresentedDocument(row);
    }
    if (id === "readGoalPresented" && row?.dataset.cardGoal) return openDocument(row.dataset.cardGoal, { heading: "presented" });
    if (id === "dismissCard" && row?.dataset.cardId) return dismissCard(row);
    if (id === "previousArea" || id === "nextArea") return moveAreaCursor(id === "previousArea" ? -1 : 1, row);
    if (id === "openBrain") {
      if (!area) return showToast("This row has no Area command header.");
      // An Area row means exactly this Area's brain. Any other row (a Goal, a
      // sub-goal) opens the nearest active brain up the Area chain, so a Goal
      // under a sub-Area without its own brain still reaches its organiser.
      const onAreaRow = Boolean(row?.classList.contains("work-group-row"));
      const brain = onAreaRow ? activeBrainForArea(state.brains, area) : nearestActiveBrain(state.brains, area);
      const session = state.sessions.find((item) => item.name === brain?.session);
      if (session) return openSessionLayer(session, "brain");
      const point = captureNavigationPoint(row?.querySelector("[data-work-row-title], [data-work-cursor-control]"));
      const opened = openOrStartBrain(area);
      Promise.resolve(opened).then(() => {
        if (state.launchTarget !== BRAIN_LAUNCH_TARGET) return;
        launchReturnPoint ??= point;
        requestLaunchFocus();
      }, () => {});
      return opened;
    }
    if (id === "stopAgent") {
      if (goal) {
        const session = sessionForGoal(goal);
        if (!session) return showToast("This Goal has no live agent.");
        rememberGoal(goal.file);
        return confirmStop();
      }
      const brain = brainForAreaCard(area);
      return area ? confirmStopBrain(area, brain?.currentAttemptId ?? brain?.session ?? "") : showToast("This row has no Area command header.");
    }
    if (id === "defaults") {
      if (!area) return showToast("This row has no Area command header.");
      const trigger = row.querySelector("[data-work-object-actions], [data-work-cursor-control]");
      trigger.dataset.defaultAgentsArea = area;
      rememberLaunchReturn(row.querySelector("[data-work-row-title], [data-work-cursor-control]"));
      const result = toggleDefaultAgents(trigger);
      requestLaunchFocus("summary");
      return result;
    }
    if (id === "messageBrain") return area ? showDescribe({ area }) : showToast("This row has no Area command header.");
    if (id === "map") {
      const mapArea = mapAreaForRow(row);
      return mapArea ? openAreaMap(mapArea, row) : showToast("This row has no Area map.");
    }
    if (id === "questions") return area ? openQuestionsReview(area) : showToast("This row has no Area command header.");
    if (id === "note") return area ? openAreaCapture(area) : showToast("This row has no Area command header.");
    if (id === "starArea") {
      // A Goal inside Other Areas has no Area header of its own, and that is
      // exactly where a star brings an Area in, so the Goal's Area serves.
      const target = area || goal?.area || "";
      if (!target) return showToast("Choose an Area row first.");
      return toggleAreaStar(target);
    }
    if (id === "starredOnly") return toggleStarredOnly();
    if (id === "activeOnly") return toggleActiveOnly();
    if (id === "chooseAreas") return openAreaFocusPicker();
    if (id === "collapse") return collapseWorkTree(row) || showToast(treeCommandAvailability(id, row).reason);
    if (id === "expand") return expandWorkTree(row) || showToast(treeCommandAvailability(id, row).reason);
    if (id === "readGoal") return goal ? openDocument(goal.file) : showToast("Choose a Goal row first.");
    if (id === "changeAgent") {
      const opener = row?.contains(document.activeElement)
        ? document.activeElement
        : row?.querySelector("[data-work-object-actions]") ?? row?.querySelector("[data-work-row-title]");
      return goal ? openChangeAgent(goal, opener) : showToast("Choose a Goal row first.");
    }
    if (id === "goalStatus") return goal ? openGoalStatus(goal) : showToast("Choose a Goal row first.");
    if (id === "resumeAttempt") {
      if (!goal) return showToast("Choose a Goal row first.");
      const resumable = resumeAvailabilityForGoal(goal);
      return resumable.enabled ? resumeGoalAttempt(goal.file) : showToast(resumable.reason);
    }
    if (id === "search") return searchBar.open();
    if (id === "nextMatch") return searchBar.step(1) || showToast("Press / to search first.");
    if (id === "previousMatch") return searchBar.step(-1) || showToast("Press / to search first.");
    if (id === "keys") return openWorkKeySheet(row);
    if (id === "open") return openWorkRow(row);
    if (id === "session") return enterCursorSession();
    // Picked from the key sheet, a motion runs once in its forward direction.
    if (["moveRows", "firstLast", "halfPage"].includes(id)) {
      const rows = visibleCursorRows();
      if (!rows.length) return showToast("There is no Work row to move to.");
      const index = rows.indexOf(row);
      const pageRows = Math.max(1, Math.floor(screen.clientHeight / Math.max(1, row?.offsetHeight || 40) / 2));
      if (id === "firstLast") return setWorkCursor(rows[0]);
      if (id === "halfPage") return setWorkCursor(rows[Math.min(rows.length - 1, Math.max(0, index) + pageRows)]);
      return setWorkCursor(rows[index < 0 ? 0 : Math.min(rows.length - 1, index + 1)]);
    }
    return undefined;
  }

  /**
   * Enter on a row is a registered command (work-view-affordances D5), so the
   * `↵` a button prints is real. The row's title or Area name carries the
   * route, and pressing it is what the native focus path did before.
   */
  function openWorkRow(row) {
    const control = row?.querySelector("[data-work-row-title], [data-work-cursor-control]");
    if (!control) return showToast("Choose a Work row first.");
    control.click();
    return true;
  }

  /**
   * Resumes one attempt (ADR-0042): the server attaches a live attempt, or
   * opens a new `resume` session with the command typed. Either way the
   * session is entered. Without an attempt id the latest attempt is meant.
   */
  async function resumeGoalAttempt(goalFile, attemptId = "", conversationId = "") {
    try {
      const result = await post("/api/goals/attempts/resume", { goal: goalFile, ...(attemptId ? { attemptId } : {}), ...(conversationId ? { conversationId } : {}) });
      await refresh();
      paint(true);
      const session = state.sessions.find((item) => item.name === result.session);
      const typed = result.status === "resumed" ? `Resume command typed in ${result.session}. Press Enter there to submit it.` : "";
      if (typed) showToast(typed);
      if (session) return openSessionLayer(session, "agent");
      return typed ? undefined : showToast(`Session ${result.session} is not live yet.`);
    } catch (error) {
      showToast(error.message);
      return undefined;
    }
  }

  /** Runs one guarded pipeline control from either pointer or object actions. */
  async function controlGoalPipeline(goalFile, action, step) {
    try {
      const record = (state.pipelines ?? []).find((item) => item.goal === goalFile);
      const result = await post("/api/pipelines/control", {
        goal: goalFile,
        action,
        step: Number(step),
        expectedRevision: record?.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      paint(true);
      showToast(result.next
        ? `Step ${result.next.index} started.`
        : action === "skip"
          ? `Step ${step} skipped; the pipeline is complete.`
          : action === "end"
            ? "Work stopped. The Goal stays open."
            : `Step ${step} ${action}ed.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  /**
   * Opens the one state-owned key sheet for the current Work object: every
   * registered command that applies to this row, with its key, runnable by
   * picking it. Row-specific outcomes without a key (End current agent, Mark
   * done, Archive) join the same list, so nothing has a second menu.
   */
  function openObjectActions(row = cursorRow()) {
    if (row) rememberWorkCursor(row);
    const area = commandAreaForRow(row);
    const goal = goalByFile(row?.dataset.goalAnchor ?? "");
    const brain = area ? brainForAreaCard(area) : null;
    const isArea = Boolean(row?.classList.contains("work-group-row") && area);
    const searching = Boolean(state.searchPattern);
    const options = workCommandsFor().filter((command) => {
      if (command.id === "starArea") return Boolean(isArea || goal);
      if (["defaults", "messageBrain", "chooseAreas", "questions", "note", "previousArea", "nextArea"].includes(command.id)) return isArea;
      if (command.id === "stopAgent") return Boolean(isArea || goal);
      if (["readGoal", "changeAgent", "goalStatus"].includes(command.id)) return Boolean(goal);
      if (command.id === "resumeAttempt") return Boolean(goal) && !isArea;
      if (["open", "session", "collapse", "expand"].includes(command.id)) return Boolean(row);
      return command.id !== "keys";
    }).map((command) => {
      const tree = treeCommandAvailability(command.id, row);
      const replacement = command.id === "changeAgent" ? replacementTargetForGoal(goal) : null;
      const resumable = command.id === "resumeAttempt" ? resumeAvailabilityForGoal(goal) : null;
      const match = ["nextMatch", "previousMatch"].includes(command.id);
      const stopLive = isArea ? Boolean(brain?.live) : Boolean(goal && sessionForGoal(goal));
      const enabled = command.id === "stopAgent" ? stopLive : replacement ? replacement.enabled : resumable ? resumable.enabled : match ? searching : tree.enabled;
      const reason = command.id === "stopAgent" && !stopLive ? (isArea ? "This Area has no live brain." : "This Goal has no live agent.") : replacement ? replacement.reason : resumable ? resumable.reason : match && !searching ? "Press / to search first." : tree.reason;
      const label = command.id === "starArea" && area && state.areaFocus.includes(area) ? "Unstar Area"
        : command.id === "starredOnly" && state.areaFocusOnly ? "Show every Area"
        : command.id === "activeOnly" && state.activeOnly ? "Show every Area" : command.label;
      return { value: command.id, key: command.keyDisplay, label, help: command.help, enabled, reason };
    });
    const record = goal ? pipelineRecordForGoal(goal) : null;
    const currentAssignment = record?.steps?.find((step) => !["complete", "skipped", "ended", "replaced"].includes(step.status));
    const stoppedAssignment = currentAssignment && (currentAssignment.status === "stopped" || (currentAssignment.status === "running" && !currentAssignment.live));
    // Area status on Julian's word (area-archive Decision 8): done is a finished
    // subject, archived a shelved one. Both fold away. A live brain blocks both.
    const areaRecord = isArea ? state.vault?.areas?.find((item) => item.path === area) : null;
    if (areaRecord) {
      const hidden = ["done", "archived"].includes(areaRecord.status);
      const blocked = Boolean(brain?.live);
      if (hidden) options.push({ value: "reopenArea", key: "", label: "Reopen", help: `This Area is ${areaRecord.status}. Return it to active.`, enabled: true });
      else {
        options.push({ value: "areaDone", key: "", label: "Mark done", help: "A finished subject. It folds away; its Goals are not changed.", enabled: !blocked, reason: "A brain is live here. Stop it first." });
        options.push({ value: "archiveArea", key: "", label: "Archive", help: "A shelved subject. It folds away like done, with its own mark.", enabled: !blocked, reason: "A brain is live here. Stop it first." });
      }
    }
    if (goal && stoppedAssignment) {
      if (currentAssignment.index < (record.steps?.length ?? 0)) options.splice(2, 0, { value: "skipAssignment", key: "", label: `Skip to assignment ${currentAssignment.index + 1}`, help: "End this stopped assignment and advance to the next one.", enabled: true });
      options.splice(2, 0, { value: "endPipeline", key: "", label: "End work", help: "End the run while keeping the Goal open and preserving its history.", enabled: true });
    }
    const cursor = row?.dataset.workCursor ?? "";
    /** Resolves the repainted semantic object before it runs the chosen command. */
    const run = (id) => {
      const currentRow = visibleCursorRows().find((item) => item.dataset.workCursor === cursor) ?? row ?? cursorRow();
      if (id === "skipAssignment" && goal && currentAssignment) {
        controlGoalPipeline(goal.file, "skip", currentAssignment.index);
        return true;
      }
      if (id === "endPipeline" && goal && currentAssignment) {
        controlGoalPipeline(goal.file, "end", currentAssignment.index);
        return true;
      }
      if (["areaDone", "archiveArea", "reopenArea"].includes(id) && area) {
        setAreaStatus(area, id === "areaDone" ? "done" : id === "archiveArea" ? "archived" : "active");
        return true;
      }
      return executeWorkCommand(id, currentRow);
    };
    return openModal({
      kicker: goal ? "Goal keys" : isArea ? "Area keys" : "Work keys",
      title: goal?.title ?? (area ? areaLabel(area) : "Work"),
      copy: "Every key for this row. Pick one to run it.",
      field: { kind: "actions", label: "Actions", options },
      confirmLabel: "",
      onConfirm: run,
    });
  }

  /**
   * `?` in the Goal reader opens one sheet: the Goal's commands with their
   * keys, runnable, above the reading keys. Keys and commands are one list.
   */
  function openReaderGoalActions(opener = document.querySelector("[data-reader-goal-actions]")) {
    const detail = state.goalDetail;
    const goal = detail?.goal;
    if (!goal) return showToast("This reader is not showing a Goal.");
    const keyFor = { read: "o", "change-agent": "c", status: "x" };
    const options = (detail.commands ?? []).map((command) => ({
      value: command.id,
      key: keyFor[command.id] ?? "",
      label: command.label || command.id,
      help: command.enabled === false ? command.reason : command.id === "status" ? "Choose Done, Check it myself, Won't do, Park, or Reopen." : "Run this Goal command.",
      enabled: command.enabled !== false,
      reason: command.reason,
    }));
    /** Runs one command without replacing the reader's stable object identity. */
    const run = (id) => {
      if (id === "read") return true;
      if (id === "status") {
        openGoalStatus(goal);
        return false;
      }
      if (id === "change-agent") return openChangeAgent(goal, opener);
      return false;
    };
    return openModal({
      kicker: "Goal keys",
      title: goal.title,
      copy: "Pick a command to run it. Reading keys follow.",
      rows: documentKeyRows({ quick: false }),
      field: { kind: "actions", label: "Goal keys", options },
      confirmLabel: "",
      onConfirm: run,
    });
  }

  /**
   * Opens the key sheet for either Document reading surface. A Goal in the
   * full reader gets its commands in the same sheet (`openReaderGoalActions`).
   */
  function openDocumentKeySheet({ quick = Boolean(state.documentPeek) } = {}) {
    if (!quick && state.goalDetail?.goal) return openReaderGoalActions();
    const rows = documentKeyRows({ quick });
    return openModal({ kicker: quick ? "Quick Document keys" : "Document keys", title: "Read without the mouse", copy: "", rows, confirmLabel: "Close", onConfirm: closeKeySheet });
  }

  /** The reading keys as sheet rows, shared by the Document and Goal sheets. */
  function documentKeyRows({ quick }) {
    return [
      { key: "j / k", label: "Move by line", help: "Move down or up one reading line." },
      { key: "Ctrl-D / Ctrl-U", label: "Move by half page", help: "Move down or up half a page." },
      { key: "gg / G", label: "Top or bottom", help: "Move to the start or end of this Document." },
      { key: "{ / }", label: "Move by heading", help: "Move to the previous or next heading." },
      { key: "H / L", label: "Document history", help: "Open the previous or next Document in your reading history." },
      { key: "]c / [c", label: "Move by comment", help: "Move to the next or previous comment." },
      { key: "y", label: "Copy", help: "Copy the selection, or the whole Document." },
      { key: "c", label: "Write a comment", help: quick ? "Open the full reader to write a comment." : "Write a comment at the current text or Document." },
      ...(!quick ? [
        { key: "e", label: "Edit active comment", help: "Edit the active Julian comment." },
        { key: "r", label: "Reply to active comment", help: "Add a Julian note at the same anchor. With no active comment, r resumes the Goal's current attempt." },
        { key: "x", label: "Resolve active comment", help: "Resolve it with a required short change note." },
      ] : []),
      { key: "Esc", label: "Step back", help: "Clear selected text, clear the active comment, then close the reader." },
    ];
  }

  /** Gives an open key sheet its own compact Vim scrolling mode. */
  function handleKeySheetScroll(event) {
    const scroller = modalLayer.querySelector(".key-sheet-surface .modal-copy");
    if (!scroller || event.metaKey || event.altKey || event.isComposing) return false;
    let target = null;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (!event.ctrlKey && !event.shiftKey && ["j", "ArrowDown"].includes(event.key)) target = scroller.scrollTop + 34;
    else if (!event.ctrlKey && !event.shiftKey && ["k", "ArrowUp"].includes(event.key)) target = scroller.scrollTop - 34;
    else if (event.ctrlKey && !event.shiftKey && String(event.key).toLowerCase() === "d") target = scroller.scrollTop + scroller.clientHeight / 2;
    else if (event.ctrlKey && !event.shiftKey && String(event.key).toLowerCase() === "u") target = scroller.scrollTop - scroller.clientHeight / 2;
    else if (!event.ctrlKey && event.key === "G") target = maximum;
    else if (!event.ctrlKey && !event.shiftKey && event.key === "g" && chords.pendingFor("key-sheet") === "g") target = 0;
    else if (!event.ctrlKey && !event.shiftKey && event.key === "g") {
      event.preventDefault();
      event.stopPropagation();
      chords.stage("key-sheet", "g");
      return true;
    } else {
      chords.clear("key-sheet");
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    chords.clear("key-sheet");
    scroller.scrollTop = Math.min(maximum, Math.max(0, target));
    return true;
  }

  /** Runs the callback owned by the current modal and closes only that modal. */
  async function invokeModalChoice(value = undefined) {
    const action = modalConfirm();
    if (!action) return;
    try {
      const previousSession = state.sessionPeek?.session ?? "";
      const previousLaunch = state.launchTarget;
      const result = await action(value);
      const sameSurface = modalConfirm() === action;
      if (result !== false && sameSurface) {
        const handedOff = Boolean(state.sessionPeek?.session && state.sessionPeek.session !== previousSession)
          || Boolean(state.launchTarget && state.launchTarget !== previousLaunch);
        closeModal({ restoreFocus: !handedOff });
      }
    } catch (error) {
      showToast(error.message);
    }
  }

  /** The scroll owner for the full or quick Document surface. */
  function documentReadingSurface(quick) {
    return quick ? documentPeekLayer.querySelector(".document-peek-scroll") : screen.querySelector(".document-reader-scroll");
  }

  /** True when the native Selection belongs to this reading surface. */
  function readingSurfaceHasSelection(surface) {
    const selection = window.getSelection?.();
    if (!surface || !selection || selection.isCollapsed || !selection.rangeCount) return false;
    const anchor = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const focus = selection.focusNode?.nodeType === 1 ? selection.focusNode : selection.focusNode?.parentElement;
    return Boolean((anchor && surface.contains(anchor)) || (focus && surface.contains(focus)));
  }

  /** The visible reader owns clean copy; a selection must start in its source column. */
  function visibleCopySurface() {
    if (state.documentPeek?.document && !documentPeekLayer.hidden) return { quick: true, name: "quick" };
    if (state.view === "document" && state.document) return { quick: false, name: "full" };
    return null;
  }

  /** True when the Selection gesture began in source-backed reading content. */
  function selectionStartsInCopyRoot(quick) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    const root = documentReadingSurface(quick)?.querySelector(".document-content");
    const anchor = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    return Boolean(root && anchor && root.contains(anchor) && anchor.closest?.("[data-copy-block]"));
  }

  /** The requested scope: eligible selection first, whole Document otherwise. */
  function prepareReaderCopy(quick) {
    const selectionStarted = selectionStartsInCopyRoot(quick);
    const selected = readerCopyPayload({ quick, whole: false });
    if (selected || selectionStarted) return selected;
    return readerCopyPayload({ quick, whole: true });
  }

  /** Mutates only the existing control, preserving reader DOM and Selection. */
  function setCopyFeedback(name, label, { announce = false } = {}) {
    const button = document.querySelector(`[data-document-copy="${name}"]`);
    if (!button) return;
    const text = button.querySelector("[data-copy-label]");
    const status = button.querySelector("[data-copy-status]");
    if (text) text.textContent = label;
    if (announce && status) {
      status.textContent = "";
      /** Repeats identical status text after clearing the live region. */
      const repeat = () => { if (status.isConnected) status.textContent = label; };
      if (window.requestAnimationFrame) window.requestAnimationFrame(repeat);
      else window.setTimeout(repeat, 0);
    }
  }

  /** Restores the live scope label after feedback expires. */
  function resetCopyLabel(name) {
    const quick = name === "quick";
    setCopyFeedback(name, readerCopyPayload({ quick, whole: false }) ? "Copy selection" : "Copy");
  }

  /** Gives one visible copy operation serial, non-repainting feedback. */
  function showCopyFeedback(name, label, expectedButton = document.querySelector(`[data-document-copy="${name}"]`)) {
    const operation = copyOperations[name];
    const serial = ++operation.serial;
    if (operation.timer) window.clearTimeout(operation.timer);
    if (!expectedButton?.isConnected || document.querySelector(`[data-document-copy="${name}"]`) !== expectedButton) return serial;
    setCopyFeedback(name, label, { announce: true });
    operation.timer = window.setTimeout(() => {
      if (operation.serial !== serial) return;
      operation.timer = null;
      if (!expectedButton.isConnected || document.querySelector(`[data-document-copy="${name}"]`) !== expectedButton) return;
      resetCopyLabel(name);
    }, 2000);
    return serial;
  }

  /** Opens the permission-free native selection fallback for a requested payload. */
  function openCopyFallback(payload) {
    openModal({
      kicker: "Copy failed", title: "Copy Markdown", copy: "Select and copy this Markdown with Cmd+C.",
      field: { kind: "copy-fallback", label: "Copy Markdown", value: payload.markdown },
      confirmLabel: "Close",
      /** The fallback has no mutation to confirm. */
      onConfirm: () => true,
    });
  }

  /** Writes both clipboard forms as one operation from the current gesture. */
  function writeReaderCopy(payload, name) {
    if (!payload) return false;
    const operation = copyOperations[name];
    const serial = ++operation.serial;
    const button = document.querySelector(`[data-document-copy="${name}"]`);
    let writing;
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write || !window.Blob) throw new Error("Rich clipboard unavailable");
      const item = new window.ClipboardItem({
        "text/html": Promise.resolve(new window.Blob([payload.html], { type: "text/html" })),
        "text/plain": Promise.resolve(new window.Blob([payload.markdown], { type: "text/plain" })),
      });
      writing = navigator.clipboard.write([item]);
    } catch (error) {
      writing = Promise.reject(error);
    }
    Promise.resolve(writing).then(() => {
      if (operation.serial !== serial || !button?.isConnected || document.querySelector(`[data-document-copy="${name}"]`) !== button) return;
      showCopyFeedback(name, payload.scope === "selection" ? "Copied selection" : "Copied", button);
    }, () => {
      if (operation.serial !== serial || !button?.isConnected || document.querySelector(`[data-document-copy="${name}"]`) !== button) return;
      showCopyFeedback(name, "Copy failed", button);
      openCopyFallback(payload);
    });
    return true;
  }

  /** Clears a staged chord key on one reading surface. */
  function clearDocumentPendingG(surface = "") {
    chords.clear(surface ? `reader:${surface}` : "");
  }

  /** Waits briefly for the second key of a chord on one exact reading surface. */
  function stageDocumentChord(surface, key) {
    chords.stage(`reader:${surface}`, key);
  }

  /** Absolute heading positions inside one Document scroll owner. */
  function documentHeadingOffsets(surface) {
    if (!surface) return [];
    const top = surface.getBoundingClientRect().top;
    return [...surface.querySelectorAll(".document-content h2, .document-content h3")]
      .map((heading) => surface.scrollTop + heading.getBoundingClientRect().top - top);
  }

  /** Applies one pure movement target to the visible Document scroll owner. */
  function moveDocumentReadingSurface(surface, command) {
    if (!surface) return false;
    const target = documentReadingScrollTarget(command, {
      scrollTop: surface.scrollTop,
      clientHeight: surface.clientHeight,
      scrollHeight: surface.scrollHeight,
      headingOffsets: documentHeadingOffsets(surface),
    });
    if (target === null) return false;
    surface.scrollTop = target;
    return true;
  }

  /** The quick reader's semantic comment cursor, resolved in its current file. */
  function peekCommentIndex() {
    const peek = state.documentPeek;
    const cursor = peek?.commentCursorIdentity;
    if (!cursor || cursor.file !== peek.file) return -1;
    return (peek.document?.comments ?? []).findIndex((comment) => JSON.stringify(commentIdentity(comment)) === JSON.stringify(cursor.comment));
  }

  /** Stores and optionally focuses one read-only quick-reader comment. */
  function syncPeekCommentCursor(comment, { focus = true } = {}) {
    const peek = state.documentPeek;
    if (!peek || !comment) return false;
    peek.commentCursorIdentity = { file: peek.file, comment: commentIdentity(comment) };
    if (!focus) return true;
    const element = documentPeekLayer.querySelector(`.document-comment[data-comment-index="${Number(comment.index)}"]`);
    if (!element) return true;
    element.setAttribute("tabindex", "-1");
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
    return true;
  }

  /** Moves through the comments in the read-only quick Document, wrapping at both ends. */
  function stepPeekComment(direction) {
    const comments = state.documentPeek?.document?.comments ?? [];
    if (!comments.length) return;
    const current = peekCommentIndex();
    const next = current < 0 ? (direction < 0 ? comments.length - 1 : 0) : ((current + direction) % comments.length + comments.length) % comments.length;
    syncPeekCommentCursor(comments[next]);
  }

  /** Keeps pointer and keyboard comment movement on the same semantic comment. */
  function syncPointerComment(target, quick) {
    const element = target.closest?.(".document-comment");
    if (!element) return false;
    const comments = quick ? state.documentPeek?.document?.comments ?? [] : state.document?.comments ?? [];
    const comment = comments.find((item) => item.index === Number(element.dataset.commentIndex));
    if (!comment) return false;
    if (quick) return syncPeekCommentCursor(comment);
    return syncCommentCursor(commentIdentity(comment));
  }

  /** Clears the semantic comment cursor, then returns focus to the reading surface. */
  function clearActiveDocumentComment(quick) {
    if (quick) {
      if (state.documentPeek) state.documentPeek.commentCursorIdentity = null;
    } else {
      state.commentCursor = -1;
      state.commentCursorIdentity = null;
    }
    documentReadingSurface(quick)?.focus?.({ preventScroll: true });
  }

  /** Shows a resolve failure beside the retained note field. */
  function showResolveCommentError(message) {
    const input = modalLayer.querySelector("[data-modal-input]");
    if (!input) return;
    let error = modalLayer.querySelector(".comment-resolution-error");
    if (!error) {
      error = document.createElement("p");
      error.className = "comment-resolution-error";
      error.id = "comment-resolution-error";
      error.setAttribute("role", "alert");
      input.closest("label")?.insertAdjacentElement("afterend", error);
    }
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", error.id);
    input.focus();
  }

  /** Opens the canonical resolve flow for the current semantic comment. */
  function openResolveActiveComment() {
    const identity = activeCommentIdentity();
    if (!identity) return showToast("That comment changed or disappeared.");
    const summary = identity.text.length > 72 ? `${identity.text.slice(0, 69)}…` : identity.text;
    return openModal({
      kicker: "Resolve comment",
      title: `Resolve “${summary}”`,
      copy: "The comment is removed only after Tangent records what changed.",
      field: { label: "What changed?", placeholder: "Short change note" },
      confirmLabel: "Resolve",
      /** Runs the confirmed action and restores the transient surface owner. */
      onConfirm: async () => {
        const note = modalLayer.querySelector("[data-modal-input]")?.value ?? "";
        const result = await resolveActiveComment(identity, note);
        if (!result?.ok) {
          showResolveCommentError(result?.error || "The comment was not resolved.");
          return false;
        }
        window.setTimeout(() => {
          if (!result.focusIdentity || !focusCommentIdentity(result.focusIdentity, { scroll: true })) {
            documentReadingSurface(false)?.focus?.({ preventScroll: true });
          }
        }, 0);
        return true;
      },
    });
  }

  /**
   * The Resume button `r` presses in the full Goal reader (ADR-0042): the
   * current attempt's button when one exists, else the first one listed.
   * The quick peek has no attempt history, so it never resumes.
   */
  function readerResumeAttemptButton(quick) {
    if (quick) return null;
    const reader = screen.querySelector(".document-reader");
    if (!reader) return null;
    const buttons = [...reader.querySelectorAll("[data-resume-attempt]")];
    return buttons.find((button) => button.parentElement?.querySelector(":scope > em")) ?? buttons[0] ?? null;
  }

  /** Dispatches one pure reading command for the exact visible Document surface. */
  function handleDocumentReadingKey(event, { quick = false } = {}) {
    const surface = documentReadingSurface(quick);
    if (!surface) return false;
    const surfaceKey = quick ? "quick" : "full";
    if (!quick && !state.commentCursorIdentity && document.activeElement?.closest?.(".document-reader .document-comment")) {
      syncPointerComment(document.activeElement, false);
    }
    const activeComment = quick
      ? peekCommentIndex() >= 0 || Boolean(document.activeElement?.closest?.("#document-peek-layer .document-comment"))
      : Boolean(state.commentCursorIdentity) || Boolean(document.activeElement?.closest?.(".document-reader .document-comment"));
    const command = matchDocumentReadingCommand(event, {
      pendingChord: chords.pendingFor(`reader:${surfaceKey}`),
      commentNavigation: true,
      commentCreation: !quick,
      commentLifecycle: !quick,
      hasSelection: readingSurfaceHasSelection(surface),
      activeComment,
      resumableAttempt: Boolean(readerResumeAttemptButton(quick)),
    });
    if (!command) {
      if (chords.pendingFor(`reader:${surfaceKey}`)) clearDocumentPendingG(surfaceKey);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (command === documentReadingCommands.stageChord) {
      stageDocumentChord(surfaceKey, event.key);
      return true;
    }
    clearDocumentPendingG(surfaceKey);
    if ([
      documentReadingCommands.lineDown, documentReadingCommands.lineUp,
      documentReadingCommands.halfPageDown, documentReadingCommands.halfPageUp,
      documentReadingCommands.top, documentReadingCommands.bottom,
      documentReadingCommands.previousHeading, documentReadingCommands.nextHeading,
    ].includes(command)) {
      moveDocumentReadingSurface(surface, command);
      return true;
    }
    if (command === documentReadingCommands.historyBack) {
      (quick ? navigateDocumentPeekHistory : navigateDocumentHistory)("back");
      return true;
    }
    if (command === documentReadingCommands.historyForward) {
      (quick ? navigateDocumentPeekHistory : navigateDocumentHistory)("forward");
      return true;
    }
    if (command === documentReadingCommands.previousComment) {
      (quick ? stepPeekComment : stepComment)(-1);
      return true;
    }
    if (command === documentReadingCommands.nextComment) {
      (quick ? stepPeekComment : stepComment)(1);
      return true;
    }
    if (command === documentReadingCommands.createComment) {
      openCommentComposer();
      return true;
    }
    if (command === documentReadingCommands.editComment) {
      editActiveComment();
      return true;
    }
    if (command === documentReadingCommands.replyComment) {
      replyToActiveComment();
      return true;
    }
    if (command === documentReadingCommands.resolveComment) {
      openResolveActiveComment();
      return true;
    }
    if (command === documentReadingCommands.resumeAttempt) {
      readerResumeAttemptButton(quick)?.click();
      return true;
    }
    if (command === documentReadingCommands.copy) {
      writeReaderCopy(prepareReaderCopy(quick), quick ? "quick" : "full");
      return true;
    }
    if (command === documentReadingCommands.help) {
      openDocumentKeySheet({ quick });
      return true;
    }
    if (command === documentReadingCommands.clearSelection) {
      window.getSelection?.()?.removeAllRanges();
      if (!quick) updateSelectionCommentButton();
      return true;
    }
    if (command === documentReadingCommands.clearComment) {
      clearActiveDocumentComment(quick);
      return true;
    }
    if (command === documentReadingCommands.closeReader) {
      (quick ? closeDocumentPeek : leaveReader)();
      return true;
    }
    return false;
  }


  /**
   * Opens one Area map from a breadcrumb or an Area row. The quick Document
   * layer and the reader share this one route, so an Area always lands on the
   * same screen (design-quick-returnable-document-search 5.3).
   */
  function openAreaRoute(area) {
    areaProcessesReturnPoint = null;
    if (state.view === "document" && state.document?.file) state.mapSelectFile = state.document.file;
    state.areaSelection = area;
    state.areaHistory = false;
    localStorage.setItem("agent-shell.last-area", state.areaSelection);
    state.view = "areas";
    state.whatHappened = null;
    revealArea(state.areaSelection);
    return paint(true);
  }

  /** Opens one Area's existing process table and remembers its Work opener. */
  function openAreaProcesses(area, trigger) {
    areaProcessesReturnPoint = captureNavigationPoint(trigger);
    state.areaSelection = area;
    state.areaHistory = false;
    state.whatHappened = null;
    localStorage.setItem("agent-shell.last-area", area);
    state.view = "areas";
    revealArea(area);
    paint(true);
    window.setTimeout(() => {
      const heading = document.querySelector("#area-processes-heading") ?? document.querySelector("#area-heading");
      heading?.focus?.({ preventScroll: true });
      heading?.closest?.(".area-processes")?.scrollIntoView?.({ block: "start" });
    }, 0);
  }

  /**
   * Routes one click inside the quick Document layer. It runs before every
   * screen rule, because the layer holds the same link and heading markup as
   * the reader below it (design-quick-returnable-document-search 5.3).
   */
  function handleDocumentPeekClick(event) {
    const target = event.target;
    const copy = target.closest?.("[data-document-copy='quick']");
    if (copy) {
      const payload = copyOperations.quick.cached?.button === copy ? copyOperations.quick.cached.payload : prepareReaderCopy(true);
      copyOperations.quick.cached = null;
      return writeReaderCopy(payload, "quick");
    }
    if (target === documentPeekLayer) return closeDocumentPeek();
    if (target.closest?.("[data-close-document-peek]")) return closeDocumentPeek();
    if (target.closest?.("[data-document-keys]")) return openDocumentKeySheet({ quick: true });
    if (target.closest?.("[data-promote-document-peek]")) return promoteDocumentPeek();
    if (target.closest?.("[data-retry-document-peek]")) return retryDocumentPeek();
    const commentStep = target.closest?.("[data-document-peek-comment-step]");
    if (commentStep) return stepPeekComment(Number(commentStep.dataset.documentPeekCommentStep));
    const history = target.closest?.("[data-document-peek-history]");
    if (history) return navigateDocumentPeekHistory(history.dataset.documentPeekHistory);
    const openArea = target.closest?.("[data-open-area]");
    if (openArea) {
      const area = openArea.dataset.openArea;
      leaveQuickPath();
      return openAreaRoute(area);
    }
    const vaultLink = target.closest?.("[data-open-vault-link]");
    if (vaultLink) return openPeekLink(vaultLink.dataset.openVaultLink);
    const heading = target.closest?.("[data-document-heading]");
    if (heading) {
      event.preventDefault();
      return openPeekHeading(heading.dataset.documentHeading);
    }
    if (syncPointerComment(target, true)) return;
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (state.documentPeek && documentPeekLayer.contains(target)) return handleDocumentPeekClick(event);
    const processControl = target.closest?.("[data-control-process]");
    if (processControl) return controlProcess(processControl);
    if (state.view === "document") syncPointerComment(target, false);
    const copy = target.closest?.("[data-document-copy='full']");
    if (copy) {
      const payload = copyOperations.full.cached?.button === copy ? copyOperations.full.cached.payload : prepareReaderCopy(false);
      copyOperations.full.cached = null;
      return writeReaderCopy(payload, "full");
    }
    const cursor = target.closest?.("[data-work-cursor]");
    const areaJump = target.closest?.("[data-move-work-area]");
    if (areaJump && state.view === "work") return moveAreaCursor(Number(areaJump.dataset.moveWorkArea), cursor ?? cursorRow());
    if (cursor && state.view === "work") rememberWorkCursor(cursor);
    const workSearchButton = target.closest?.("[data-work-search]");
    if (workSearchButton) return searchBar.open();
    const workKeys = target.closest?.("[data-work-keys]");
    if (workKeys) return openWorkKeySheet();
    // The caption key line's entries run their command on the cursor row
    // (work-screen-refresh D7): the line teaches the key and takes the pointer.
    const captionCommand = target.closest?.("[data-work-caption-command]");
    if (captionCommand && state.view === "work") return executeWorkCommand(captionCommand.dataset.workCaptionCommand, cursorRow());
    const mapButton = target.closest?.("[data-open-area-map]");
    if (mapButton) return openAreaMap(mapButton.dataset.openAreaMap, mapButton);
    if (target.closest?.("[data-map-back]")) return closeAreaMap();
    const mapBreadcrumb = target.closest?.("[data-map-breadcrumb]");
    if (mapBreadcrumb) return drillAreaMap(mapBreadcrumb.dataset.mapBreadcrumb);
    if (target.closest?.("[data-map-retry]")) { state.view = "map"; paint(true); return; }
    if (target.closest?.("[data-document-keys]")) return openDocumentKeySheet({ quick: false });
    const objectActions = target.closest?.("[data-work-object-actions]");
    if (objectActions) {
      objectActions.focus?.({ preventScroll: true });
      return openObjectActions(cursor ?? cursorRow());
    }
    const captureArea = target.closest?.("[data-capture-area]");
    if (captureArea) return openAreaCapture(captureArea.dataset.captureArea || commandAreaForRow(cursor ?? cursorRow()));
    const starArea = target.closest?.("[data-star-area]");
    if (starArea) return toggleAreaStar(starArea.dataset.starArea);
    if (target.closest?.("[data-starred-only]")) return toggleStarredOnly();
    if (target.closest?.("[data-active-only]")) return toggleActiveOnly();
    if (target.closest?.("[data-cancel-area-focus]")) return cancelAreaFocusPicker();
    const stopBrain = target.closest("[data-stop-brain-area]");
    if (stopBrain) return confirmStopBrain(stopBrain.dataset.stopBrainArea, stopBrain.dataset.stopBrainAttempt);
    const areaBrain = target.closest("[data-open-area-brain]");
    if (areaBrain) {
      const point = captureNavigationPoint(areaBrain);
      if (state.launchTarget && state.launchTarget !== BRAIN_LAUNCH_TARGET) {
        launchReturnPoint = point;
        launchParentSurface = null;
      }
      const opened = openOrStartBrain(areaBrain.dataset.openAreaBrain, areaBrain);
      Promise.resolve(opened).then(() => {
        if (state.launchTarget !== BRAIN_LAUNCH_TARGET) return;
        launchReturnPoint ??= point;
        requestLaunchFocus();
      }, () => {});
      return opened;
    }
    if (target.closest("[data-rebuild-dismiss]")) {
      if (state.rebuild?.id) localStorage.setItem("agent-shell.dismissed-rebuild", state.rebuild.id);
      state.rebuild = null;
      state.rebuilding = false;
      document.querySelector("#update-panel").hidden = true;
      return;
    }
    if (target.closest("[data-rebuild-retry]")) return confirmRebuild();
    if (target.closest("[data-rebuild-start]")) return confirmRebuild({ immediate: true });
    if (target.closest("[data-rebuild-log]")) {
      const log = state.rebuild?.log || "~/.tangent/agent-shell-rebuild.log";
      await navigator.clipboard?.writeText?.(log);
      showToast(`Copied ${log}`);
      return;
    }
    // Clicks can trigger re-renders while the describe form is visible; the
    // typed description survives them only through the stored draft.
    if (state.view === "describe") syncDescribeDraft();
    if (state.launchTarget) syncLaunchDraft();
    if (!shellMenu.hidden && !target.closest?.("#shell-menu") && !backButton.contains(target)) toggleShellMenu(false);
    // A click outside the agent chooser closes it; the clicked control still runs.
    if (state.launchTarget && !target.closest?.("[data-launch-popover]") && !target.closest?.("[data-launch-for]") && !target.closest?.("[data-default-agents-area]")) {
      stopLaunchFocusRequest();
      launchReturnPoint = null;
      launchParentSurface = null;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.defaultAgents = { area: "", editing: "", mode: "" };
      paint(true);
    }
    // A click outside the What happened look closes it; the clicked control still runs.
    if (state.whatHappened && !target.closest?.("[data-what-happened]") && !target.closest?.("[data-what-happened-for]")) {
      state.whatHappened = null;
      paint(true);
    }
    const workFilter = target.closest("[data-work-filter]");
    if (workFilter) {
      state.workFilter = workFilter.dataset.workFilter;
      localStorage.setItem("agent-shell.work-filter", state.workFilter);
      return paint(true);
    }
    if (target === awakeButton || target.closest("#awake-button")) return toggleAwake();
    const reviewQuestions = target.closest("[data-review-questions]");
    if (reviewQuestions) {
      event.stopPropagation();
      return openQuestionsReview(reviewQuestions.dataset.reviewQuestions);
    }
    const goalPrompt = target.closest("[data-load-goal-prompt]");
    if (goalPrompt) return loadGoalPrompt(document.querySelector("[data-prompt-goal]")?.value ?? "", goalPrompt.dataset.loadGoalPrompt);
    if (target.closest("[data-load-brain-prompt]")) return loadBrainPrompt(document.querySelector("[data-prompt-brain]")?.value ?? "");
    if (target.closest("[data-close-prompt-preview]")) return closePromptPreview();
    const modelMode = target.closest("[data-model-mode]");
    if (modelMode) return selectModelMode(modelMode.dataset.modelMode);
    const modelConcept = target.closest("[data-model-concept]");
    if (modelConcept) return selectModelConcept(modelConcept.dataset.modelConcept);
    const lifecycle = target.closest("[data-bestiary-lifecycle]");
    if (lifecycle) return selectBestiaryLifecycle(lifecycle.dataset.bestiaryLifecycle);
    const transition = target.closest("[data-bestiary-transition]");
    if (transition) return selectBestiaryTransition(transition.dataset.bestiaryTransition);
    const goalRun = target.closest("[data-open-goal-run]");
    if (goalRun) return openGoalRun(goalRun.dataset.openGoalRun);
    const revealGoal = target.closest("[data-reveal-goal]");
    if (revealGoal) return selectGoal(revealGoal.dataset.revealGoal);
    const stopGoal = target.closest("[data-stop-goal]");
    if (stopGoal) {
      rememberGoal(stopGoal.dataset.stopGoal);
      return confirmStop();
    }
    const completeGoal = target.closest("[data-complete-goal]");
    if (completeGoal) return confirmComplete(completeGoal.dataset.completeGoal);
    const retryCleanup = target.closest("[data-retry-goal-cleanup]");
    if (retryCleanup) {
      try {
        await post("/api/goals/cleanup", { file: retryCleanup.dataset.retryGoalCleanup });
        await refresh();
        paint(true);
        showToast("The worker cleanup is complete.");
      } catch (error) {
        showToast(`Worker cleanup failed: ${error.message}`);
      }
      return;
    }
    const wontDoGoal = target.closest("[data-wont-do-goal]");
    if (wontDoGoal) {
      rememberGoal(wontDoGoal.dataset.wontDoGoal);
      return confirmWontDo();
    }
    const select = target.closest("[data-select-goal]");
    if (select) return selectGoal(select.dataset.selectGoal);
    if (target.closest("[data-show-areas]")) { areaProcessesReturnPoint = null; return showAreas(); }
    const areaToggle = target.closest("[data-toggle-area]");
    if (areaToggle) {
      const area = areaToggle.dataset.toggleArea;
      if (state.expandedAreas.has(area)) state.expandedAreas.delete(area);
      else state.expandedAreas.add(area);
      saveExpandedAreas();
      return paint(true);
    }
    const subgoalToggle = target.closest("[data-toggle-subgoals]");
    if (subgoalToggle) return toggleSubgoals(subgoalToggle.dataset.toggleSubgoals);
    const deskSectionToggle = target.closest("[data-toggle-desk-section]");
    if (deskSectionToggle) {
      const area = deskSectionToggle.dataset.toggleDeskSection;
      if (state.collapsedDeskSections.has(area)) state.collapsedDeskSections.delete(area);
      else state.collapsedDeskSections.add(area);
      localStorage.setItem("agent-shell.collapsed-desk-sections", JSON.stringify([...state.collapsedDeskSections]));
      return paint(true);
    }
    const area = target.closest("[data-select-area]");
    if (area) {
      areaProcessesReturnPoint = null;
      state.areaSelection = area.dataset.selectArea;
      localStorage.setItem("agent-shell.last-area", state.areaSelection);
      paint(true);
      return window.setTimeout(() => document.querySelector("#area-work-heading")?.focus(), 0);
    }
    const openProcesses = target.closest("[data-open-area-processes]");
    if (openProcesses) return openAreaProcesses(openProcesses.dataset.openAreaProcesses, openProcesses);
    const kindOnly = target.closest("[data-area-kind-only]");
    if (kindOnly) {
      state.areaDocumentOnly = state.areaDocumentOnly === kindOnly.dataset.areaKindOnly ? "" : kindOnly.dataset.areaKindOnly;
      state.areaDocumentExcluded.delete(kindOnly.dataset.areaKindOnly);
      return paint(true);
    }
    const kindToggle = target.closest("[data-area-kind-toggle]");
    if (kindToggle) {
      const kind = kindToggle.dataset.areaKindToggle;
      if (state.areaDocumentOnly) {
        const included = new Set([state.areaDocumentOnly]);
        if (kind === state.areaDocumentOnly) included.delete(kind);
        else included.add(kind);
        const allKinds = new Set((state.vault?.documents ?? []).filter((item) => item.kind === "document" && item.area === state.areaSelection).map((item) => item.docKind ?? "page"));
        state.areaDocumentOnly = "";
        state.areaDocumentExcluded = new Set([...allKinds].filter((item) => !included.has(item)));
      } else if (state.areaDocumentExcluded.has(kind)) state.areaDocumentExcluded.delete(kind);
      else state.areaDocumentExcluded.add(kind);
      return paint(true);
    }
    const kindExclude = target.closest("[data-area-kind-exclude]");
    if (kindExclude) {
      const kind = kindExclude.dataset.areaKindExclude;
      state.areaDocumentOnly = state.areaDocumentOnly === kind ? "" : state.areaDocumentOnly;
      if (state.areaDocumentExcluded.has(kind)) state.areaDocumentExcluded.delete(kind);
      else state.areaDocumentExcluded.add(kind);
      return paint(true);
    }
    if (target.closest("[data-area-kind-reset]")) {
      state.areaDocumentOnly = "";
      state.areaDocumentExcluded.clear();
      return paint(true);
    }
    const openArea = target.closest("[data-open-area]");
    if (openArea) return openAreaRoute(openArea.dataset.openArea);
    const openHistory = target.closest("[data-open-history]");
    if (openHistory) {
      state.areaSelection = openHistory.dataset.openHistory;
      state.areaHistory = true;
      state.view = "areas";
      state.whatHappened = null;
      revealArea(state.areaSelection);
      // History shows the Journal beside the finished Goals, so read it on
      // the way in. The paint below does not wait for it.
      loadAreaJournal(state.areaSelection);
      return paint(true);
    }
    if (target.closest("[data-close-area-history]")) { state.areaHistory = false; return paint(true); }
    if (target.closest("[data-area-work-reset]")) {
      state.areaWorkQuery = "";
      state.areaWorkScope = "";
      state.areaWorkState = "all";
      state.areaWorkLimits.set(state.areaSelection, { frontier: 12, successors: 12, boundaries: 12, successorDepth: 1 });
      return paint(true);
    }
    if (target.closest("[data-area-work-deeper]")) {
      const limits = state.areaWorkLimits.get(state.areaSelection) ?? { frontier: 12, successors: 12, boundaries: 12, successorDepth: 1 };
      limits.successorDepth += 1;
      state.areaWorkLimits.set(state.areaSelection, limits);
      return paint(true);
    }
    if (target.closest("[data-area-work-frontier]")) {
      const limits = state.areaWorkLimits.get(state.areaSelection) ?? { frontier: 12, successors: 12, boundaries: 12, successorDepth: 1 };
      limits.successorDepth = 1;
      state.areaWorkLimits.set(state.areaSelection, limits);
      return paint(true);
    }
    const moreWork = target.closest("[data-area-work-more]");
    if (moreWork) {
      const limits = state.areaWorkLimits.get(state.areaSelection) ?? { frontier: 12, successors: 12, boundaries: 12, successorDepth: 1 };
      limits[moreWork.dataset.areaWorkMore] += 12;
      state.areaWorkLimits.set(state.areaSelection, limits);
      return paint(true);
    }
    const markAreaDone = target.closest("[data-mark-area-done]");
    if (markAreaDone) return setAreaStatus(markAreaDone.dataset.markAreaDone, "done");
    const archiveArea = target.closest("[data-archive-area]");
    if (archiveArea) return setAreaStatus(archiveArea.dataset.archiveArea, "archived");
    const reopenArea = target.closest("[data-reopen-area]");
    if (reopenArea) return setAreaStatus(reopenArea.dataset.reopenArea, "active");
    if (target.closest("[data-toggle-done-areas]")) {
      state.showDoneAreas = !state.showDoneAreas;
      localStorage.setItem("agent-shell.show-done-areas", state.showDoneAreas ? "1" : "0");
      return paint(true);
    }
    if (target.closest("[data-new-area]")) return beginAreaCreate();
    if (target.closest("[data-rename-area]")) return beginAreaMove();
    if (target.closest("[data-cancel-area-edit]")) return showAreas();
    if (target.closest("[data-confirm-area-move]")) return confirmAreaMove();
    const program = target.closest("[data-select-program]");
    if (program) return selectProgram(program.dataset.selectProgram);
    if (target.closest("[data-new-program]")) return showProgramCreate();
    if (target.closest("[data-cancel-program-create]")) return showAreasAt(state.programDraft.area);
    if (target.closest("[data-open-program-session]")) return openProgramSession();
    if (target.closest("[data-back-program]")) {
      state.view = "program-detail";
      return paint(true);
    }
    const programAction = target.closest("[data-program-action]");
    if (programAction) return controlProgram(programAction.dataset.programAction, programAction.dataset.programId || state.programId);
    const workDefinition = target.closest("[data-select-work-definition]");
    if (workDefinition) return openDescribeSession(workDefinition.dataset.selectWorkDefinition);
    const describeArea = target.closest("[data-describe-area]");
    if (describeArea) return showDescribe({ area: describeArea.dataset.describeArea });
    if (target.closest("[data-describe-work]")) return showDescribe();
    if (target.closest("[data-cancel-describe]")) return cancelDescribe();
    const removeSource = target.closest("[data-remove-describe-source]");
    if (removeSource && state.describeDraft) {
      state.describeDraft.sources = (state.describeDraft.sources ?? []).filter((source) => source.file !== removeSource.dataset.removeDescribeSource);
      saveDescribeDraft();
      return paint(true);
    }
    if (target.closest("[data-save-idea]")) return saveVisibleIdea();
    if (target.closest("[data-notify-document-comments]")) return notifyDocumentComments();
    const vaultLink = target.closest("[data-open-vault-link]");
    if (vaultLink) return openVaultLink(vaultLink.dataset.openVaultLink);
    const documentHeading = target.closest("[data-document-heading]");
    if (documentHeading) {
      event.preventDefault();
      return openDocumentHeading(documentHeading.dataset.documentHeading);
    }
    const documentButton = target.closest("[data-open-document]");
    if (documentButton) {
      const presentation = documentButton.closest("[data-presentation-goal], [data-presentation-area]");
      if (presentation) return openDocumentPeek(documentButton.dataset.openDocument, { origin: documentButton, presentation });
      return openDocument(documentButton.dataset.openDocument);
    }
    const cardAction = target.closest("[data-card-action]");
    if (cardAction) return runCardAction(cardAction.closest("[data-card-id]"));
    const cardGoal = target.closest("[data-card-goal-open]");
    if (cardGoal) { const row = cardGoal.closest("[data-card-goal]"); return openDocument(row.dataset.cardGoal, { heading: "presented" }); }
    const cardDismiss = target.closest("[data-card-dismiss]");
    if (cardDismiss) return dismissCard(cardDismiss.closest("[data-card-id]"));
    const presentationFull = target.closest("[data-presentation-full]");
    if (presentationFull) return openDocument(presentationFull.dataset.presentationFull, { presentation: presentationFull.closest("[data-presentation-goal], [data-presentation-area]") });
    const withdrawPresentation = target.closest("[data-withdraw-presentation]");
    if (withdrawPresentation) {
      const row = withdrawPresentation.closest("[data-presentation-goal], [data-presentation-area]");
      return dismissPresentedDocument(row, withdrawPresentation.dataset.withdrawPresentation);
    }
    const readerGoalActions = target.closest("[data-reader-goal-actions]");
    if (readerGoalActions) return openReaderGoalActions(readerGoalActions);
    const closeRow = target.closest("[data-open-close]");
    if (closeRow) {
      const file = closeRow.dataset.openClose;
      if (!goalByFile(file)) return showToast("The Goal file was removed from the vault.");
      return openDocument(file);
    }
    const documentHistory = target.closest("[data-document-history]");
    if (documentHistory) return navigateDocumentHistory(documentHistory.dataset.documentHistory);
    if (target.closest("[data-leave-document]")) return leaveCurrentSurface();
    if (target.closest("[data-open-reader-agent]")) return openReaderAgent();
    const resumeAttempt = target.closest("[data-resume-attempt]");
    if (resumeAttempt) return resumeGoalAttempt(resumeAttempt.dataset.resumeGoal, resumeAttempt.dataset.resumeAttempt, resumeAttempt.dataset.resumeConversation ?? "");
    if (target.closest("[data-comment-new]")) return openCommentComposer();
    const commentStep = target.closest("[data-comment-step]");
    if (commentStep) return stepComment(Number(commentStep.dataset.commentStep));
    const commentScope = target.closest("[data-comment-scope]");
    if (commentScope) return setCommentScope(commentScope.dataset.commentScope);
    if (target.closest("[data-cancel-comment]")) return cancelCommentComposer();
    const editCommentButton = target.closest("[data-edit-comment]");
    if (editCommentButton) return editActiveComment();
    const replyCommentButton = target.closest("[data-reply-comment]");
    if (replyCommentButton) return replyToActiveComment();
    if (target.closest("[data-resolve-comment]")) return openResolveActiveComment();
    if (target.closest("[data-open-goal-agent]")) return openGoalAgent({ returnView: "work" });
    if (target.closest("[data-launch-change]")) {
      state.launch.open = true;
      return paint(true);
    }
    const verdictRow = target.closest("[data-verdict-line]");
    if (verdictRow) {
      event.stopPropagation();
      return sendVerdict(verdictRow.dataset.verdictArea, verdictRow.dataset.verdictLine, verdictRow.dataset.verdict, "", verdictRow.dataset.effectRevision);
    }
    const workTree = target.closest("[data-work-tree-action]");
    if (workTree) return executeWorkCommand(workTree.dataset.workTreeAction, cursor ?? cursorRow());
    const requestRow = target.closest("[data-open-request-id]");
    if (requestRow) return openRequest(requestRow.dataset.openRequestArea, requestRow.dataset.openRequestId);
    const replyRow = target.closest("[data-reply-subject]");
    if (replyRow) {
      event.stopPropagation();
      return replyAboutRow(replyRow.dataset.replyArea, replyRow.dataset.replySession, replyRow.dataset.replySubject);
    }
    const openBrain = target.closest("[data-open-brain]");
    if (openBrain) return openBrainSession(openBrain.dataset.openBrain);
    const openSession = target.closest("[data-open-session]");
    if (openSession) {
      state.agentSessionName = openSession.dataset.openSession;
      const goal = rememberGoal(openSession.dataset.openSessionGoal);
      if (!goal) return;
      const session = state.sessions.find((item) => item.name === state.agentSessionName);
      return session ? openSessionLayer(session, "agent") : showToast("This session is not live.");
    }
    const pipelineControl = target.closest("[data-pipeline-control]");
    if (pipelineControl) {
      const { pipelineControl: action, pipelineGoal: goalFile, pipelineStep: step } = pipelineControl.dataset;
      return controlGoalPipeline(goalFile, action, step);
    }
    const whatHappenedFor = target.closest("[data-what-happened-for]");
    if (whatHappenedFor) {
      const area = whatHappenedFor.dataset.whatHappenedFor;
      if (state.whatHappened?.area === area) {
        state.whatHappened = null;
        return paint(true);
      }
      const rect = whatHappenedFor.getBoundingClientRect();
      state.launchTarget = "";
      state.launchAnchor = null;
      state.whatHappened = { area, anchor: { top: Math.round(rect.bottom + 8), right: Math.round(rect.right) } };
      return paint(true);
    }
    const launchFor = target.closest("[data-launch-for]");
    if (launchFor) {
      const file = launchFor.dataset.launchFor;
      if (file === BRAIN_LAUNCH_TARGET) {
        if (state.launchTarget && state.launchTarget !== BRAIN_LAUNCH_TARGET) {
          launchReturnPoint = captureNavigationPoint(launchFor);
          launchParentSurface = null;
        } else rememberLaunchReturn(launchFor);
        const result = toggleBrainPopover(launchFor);
        if (state.launchTarget === BRAIN_LAUNCH_TARGET) requestLaunchFocus();
        else {
          const point = launchReturnPoint;
          launchReturnPoint = null;
          stopLaunchFocusRequest();
          restoreNavigationPoint(point);
        }
        return result;
      }
      const describing = file === DESCRIBE_LAUNCH_TARGET;
      if (!describing) return;
      if (state.launchTarget === file) {
        return dismissLaunchSurface();
      }
      launchReturnPoint = captureNavigationPoint(launchFor);
      launchParentSurface = null;
      stopLaunchFocusRequest();
      const rect = launchFor.getBoundingClientRect();
      state.launchTarget = file;
      state.launchAnchor = { top: Math.round(rect.bottom + 8), above: Math.round(rect.top - 8), right: Math.round(rect.right) };
      launchOptionsFor(describeLaunchArea());
      state.launch.open = false;
      paint(true);
      requestLaunchFocus();
      return;
    }
    const defaultAgents = target.closest("[data-default-agents-area]");
    if (defaultAgents) {
      const nestedBrain = state.launchTarget === BRAIN_LAUNCH_TARGET && Boolean(defaultAgents.closest("[data-launch-popover]"));
      if (nestedBrain) {
        launchParentSurface = {
          target: BRAIN_LAUNCH_TARGET,
          anchor: state.launchAnchor,
          brainDraft: { ...state.brainDraft },
          choice: state.launch.choice ? { ...state.launch.choice } : null,
          command: state.launch.command,
          editing: state.launch.editing,
        };
      } else {
        launchParentSurface = null;
        launchReturnPoint = captureNavigationPoint(defaultAgents);
      }
      const result = toggleDefaultAgents(defaultAgents);
      if (state.launchTarget === DEFAULT_AGENTS_TARGET) requestLaunchFocus(nestedBrain ? "default:brain" : "summary");
      else {
        const point = launchReturnPoint;
        launchReturnPoint = null;
        stopLaunchFocusRequest();
        restoreNavigationPoint(point);
      }
      return result;
    }
    if (target.closest("[data-launch-close]")) return dismissLaunchSurface();
    const defaultAgentEdit = target.closest("[data-default-agent-edit]");
    if (defaultAgentEdit) {
      editDefaultAgent(defaultAgentEdit.dataset.defaultAgentEdit);
      requestLaunchFocus("choices");
      return;
    }
    const defaultAgentMode = target.closest("[data-default-agent-mode]");
    if (defaultAgentMode) return setDefaultAgentMode(defaultAgentMode.dataset.defaultAgentKind, defaultAgentMode.dataset.defaultAgentMode);
    if (target.closest("[data-default-agents-cancel]")) {
      return cancelLaunchEditStage();
    }
    const launchHarness = target.closest("[data-launch-harness]");
    if (launchHarness) {
      const harness = (state.launch.options?.harnesses ?? []).find((entry) => entry.id === launchHarness.dataset.launchHarness);
      if (harness) state.launch.choice = { harness: harness.id, model: harness.models?.[0]?.id ?? null, effort: null };
      state.launch.command = "";
      state.launch.editing = false;
      return paint(true);
    }
    const launchModel = target.closest("[data-launch-model]");
    if (launchModel) {
      const selection = launchSelection();
      if (selection?.harness) state.launch.choice = { harness: selection.harness.id, model: launchModel.dataset.launchModel, effort: selection.effort?.id ?? null };
      state.launch.command = "";
      state.launch.editing = false;
      return paint(true);
    }
    const launchEffort = target.closest("[data-launch-effort]");
    if (launchEffort) {
      const selection = launchSelection();
      if (selection?.harness) state.launch.choice = { harness: selection.harness.id, model: selection.model?.id ?? null, effort: selection.effort?.id === launchEffort.dataset.launchEffort ? null : launchEffort.dataset.launchEffort };
      state.launch.command = "";
      state.launch.editing = false;
      return paint(true);
    }
    if (target.closest("[data-launch-edit]")) {
      const selection = launchSelection();
      state.launch.editing = true;
      if (!state.launch.command) state.launch.command = selection?.command ?? "";
      paint(true);
      return window.setTimeout(() => document.querySelector("#launch-command-input")?.focus(), 0);
    }
    if (target.closest("[data-launch-reset]")) {
      state.launch.command = "";
      state.launch.editing = false;
      return paint(true);
    }
    if (target.closest("[data-brain-start-over]")) return startBrain({ resume: false });
    if (target.closest("[data-launch-start]")) {
      syncLaunchDraft();
      const targetFile = state.launchTarget;
      if (targetFile === BRAIN_LAUNCH_TARGET) {
        const brain = brainForAreaCard(state.brainDraft?.area);
        return startBrain({ resume: Boolean(brain && !brain.live) });
      }
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      stopLaunchFocusRequest();
      launchReturnPoint = null;
      launchParentSurface = null;
      if (targetFile === DESCRIBE_LAUNCH_TARGET) return document.querySelector("[data-describe-work-form]")?.requestSubmit();
      if (targetFile) rememberGoal(targetFile);
      return openGoalAgent({ returnView: "work" });
    }
    if (target.closest("[data-launch-save]")) {
      const kind = state.defaultAgents.editing;
      await saveLaunchDefault();
      requestLaunchFocus(kind ? `default:${kind}` : "summary");
      return;
    }
    if (target.closest("[data-open-harnesses]")) {
      harnessReturnPoint = launchReturnPoint ?? captureNavigationPoint(target);
      launchReturnPoint = null;
      launchParentSurface = null;
      stopLaunchFocusRequest();
      return showHarnessEditor();
    }
    if (target.closest("[data-add-harness]") && state.harnessDraft) {
      state.harnessDraft.harnesses = [...(state.harnessDraft.harnesses ?? []), { id: "", label: "", command: "" }];
      return paint(true);
    }
    const removeHarness = target.closest("[data-remove-harness]");
    if (removeHarness && state.harnessDraft) {
      state.harnessDraft.harnesses.splice(Number(removeHarness.dataset.removeHarness), 1);
      return paint(true);
    }
    const addModel = target.closest("[data-add-model]");
    if (addModel && state.harnessDraft) {
      state.harnessDraft.modelSets[addModel.dataset.addModel].push({ id: "", label: "", args: "" });
      return paint(true);
    }
    const removeModel = target.closest("[data-remove-model]");
    if (removeModel && state.harnessDraft) {
      state.harnessDraft.modelSets[removeModel.dataset.set].splice(Number(removeModel.dataset.index), 1);
      return paint(true);
    }
    if (target.closest("[data-add-set]") && state.harnessDraft) {
      const name = document.querySelector("#new-set-name")?.value.trim();
      if (!name) return showToast("Name the model set first.");
      if (state.harnessDraft.modelSets?.[name]) return showToast(`The set "${name}" already exists.`);
      state.harnessDraft.modelSets = { ...(state.harnessDraft.modelSets ?? {}), [name]: [] };
      return paint(true);
    }
    const addEffort = target.closest("[data-add-effort]");
    if (addEffort && state.harnessDraft) {
      state.harnessDraft.effortSets[addEffort.dataset.addEffort].push({ id: "", label: "", args: "" });
      return paint(true);
    }
    const removeEffort = target.closest("[data-remove-effort]");
    if (removeEffort && state.harnessDraft) {
      state.harnessDraft.effortSets[removeEffort.dataset.set].splice(Number(removeEffort.dataset.index), 1);
      return paint(true);
    }
    if (target.closest("[data-add-effort-set]") && state.harnessDraft) {
      const name = document.querySelector("#new-effort-set-name")?.value.trim();
      if (!name) return showToast("Name the effort set first.");
      if (state.harnessDraft.effortSets?.[name]) return showToast(`The set "${name}" already exists.`);
      state.harnessDraft.effortSets = { ...(state.harnessDraft.effortSets ?? {}), [name]: [] };
      return paint(true);
    }
    if (target.closest("[data-save-harnesses]")) {
      const point = harnessReturnPoint;
      await saveHarnesses();
      if (state.view !== "harnesses") {
        harnessReturnPoint = null;
        restoreNavigationPoint(point);
      }
      return;
    }
    if (target.closest("[data-leave-harnesses]")) {
      const point = harnessReturnPoint;
      harnessReturnPoint = null;
      leaveHarnessEditor();
      return restoreNavigationPoint(point);
    }
    if (target.closest("[data-cancel-harnesses]")) {
      const point = harnessReturnPoint;
      harnessReturnPoint = null;
      leaveHarnessEditor({ discard: true });
      return restoreNavigationPoint(point);
    }
    if (target.closest("[data-open-agent]")) {
      const session = sessionForGoal(currentGoal());
      return session ? openSessionLayer(session, "agent") : showToast("This session is not live.");
    }
    if (target.closest("[data-toggle-awake]")) return toggleAwake();
    if (target.closest("[data-stop-agent]")) return confirmStop();
    if (target.closest("[data-keep-working]")) {
      const session = sessionForGoal(currentGoal());
      return session ? openSessionLayer(session, "agent") : showToast("This session is not live.");
    }
    if (target.closest("[data-finish-run]")) {
      const goal = currentGoal();
      if (!goal) return;
      try {
        await post("/api/goals/accept", { file: goal.file });
        state.view = "work";
        await refresh();
        paint(true);
        showToast("The agent run ended. The goal stays open.");
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (target.closest("[data-mark-complete]")) return confirmComplete();
    if (target.closest("[data-mark-wont-do]")) return confirmWontDo();
    if (target.closest("[data-reopen-goal]")) {
      const goal = currentGoal();
      if (!goal) return;
      try {
        await post("/api/goals/edit", { file: goal.file, status: "open" });
        await refresh();
        paint(true);
        showToast("The goal is open again.");
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const modalAction = target.closest("[data-modal-action]");
    if (modalAction) {
      const reason = modalAction.dataset.disabledReason;
      if (modalAction.getAttribute("aria-disabled") === "true") return showToast(reason || "This action is not available.");
      return invokeModalChoice(modalAction.dataset.modalAction);
    }
    if (target.closest("[data-modal-cancel]")) return closeModal();
    if (target.closest("[data-modal-confirm]")) return invokeModalChoice();
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.matches("[data-area-journal-form]")) {
      event.preventDefault();
      const form = event.target;
      const text = new FormData(form).get("text")?.toString().trim() || "";
      if (!text) return;
      try {
        const idempotencyKey = form.dataset.journalIdempotencyKey || crypto.randomUUID();
        form.dataset.journalIdempotencyKey = idempotencyKey;
        const saved = await post("/api/areas/journal", { area: state.areaSelection, text, idempotencyKey, source: "Agent Shell" });
        showToast(journalCaptureToast(saved));
        if (journalCaptureNeedsRetry(saved)) return;
        delete form.dataset.journalIdempotencyKey;
        state.areaJournal = null;
        form.reset();
        await refresh();
      } catch (error) { showToast(error.message); }
      return;
    }
    if (event.target.matches("[data-area-focus-form]")) {
      event.preventDefault();
      return applyAreaFocus();
    }
    if (event.target.matches("[data-comment-composer]")) {
      event.preventDefault();
      return submitCommentComposer();
    }
    if (event.target.matches("[data-area-form]")) {
      event.preventDefault();
      const edit = state.areaEdit;
      if (!edit) return;
      const fields = new FormData(event.target);
      edit.parent = fields.get("parent")?.toString() || "";
      edit.name = fields.get("name")?.toString().trim() || "";
      edit.preview = null;
      if (!edit.parent || !edit.name) return showToast("Choose where this Area belongs and add a name.");
      try {
        if (edit.kind === "new") {
          const created = await post("/api/areas/new", { parent: edit.parent, name: edit.name });
          state.areaSelection = created.area;
          localStorage.setItem("agent-shell.last-area", created.area);
          state.areaEdit = null;
          await refresh();
          state.view = "areas";
          paint(true);
          showToast("The area exists. No work or agent started.");
        } else {
          edit.preview = await post("/api/areas/preview-move", { area: edit.area, parent: edit.parent, name: edit.name });
          paint(true);
        }
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (event.target.matches("[data-program-form]")) {
      event.preventDefault();
      const fields = new FormData(event.target);
      const body = {
        type: fields.get("type")?.toString() || "process",
        area: fields.get("area")?.toString() || "",
        name: fields.get("name")?.toString().trim() || "",
        command: fields.get("command")?.toString().trim() || "",
        time: fields.get("time")?.toString() || "",
        cwd: fields.get("cwd")?.toString().trim() || "",
        model: fields.get("model")?.toString().trim() || "sonnet",
        prompt: fields.get("prompt")?.toString().trim() || "",
      };
      try {
        const created = await post("/api/operations/new", body);
        localStorage.setItem("agent-shell.last-area", body.area);
        await refresh();
        state.programId = created.id;
        state.view = "program-detail";
        paint(true);
        showToast("The program is saved. Nothing started.");
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    if (event.target.matches("[data-describe-work-form]")) {
      event.preventDefault();
      const fields = new FormData(event.target);
      const area = fields.get("area")?.toString() || "";
      const description = fields.get("description")?.toString().trim() || "";
      if (!area || !description) {
        showToast("Choose an Area and describe the work.");
        return;
      }
      const submitButton = event.target.querySelector("button[type='submit']");
      submitButton.disabled = true;
      submitButton.textContent = "Opening the agent…";
      try {
        const sources = state.describeDraft?.sources ?? [];
        const opened = await post("/api/work/describe", { area, description, sources });
        state.describeSessionName = opened.session;
        state.describeDraft = null;
        localStorage.setItem("agent-shell.last-area", area);
        saveDescribeSession();
        saveDescribeDraft();
        await refresh();
        const session = describeWorkSession();
        if (!session) throw new Error("The agent session did not open.");
        showWork();
        openSessionLayer(session, opened.route?.startsWith("brain-") ? "brain" : "definition");
        const messages = {
          "brain-opened": "Your message reached the Area brain.",
          "brain-resumed": "Your message woke the Area brain.",
          "brain-started": "Your message started the Area brain.",
        };
        showToast(messages[opened.route] ?? messages["brain-opened"]);
      } catch (error) {
        submitButton.disabled = false;
        paint(true);
        showToast(error.message);
      }
      return;
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches?.("[data-launch-path]")) {
      state.launch.assignmentPath = event.target.value;
      return;
    }
    if (event.target.id === "area-focus-search") {
      return updateAreaFocusQuery(event.target.value, event.target.selectionStart);
    }
    if (event.target.id === "comment-text" && state.commentComposer) {
      state.commentComposer.text = event.target.value;
      return;
    }
    if (event.target.id === "launch-command-input") {
      state.launch.command = event.target.value;
      return;
    }
    if (event.target.id === "launch-instruction") {
      state.launch.instruction = event.target.value;
      return;
    }
    const harnessField = event.target.closest?.("[data-harness-field]");
    if (harnessField && state.harnessDraft) {
      state.harnessDraft.harnesses[Number(harnessField.dataset.index)][harnessField.dataset.harnessField] = harnessField.value;
      return;
    }
    const modelField = event.target.closest?.("[data-model-field]");
    if (modelField && state.harnessDraft) {
      state.harnessDraft.modelSets[modelField.dataset.set][Number(modelField.dataset.index)][modelField.dataset.modelField] = modelField.value;
      return;
    }
    const effortField = event.target.closest?.("[data-effort-field]");
    if (effortField && state.harnessDraft) {
      state.harnessDraft.effortSets[effortField.dataset.set][Number(effortField.dataset.index)][effortField.dataset.effortField] = effortField.value;
      return;
    }
    if (event.target.closest?.("[data-area-form]") && state.areaEdit) {
      if (event.target.name === "parent" || event.target.name === "name") state.areaEdit[event.target.name] = event.target.value;
      state.areaEdit.preview = null;
      return;
    }
    if (event.target.matches?.("[data-program-draft]")) {
      const field = event.target.dataset.programDraft;
      const previousArea = state.programDraft.area;
      state.programDraft[field] = event.target.value;
      if (field === "area" && (!state.programDraft.cwd || state.programDraft.cwd === programAreaDirectory(previousArea))) {
        state.programDraft.cwd = programAreaDirectory(event.target.value);
      }
      if (field === "type") paint(true);
      return;
    }
    if (["describe-area", "describe-work"].includes(event.target.id)) {
      const area = document.querySelector("#describe-area")?.value || preferredArea();
      const description = document.querySelector("#describe-work")?.value || "";
      state.describeDraft = { area, description, sources: state.describeDraft?.sources ?? [] };
      saveDescribeDraft();
      return;
    }
    if (["area-search", "area-document-search", "area-work-search"].includes(event.target.id)) {
      const id = event.target.id;
      const cursor = event.target.selectionStart;
      if (id === "area-search") state.areaQuery = event.target.value;
      else if (id === "area-document-search") state.areaDocumentQuery = event.target.value;
      else state.areaWorkQuery = event.target.value;
      if (id === "area-search" && state.areaQuery.trim()) {
        const query = state.areaQuery.trim().toLowerCase();
        for (const area of state.vault?.areas ?? []) {
          if (!`${area.name} ${area.path}`.toLowerCase().includes(query)) continue;
          const parts = area.path.split("/");
          for (let count = 1; count < parts.length; count += 1) state.expandedAreas.add(parts.slice(0, count).join("/"));
        }
        saveExpandedAreas();
      }
      paint(true);
      const input = document.querySelector(`#${id}`);
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
      return;
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches("[data-area-focus-path]")) {
      return toggleAreaFocusDraft(event.target.dataset.areaFocusPath, event.target.checked);
    }
    if (event.target.id === "area-work-scope") { state.areaWorkScope = event.target.value; return paint(true); }
    if (event.target.id === "area-work-state") { state.areaWorkState = event.target.value; return paint(true); }
    if (event.target.id === "area-document-period" || event.target.id === "area-document-order") {
      if (event.target.id === "area-document-period") state.areaDocumentPeriod = event.target.value;
      else state.areaDocumentOrder = event.target.value;
      paint(true);
      return;
    }
    if (event.target.matches?.("select[data-launch-continue]")) {
      state.launch.continueFrom = event.target.value || null;
      return;
    }
    if (event.target.matches?.("select[data-launch-kind]")) {
      state.launch.assignmentKind = event.target.value === "review" ? "review" : "implementation";
      return;
    }
    if (event.target.matches?.("select[data-harness-field]") && state.harnessDraft) {
      state.harnessDraft.harnesses[Number(event.target.dataset.index)][event.target.dataset.harnessField] = event.target.value;
      return;
    }
  });

  backButton.addEventListener("click", async () => {
    if (closeNearestOpenDetails()) return;
    if (state.view === "areas" && areaProcessesReturnPoint) return leaveCurrentSurface();
    if (["work", "areas", "prompts"].includes(state.view)) return toggleShellMenu();
    return leaveCurrentSurface();
  });

  goToButton.innerHTML = `Go to ${shortcutKbd("goTo")}`;
  goToButton.addEventListener("click", openGoTo);

  goToInput.addEventListener("input", () => {
    if (!state.goTo) return;
    state.goTo.query = goToInput.value;
    state.goTo.selected = 0;
    renderGoToList();
  });

  goToLayer.addEventListener("keydown", (event) => {
    if (!state.goTo) return;
    if (keyboardEventIsComposing(event)) return;
    const rows = state.goTo.rows;
    const focusedRow = event.target.closest?.("[data-go-to-row]");
    const resultsOwnKeys = event.target === goToInput || Boolean(focusedRow);
    /** Keeps the finder's keys inside the layer, away from the global handler. */
    const own = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const goToMotion = resolveMotion(event, { textOwned: true });
    if (resultsOwnKeys && goToMotion === motions.next) {
      state.goTo.selected = Math.min(state.goTo.selected + 1, Math.max(rows.length - 1, 0));
      renderGoToList();
      if (focusedRow) goToLayer.querySelector(`[data-go-to-row="${state.goTo.selected}"]`)?.focus();
      return own();
    }
    if (resultsOwnKeys && goToMotion === motions.previous) {
      state.goTo.selected = Math.max(state.goTo.selected - 1, 0);
      renderGoToList();
      if (focusedRow) goToLayer.querySelector(`[data-go-to-row="${state.goTo.selected}"]`)?.focus();
      return own();
    }
    if (resultsOwnKeys && event.key === "Enter") {
      own();
      const index = focusedRow ? Number(focusedRow.dataset.goToRow) : state.goTo.selected;
      return chooseGoToRow(rows[index]);
    }
    if (event.key === "Escape" || shortcutMatches(event, KEYMAP.goTo)) {
      own();
      return closeGoTo();
    }
  });

  goToLayer.addEventListener("focusin", (event) => {
    const row = event.target.closest?.("[data-go-to-row]");
    if (state.goTo && row) state.goTo.selected = Number(row.dataset.goToRow);
  });

  goToLayer.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === goToLayer) return closeGoTo();
    if (event.target.closest?.("[data-close-go-to]")) return closeGoTo();
    const row = event.target.closest?.("[data-go-to-row]");
    if (row) return chooseGoToRow(state.goTo?.rows[Number(row.dataset.goToRow)]);
  });

  for (const id of ["go-to-area", "go-to-kind"]) document.querySelector(`#${id}`).addEventListener("change", (event) => {
    if (!state.goTo) return;
    state.goTo[id === "go-to-area" ? "area" : "kind"] = event.target.value;
    state.goTo.selected = 0;
    renderGoToList();
  });
  document.querySelector("#go-to-view").addEventListener("click", (event) => {
    if (!state.goTo) return;
    state.goTo.view = state.goTo.view === "list" ? "graph" : "list";
    event.currentTarget.textContent = state.goTo.view === "list" ? "Graph" : "List";
    event.currentTarget.setAttribute("aria-pressed", String(state.goTo.view === "graph"));
    state.goTo.selected = 0;
    renderGoToList();
  });

  workTab.addEventListener("click", () => { areaProcessesReturnPoint = null; showWork(); });
  areasTab.addEventListener("click", () => { areaProcessesReturnPoint = null; showAreas(); });
  promptsTab.addEventListener("click", () => { areaProcessesReturnPoint = null; showPrompts(); });

  findButton.addEventListener("click", () => {
    if (findButton.dataset.action === "next-step") {
      return showDecision("agent");
    }
    showWork();
    searchBar.open();
  });

  secondaryAction.addEventListener("click", () => confirmStop({ immediate: true }));

  shellMenu.addEventListener("click", async (event) => {
    const item = event.target.closest("button");
    if (!item) return;
    toggleShellMenu(false);
    if (item.id === "menu-refresh") {
      await refresh();
      paint(true);
      showToast("Agent Shell data is current.");
      return;
    }
    if (item.id === "menu-reload") return location.reload();
    if (item.id === "menu-update") return reloadChanges();
    if (item.id === "menu-rebuild") return confirmRebuild();
    if (item.id === "menu-awake") return toggleAwake();
  });

  modalLayer.addEventListener("click", (event) => {
    if (event.target === modalLayer) closeModal();
  });

  document.querySelector("#session-layer").addEventListener("click", async (event) => {
    const copy = event.target.closest?.("[data-copy-session-tag]");
    if (copy) {
      const tag = copy.dataset.copySessionTag;
      const feedback = copy.querySelector(".session-tag-feedback");
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(tag);
        feedback.textContent = "Copied";
        copy.dataset.copyState = "success";
        showToast(`Copied ${tag}`);
      } catch {
        feedback.textContent = "Could not copy";
        copy.dataset.copyState = "failure";
        showToast(`Could not copy ${tag}`);
      }
      window.setTimeout(() => {
        if (!copy.isConnected) return;
        feedback.textContent = "";
        delete copy.dataset.copyState;
      }, 1800);
      return;
    }
    if (event.target === event.currentTarget || event.target.closest?.("[data-close-session-layer]")) closeSessionLayer();
  });

  /**
   * Keeps Tab inside one open layer. The surfaces below a dialog are marked
   * inert, but the trap must not depend on that: focus must never move behind
   * the visible top layer (design-quick-returnable-document-search 5.1).
   */
  function trapTabInside(layer, stopSelector, isTop) {
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || !isTop()) return;
      const stops = [...layer.querySelectorAll(stopSelector)];
      if (!stops.length) return;
      const first = stops[0];
      const last = stops.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !layer.contains(active))) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  // Tab stays inside the quick Document layer while it is the top surface.
  trapTabInside(documentPeekLayer, 'button:not([disabled]), a[href], [tabindex="-1"].document-peek-surface', () => Boolean(state.documentPeek) && !state.goTo);

  // The finder is the top layer whenever it is open, including above a quick
  // Document. Tab and Shift-Tab stay on its own controls, so no focus reaches
  // the Document or the screen behind it.
  trapTabInside(goToLayer, 'input, select, button:not([disabled]), [data-go-to-row][tabindex="0"]', () => Boolean(state.goTo));

  // A confirmation is a real modal: focus cycles only through its controls
  // until it closes and restores the opener.
  trapTabInside(modalLayer, 'input, textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', () => !modalLayer.hidden);

  /** Returns the one visible surface that may interpret this event. */
  function keyboardContext(event) {
    const target = event.target;
    return resolveKeyboardContext({
      modal: !modalLayer.hidden,
      goTo: Boolean(state.goTo),
      documentPeek: Boolean(state.documentPeek),
      session: Boolean(state.sessionPeek) || Boolean(target.closest?.(".terminal-host")),
      focusPicker: Boolean(state.areaFocusPicker),
      transient: !shellMenu.hidden || Boolean(state.launchTarget) || Boolean(state.whatHappened) || Boolean(state.commentComposer),
      textEntry: Boolean(target.closest?.("input, textarea, select, [contenteditable='true']")),
      view: state.view,
    });
  }

  /**
   * Moves the Work cursor for one Vim motion (design agent-shell-keymap 5.1).
   * Arrows, Home, End, PageUp, and PageDown are synonyms through the same
   * resolver, so click, arrow, and letter all move the one cursor.
   */
  function handleWorkMotion(event, rows, current) {
    const motion = resolveMotion(event, { textOwned: false, pendingChord: chords.pendingFor("work"), pendingCount: chords.countFor("work") });
    if (!motion) { chords.clear("work"); return false; }
    event.preventDefault();
    if (motion === motions.chordStart) { chords.stage("work", event.key); return true; }
    if (motion === motions.countDigit) { chords.stageCount("work", event.key); return true; }
    const count = Number(chords.countFor("work")) || 0;
    chords.clear("work");
    const index = rows.indexOf(current);
    const pageRows = Math.max(1, Math.floor(screen.clientHeight / Math.max(1, current?.offsetHeight || 40) / 2));
    const target = countedRowIndex(motion, { index, count, length: rows.length, pageRows });
    if (target !== null) return setWorkCursor(rows[target]);
    if (motion === motions.sectionNext || motion === motions.sectionPrevious) {
      let moved = current;
      for (let step = 0; step < Math.max(1, count); step += 1) {
        moveAreaCursor(motion === motions.sectionNext ? 1 : -1, moved);
        moved = cursorRow();
      }
      return true;
    }
    if (motion === motions.parent) return executeWorkCommand("collapse", current);
    if (motion === motions.child) return executeWorkCommand("expand", current);
    return true;
  }

  /** Runs one shell-wide shortcut, after the owning context permits it. */
  function handleGlobalShortcut(event) {
    if (shortcutMatches(event, KEYMAP.goTo)) {
      event.preventDefault();
      openGoTo();
      return true;
    }
    if (shortcutMatches(event, KEYMAP.session)) {
      event.preventDefault();
      if (state.sessionPeek) closeSessionLayer();
      else if (state.view === "work") enterCursorSession();
      else if (state.view === "document") openReaderAgent();
      else showToast("Return to Work to choose a session.");
      return true;
    }
    if (shortcutMatches(event, KEYMAP.findWork)) {
      event.preventDefault();
      if (state.sessionPeek) closeSessionLayer();
      showWork();
      searchBar.open();
      return true;
    }
    return false;
  }

  /**
   * Submits a form that advertises Command-Enter without stealing plain Enter
   * or Command-Shift-Enter, which enters and leaves the live session.
   */
  function handleCommandEnter(event) {
    if (event.key !== "Enter" || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    const form = event.target.closest?.("[data-command-enter-submit]");
    if (!form && state.view === "harnesses") {
      event.preventDefault();
      screen.querySelector("[data-save-harnesses]")?.click();
      return true;
    }
    if (!form) return false;
    event.preventDefault();
    form.requestSubmit();
    return true;
  }

  const transientDetails = [
    "details.desk-action-menu[open]",
    "details.document-outline-menu[open]",
    "details.document-picker[open]",
    "details.reader-brain-actions[open]",
    "details.area-more[open]",
  ].join(", ");

  /** Closes the nearest native disclosure before Back leaves its parent screen. */
  function closeNearestOpenDetails(target = document.activeElement) {
    const local = target?.closest?.("details[open]");
    const root = state.documentPeek ? documentPeekLayer : screen;
    const fallback = [...root.querySelectorAll(transientDetails)].at(-1);
    const details = local && root.contains(local) ? local : fallback;
    if (!details) return false;
    details.open = false;
    details.querySelector(":scope > summary")?.focus?.({ preventScroll: true });
    return true;
  }

  /** Closes the one visible transient surface and leaves lower Work state intact. */
  function closeTransientSurface() {
    if (!shellMenu.hidden) {
      toggleShellMenu(false);
      return true;
    }
    if (state.commentComposer) {
      cancelCommentComposer();
      return true;
    }
    if (state.launchTarget) {
      if (state.view === "describe") syncDescribeDraft();
      if (cancelLaunchEditStage()) return true;
      return dismissLaunchSurface();
    }
    if (state.whatHappened) {
      state.whatHappened = null;
      paint(true);
      return true;
    }
    return false;
  }

  /**
   * Unwinds Work one visible stage at a time. The order is deliberate: a
   * temporary surface, staged Focus, search, active-only, applied Focus,
   * and finally the Work tab.
   */
  function unwindWork() {
    chords.clear("work");
    if (closeTransientSurface()) return;
    if (state.areaFocusPicker) return cancelAreaFocusPicker();
    if (searchBar.clear()) return;
    if (state.activeOnly) return toggleActiveOnly();
    if (state.areaFocusOnly) return toggleStarredOnly();
    if (state.areaFocus.length) return clearAreaFocus();
    workTab.focus();
  }

  /**
   * Leaves one browser-managed screen. Pointer Back and keyboard Escape call
   * this same router, so adding a view cannot create two different parents.
   * The terminal never calls it: Escape remains a native tmux key there.
   */
  function leaveCurrentSurface() {
    if (closeNearestOpenDetails()) return true;
    if (state.view === "work") {
      unwindWork();
      return true;
    }
    if (state.view === "harnesses") {
      const point = harnessReturnPoint;
      harnessReturnPoint = null;
      leaveHarnessEditor();
      restoreNavigationPoint(point);
      return true;
    }
    if (state.view === "area-edit") {
      showAreas();
      return true;
    }
    if (state.view === "program-detail") {
      showAreasAt(currentProgram()?.area);
      return true;
    }
    if (state.view === "program-create") {
      showAreasAt(state.programDraft.area);
      return true;
    }
    if (state.view === "program-session") {
      state.view = "program-detail";
      paint(true);
      return true;
    }
    if (state.view === "describe" || state.view === "describe-agent") {
      cancelDescribe();
      return true;
    }
    if (state.view === "agent") {
      leaveGoalAgent();
      return true;
    }
    if (state.view === "document") {
      leaveReader();
      return true;
    }
    if (state.view === "areas" && areaProcessesReturnPoint) {
      const point = areaProcessesReturnPoint;
      areaProcessesReturnPoint = null;
      state.view = point.view;
      paint(true);
      restoreNavigationPoint(point);
      return true;
    }
    if (state.view === "decision") {
      state.view = state.decisionReturnView;
      state.renderedKey = "";
      paint(true);
      return true;
    }
    return false;
  }

  /** Owns native navigation and staged Escape for the Area search fields. */
  function handleAreaSearchKey(event) {
    const queryById = {
      "area-search": "areaQuery",
      "area-work-search": "areaWorkQuery",
      "area-document-search": "areaDocumentQuery",
    };
    const queryKey = queryById[event.target.id];
    if (!queryKey) return false;
    if (event.key === "Escape" && state[queryKey]) {
      event.preventDefault();
      state[queryKey] = "";
      paint(true);
      window.setTimeout(() => document.querySelector(`#${event.target.id}`)?.focus(), 0);
      return true;
    }
    if (event.target.id !== "area-search") return false;
    const rows = [...screen.querySelectorAll("[data-select-area]")];
    const selected = rows.findIndex((row) => row.dataset.selectArea === state.areaSelection);
    const listMotion = resolveMotion(event, { textOwned: true });
    if ((listMotion === motions.next || listMotion === motions.previous) && rows.length) {
      event.preventDefault();
      const next = listMotion === motions.next ? Math.min(rows.length - 1, selected + 1) : Math.max(0, selected < 0 ? 0 : selected - 1);
      rows[next].focus();
      return true;
    }
    if (event.key === "Enter" && rows.length) {
      event.preventDefault();
      rows[Math.max(0, selected)]?.click();
      return true;
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    // A composition belongs to the focused editor or terminal. No Agent Shell
    // shortcut may reinterpret its provisional key value.
    if (keyboardEventIsComposing(event)) return;
    const context = keyboardContext(event);

    if (context === "modal") {
      const focusedAction = event.target.closest?.("button:not([disabled]), a[href]");
      const actionButtons = [...modalLayer.querySelectorAll("[data-modal-action]")];
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
      } else if (actionButtons.length && !event.metaKey && !event.ctrlKey && !event.altKey && ["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const current = actionButtons.indexOf(event.target.closest?.("[data-modal-action]"));
        const delta = ["j", "ArrowDown"].includes(event.key) ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : actionButtons.length - 1) : Math.max(0, Math.min(actionButtons.length - 1, current + delta));
        actionButtons[next]?.focus({ preventScroll: true });
      } else if (actionButtons.length && !event.metaKey && !event.ctrlKey && !event.altKey && actionButtons.some((button) => button.dataset.modalKey === event.key)) {
        event.preventDefault();
        event.stopPropagation();
        actionButtons.find((button) => button.dataset.modalKey === event.key)?.click();
      } else if (actionButtons.length && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        (event.target.closest?.("[data-modal-action]") ?? actionButtons[0])?.click();
      } else if (handleKeySheetScroll(event)) {
        return;
      } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !modalLayer.querySelector("[data-modal-input], [data-modal-select]")) {
        event.preventDefault();
        event.stopPropagation();
        (focusedAction && modalLayer.contains(focusedAction)
          ? focusedAction
          : modalLayer.querySelector("[data-modal-confirm]"))?.click();
      } else if (event.key === "Enter" && event.metaKey && event.target.closest?.("[data-modal-input], [data-modal-select]")) {
        event.preventDefault();
        event.stopPropagation();
        modalLayer.querySelector("[data-modal-confirm]")?.click();
      } else if ([KEYMAP.goTo, KEYMAP.session, KEYMAP.findWork].some((binding) => shortcutMatches(event, binding))) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    // The finder owns its own Arrow, Enter, Escape, and Command-K handler.
    if (context === "go-to") return;
    if (context === "document-peek") {
      if (shortcutMatches(event, KEYMAP.goTo)) return void handleGlobalShortcut(event);
      if (handleDocumentReadingKey(event, { quick: true })) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDocumentPeek();
      } else if (shortcutMatches(event, KEYMAP.session) || shortcutMatches(event, KEYMAP.findWork)) {
        event.preventDefault();
      }
      return;
    }
    // The terminal/tmux session receives every key except the visible
    // Command-Shift-Enter leave action. This handler runs in capture so xterm never sees
    // that one shell command first.
    if (context === "session") {
      if (shortcutMatches(event, KEYMAP.session) && state.sessionPeek) {
        event.preventDefault();
        event.stopPropagation();
        closeSessionLayer();
      }
      return;
    }
    if (context === "focus-picker") {
      if (shortcutMatches(event, KEYMAP.goTo)) return void handleGlobalShortcut(event);
      if (shortcutMatches(event, KEYMAP.session) || shortcutMatches(event, KEYMAP.findWork)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        unwindWork();
      }
      return;
    }
    if (context === "transient") {
      if (shortcutMatches(event, KEYMAP.goTo)) return void handleGlobalShortcut(event);
      if (shortcutMatches(event, KEYMAP.session) || shortcutMatches(event, KEYMAP.findWork)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (handleLaunchPopoverKey(event)) return;
      if (handleCommandEnter(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeTransientSurface();
      }
      return;
    }
    if (context === "text-entry") {
      if (searchBar.handleInputKey(event)) return void event.stopPropagation();
      if (handleAreaSearchKey(event)) return;
      if (handleGlobalShortcut(event)) return;
      if (handleCommandEnter(event)) return;
      if (event.key === "Escape") {
        if (state.view === "map") return;
        event.preventDefault();
        leaveCurrentSurface();
      }
      return;
    }
    if (handleGlobalShortcut(event)) return;
    if (handleCommandEnter(event)) return;
    if (state.view === "map" && event.key === "Escape") {
      // Excalidraw owns Escape while its surface has a tool or selection. The
      // editor island calls closeAreaMap only after both are clear.
      if (event.target.closest?.("[data-tangent-area-map]")) return;
      event.preventDefault();
      return closeAreaMap();
    }
    if (context === "work" && event.key === "Escape") {
      event.preventDefault();
      return leaveCurrentSurface();
    }
    if (context === "work" && !event.metaKey && !event.altKey) {
      const rows = visibleCursorRows();
      const current = cursorRow();
      const commandArea = commandAreaForRow(current);
      if (handleWorkMotion(event, rows, current)) return;
      if (current?.dataset.presentationFile && workCommandMatches(event, "fullDocument")) {
        event.preventDefault();
        return executeWorkCommand("fullDocument", current);
      }
      if (current?.dataset.presentationFile && workCommandMatches(event, "dismissPresentation")) {
        event.preventDefault();
        return executeWorkCommand("dismissPresentation", current);
      }
      if (current?.dataset.cardId && workCommandMatches(event, "readGoalPresented")) {
        event.preventDefault();
        return executeWorkCommand("readGoalPresented", current);
      }
      if (current?.dataset.cardId && workCommandMatches(event, "dismissCard")) {
        event.preventDefault();
        return executeWorkCommand("dismissCard", current);
      }
      if (workCommandMatches(event, "stopAgent")) {
        event.preventDefault();
        return executeWorkCommand("stopAgent", current);
      }
      if (workCommandMatches(event, "defaults")) {
        event.preventDefault();
        return executeWorkCommand("defaults", current);
      }
      if (workCommandMatches(event, "messageBrain")) {
        event.preventDefault();
        return executeWorkCommand("messageBrain", current);
      }
      if (workCommandMatches(event, "collapse") || workCommandMatches(event, "expand")) {
        event.preventDefault();
        return executeWorkCommand(workCommandMatches(event, "collapse") ? "collapse" : "expand", current);
      }
      if (workCommandMatches(event, "questions")) {
        event.preventDefault();
        // One key, two objects: `r` on a Goal row resumes its agent, on an
        // Area header it reviews the brain's questions.
        return executeWorkCommand(current?.dataset.goalAnchor ? "resumeAttempt" : "questions", current);
      }
      if (workCommandMatches(event, "starArea")) { event.preventDefault(); return executeWorkCommand("starArea", current); }
      if (workCommandMatches(event, "map")) { event.preventDefault(); return executeWorkCommand("map", current); }
      if (workCommandMatches(event, "starredOnly")) { event.preventDefault(); return executeWorkCommand("starredOnly", current); }
      if (workCommandMatches(event, "activeOnly")) { event.preventDefault(); return executeWorkCommand("activeOnly", current); }
      if (workCommandMatches(event, "readGoal")) {
        event.preventDefault();
        return executeWorkCommand("readGoal", current);
      }
      if (workCommandMatches(event, "changeAgent")) {
        event.preventDefault();
        return executeWorkCommand("changeAgent", current);
      }
      if (workCommandMatches(event, "goalStatus")) { event.preventDefault(); return executeWorkCommand("goalStatus", current); }
      if (workCommandMatches(event, "search")) { event.preventDefault(); return executeWorkCommand("search", current); }
      if (state.searchPattern && workCommandMatches(event, "nextMatch")) { event.preventDefault(); return executeWorkCommand("nextMatch", current); }
      if (state.searchPattern && workCommandMatches(event, "previousMatch")) { event.preventDefault(); return executeWorkCommand("previousMatch", current); }
      if (workCommandMatches(event, "open") && !event.shiftKey && enterOwnsWorkRow(event.target, current)) {
        event.preventDefault();
        return executeWorkCommand("open", current);
      }
      if (workCommandMatches(event, "keys")) {
        event.preventDefault();
        return openWorkKeySheet(current);
      }
    }
    if (context === "document" && event.key === "Escape" && closeNearestOpenDetails(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (context === "document" && handleDocumentReadingKey(event)) return;
    if (context === "document" && event.metaKey && event.altKey && !event.shiftKey && !event.ctrlKey) {
      if (event.code === "KeyM") {
        event.preventDefault();
        return openCommentComposer();
      }
    }
    if (event.key === "Escape" && context === "document") {
      event.preventDefault();
      return leaveReader();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      return leaveCurrentSurface();
    }
  }, { capture: true });

  window.addEventListener("resize", () => {
    try { terminalFit(); } catch {}
  });

  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.("[data-document-copy]");
    if (!button) return;
    const name = button.dataset.documentCopy;
    copyOperations[name].cached = { button, payload: prepareReaderCopy(name === "quick") };
  }, { capture: true });

  // The native copy event is the synchronous, permission-free clean-copy path.
  document.addEventListener("copy", (event) => {
    const surface = visibleCopySurface();
    if (!surface || !event.clipboardData) return;
    const payload = readerCopyPayload({ quick: surface.quick, whole: false });
    if (!payload) return;
    try {
      event.clipboardData.setData("text/html", payload.html);
      event.clipboardData.setData("text/plain", payload.markdown);
    } catch {
      return;
    }
    event.preventDefault();
    showCopyFeedback(surface.name, "Copied selection");
  }, { capture: true });

  document.addEventListener("selectionchange", () => {
    if (state.view === "document") updateSelectionCommentButton();
    for (const name of ["full", "quick"]) if (!copyOperations[name].timer) resetCopyLabel(name);
  });

  return { paintWorkSearch: searchBar.paintBar };
}
