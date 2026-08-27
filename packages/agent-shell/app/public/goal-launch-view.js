import { currentBriefFields, storyEntries } from "./goal-narrative.js";
import { clip, escapeHtml } from "./text-format.js";

/** Creates Goal launch and creation from shell, Area, Work, and overlay ports. */
export function createGoalLaunchView({ shell, areaModel, work, overlays }) {
  const { state, api, post, paint, showToast } = shell;
  const { allAreas, areaLabel, areaPath } = areaModel;
  const {
    humanName, agentName, describeLaunchArea, goalByFile, currentGoal, sessionForGoal, brainForAreaCard,
    brainStateLabel, brainKind,
  } = work;
  const { launchPopover, DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET } = overlays;
  /** Returns the Areas that can own newly created work. */
  function selectableAreas() {
    return (state.vault?.areas ?? [])
      .filter((area) => area.path && area.path !== "root")
      .sort((left, right) => areaLabel(left.path).localeCompare(areaLabel(right.path)));
  }

  /** Selects the closest useful area for a new-work form. */
  function preferredArea() {
    return currentGoal()?.area
      || state.describeDraft?.area
      || localStorage.getItem("agent-shell.last-area")
      || state.vault?.map?.find((group) => group.path)?.path
      || selectableAreas()[0]?.path
      || "";
  }

  /** Renders area options with one selected area. */
  function areaOptions(selected = preferredArea()) {
    return selectableAreas()
      .map((area) => `<option value="${escapeHtml(area.path)}" ${area.path === selected ? "selected" : ""}>${escapeHtml(areaLabel(area.path))}</option>`)
      .join("");
  }

  /** Renders the fast path for one known goal. */
  function renderCreate() {
    const selectedArea = state.createArea || preferredArea();
    return `
      <article class="create-page">
        <p class="kicker">New goal</p>
        <h1>What result do you want?</h1>
        <p class="create-lede">Choose where this work belongs. Then state what will be true when the work is complete.</p>

        <form class="create-form" data-create-form data-command-enter-submit>
          <label>
            <span>Area</span>
            <select id="new-goal-area" name="area" required>
              ${areaOptions(selectedArea)}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input id="new-goal-title" name="title" type="text" required autocomplete="off" placeholder="A short name for this result" />
          </label>
          <label>
            <span>Done looks like</span>
            <textarea id="new-goal-result" name="doneWhen" required placeholder="One clear sentence that describes the finished result"></textarea>
          </label>
          <label>
            <span>Starting point <small>Optional</small></span>
            <textarea id="new-goal-state" name="state" class="short-textarea" placeholder="What is true now?"></textarea>
          </label>
          <div class="create-actions">
            <button class="primary-button" type="submit">Create and choose agent <kbd>⌘↵</kbd></button>
            <button class="quiet-button" type="submit" data-create-only>Create only</button>
            <button class="quiet-button" type="button" data-cancel-create>Cancel</button>
          </div>
          <p class="form-note">You review the Area default, harness, model, and effort before anything starts.</p>
        </form>
      </article>
    `;
  }

  /** Renders natural-language capture before a work-definition conversation. */
  function renderDescribeCapture() {
    const draft = state.describeDraft;
    const area = draft?.area || preferredArea();
    const brain = controllingBrainForArea(area);
    launchOptionsFor(area);
    const selection = launchSelection();
    const recipient = brain?.resolvedLaunch?.label || "brain";
    const startLabel = brain?.live
      ? `Send to ${recipient} brain`
      : selection?.label
        ? `${brain ? "Resume" : "Start"} ${selection.label}${brain ? " brain" : ""}`
        : brain ? "Resume brain" : "Start agent";
    const chooserOpen = !brain?.live && state.launchTarget === DESCRIBE_LAUNCH_TARGET;
    return `
      <article class="create-page describe-page">
        <p class="kicker">Describe work</p>
        <h1>What do you want to work out?</h1>
        <p class="create-lede">Type or dictate the whole thought. You will continue in a native agent conversation with the Area's context.</p>

        ${describeSourcesBlock(draft)}

        <form class="create-form" data-describe-work-form data-command-enter-submit>
          <label>
            <span>Area</span>
            <select id="describe-area" name="area" required>${areaOptions(draft?.area)}</select>
          </label>
          <label>
            <span>Your description</span>
            <textarea id="describe-work" name="description" class="describe-work-input" required placeholder="Describe the result, the context, and any parts that already matter to you.">${escapeHtml(draft?.description || "")}</textarea>
          </label>
          <div class="create-actions">
            <span class="desk-split describe-launch-split">
              <button class="primary-button" type="submit">${escapeHtml(startLabel)} <kbd>⌘↵</kbd></button>
              ${brain?.live ? "" : `<button class="primary-button describe-launch-toggle${chooserOpen ? " open" : ""}" type="button" data-launch-for="${DESCRIBE_LAUNCH_TARGET}" title="Choose agent or model" aria-label="Choose the agent for this conversation" aria-expanded="${chooserOpen}">▾</button>`}
            </span>
            <button class="quiet-button" type="button" data-create-manually>Create Goal manually</button>
            <button class="quiet-button" type="button" data-save-idea>Save as an idea</button>
            <button class="quiet-button" type="button" data-cancel-describe>Cancel</button>
          </div>
          <p class="form-note">The agent reads the Area notes and can inspect its vault and repository. It discusses the structure before it creates Goals.</p>
        </form>
      </article>
      ${launchPopover()}
    `;
  }

  /** The brain record for this exact Area, whatever its state. */
  function controllingBrainForArea(area) {
    return brainForAreaCard(String(area ?? ""));
  }

  /** Shows the Documents that will inform and remain linked to new work. */
  function describeSourcesBlock(draft) {
    const sources = draft?.sources ?? [];
    if (!sources.length) return "";
    return `
      <section class="describe-sources" aria-label="Source context">
        <div><p class="kicker">Source context</p><h2>The agent will read these Documents.</h2></div>
        <div class="describe-source-list">${sources.map((source) => `
          <div class="describe-source">
            <span><strong>${escapeHtml(source.title || source.file)}</strong><small>${escapeHtml(source.file)}</small></span>
            <button type="button" data-remove-describe-source="${escapeHtml(source.file)}" aria-label="Remove ${escapeHtml(source.title || source.file)}">Remove</button>
          </div>`).join("")}</div>
        <p>The agent will keep relevant Document links with the work that you confirm.</p>
      </section>`;
  }

  /**
   * Fetches the launch choices for one Area once and repaints when they land.
   * Selecting a different Goal in the same Area keeps the loaded options.
   */
  function launchOptionsFor(area) {
    const kind = state.launchTarget === BRAIN_LAUNCH_TARGET ? "brain" : state.launchTarget === DEFAULT_AGENTS_TARGET ? "all" : "launch";
    if (state.launch.area !== area || (state.launch.kind && state.launch.kind !== kind)) {
      state.launch = { area, kind, options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", assignmentKind: "implementation", assignmentPath: "", continueFrom: null, steps: [], active: 0, record: null, stale: null, queueMutation: null, replacement: null };
    } else state.launch.kind = kind;
    if (!state.launch.options && !state.launch.loading) {
      state.launch.loading = true;
      api(`/api/launch/options?area=${encodeURIComponent(area)}${kind === "launch" ? "" : `&kind=${kind}`}`)
        .then((options) => { state.launch.options = options; })
        .catch((error) => { state.launch.options = { harnesses: [], default: { error: error.message } }; })
        .finally(() => { state.launch.loading = false; paint(true); });
    }
    return state.launch.options;
  }

  /**
   * The picker's current selection, seeded from the Area default. Recognition
   * over recall: labels carry the choice, the composed command stays exact.
   */
  function launchSelection() {
    const options = state.launch.options;
    if (!options) return null;
    const settingsDefault = state.launchTarget === DEFAULT_AGENTS_TARGET
      ? state.defaultAgents.editing === "brain" ? options.brainDefault : options.workDefault
      : null;
    const preset = (settingsDefault ?? options.default) && !(settingsDefault ?? options.default).error ? (settingsDefault ?? options.default) : null;
    const choice = state.launch.choice ?? (preset?.harness ? { harness: preset.harness, model: preset.model, effort: preset.effort ?? null } : null);
    const harness = choice ? (options.harnesses ?? []).find((entry) => entry.id === choice.harness) : null;
    if (!harness) {
      return preset ? { harness: null, model: null, effort: null, command: preset.command, label: preset.label || "", edited: false } : null;
    }
    const model = (harness.models ?? []).find((entry) => entry.id === choice.model) ?? null;
    const effort = (model?.efforts ?? harness.efforts ?? []).find((entry) => entry.id === choice.effort) ?? null;
    const edited = Boolean(state.launch.command.trim());
    const command = edited ? state.launch.command.trim() : [harness.command, model?.args, effort?.args].filter(Boolean).join(" ");
    const label = edited ? command : [harness.label, model?.label, effort?.label].filter(Boolean).join(" · ");
    return { harness, model, effort, command, label, edited };
  }

  /** Explicit per-run launch fields for a start request, or nothing. */
  function launchRequestFields(describing = false) {
    const selection = launchSelection();
    if (!selection) return {};
    if (describing) {
      const brain = controllingBrainForArea(describeLaunchArea());
      if (brain) return {};
      if (selection.edited) return { command: selection.command };
      return selection.harness
        ? { choice: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) } }
        : selection.command ? { command: selection.command } : {};
    }
    if (selection.edited) return { command: selection.command };
    // Send the selection the picker already shows, seeded or clicked. The
    // server supplies no default, so a request that carries nothing is
    // refused; and the harness on screen is the harness that starts.
    if (selection.harness) {
      return { choice: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) } };
    }
    return selection.command ? { command: selection.command } : {};
  }

  /**
   * The launch fields for a start that did not go through the picker: Julian
   * presses Start agent without opening it, so nothing is loaded and nothing
   * would be sent. The server supplies no harness of its own, so the client
   * fills the flag from the Area's declared default and names it back in the
   * toast. Returns the request fields and the label that was started.
   */
  async function launchFieldsForArea(area) {
    // Only this Area's own worker picker may speak for this start. The picker
    // state survives a close, so a choice made for another Area, or for the
    // brain, would otherwise start this worker on a harness nobody named for it.
    const owned = state.launch.area === area && (!state.launch.kind || state.launch.kind === "launch");
    const chosen = owned ? launchRequestFields() : {};
    if (Object.keys(chosen).length) return { fields: chosen, label: launchSelection()?.label ?? "" };
    const options = await api(`/api/launch/options?area=${encodeURIComponent(area)}`).catch(() => null);
    const preset = options?.default && !options.default.error ? options.default : null;
    if (!preset) return { fields: {}, label: "" };
    const label = preset.label || preset.command || "";
    if (preset.harness) {
      return { fields: { choice: { harness: preset.harness, ...(preset.model ? { model: preset.model } : {}), ...(preset.effort ? { effort: preset.effort } : {}) } }, label };
    }
    return { fields: preset.command ? { command: preset.command } : {}, label };
  }

  // ---- assignment drafts ----

  /** Creates one stable browser identity that survives reorder before Save. */
  function draftAssignmentId() {
    return `draft-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  }

  /** Creates one unsaved assignment without borrowing a display position. */
  function blankLaunchStep() {
    return { id: draftAssignmentId(), persisted: false, status: "draft", choice: null, command: "", instruction: "", kind: "implementation", path: "", continueFromAssignmentId: null };
  }

  /** Converts queue history and pending rows to the editor's stable model. */
  function launchStepsForRecord(record) {
    const source = record?.steps ?? record?.assignments ?? [];
    return source.map((step, index) => {
      const legacySource = Number.isInteger(step.continueFrom) ? source[step.continueFrom - 1] : null;
      return {
        id: String(step.id ?? step.assignmentId ?? `assignment-${index + 1}`),
        persisted: true,
        status: step.status ?? "pending",
        choice: step.launch ?? null,
        command: step.launch ? "" : step.command ?? "",
        instruction: step.instruction ?? "",
        kind: step.kind === "review" ? "review" : "implementation",
        path: step.path ?? "",
        continueFromAssignmentId: step.continueFromAssignmentId ?? legacySource?.id ?? legacySource?.assignmentId ?? null,
      };
    });
  }

  /** True only for a pending queue row or a new local row. */
  function launchStepIsMutable(row) {
    return Boolean(row && (!row.persisted || row.status === "pending"));
  }

  /** The active row's draft as one plain object with its stable identity. */
  function launchStepDraft() {
    const row = state.launch.steps[state.launch.active] ?? blankLaunchStep();
    return {
      ...row,
      choice: state.launch.choice,
      command: state.launch.command,
      instruction: state.launch.instruction,
      kind: state.launch.assignmentKind === "review" ? "review" : "implementation",
      path: state.launch.assignmentPath ?? "",
      continueFromAssignmentId: state.launch.continueFrom ?? null,
    };
  }

  /** Copies the typed instruction and command into the active row before any repaint. */
  function syncLaunchDraft() {
    const instruction = document.querySelector("#launch-instruction");
    if (instruction) state.launch.instruction = instruction.value;
    const brainInstruction = document.querySelector("#brain-instruction");
    if (brainInstruction && state.brainDraft) state.brainDraft.instruction = brainInstruction.value;
    const command = document.querySelector("#launch-command-input");
    if (command) state.launch.command = command.value;
    const path = document.querySelector("[data-launch-path]");
    if (path) state.launch.assignmentPath = path.value;
    const kind = document.querySelector("[data-launch-kind]");
    if (kind) state.launch.assignmentKind = kind.value === "review" ? "review" : "implementation";
    const continuation = document.querySelector("[data-launch-continue]");
    if (continuation) state.launch.continueFrom = continuation.value || null;
  }

  /** Stores the active row's fields into the steps array and returns the array. */
  function commitActiveStep() {
    const steps = state.launch.steps.length ? state.launch.steps : [blankLaunchStep()];
    state.launch.active = Math.min(state.launch.active, steps.length - 1);
    if (launchStepIsMutable(steps[state.launch.active])) steps[state.launch.active] = { ...steps[state.launch.active], ...launchStepDraft() };
    state.launch.steps = steps;
    return steps;
  }

  /** Stores the active row, then loads another row into the active fields. */
  function activateLaunchStep(index) {
    loadLaunchStep(commitActiveStep(), index);
  }

  /** Loads one row of the given steps into the active fields without storing the current one. */
  function loadLaunchStep(steps, index) {
    const row = steps[index] ?? blankLaunchStep();
    state.launch.active = Math.max(0, index);
    state.launch.choice = row.choice ?? null;
    state.launch.command = row.command ?? "";
    state.launch.instruction = row.instruction ?? "";
    state.launch.assignmentKind = row.kind === "review" ? "review" : "implementation";
    state.launch.assignmentPath = row.path ?? "";
    state.launch.continueFrom = row.continueFromAssignmentId ?? null;
    state.launch.editing = false;
  }

  /** Inserts one pending row after the selected mutable assignment. */
  function addLaunchStep(afterIndex = state.launch.active) {
    const steps = commitActiveStep();
    const row = steps[afterIndex];
    if (row && !launchStepIsMutable(row) && steps.some(launchStepIsMutable)) return false;
    const insertion = row ? afterIndex + 1 : steps.length;
    steps.splice(insertion, 0, blankLaunchStep());
    loadLaunchStep(steps, insertion);
    return true;
  }

  /**
   * Removes one draft row; the active row moves to the nearest remaining
   * editable one. Rows that belong to a record are history and never go. The
   * last editable row stays, so the picker always has something to edit.
   */
  function removeLaunchStep(index) {
    const steps = commitActiveStep();
    if (!launchStepIsMutable(steps[index])) return false;
    if (steps.length <= 1 || (state.launch.record && !steps.some((step) => !launchStepIsMutable(step)) && steps.filter(launchStepIsMutable).length <= 1)) return false;
    const removed = steps[index].id;
    steps.splice(index, 1);
    for (const step of steps) if (step.continueFromAssignmentId === removed) step.continueFromAssignmentId = null;
    const editable = steps.map((step, position) => ({ step, position })).filter((item) => launchStepIsMutable(item.step));
    const next = editable.find((item) => item.position >= index) ?? editable.at(-1);
    loadLaunchStep(steps, next?.position ?? Math.max(0, Math.min(index - 1, steps.length - 1)));
    return true;
  }

  /** Moves one pending assignment while keeping continuation identities stable. */
  function moveLaunchStep(index, direction) {
    const steps = commitActiveStep();
    if (!launchStepIsMutable(steps[index])) return false;
    const next = index + direction;
    if (next < 0 || next >= steps.length || !launchStepIsMutable(steps[next])) return false;
    [steps[index], steps[next]] = [steps[next], steps[index]];
    const positions = new Map(steps.map((step, position) => [step.id, position]));
    for (const [position, step] of steps.entries()) {
      const source = positions.get(step.continueFromAssignmentId);
      if (Number.isInteger(source) && source >= position) step.continueFromAssignmentId = null;
    }
    loadLaunchStep(steps, next);
    return true;
  }

  /** The label one draft row shows in the step list. */
  function launchStepLabel(row) {
    const options = state.launch.options;
    if (row.command?.trim()) return row.command.trim();
    const harness = row.choice ? (options?.harnesses ?? []).find((entry) => entry.id === row.choice.harness) : null;
    if (!harness) return options?.default && !options.default.error ? (options.default.label || options.default.command || "Area default") : "Area default";
    const model = (harness.models ?? []).find((entry) => entry.id === row.choice.model);
    const effort = (model?.efforts ?? harness.efforts ?? []).find((entry) => entry.id === row.choice.effort);
    return [harness.label, model?.label, effort?.label].filter(Boolean).join(" · ");
  }

  /** One request step for the server: instruction plus a launch or a command. */
  function launchStepRequest(row) {
    const options = state.launch.options;
    const base = {
      id: row.id,
      instruction: row.instruction.trim(),
      kind: row.kind === "review" ? "review" : "implementation",
      path: row.path?.trim() || null,
      continueFromAssignmentId: row.continueFromAssignmentId ?? null,
    };
    if (row.command?.trim()) return { ...base, command: row.command.trim() };
    if (row.choice?.harness) return { ...base, launch: { harness: row.choice.harness, model: row.choice.model ?? null, effort: row.choice.effort ?? null } };
    const preset = options?.default && !options.default.error ? options.default : null;
    if (preset?.harness) return { ...base, launch: { harness: preset.harness, model: preset.model ?? null, effort: preset.effort ?? null } };
    if (preset?.command) return { ...base, command: preset.command };
    return base;
  }

  /** True when the popover holds more than one row or an instruction: a pipeline, not a plain start. */
  function launchIsPipeline() {
    const steps = commitActiveStep();
    return steps.length > 1 || Boolean(steps[0]?.instruction?.trim());
  }

  /** The pipeline on one Goal that is not finished, or null. */
  function pipelineForGoal(goal) {
    const record = pipelineRecordForGoal(goal);
    return record && record.status !== "complete" ? record : null;
  }

  /**
   * The pipeline record on one Goal in any status, or null. A Goal that once
   * ran a pipeline keeps it: the popover shows its history and appends to it
   * rather than starting over. Finished Goals show nothing.
   */
  function pipelineRecordForGoal(goal) {
    if (!goal || ["done", "dropped", "parked", "deferred"].includes(goal.status)) return null;
    return (state.pipelines ?? []).find((item) => item.goal === goal.file) ?? null;
  }

  /** The rows created locally after the queue revision was loaded. */
  function launchDraftRows(steps = commitActiveStep()) {
    return state.launch.record ? steps.filter((row) => !row.persisted) : steps;
  }

  /** Builds one atomic stable-ID mutation batch for the current queue draft. */
  function pipelineMutationOperations(record, rows = commitActiveStep()) {
    if (!record) return [];
    const original = launchStepsForRecord(record);
    const originalById = new Map(original.map((row) => [row.id, row]));
    const current = rows.filter(launchStepIsMutable);
    const currentIds = new Set(current.map((row) => row.id));
    const operations = original.filter((row) => row.status === "pending" && !currentIds.has(row.id))
      .map((row) => ({ type: "remove", assignmentId: row.id }));
    let previousId = rows.slice(0, Math.max(0, rows.findIndex(launchStepIsMutable))).at(-1)?.id ?? null;
    for (const row of current) {
      const request = launchStepRequest(row);
      if (!row.persisted) operations.push({ type: "add", afterAssignmentId: previousId, assignment: request });
      else {
        const before = originalById.get(row.id);
        const comparableBefore = before ? launchStepRequest(before) : null;
        if (!comparableBefore || JSON.stringify(comparableBefore) !== JSON.stringify(request)) {
          const patch = { ...request };
          delete patch.id;
          operations.push({ type: "update", assignmentId: row.id, patch });
        }
      }
      previousId = row.id;
    }
    const simulated = original.filter((row) => row.status === "pending" && currentIds.has(row.id)).map((row) => row.id);
    for (const row of current.filter((item) => !item.persisted)) {
      const wanted = current.findIndex((item) => item.id === row.id);
      simulated.splice(wanted, 0, row.id);
    }
    const firstMutable = rows.findIndex(launchStepIsMutable);
    const historyAnchor = firstMutable > 0 ? rows[firstMutable - 1].id : null;
    for (let index = 0; index < current.length; index += 1) {
      const id = current[index].id;
      const position = simulated.indexOf(id);
      if (position === index) continue;
      operations.push({ type: "move", assignmentId: id, afterAssignmentId: index ? current[index - 1].id : historyAnchor });
      simulated.splice(position, 1);
      simulated.splice(index, 0, id);
    }
    return operations;
  }

  /** Rebases the local operation batch onto the server's current queue. */
  function rebasePipelineDraft(latestRecord, originalRecord = state.launch.record, rows = commitActiveStep()) {
    const operations = pipelineMutationOperations(originalRecord, rows);
    const rebased = launchStepsForRecord(latestRecord);
    /** Converts a request assignment back to one editable browser row. */
    const draftRow = (assignment, persisted = false) => ({
      id: String(assignment.id), persisted, status: persisted ? "pending" : "draft",
      choice: assignment.launch ?? null, command: assignment.command ?? "", instruction: assignment.instruction ?? "",
      kind: assignment.kind === "review" ? "review" : "implementation", path: assignment.path ?? "",
      continueFromAssignmentId: assignment.continueFromAssignmentId ?? null,
    });
    for (const operation of operations) {
      if (operation.type === "add") {
        // The previous request may have committed even when its response was
        // lost. Reapplying that draft to the newer projection must recognize
        // its stable assignment ID instead of displaying a duplicate add.
        if (rebased.some((row) => row.id === operation.assignment.id)) continue;
        const after = operation.afterAssignmentId == null ? -1 : rebased.findIndex((row) => row.id === operation.afterAssignmentId);
        rebased.splice(after + 1, 0, draftRow(operation.assignment));
      } else if (operation.type === "update") {
        const index = rebased.findIndex((row) => row.id === operation.assignmentId);
        if (index >= 0 && launchStepIsMutable(rebased[index])) rebased[index] = { ...rebased[index], ...draftRow({ id: operation.assignmentId, ...operation.patch }, true) };
      } else if (operation.type === "remove") {
        const index = rebased.findIndex((row) => row.id === operation.assignmentId && launchStepIsMutable(row));
        if (index >= 0) rebased.splice(index, 1);
      } else if (operation.type === "move") {
        const index = rebased.findIndex((row) => row.id === operation.assignmentId);
        if (index < 0 || !launchStepIsMutable(rebased[index])) continue;
        const [row] = rebased.splice(index, 1);
        const after = operation.afterAssignmentId == null ? -1 : rebased.findIndex((item) => item.id === operation.afterAssignmentId);
        rebased.splice(after + 1, 0, row);
      }
    }
    return rebased;
  }

  /** The assignment list and its keyboard-equivalent pointer actions. */
  function launchStepList() {
    if ([DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET].includes(state.launchTarget)) return "";
    const steps = commitActiveStep();
    const glyph = { complete: "✓", running: "●", pending: "○", skipped: "–", stopped: "■", ended: "■" };
    if (state.launch.replacement) {
      const row = steps[state.launch.active];
      return `<section class="launch-assignment-region replacement-assignment" data-launch-assignment-region aria-label="Assignment being replaced">
        <p class="launch-region-title">Assignment identity stays fixed</p>
        <ol class="launch-steps" aria-label="Assignment being replaced"><li class="launch-step ${escapeHtml(row?.status ?? "running")} selected" data-launch-assignment="${escapeHtml(row?.id ?? state.launch.replacement.assignmentId)}"><span class="launch-step-fixed"><b>${glyph[row?.status] ?? "●"}</b><span>${escapeHtml(String(row?.id ?? state.launch.replacement.assignmentId))}</span><em>${escapeHtml(clip(row?.instruction ?? "", 80))}</em></span></li></ol>
      </section>`;
    }
    const rows = steps.map((row, index) => {
      const mutable = launchStepIsMutable(row);
      const canRemove = mutable && (steps.length > 1 || steps.some((step) => !launchStepIsMutable(step)));
      return `<li class="launch-step ${row.status}${state.launch.active === index ? " selected" : ""}" data-launch-assignment="${escapeHtml(row.id)}">
        ${mutable
          ? `<button type="button" data-launch-step-select="${index}" data-focus-key="launch:assignment:${escapeHtml(row.id)}" title="Edit assignment ${index + 1} (e)"><b>${row.persisted ? glyph.pending : "+"}</b><span>${index + 1} · ${escapeHtml(launchStepLabel(row))}</span><em>${row.instruction?.trim() ? escapeHtml(clip(row.instruction.trim(), 60)) : "<i>no instruction</i>"}</em></button>
            <span class="launch-step-actions"><button type="button" data-launch-step-add-after="${index}" title="Add after (a)">a</button><button type="button" data-launch-step-edit="${index}" title="Edit (e)">e</button><button type="button" data-launch-step-move="-1" data-launch-step-index="${index}" ${index > 0 && launchStepIsMutable(steps[index - 1]) ? "" : "disabled"} title="Move up (K)">K</button><button type="button" data-launch-step-move="1" data-launch-step-index="${index}" ${index < steps.length - 1 && launchStepIsMutable(steps[index + 1]) ? "" : "disabled"} title="Move down (J)">J</button>${canRemove ? `<button type="button" data-launch-step-remove="${index}" title="Remove (d)">d</button>` : ""}</span>`
          : `<span class="launch-step-fixed"><b>${glyph[row.status] ?? "■"}</b><span>${index + 1} · ${escapeHtml(launchStepLabel(row))}</span><em>${escapeHtml(clip(row.instruction, 60))}</em></span>`}
      </li>`;
    });
    return `
      <section class="launch-assignment-region" data-launch-assignment-region aria-label="Assignments">
        <p class="launch-region-title">Assignments <small>j/k rows · a add · e edit · d remove · J/K move</small></p>
        <ol class="launch-steps" aria-label="Assignments">${rows.join("")}</ol>
        <button type="button" class="quiet-button launch-step-add" data-launch-step-add>Add assignment <kbd>a</kbd></button>
      </section>`;
  }

  /**
   * The launch picker: harness and model by display label, the exact composed
   * command one line below, and a start action that states its exact effect.
   * Selection never starts work; only the labeled start action does.
   */
  function launchPickerBlock() {
    const options = state.launch.options;
    if (!options) return "";
    const settings = state.launchTarget === DEFAULT_AGENTS_TARGET;
    const selection = launchSelection();
    const presetCandidate = settings
      ? state.defaultAgents.editing === "brain" ? options.brainDefault : options.workDefault
      : options.default;
    const presetError = presetCandidate?.error ?? "";
    const preset = presetCandidate && !presetCandidate.error ? presetCandidate : {};
    const currentHarness = selection?.harness ?? null;
    const replacement = state.launch.replacement;
    const replacementLocked = Boolean(replacement?.saving || (replacement?.operation && !["failed", "rollback"].includes(replacement.operation.status)));
    const harnessButtons = (options.harnesses ?? []).map((harness) => `
      <button type="button" role="radio" aria-checked="${currentHarness?.id === harness.id}" class="launch-option${currentHarness?.id === harness.id ? " selected" : ""}" data-launch-harness="${escapeHtml(harness.id)}" data-focus-key="launch:harness:${escapeHtml(harness.id)}" ${replacementLocked ? "disabled" : ""}>
        <span>${escapeHtml(harness.label)}</span>${preset.harness === harness.id ? `<span class="launch-default-tag">default</span>` : ""}
      </button>`).join("");
    const models = currentHarness?.models ?? [];
    const modelButtons = models.length
      ? models.map((model) => `
        <button type="button" role="radio" aria-checked="${selection?.model?.id === model.id}" class="launch-option${selection?.model?.id === model.id ? " selected" : ""}" data-launch-model="${escapeHtml(model.id)}" data-focus-key="launch:model:${escapeHtml(currentHarness?.id ?? "")}:${escapeHtml(model.id)}" ${replacementLocked ? "disabled" : ""}>
          <span>${escapeHtml(model.label)}</span>${preset.harness === currentHarness?.id && preset.model === model.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("")
      : `<p class="launch-none">${currentHarness ? "No model choice. The command is complete." : "Pick a harness first."}</p>`;
    const efforts = selection?.model?.efforts ?? currentHarness?.efforts ?? [];
    const effortButtons = efforts.map((effort) => `
        <button type="button" role="radio" aria-checked="${selection?.effort?.id === effort.id}" class="launch-option${selection?.effort?.id === effort.id ? " selected" : ""}" data-launch-effort="${escapeHtml(effort.id)}" data-focus-key="launch:effort:${escapeHtml(currentHarness?.id ?? "")}:${escapeHtml(selection?.model?.id ?? "")}:${escapeHtml(effort.id)}" ${replacementLocked ? "disabled" : ""}>
          <span>${escapeHtml(effort.label)}</span>${preset.harness === currentHarness?.id && preset.effort === effort.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("");
    const command = selection?.command ?? "";
    const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
    const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
    const brainRef = braining ? [selection?.harness?.id, selection?.model?.id, selection?.effort?.id].filter(Boolean).join("/") : "";
    const brainSource = braining && preset.source ? (preset.source === state.brainDraft?.area ? "Set on this Area" : `Inherited from ${areaLabel(preset.source)}`) : "";
    const brainOverride = braining && Boolean(state.launch.choice?.harness);
    const commandZone = braining
      ? `<section class="brain-launch-summary${brainOverride ? " override" : ""}" aria-label="Resolved brain launch"><p class="kicker">Brain launch</p><strong>${escapeHtml(brainRef || "Not configured")}</strong><span>${escapeHtml(selection?.label || presetError)}</span><code>${escapeHtml(selection?.command || "")}</code>${brainOverride ? `<small class="launch-override-note">One launch only · Area default unchanged</small>` : brainSource ? `<small>${escapeHtml(brainSource)}</small>` : ""}<button class="quiet-button" type="button" data-default-agents-area="${escapeHtml(state.brainDraft?.area ?? "")}" data-default-agents-origin="brain" data-focus-key="launch:brain:default">Change default</button></section>`
      : replacement
      ? `<div class="launch-command replacement-command"><code>${escapeHtml(command)}</code><small>Only this assignment's desired launch changes. Its Goal, prompt, path, Documents, and history stay fixed.</small></div>`
      : settings
      ? `<div class="launch-command"><code>${escapeHtml(command)}</code></div>`
      : state.launch.editing
      ? `<div class="launch-command"><input id="launch-command-input" type="text" spellcheck="false" value="${escapeHtml(state.launch.command || command)}"><button class="quiet-button" type="button" data-launch-reset>Reset</button></div>
         <p class="form-note">The edited command applies to this run only.</p>`
      : `<div class="launch-command"><code>${escapeHtml(command)}</code>${selection?.edited ? `<span class="launch-default-tag">edited</span>` : ""}<button class="quiet-button" type="button" data-launch-edit>Edit command</button></div>`;
    const brain = braining ? brainForAreaCard(state.brainDraft?.area) : null;
    const brainResumes = Boolean(brain && !brain.live);
    const record = state.launch.record;
    const assignmentRows = describing || braining || settings ? [] : commitActiveStep();
    const activeAssignment = assignmentRows[state.launch.active];
    const activeMutable = launchStepIsMutable(activeAssignment);
    const stepCount = describing || braining || settings ? 1 : assignmentRows.length;
    const replacementStatus = replacement?.operation?.status ?? "";
    const replacementViewStatus = replacement?.saving ? "saving" : replacementStatus;
    const startLabel = braining
      ? (brainResumes ? "Send and wake brain" : "Start brain")
      : replacement
      ? replacement?.saving ? "Working…"
        : replacementStatus === "complete" ? "Open replacement"
        : replacementStatus === "retirement-incomplete" ? "Retry exact retirement"
          : ["replacement-starting", "replacement-ready", "source-retiring"].includes(replacementStatus) ? "Finish replacement"
            : ["failed", "rollback"].includes(replacementStatus) ? "Try replacement again"
              : "Start replacement"
      : record
      ? "Save pending changes"
      : stepCount > 1 ? `Start ${stepCount} assignments` : `Start ${selection ? (selection.label || "agent") : "agent"}`;
    const brainZone = braining ? `
        <label class="brain-instruction"><span>${brainResumes ? "What should this brain do next?" : "What should this Area get done?"}</span><textarea id="brain-instruction" rows="5" placeholder="${brainResumes ? "The message that wakes this brain. It keeps its founding instruction and its plan, and reads this as the reason it is awake." : "The instruction the brain plans and dispatches from. It splits the work into Goals, starts agents in dependency order, reviews what comes back, and asks you only for real decisions."}">${escapeHtml(state.brainDraft?.instruction ?? "")}</textarea></label>
        ${brainResumes ? `<p class="form-note">A brain ran here before (${escapeHtml(brainStateLabel(brain).toLowerCase())}). Your message wakes it and keeps its founding instruction. Start over begins a new brain from the message above.</p>` : ""}` : "";
    const continuationRows = assignmentRows.slice(0, state.launch.active);
    const stepZone = describing || braining || settings ? "" : replacement
      ? `<section class="launch-assignment-history replacement-preserved"><p><strong>Preserved assignment</strong></p><dl><div><dt>Instruction</dt><dd>${escapeHtml(activeAssignment?.instruction || "No instruction")}</dd></div><div><dt>Type</dt><dd>${escapeHtml(activeAssignment?.kind || "implementation")}</dd></div><div><dt>Path</dt><dd>${escapeHtml(activeAssignment?.path || "Area workspace")}</dd></div><div><dt>Continuation</dt><dd>${escapeHtml(activeAssignment?.continueFromAssignmentId || "Fresh session")}</dd></div></dl></section>`
      : !activeMutable
      ? `<section class="launch-assignment-history"><p>This assignment is immutable history. Select a pending assignment or add one.</p></section>`
      : `<section class="launch-assignment-editor" data-launch-assignment-editor aria-label="Assignment fields">
          <label class="launch-instruction"><span>Assignment ${state.launch.active + 1} does</span><textarea id="launch-instruction" rows="2" placeholder="${stepCount > 1 || record ? "What this agent does" : "What this agent does (optional for one assignment)"}">${escapeHtml(state.launch.instruction ?? "")}</textarea></label>
          <div class="launch-assignment-metadata"><label><span>Type</span><select data-launch-kind><option value="implementation"${state.launch.assignmentKind !== "review" ? " selected" : ""}>Implementation</option><option value="review"${state.launch.assignmentKind === "review" ? " selected" : ""}>Review</option></select></label><label><span>Path <small>optional</small></span><input data-launch-path value="${escapeHtml(state.launch.assignmentPath ?? "")}" placeholder="Repository path"></label><label class="launch-continue"><span>Session</span><select data-launch-continue><option value="">Fresh session</option>${continuationRows.map((row, index) => `<option value="${escapeHtml(row.id)}"${state.launch.continueFrom === row.id ? " selected" : ""}>Continue assignment ${index + 1}</option>`).join("")}</select></label></div>
          <div class="action-row"><button class="quiet-button" type="button" data-launch-assignment-cancel aria-keyshortcuts="Escape" title="Cancel assignment edit (Esc)">Cancel assignment edit <kbd>Esc</kbd></button></div>
        </section>`;
    const settingsRows = settings ? defaultAgentRows(options) : "";
    const settingsMode = state.defaultAgents.mode;
    const goalChoiceVisible = replacement || !record || activeMutable;
    const showChoices = braining || (goalChoiceVisible && (!settings || (state.defaultAgents.editing && settingsMode === "launch")));
    const replacementStateCopy = {
      saving: "Tangent is persisting this exact replacement operation.",
      requested: "The replacement request is durable. The source is still current.",
      "replacement-starting": "The replacement is live for inspection. The source stays alive until readiness is confirmed.",
      "replacement-ready": "The replacement is ready. Tangent is preserving the source until promotion is fenced.",
      "source-retiring": "The replacement is current. Tangent is retiring only the exact source target.",
      complete: "Replacement complete. Goal and assignment identity were preserved.",
      failed: "Replacement failed. The source attempt stayed current and alive.",
      rollback: "Replacement rolled back. The source attempt stayed current.",
      "retirement-incomplete": "Both sessions remain visible because exact source retirement did not complete.",
    };
    const replacementState = replacement ? `<section class="replacement-state ${escapeHtml(replacementViewStatus || "choosing")}" role="status"><strong>${escapeHtml(replacementViewStatus ? replacementViewStatus.replaceAll("-", " ") : "Choose a replacement agent")}</strong><span>${escapeHtml(replacementViewStatus ? replacementStateCopy[replacementViewStatus] || "The persisted replacement operation is still advancing." : "The old agent remains alive until the new agent is ready.")}</span>${replacement?.operation?.error ? `<small>${escapeHtml(replacement.operation.error)}</small>` : ""}${replacement?.operation?.replacementTarget?.session ? `<small>Replacement: ${escapeHtml(replacement.operation.replacementTarget.session)}</small>` : ""}</section>` : "";
    const settingsEditor = settings && state.defaultAgents.editing ? `
      <section class="default-agent-editor" aria-label="Edit ${escapeHtml(state.defaultAgents.editing)} default">
        <p>${settingsMode === "launch" ? `Choose the harness, model, and effort for ${state.defaultAgents.editing === "brain" ? "Brain" : "Work"}.` : settingsMode === "work" ? "Brain will follow the Work default of this Area." : `The ${state.defaultAgents.editing === "brain" ? "Brain" : "Work"} default will inherit from the nearest parent Area.`}</p>
      </section>` : "";
    const settingsActions = settings ? `
      <div class="action-row start-actions">
        ${state.defaultAgents.editing ? `<button class="primary-button" type="button" data-launch-save data-focus-key="launch:default:save" ${settingsMode === "launch" && !selection?.harness ? "disabled" : ""}>Save</button><button class="quiet-button" type="button" data-default-agents-cancel data-focus-key="launch:default:cancel">Cancel</button>` : ""}
        <button class="quiet-button" type="button" data-launch-close data-focus-key="launch:close">${state.defaultAgents.origin === "brain" ? "Back" : "Close"}</button>
      </div>` : "";
    return `
      <div class="launch-picker">
        ${settingsRows}
        ${launchStepList()}
        ${brainZone}
        ${settingsEditor}
        ${stepZone}
        ${showChoices && (options.harnesses ?? []).length ? `
        <div class="launch-columns" aria-label="Agent choices">
          <div class="launch-col" data-launch-column="harness" role="radiogroup" aria-label="Harness"><p class="launch-col-title">Harness</p>${harnessButtons}</div>
          <div class="launch-col" data-launch-column="model" role="radiogroup" aria-label="Model"><p class="launch-col-title">Model</p>${modelButtons}</div>
          ${efforts.length ? `<div class="launch-col" data-launch-column="effort" role="radiogroup" aria-label="Effort"><p class="launch-col-title">Effort</p>${effortButtons}</div>` : ""}
        </div>` : showChoices ? `<p class="launch-none">No harness registry. Add one at <code>~/.tangent/trees/harnesses.md</code>.</p>` : ""}
        ${braining || showChoices ? commandZone : ""}
        ${replacementState}
        ${state.launch.stale ? `<section class="launch-stale" role="alert"><strong>The queue changed while this editor was open.</strong><span>Your local draft is intact.</span><button class="quiet-button" type="button" data-launch-rebase>Reload queue and reapply draft</button></section>` : ""}
        ${settingsActions || `<div class="action-row start-actions">
          <button class="primary-button" type="button" data-launch-start data-focus-key="launch:start" ${(braining && !selection?.harness) || replacement?.saving ? "disabled" : ""}>${escapeHtml(startLabel)}</button>
          ${brainResumes ? `<button class="quiet-button" type="button" data-brain-start-over>Start over</button>` : ""}
          <button class="quiet-button" type="button" data-launch-close data-focus-key="launch:close">${state.launchTarget ? "Close" : "Back"}</button>
        </div>`}
        <button class="quiet-button launch-registry-link" type="button" data-open-harnesses data-focus-key="launch:registry">Edit harnesses and models…</button>
      </div>
    `;
  }

  /** Renders the effective Work and Brain values with their local edit actions. */
  function defaultAgentRows(options) {
    /** Renders one independent default row. */
    const row = (kind, title, effective) => {
      const declaration = options.declarations?.[kind] ?? { mode: "inherit" };
      const local = declaration.mode !== "inherit";
      let source;
      if (local) source = declaration.mode === "work" ? "Follows Work on this Area" : "Set on this Area";
      else if (kind === "brain" && effective?.via === "work") source = `Inherited from ${areaLabel(effective.source)} · Follows Work`;
      else if (kind === "brain" && effective?.via === "work-fallback") {
        source = effective.source === options.area ? "Follows Work on this Area" : effective.source ? `Follows Work inherited from ${areaLabel(effective.source)}` : "No declared fallback";
      } else if (effective?.source === options.area) source = "Set on this Area";
      else source = effective?.source ? `Inherited from ${areaLabel(effective.source)}` : kind === "work" ? "Profile fallback" : "No declared fallback";
      const value = effective?.error ? effective.error : effective?.label || effective?.command || "Not set";
      return `<div class="default-agent-row" data-default-agent-row="${kind}">
        <div class="default-agent-value"><strong>${title}</strong><span>${escapeHtml(value)}</span><small>${escapeHtml(source)}</small></div>
        <div class="default-agent-actions">
          <button class="quiet-button" type="button" data-default-agent-edit="${kind}" data-focus-key="launch:default:${kind}:change">Change</button>
          ${kind === "brain" ? `<button class="quiet-button" type="button" data-default-agent-mode="work" data-default-agent-kind="brain" data-focus-key="launch:default:brain:work">Follow work</button>` : ""}
          ${local ? `<button class="quiet-button" type="button" data-default-agent-mode="inherit" data-default-agent-kind="${kind}" data-focus-key="launch:default:${kind}:inherit">Use inherited</button>` : ""}
        </div>
      </div>`;
    };
    return `<div class="default-agent-rows">${row("work", "Work", options.workDefault)}${row("brain", "Brain", options.brainDefault)}</div>`;
  }

  /** Opens the durable defaults editor for one Area without starting work. */
  function toggleDefaultAgents(button) {
    const area = button.dataset.defaultAgentsArea;
    if (state.launchTarget === DEFAULT_AGENTS_TARGET && state.defaultAgents.area === area) {
      state.launchTarget = "";
      state.launchAnchor = null;
      return paint(true);
    }
    state.launchTarget = DEFAULT_AGENTS_TARGET;
    state.defaultAgents = { area, editing: "", mode: "", ...(button.dataset.defaultAgentsOrigin ? { origin: button.dataset.defaultAgentsOrigin } : {}) };
    launchOptionsFor(area);
    // The menu item is hidden when `d` opens this editor. Its always-visible
    // summary is the shared pointer and keyboard anchor.
    const anchor = button.closest?.(".work-group-action-menu")?.querySelector("summary") ?? button;
    const rect = anchor.getBoundingClientRect();
    state.launchAnchor = { top: Math.round(rect.bottom + 8), above: Math.round(rect.top - 8), right: Math.round(rect.right) };
    return paint(true);
  }

  /** Starts an exact launch edit from the local declaration or effective value. */
  function editDefaultAgent(kind) {
    const options = state.launch.options;
    const declaration = options?.declarations?.[kind];
    const effective = kind === "brain" ? options?.brainDefault : options?.workDefault;
    const launch = declaration?.mode === "launch" ? declaration.launch : effective;
    state.defaultAgents = { ...state.defaultAgents, editing: kind, mode: "launch" };
    state.launch.choice = launch?.harness ? { harness: launch.harness, model: launch.model ?? null, effort: launch.effort ?? null } : null;
    state.launch.command = "";
    state.launch.editing = false;
    paint(true);
  }

  /** Selects Follow Work or inheritance as a draft until Save. */
  function setDefaultAgentMode(kind, mode) {
    state.defaultAgents = { ...state.defaultAgents, editing: kind, mode };
    state.launch.choice = null;
    state.launch.command = "";
    paint(true);
  }

  /** Saves the current picker selection as the Area's durable default. */
  async function saveLaunchDefault() {
    const settings = state.launchTarget === DEFAULT_AGENTS_TARGET;
    if (settings) {
      const { area, editing: kind, mode } = state.defaultAgents;
      const selection = launchSelection();
      if (!area || !kind || !mode || (mode === "launch" && !selection?.harness)) return;
      try {
        const saved = await post("/api/launch/default", {
          area,
          kind,
          mode,
          ...(mode === "launch" ? { launch: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) } } : {}),
        });
        state.defaultAgents = { area, editing: "", mode: "", ...(state.defaultAgents.origin ? { origin: state.defaultAgents.origin } : {}) };
        state.launch.options = null;
        launchOptionsFor(area);
        showToast(`${kind === "brain" ? "Brain" : "Work"} now uses ${saved.label || saved.command}.`);
        paint(true);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const area = state.launchTarget === DESCRIBE_LAUNCH_TARGET
      ? describeLaunchArea()
      : state.launchTarget === BRAIN_LAUNCH_TARGET
        ? state.brainDraft?.area
        : (state.launchTarget ? goalByFile(state.launchTarget)?.area : currentGoal()?.area);
    const selection = launchSelection();
    if (!area || !selection?.harness || selection.edited) return;
    try {
      const saved = await post("/api/launch/default", {
        area,
        ...(state.launchTarget === BRAIN_LAUNCH_TARGET ? { kind: "brain" } : {}),
        launch: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) },
      });
      state.launch.options = null;
      launchOptionsFor(area);
      showToast(`${saved.label} is now the ${state.launchTarget === BRAIN_LAUNCH_TARGET ? "brain " : ""}default for ${areaLabel(area)}.`);
      paint(true);
    } catch (error) {
      showToast(error.message);
    }
  }

  /** Opens the harness registry editor and loads the current registry. */
  function showHarnessEditor(returnView = state.view === "harnesses" ? state.harnessReturnView : state.view) {
    state.harnessReturnView = returnView;
    state.launchTarget = "";
    state.launchAnchor = null;
    state.launch.open = false;
    state.view = "harnesses";
    // Back and Escape keep an unsaved registry draft in memory. Only Save or
    // the explicit Discard action destroys it.
    if (state.harnessDraft) return paint(true);
    api("/api/harnesses")
      .then((data) => { state.harnessDraft = data.registry; paint(true); })
      .catch((error) => showToast(error.message));
    paint(true);
  }

  /** Leaves the registry editor; only an explicit discard destroys its draft. */
  function leaveHarnessEditor({ discard = false } = {}) {
    state.view = state.harnessReturnView || "work";
    if (discard) state.harnessDraft = null;
    paint(true);
  }

  /** A stable lowercase id for a new registry entry. */
  function harnessSlug(value, taken) {
    let slug = String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "entry";
    for (let index = 2; taken.has(slug); index += 1) slug = `${slug}-${index}`;
    taken.add(slug);
    return slug;
  }

  /** Saves the edited registry for every Area, then returns to the caller view. */
  async function saveHarnesses() {
    const draft = structuredClone(state.harnessDraft ?? { modelSets: {}, harnesses: [] });
    draft.version = 1;
    draft.harnesses = (draft.harnesses ?? []).filter((harness) => (harness.label ?? "").trim() || (harness.command ?? "").trim());
    const harnessIds = new Set(draft.harnesses.map((harness) => harness.id).filter(Boolean));
    for (const harness of draft.harnesses) {
      if (!harness.id) harness.id = harnessSlug(harness.label || harness.command, harnessIds);
      if (!harness.modelSet) delete harness.modelSet;
      if (!harness.effortSet) delete harness.effortSet;
    }
    draft.effortSets = draft.effortSets ?? {};
    for (const name of Object.keys(draft.effortSets)) {
      draft.effortSets[name] = (draft.effortSets[name] ?? []).filter((effort) => (effort.label ?? "").trim() || (effort.args ?? "").trim());
      const effortIds = new Set(draft.effortSets[name].map((effort) => effort.id).filter(Boolean));
      for (const effort of draft.effortSets[name]) {
        if (!effort.id) effort.id = harnessSlug(effort.label || effort.args, effortIds);
      }
    }
    for (const name of Object.keys(draft.modelSets ?? {})) {
      draft.modelSets[name] = (draft.modelSets[name] ?? []).filter((model) => (model.label ?? "").trim() || (model.args ?? "").trim());
      const modelIds = new Set(draft.modelSets[name].map((model) => model.id).filter(Boolean));
      for (const model of draft.modelSets[name]) {
        if (!model.id) model.id = harnessSlug(model.label || model.args, modelIds);
      }
    }
    try {
      await post("/api/harnesses", draft);
      state.launch = { area: "", kind: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", assignmentKind: "implementation", assignmentPath: "", continueFrom: null, steps: [], active: 0, record: null, stale: null, queueMutation: null, replacement: null };
      state.view = state.harnessReturnView;
      state.harnessDraft = null;
      paint(true);
      showToast("Harnesses saved for every Area.");
    } catch (error) {
      showToast(error.message);
    }
  }

  /**
   * The harness registry editor: plain fields instead of a file. A harness is
   * one exact command or alias; a model option pairs a display label with
   * exact arguments; harnesses with the same interface share one model set.
   */
  function renderHarnessEditor() {
    const draft = state.harnessDraft;
    if (!draft) return `<div class="loading">Loading harnesses…</div>`;
    const setNames = Object.keys(draft.modelSets ?? {});
    const effortSetNames = Object.keys(draft.effortSets ?? {});
    const harnessRows = (draft.harnesses ?? []).map((harness, index) => `
      <div class="harness-row">
        <input data-harness-field="label" data-index="${index}" value="${escapeHtml(harness.label ?? "")}" placeholder="Display name" aria-label="Harness name">
        <input class="mono" data-harness-field="command" data-index="${index}" value="${escapeHtml(harness.command ?? "")}" placeholder="Exact command or alias" aria-label="Harness command">
        <select data-harness-field="modelSet" data-index="${index}" aria-label="Model set">
          <option value="">No models</option>
          ${setNames.map((name) => `<option value="${escapeHtml(name)}"${harness.modelSet === name ? " selected" : ""}>${escapeHtml(name)} models</option>`).join("")}
        </select>
        <select data-harness-field="effortSet" data-index="${index}" aria-label="Effort set">
          <option value="">No effort</option>
          ${effortSetNames.map((name) => `<option value="${escapeHtml(name)}"${harness.effortSet === name ? " selected" : ""}>${escapeHtml(name)} efforts</option>`).join("")}
        </select>
        <button class="quiet-button" type="button" data-remove-harness="${index}" aria-label="Remove ${escapeHtml(harness.label || "harness")}">✕</button>
      </div>`).join("");
    const setBlocks = setNames.map((name) => `
      <div class="model-set">
        <h3>${escapeHtml(name)} models</h3>
        <div class="model-rows">
          ${(draft.modelSets[name] ?? []).map((model, index) => `
          <div class="model-row">
            <input data-model-field="label" data-set="${escapeHtml(name)}" data-index="${index}" value="${escapeHtml(model.label ?? "")}" placeholder="Display label (Opus 4.6)" aria-label="Model label">
            <input class="mono" data-model-field="args" data-set="${escapeHtml(name)}" data-index="${index}" value="${escapeHtml(model.args ?? "")}" placeholder="Exact arguments (--model claude-opus-4-6)" aria-label="Model arguments">
            <select data-model-field="effortSet" data-set="${escapeHtml(name)}" data-index="${index}" aria-label="Model effort set">
              <option value="">Harness efforts</option>
              ${effortSetNames.map((effortSet) => `<option value="${escapeHtml(effortSet)}"${model.effortSet === effortSet ? " selected" : ""}>${escapeHtml(effortSet)} efforts</option>`).join("")}
            </select>
            <button class="quiet-button" type="button" data-remove-model data-set="${escapeHtml(name)}" data-index="${index}" aria-label="Remove option">✕</button>
          </div>`).join("")}
        </div>
        <button class="quiet-button" type="button" data-add-model="${escapeHtml(name)}">Add model</button>
      </div>`).join("");
    const effortBlocks = effortSetNames.map((name) => `
      <div class="model-set">
        <h3>${escapeHtml(name)} efforts</h3>
        <div class="model-rows">
          ${(draft.effortSets[name] ?? []).map((effort, index) => `
          <div class="model-row">
            <input data-effort-field="label" data-set="${escapeHtml(name)}" data-index="${index}" value="${escapeHtml(effort.label ?? "")}" placeholder="Display label (High)" aria-label="Effort label">
            <input class="mono" data-effort-field="args" data-set="${escapeHtml(name)}" data-index="${index}" value="${escapeHtml(effort.args ?? "")}" placeholder="Exact arguments (-c model_reasoning_effort=high)" aria-label="Effort arguments">
            <button class="quiet-button" type="button" data-remove-effort data-set="${escapeHtml(name)}" data-index="${index}" aria-label="Remove option">✕</button>
          </div>`).join("")}
        </div>
        <button class="quiet-button" type="button" data-add-effort="${escapeHtml(name)}">Add effort</button>
      </div>`).join("");
    return `
      <article class="summary-page harness-editor" data-harness-form>
        <p class="kicker">Machine-wide</p>
        <h1 class="goal-title">Harnesses, models, and efforts</h1>
        <p class="next-action-copy">A harness is one exact CLI command or alias. A model pairs the label you pick from with the exact arguments the command needs. Every Area launches from this one list.</p>
        <section class="summary-section">
          <h2>Harnesses</h2>
          <div class="harness-rows">${harnessRows || `<p class="launch-none">No harnesses yet.</p>`}</div>
          <button class="secondary-button" type="button" data-add-harness>Add harness</button>
        </section>
        <section class="summary-section">
          <h2>Model sets</h2>
          <p class="form-note">Harnesses with the same model interface share one set. Both Claude identities use the claude set.</p>
          ${setBlocks || ""}
          <div class="model-set-add">
            <input id="new-set-name" placeholder="New set name" aria-label="New model set name">
            <button class="secondary-button" type="button" data-add-set>Add model set</button>
          </div>
        </section>
        <section class="summary-section">
          <h2>Effort sets</h2>
          <p class="form-note">A third axis after the model: the exact arguments that set thinking effort. A harness with no effort set has no effort choice.</p>
          ${effortBlocks || ""}
          <div class="model-set-add">
            <input id="new-effort-set-name" placeholder="New effort set name" aria-label="New effort set name">
            <button class="secondary-button" type="button" data-add-effort-set>Add effort set</button>
          </div>
        </section>
        <div class="action-row">
          <button class="primary-button" type="button" data-save-harnesses title="Save harnesses and models (Command-Enter)">Save <kbd>⌘↵</kbd></button>
          <button class="quiet-button" type="button" data-leave-harnesses aria-keyshortcuts="Escape" title="Return without discarding this draft (Escape)">Back <kbd>Esc</kbd></button>
          <button class="quiet-button" type="button" data-cancel-harnesses title="Discard this unsaved draft">Discard changes</button>
        </div>
        <p class="form-note">Saved to <code>~/.tangent/trees/harnesses.md</code> and applied to the next launch. Area defaults keep pointing at unchanged ids.</p>
      </article>
    `;
  }

  /** Renders the complete native agent terminal without a second chat. */

  return { selectableAreas, preferredArea, areaOptions, renderCreate, renderDescribeCapture, describeSourcesBlock, launchOptionsFor, launchSelection, launchRequestFields, launchFieldsForArea, blankLaunchStep, launchStepsForRecord, launchStepIsMutable, launchStepDraft, syncLaunchDraft, commitActiveStep, activateLaunchStep, loadLaunchStep, addLaunchStep, removeLaunchStep, moveLaunchStep, launchStepLabel, launchStepRequest, launchIsPipeline, pipelineForGoal, pipelineRecordForGoal, launchDraftRows, pipelineMutationOperations, rebasePipelineDraft, launchStepList, launchPickerBlock, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, leaveHarnessEditor, harnessSlug, saveHarnesses, renderHarnessEditor };
}
