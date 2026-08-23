/** Creates this browser boundary with explicit shell-owned dependencies. */
export function bindShellEvents({ state, post, paint, refresh, showToast, screen, backButton, workTab, areasTab, promptsTab, findButton, secondaryAction, shellMenu, goToButton, goToLayer, goToInput, modalLayer, terminalFit, KEYMAP, shortcutMatches, shortcutKbd, toggleShellMenu, confirmRebuild, reloadChanges, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWork, showAreas, showPrompts, loadGoalPrompt, loadBrainPrompt, closePromptPreview, selectBestiaryLifecycle, selectBestiaryTransition, showAreasAt, showDecision, showCreate, showDescribe, showProgramCreate, selectProgram, openProgramSession, controlProgram, performProgramAction, beginAreaCreate, beginAreaMove, confirmAreaMove, cancelCreate, cancelDescribe, currentProgram, programAreaDirectory, selectGoal, rememberGoal, openGoalRun, goalByFile, currentGoal, sessionForGoal, startBrain, brainForAreaCard, openBrainSession, toggleBrainPopover, syncDescribeDraft, saveDescribeDraft, saveDescribeSession, describeWorkSession, openDescribeSession, addDescribeSource, switchDescribeToManualCreate, launchSelection, launchRequestFields, syncLaunchDraft, activateLaunchStep, removeLaunchStep, addLaunchStep, launchIsPipeline, saveLaunchDefault, showHarnessEditor, saveHarnesses, startPipeline, savePipelineStep, appendPipelineSteps, selectionForArea, startSelectedGoals, openGoalAgent, launchOpenSession, confirmStop, confirmComplete, confirmWontDo, openDocument, navigateDocumentHistory, openVaultLink, openDocumentHeading, openCommentComposer, setCommentScope, editComment, cancelCommentComposer, submitCommentComposer, removeComment, stepComment, saveVisibleIdea, notifyDocumentComments, refreshDocument, leaveReader, toggleAwake, closeModal, modalConfirm, updateSelectionCommentButton, preferredArea, areaLabel, programById, DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET }) {
  const awakeButton = document.querySelector("#awake-button");
  const { enableDockBadge, areaIsFolded, saveExpandedAreas, revealArea, setAreaStatus, openReaderAgent, sendVerdict, replyAboutRow, launchOptionsFor, pipelineRecordForGoal, loadLaunchStep, renderWork, describeLaunchArea, describeWorkSessions } = programById;
  document.addEventListener("click", async (event) => {
    const target = event.target;
    // Clicks can trigger re-renders while the describe form is visible; the
    // typed description survives them only through the stored draft.
    if (state.view === "describe") syncDescribeDraft();
    if (state.launchTarget) syncLaunchDraft();
    if (!shellMenu.hidden && !target.closest?.("#shell-menu") && !backButton.contains(target)) toggleShellMenu(false);
    // A click outside the agent chooser closes it; the clicked control still runs.
    if (state.launchTarget && !target.closest?.("[data-launch-popover]") && !target.closest?.("[data-launch-for]")) {
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
    const goalPrompt = target.closest("[data-load-goal-prompt]");
    if (goalPrompt) return loadGoalPrompt(document.querySelector("[data-prompt-goal]")?.value ?? "", goalPrompt.dataset.loadGoalPrompt);
    if (target.closest("[data-load-brain-prompt]")) return loadBrainPrompt(document.querySelector("[data-prompt-brain]")?.value ?? "");
    if (target.closest("[data-close-prompt-preview]")) return closePromptPreview();
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
      rememberGoal(completeGoal.dataset.completeGoal);
      return confirmComplete();
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
      return paint(true);
    }
    const openArea = target.closest("[data-open-area]");
    if (openArea) {
      if (state.view === "document" && state.document?.file) state.mapSelectFile = state.document.file;
      state.areaSelection = openArea.dataset.openArea;
      localStorage.setItem("agent-shell.last-area", state.areaSelection);
      state.view = "areas";
      state.whatHappened = null;
      revealArea(state.areaSelection);
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
      state.goalSelection = state.goalSelection.includes(file)
        ? state.goalSelection.filter((item) => item !== file)
        : [...state.goalSelection, file];
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
      state.document = null;
      state.agentReturnView = "work";
      state.view = "agent";
      state.renderedKey = "";
      return paint(true);
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
    if (target.closest("[data-launch-close]")) {
      state.launch.open = false;
      state.launch.editing = false;
      state.launchTarget = "";
      state.launchAnchor = null;
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
      state.agentReturnView = "work";
      state.view = "agent";
      state.renderedKey = "";
      return paint(true);
    }
    if (target.closest("[data-toggle-awake]")) return toggleAwake();
    if (target.closest("[data-stop-agent]")) return confirmStop();
    if (target.closest("[data-keep-working]")) {
      state.view = "agent";
      state.renderedKey = "";
      return paint(true);
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
          ...launchRequestFields(),
        });
        state.describeSessionName = opened.session;
        state.describeDraft = null;
        localStorage.setItem("agent-shell.last-area", area);
        saveDescribeSession();
        saveDescribeDraft();
        await refresh();
        if (!describeWorkSession()) throw new Error("The agent session did not open.");
        state.view = "describe-agent";
        state.renderedKey = "";
        paint(true);
        showToast("The agent opened with the Area, your description, and the selected Documents.");
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `Start agent <kbd>⌘↵</kbd>`;
        showToast(error.message);
      }
      return;
    }
  });

  document.addEventListener("input", (event) => {
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
    if (event.target.id !== "work-search") return;
    state.query = event.target.value;
    const cursor = event.target.selectionStart;
    screen.innerHTML = renderWork();
    const input = document.querySelector("#work-search");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  });

  document.addEventListener("change", async (event) => {
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
      if (state.agentReturnView === "document" && state.document) {
        state.view = "document";
        state.renderedKey = "";
        paint(true);
        return refreshDocument();
      }
      return showWork();
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

  workTab.addEventListener("click", showWork);
  areasTab.addEventListener("click", showAreas);
  promptsTab.addEventListener("click", showPrompts);

  findButton.addEventListener("click", () => {
    if (findButton.dataset.action === "next-step") {
      return showDecision("agent");
    }
    showWork({ focus: true });
  });

  secondaryAction.addEventListener("click", confirmStop);

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

  document.addEventListener("keydown", (event) => {
    if (shortcutMatches(event, KEYMAP.goTo)) {
      event.preventDefault();
      return openGoTo();
    }
    // No other global shortcut fires while the finder holds the keyboard.
    if (state.goTo) return;
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
      paint(true);
      return;
    }
    if (event.key === "Escape" && state.whatHappened) {
      event.preventDefault();
      state.whatHappened = null;
      paint(true);
      return;
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
