/** Binds browser events through capability-owned feature ports. */
export function bindShellEvents({ shell, chrome, prompts, work, areas, programs, launch, documents }) {
  const { state, post, paint, refresh, showToast } = shell;
  const {
    screen, backButton, workTab, areasTab, promptsTab, findButton, secondaryAction, shellMenu, goToButton, goToLayer,
    goToInput, modalLayer, terminalFit, KEYMAP, shortcutMatches, shortcutKbd, toggleShellMenu, confirmRebuild,
    reloadChanges, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWork, showAreas, showPrompts, showDecision,
    showCreate, showDescribe, toggleAwake, openModal, closeModal, modalConfirm, restoreReturnPoint, openSessionLayer, closeSessionLayer,
  } = chrome;
  const {
    loadGoalPrompt, loadBrainPrompt, closePromptPreview, selectBestiaryLifecycle, selectBestiaryTransition,
    selectModelMode, selectModelConcept,
  } = prompts;
  const {
    selectGoal, rememberGoal, openGoalRun, goalByFile, currentGoal, sessionForGoal, startBrain, brainForAreaCard,
    openBrainSession, openOrStartBrain, toggleBrainPopover, saveDescribeDraft, saveDescribeSession, describeWorkSession,
    openDescribeSession, addDescribeSource, switchDescribeToManualCreate, selectionForArea, startSelectedGoals,
    openGoalAgent, launchOpenSession, confirmStop, confirmComplete, confirmWontDo, enableDockBadge, openRequest, sendVerdict, dismissAsk,
    replyAboutRow, openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery,
    applyAreaFocus, clearAreaFocus, renderWork, describeLaunchArea, describeWorkSessions,
    goalGroupRoot, toggleSubgoals,
  } = work;
  const {
    showAreasAt, beginAreaCreate, beginAreaMove, confirmAreaMove, cancelCreate, cancelDescribe, areaIsFolded,
    saveExpandedAreas, revealArea, setAreaStatus, preferredArea, areaLabel,
  } = areas;
  const {
    showProgramCreate, selectProgram, openProgramSession, controlProgram, performProgramAction, currentProgram,
    programAreaDirectory,
  } = programs;
  const {
    syncDescribeDraft, launchSelection, launchRequestFields, syncLaunchDraft, activateLaunchStep, removeLaunchStep,
    addLaunchStep, launchIsPipeline, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, saveHarnesses, startPipeline,
    savePipelineStep, appendPipelineSteps, launchOptionsFor, pipelineRecordForGoal, loadLaunchStep,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  } = launch;
  const {
    openDocument, navigateDocumentHistory, openVaultLink, openDocumentHeading, openCommentComposer, setCommentScope,
    editComment, cancelCommentComposer, submitCommentComposer, removeComment, stepComment, saveVisibleIdea,
    notifyDocumentComments, refreshDocument, leaveReader, updateSelectionCommentButton, openReaderAgent,
  } = documents;
  const awakeButton = document.querySelector("#awake-button");

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

  /**
   * Says how many Goals the filter left, through the one live region that
   * outlives the repaint. A filter that empties the table takes the focused row
   * with it; focus is already back in the filter input, so the count is the
   * only fact a screen reader would otherwise lose
   * (design-redesign-work-as-a-compact-table, "Polls and stable focus").
   */
  function announceWorkCount() {
    const region = document.querySelector("#filter-count");
    if (!region) return;
    const count = document.querySelector(".work-table .work-caption-count")?.textContent
      ?? document.querySelector(".work-page .empty-state")?.textContent
      ?? "";
    region.textContent = count.trim();
  }

  /** Stores and paints one cursor row, then optionally gives its control focus. */
  function setWorkCursor(row, focus = true) {
    if (!row?.dataset.workCursor) return false;
    state.workCursor = row.dataset.workCursor;
    localStorage.setItem("agent-shell.work-cursor", state.workCursor);
    paint(true);
    if (focus) window.setTimeout(() => [...document.querySelectorAll("[data-work-cursor]")].find((item) => item.dataset.workCursor === state.workCursor)?.querySelector("[data-work-row-title], [data-work-cursor-control]")?.focus(), 0);
    return true;
  }

  /** Returns the visible rows that participate in Work cursor movement. */
  function visibleCursorRows(selector = "[data-work-cursor]") {
    return [...screen.querySelectorAll(selector)].filter((row) => !row.hidden);
  }

  /** Resolves the stored cursor, with the first visible row as its fallback. */
  function cursorRow() {
    return visibleCursorRows().find((row) => row.dataset.workCursor === state.workCursor) ?? visibleCursorRows()[0] ?? null;
  }

  /** Opens the live session owned by the cursor row without starting work. */
  function enterCursorSession() {
    const row = cursorRow();
    if (!row) return showToast("There is no Work row to enter.");
    setWorkCursor(row, false);
    const value = row.dataset.workCursor;
    if (value.startsWith("goal:")) {
      const session = sessionForGoal(rememberGoal(value.slice(5)));
      return session ? openSessionLayer(session, "agent") : showToast("This Goal has no live session to enter.");
    }
    if (value.startsWith("definition:")) {
      const session = describeWorkSessions().find((item) => item.name === value.slice(11));
      return session ? openSessionLayer(session, "definition") : showToast("This row has no live session to enter.");
    }
    const brain = brainForAreaCard(row.dataset.workArea);
    const session = state.sessions.find((item) => item.name === brain?.session && brain?.live);
    return session ? openSessionLayer(session, "brain") : showToast("This Area has no live brain to enter.");
  }

  /** Lets the shared modal close its informational key sheet. */
  function closeKeySheet() { return true; }

  /**
   * Arrow, Home, and End move between the Goal titles of the table the focused
   * title belongs to. Enter and Space keep their native button behavior, so the
   * table needs no ARIA grid and still works when this handler does not run
   * (design-redesign-work-as-a-compact-table Decision 9).
   */
  function moveBetweenWorkRows(event) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    const title = event.target.closest?.("[data-work-row-title]");
    if (!title) return false;
    const table = title.closest("table");
    if (!table) return false;
    const titles = [...table.querySelectorAll("[data-work-row-title]")].filter((button) => !button.closest("tr[hidden]"));
    if (titles.length < 2) return false;
    const index = titles.indexOf(title);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? titles.length - 1
      : event.key === "ArrowDown" ? Math.min(titles.length - 1, index + 1)
      : Math.max(0, index - 1);
    if (next === index) {
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    titles[next].focus();
    return true;
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    const cursor = target.closest?.("[data-work-cursor]");
    if (cursor && state.view === "work") setWorkCursor(cursor, false);
    if (target.closest?.("[data-open-area-focus], [data-change-area-focus]")) return openAreaFocusPicker();
    if (target.closest?.("[data-cancel-area-focus]")) return cancelAreaFocusPicker();
    if (target.closest?.("[data-clear-area-focus]")) return clearAreaFocus();
    const areaBrain = target.closest("[data-open-area-brain]");
    if (areaBrain) return openOrStartBrain(areaBrain.dataset.openAreaBrain, areaBrain);
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
      state.launchTarget = "";
      state.launchAnchor = null;
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
    if (target.closest("[data-enable-dock-badge]")) return enableDockBadge();
    const dismissAskButton = target.closest("[data-dismiss-ask]");
    if (dismissAskButton) {
      event.stopPropagation();
      return dismissAsk(dismissAskButton.dataset.dismissAsk);
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
    if (completeGoal) {
      const file = completeGoal.dataset.completeGoal;
      rememberGoal(file);
      try {
        await post("/api/goals/edit", { file, status: "done" });
        await refresh();
        paint(true);
        showToast("The work is complete.");
      } catch (error) {
        showToast(`Could not complete the Goal: ${error.message}`);
      }
      return;
    }
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
    if (target.closest("[data-show-areas]")) return showAreas();
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
      state.areaSelection = area.dataset.selectArea;
      localStorage.setItem("agent-shell.last-area", state.areaSelection);
      paint(true);
      return window.setTimeout(() => document.querySelector("#area-work-heading")?.focus(), 0);
    }
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
    if (openArea) {
      if (state.view === "document" && state.document?.file) state.mapSelectFile = state.document.file;
      state.areaSelection = openArea.dataset.openArea;
      state.areaHistory = false;
      localStorage.setItem("agent-shell.last-area", state.areaSelection);
      state.view = "areas";
      state.whatHappened = null;
      revealArea(state.areaSelection);
      return paint(true);
    }
    const openHistory = target.closest("[data-open-history]");
    if (openHistory) {
      state.areaSelection = openHistory.dataset.openHistory;
      state.areaHistory = true;
      state.view = "areas";
      state.whatHappened = null;
      revealArea(state.areaSelection);
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
    const checkGoal = target.closest("[data-check-goal]");
    if (checkGoal) {
      const file = checkGoal.dataset.checkGoal;
      if (state.goalSelection.includes(file)) {
        state.goalSelection = state.goalSelection.filter((item) => item !== file);
        return paint(true);
      }
      // One agent owns one brain-owned Area group. Checking a Goal in another
      // group replaces the selection and says so, instead of silently starting
      // an agent across two groups (design-redesign-work-as-a-compact-table).
      const group = goalGroupRoot(file);
      const foreign = state.goalSelection.filter((item) => goalGroupRoot(item) !== group);
      if (foreign.length) {
        state.goalSelection = [file];
        showToast(`Selection moved to ${areaLabel(group)}. ${foreign.length} ${foreign.length === 1 ? "Goal" : "Goals"} in another group cleared.`);
        return paint(true);
      }
      state.goalSelection = [...state.goalSelection, file];
      return paint(true);
    }
    const startSelected = target.closest("[data-start-selected]");
    if (startSelected) return startSelectedGoals(startSelected.dataset.startSelected);
    if (target.closest("[data-clear-selection]")) {
      state.goalSelection = [];
      return paint(true);
    }
    if (target.closest("[data-create-manually]")) return switchDescribeToManualCreate();
    if (target.closest("[data-cancel-create]")) return cancelCreate();
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
    if (documentButton) return openDocument(documentButton.dataset.openDocument);
    const closeRow = target.closest("[data-open-close]");
    if (closeRow) {
      const file = closeRow.dataset.openClose;
      if (!goalByFile(file)) return showToast("The Goal file was removed from the vault.");
      return openDocument(file);
    }
    const documentHistory = target.closest("[data-document-history]");
    if (documentHistory) return navigateDocumentHistory(documentHistory.dataset.documentHistory);
    if (target.closest("[data-open-reader-agent]")) return openReaderAgent();
    if (target.closest("[data-comment-new]")) return openCommentComposer();
    const commentStep = target.closest("[data-comment-step]");
    if (commentStep) return stepComment(Number(commentStep.dataset.commentStep));
    const commentScope = target.closest("[data-comment-scope]");
    if (commentScope) return setCommentScope(commentScope.dataset.commentScope);
    if (target.closest("[data-cancel-comment]")) return cancelCommentComposer();
    const editCommentButton = target.closest("[data-edit-comment]");
    if (editCommentButton) return editComment(Number(editCommentButton.dataset.editComment));
    const removeCommentButton = target.closest("[data-remove-comment]");
    if (removeCommentButton) return removeComment(Number(removeCommentButton.dataset.removeComment));
    if (target.closest("[data-open-goal-agent]")) return openGoalAgent({ returnView: "work" });
    if (target.closest("[data-launch-change]")) {
      state.launch.open = true;
      return paint(true);
    }
    const verdictRow = target.closest("[data-verdict-line]");
    if (verdictRow) {
      event.stopPropagation();
      return sendVerdict(verdictRow.dataset.verdictArea, verdictRow.dataset.verdictLine, verdictRow.dataset.verdict);
    }
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
      try {
        const result = await post("/api/pipelines/control", { goal: goalFile, action, step: Number(step) });
        await refresh();
        paint(true);
        showToast(result.next ? `Step ${result.next.index} started.` : action === "skip" ? `Step ${step} skipped; the pipeline is complete.` : action === "end" ? "Work stopped. The Goal stays open." : `Step ${step} ${action}ed.`);
      } catch (error) {
        showToast(error.message);
      }
      return;
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
      if (file === BRAIN_LAUNCH_TARGET) return toggleBrainPopover(launchFor);
      const describing = file === DESCRIBE_LAUNCH_TARGET;
      const goal = describing ? null : goalByFile(file);
      if (!describing && !goal) return;
      if (state.launchTarget === file) {
        state.launchTarget = "";
        state.launchAnchor = null;
        return paint(true);
      }
      launchOptionsFor(describing ? describeLaunchArea() : goal.area);
      const record = describing ? null : pipelineRecordForGoal(goal);
      if (record) {
        // Record mode: history stays, the first pending step is up for edits,
        // and when nothing is pending a draft row waits to be appended.
        state.launch.record = record;
        const firstPending = record.steps.findIndex((step) => step.status === "pending");
        const steps = record.steps.map((step) => ({ choice: step.launch, command: step.launch ? "" : step.command, instruction: step.instruction, continueFrom: step.continueFrom }));
        if (firstPending < 0) steps.push({ choice: null, command: "", instruction: "", continueFrom: null });
        state.launch.steps = steps;
        loadLaunchStep(steps, firstPending >= 0 ? firstPending : steps.length - 1);
      } else if (state.launch.record || (state.launchTarget && state.launchTarget !== file)) {
        state.launch.record = null;
        state.launch.steps = [];
        state.launch.active = 0;
        state.launch.choice = null;
        state.launch.command = "";
        state.launch.instruction = "";
        state.launch.continueFrom = null;
      }
      const rect = launchFor.getBoundingClientRect();
      state.launchTarget = file;
      state.launchAnchor = { top: Math.round(rect.bottom + 8), right: Math.round(rect.right) };
      state.launch.open = false;
      return paint(true);
    }
    const defaultAgents = target.closest("[data-default-agents-area]");
    if (defaultAgents) return toggleDefaultAgents(defaultAgents);
    if (target.closest("[data-launch-close]")) {
      state.launch.open = false;
      state.launch.editing = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      state.defaultAgents = { area: "", editing: "", mode: "" };
      return paint(true);
    }
    const defaultAgentEdit = target.closest("[data-default-agent-edit]");
    if (defaultAgentEdit) return editDefaultAgent(defaultAgentEdit.dataset.defaultAgentEdit);
    const defaultAgentMode = target.closest("[data-default-agent-mode]");
    if (defaultAgentMode) return setDefaultAgentMode(defaultAgentMode.dataset.defaultAgentKind, defaultAgentMode.dataset.defaultAgentMode);
    if (target.closest("[data-default-agents-cancel]")) {
      state.defaultAgents = { ...state.defaultAgents, editing: "", mode: "" };
      state.launch.choice = null;
      return paint(true);
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
    const launchStepSelect = target.closest("[data-launch-step-select]");
    if (launchStepSelect) {
      activateLaunchStep(Number(launchStepSelect.dataset.launchStepSelect));
      return paint(true);
    }
    const launchStepRemove = target.closest("[data-launch-step-remove]");
    if (launchStepRemove) {
      removeLaunchStep(Number(launchStepRemove.dataset.launchStepRemove));
      return paint(true);
    }
    if (target.closest("[data-launch-step-add]")) {
      addLaunchStep();
      paint(true);
      return window.setTimeout(() => document.querySelector("#launch-instruction")?.focus(), 0);
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
      if (targetFile !== DESCRIBE_LAUNCH_TARGET && state.launch.record) {
        return state.launch.active < state.launch.record.steps.length ? savePipelineStep(targetFile) : appendPipelineSteps(targetFile);
      }
      if (targetFile !== DESCRIBE_LAUNCH_TARGET && launchIsPipeline()) return startPipeline(targetFile);
      state.launch.open = false;
      state.launchTarget = "";
      state.launchAnchor = null;
      if (targetFile === DESCRIBE_LAUNCH_TARGET) return document.querySelector("[data-describe-work-form]")?.requestSubmit();
      const targetGoal = targetFile ? goalByFile(targetFile) : null;
      if (targetGoal && selectionForArea(targetGoal.area)[0] === targetFile) return startSelectedGoals(targetGoal.area);
      if (targetFile) rememberGoal(targetFile);
      return openGoalAgent({ returnView: "work" });
    }
    if (target.closest("[data-launch-save]")) return saveLaunchDefault();
    if (target.closest("[data-open-harnesses]")) return showHarnessEditor();
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
    if (target.closest("[data-save-harnesses]")) return saveHarnesses();
    if (target.closest("[data-cancel-harnesses]")) {
      state.harnessDraft = null;
      state.view = state.harnessReturnView;
      return paint(true);
    }
    if (target.closest("[data-launch-open-session]")) return launchOpenSession();
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
    if (target.closest("[data-modal-cancel]")) return closeModal();
    if (target.closest("[data-modal-confirm]")) {
      const action = modalConfirm();
      if (!action) return;
      try {
        const result = await action();
        if (result !== false) closeModal();
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  document.addEventListener("submit", async (event) => {
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
        const created = await post("/api/programs/new", body);
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
    if (event.target.matches("[data-create-form]")) {
      event.preventDefault();
      const fields = new FormData(event.target);
      const area = fields.get("area")?.toString() || "";
      const title = fields.get("title")?.toString().trim() || "";
      const doneWhen = fields.get("doneWhen")?.toString().trim() || "";
      const startingPoint = fields.get("state")?.toString().trim() || "";
      if (!area || !title || !doneWhen) {
        showToast("Choose an Area, add a name, and state what done looks like.");
        return;
      }
      try {
        const created = await post("/api/goals/new", { area, title, doneWhen, state: startingPoint });
        localStorage.setItem("agent-shell.last-area", area);
        await refresh();
        selectGoal(created.file);
        showToast("The goal is ready. No agent started.");
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
        const opened = await post("/api/work/describe", {
          area,
          description,
          sources,
          launch: true,
          ...launchRequestFields(true),
        });
        state.describeSessionName = opened.session;
        state.describeDraft = null;
        localStorage.setItem("agent-shell.last-area", area);
        saveDescribeSession();
        saveDescribeDraft();
        await refresh();
        if (!describeWorkSession()) throw new Error("The agent session did not open.");
        openSessionLayer(describeWorkSession(), opened.route?.startsWith("brain-") ? "brain" : "definition");
        const messages = {
          "brain-opened": "Your description reached the Area brain.",
          "brain-resumed": "Your description reached the resumed Area brain.",
          "brain-started": "Your description reached the restarted Area brain.",
          "work-definition-opened": "The agent opened with the Area, your description, and the selected Documents.",
        };
        showToast(messages[opened.route] ?? messages["work-definition-opened"]);
      } catch (error) {
        submitButton.disabled = false;
        paint(true);
        showToast(error.message);
      }
      return;
    }
  });

  document.addEventListener("input", (event) => {
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
    if (event.target.id !== "work-search") return;
    state.query = event.target.value;
    const cursor = event.target.selectionStart;
    screen.innerHTML = renderWork();
    const input = document.querySelector("#work-search");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
    announceWorkCount();
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches("[data-area-focus-path]")) {
      return toggleAreaFocusDraft(event.target.dataset.areaFocusPath, event.target.checked);
    }
    if (event.target.matches("#new-goal-area")) {
      state.createArea = event.target.value || "";
      return paint(true);
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
      state.launch.continueFrom = event.target.value ? Number(event.target.value) : null;
      return;
    }
    if (event.target.matches?.("select[data-harness-field]") && state.harnessDraft) {
      state.harnessDraft.harnesses[Number(event.target.dataset.index)][event.target.dataset.harnessField] = event.target.value;
      return;
    }
  });

  backButton.addEventListener("click", async () => {
    if (["work", "areas", "prompts"].includes(state.view)) return toggleShellMenu();
    if (state.view === "area-edit") return showAreas();
    if (state.view === "program-detail") return showAreasAt(currentProgram()?.area);
    if (state.view === "program-create") return showAreasAt(state.programDraft.area);
    if (state.view === "program-session") {
      state.view = "program-detail";
      return paint(true);
    }
    if (state.view === "create") return cancelCreate();
    if (state.view === "describe" || state.view === "describe-agent") return cancelDescribe();
    if (state.view === "agent") {
      return leaveGoalAgent();
    }
    if (state.view === "document") return leaveReader();
    if (state.view === "decision") {
      state.view = state.decisionReturnView;
      state.renderedKey = "";
      paint(true);
    }
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
    const rows = state.goTo.rows;
    /** Keeps the finder's keys inside the layer, away from the global handler. */
    const own = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown") {
      state.goTo.selected = Math.min(state.goTo.selected + 1, Math.max(rows.length - 1, 0));
      renderGoToList();
      return own();
    }
    if (event.key === "ArrowUp") {
      state.goTo.selected = Math.max(state.goTo.selected - 1, 0);
      renderGoToList();
      return own();
    }
    if (event.key === "Enter") {
      own();
      return chooseGoToRow(rows[state.goTo.selected]);
    }
    if (event.key === "Escape" || shortcutMatches(event, KEYMAP.goTo)) {
      own();
      return closeGoTo();
    }
  });

  goToLayer.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === goToLayer) return closeGoTo();
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

  workTab.addEventListener("click", showWork);
  areasTab.addEventListener("click", showAreas);
  promptsTab.addEventListener("click", showPrompts);

  findButton.addEventListener("click", () => {
    if (findButton.dataset.action === "next-step") {
      return showDecision("agent");
    }
    showWork({ focus: true });
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

  document.querySelector("#session-layer").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest?.("[data-close-session-layer]")) closeSessionLayer();
  });

  document.addEventListener("keydown", (event) => {
    if (shortcutMatches(event, KEYMAP.session)) {
      event.preventDefault();
      return state.sessionPeek ? closeSessionLayer() : state.view === "work" ? enterCursorSession() : showToast("Return to Work to choose a session.");
    }
    if (event.key === "Escape" && state.areaFocusPicker) {
      event.preventDefault();
      return cancelAreaFocusPicker();
    }
    if (event.target.id === "area-search") {
      const rows = [...screen.querySelectorAll("[data-select-area]")];
      const selected = rows.findIndex((row) => row.dataset.selectArea === state.areaSelection);
      if (event.key === "Escape" && state.areaQuery) {
        event.preventDefault();
        state.areaQuery = "";
        paint(true);
        return window.setTimeout(() => document.querySelector("#area-search")?.focus(), 0);
      }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && rows.length) {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, selected + 1) : Math.max(0, selected < 0 ? 0 : selected - 1);
        rows[next].focus();
        return;
      }
      if (event.key === "Enter" && rows.length) {
        event.preventDefault();
        rows[Math.max(0, selected)]?.click();
        return;
      }
    }
    if (shortcutMatches(event, KEYMAP.goTo)) {
      event.preventDefault();
      return openGoTo();
    }
    // No other global shortcut fires while the finder holds the keyboard.
    if (state.goTo) return;
    const textEntry = event.target.closest?.("input, textarea, select, [contenteditable='true'], .terminal-host");
    if (state.view === "work" && !textEntry && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const rows = visibleCursorRows();
      const current = cursorRow();
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const found = rows.indexOf(current);
        const index = found < 0 ? (event.key === "j" ? -1 : 1) : found;
        return setWorkCursor(rows[event.key === "j" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)]);
      }
      if (event.key === "G" || (event.key === "g" && state.workPendingG)) {
        event.preventDefault(); state.workPendingG = false;
        return setWorkCursor(event.key === "G" ? rows.at(-1) : rows[0]);
      }
      if (event.key === "g") { event.preventDefault(); state.workPendingG = true; window.setTimeout(() => { state.workPendingG = false; }, 650); return; }
      state.workPendingG = false;
      if (event.key === "b") {
        event.preventDefault();
        const area = current?.dataset.workArea ?? "";
        const brain = (state.brains ?? []).filter((item) => item.live && (area === item.area || area.startsWith(`${item.area}/`))).sort((a, b) => b.area.length - a.area.length)[0];
        const session = state.sessions.find((item) => item.name === brain?.session);
        return session ? openSessionLayer(session, "brain") : showToast("This Area has no live brain to enter.");
      }
      if (event.key === "/") { event.preventDefault(); return document.querySelector("#work-search")?.focus(); }
      if (event.key === "?") {
        event.preventDefault();
        return openModal({ kicker: "Work keys", title: "Move around Work", copy: "j/k rows · gg/G first/last · b brain · / filter · ⌘J session", confirmLabel: "Close", onConfirm: closeKeySheet });
      }
    }
    if (moveBetweenWorkRows(event)) return;
    if (event.key === "Enter" && event.metaKey && !modalLayer.hidden && event.target.closest?.("[data-modal-input]")) {
      event.preventDefault();
      modalLayer.querySelector("[data-modal-confirm]")?.click();
      return;
    }
    if (event.key === "Enter" && event.metaKey) {
      const form = event.target.closest?.("[data-command-enter-submit]");
      if (form) {
        event.preventDefault();
        form.requestSubmit();
        return;
      }
    }
    if (event.key === "Escape" && !modalLayer.hidden) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === "Escape" && !shellMenu.hidden) {
      event.preventDefault();
      toggleShellMenu(false);
      return;
    }
    if (event.key === "Escape" && state.commentComposer) {
      event.preventDefault();
      cancelCommentComposer();
      return;
    }
    if (state.view === "document" && event.metaKey && event.altKey && !event.shiftKey && !event.ctrlKey) {
      if (event.code === "KeyM") {
        event.preventDefault();
        return openCommentComposer();
      }
      if (event.code === "KeyN" || event.code === "KeyP") {
        event.preventDefault();
        return stepComment(event.code === "KeyN" ? 1 : -1);
      }
    }
    if (event.key === "Escape" && state.launchTarget) {
      event.preventDefault();
      if (state.view === "describe") syncDescribeDraft();
      state.launchTarget = "";
      state.launchAnchor = null;
      state.defaultAgents = { area: "", editing: "", mode: "" };
      paint(true);
      return;
    }
    if (event.key === "Escape" && state.whatHappened) {
      event.preventDefault();
      state.whatHappened = null;
      paint(true);
      return;
    }
    if (event.key === "Escape" && state.view === "describe-agent") {
      event.preventDefault();
      return cancelDescribe();
    }
    if (event.key === "Escape" && state.view === "agent") {
      event.preventDefault();
      return leaveGoalAgent();
    }
    if (event.key === "Escape" && state.goalSelection.length) {
      event.preventDefault();
      state.goalSelection = [];
      paint(true);
      return;
    }
    if (event.key === "Escape" && state.view === "document") {
      event.preventDefault();
      return leaveReader();
    }
    if (shortcutMatches(event, KEYMAP.findWork)) {
      event.preventDefault();
      showWork({ focus: true });
    }
  });

  window.addEventListener("resize", () => {
    try { terminalFit()?.fit(); } catch {}
  });

  document.addEventListener("selectionchange", () => {
    if (state.view === "document") updateSelectionCommentButton();
  });

  return {  };
}
