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
            <button class="primary-button" type="submit">Create goal <kbd>⌘↵</kbd></button>
            <button class="quiet-button" type="button" data-cancel-create>Cancel</button>
          </div>
          <p class="form-note">Creating the goal does not start an agent.</p>
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
      state.launch = { area, kind, options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null };
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

  // ---- pipeline drafts ----
  // The popover holds one draft step per row. The active row's fields live in
  // state.launch (choice, command, instruction, continueFrom) so the picker
  // code works unchanged; the other rows wait in state.launch.steps.

  /** The active row's draft as one plain object. */
  function launchStepDraft() {
    return { choice: state.launch.choice, command: state.launch.command, instruction: state.launch.instruction, continueFrom: state.launch.continueFrom };
  }

  /** Copies the typed instruction and command into the active row before any repaint. */
  function syncLaunchDraft() {
    const instruction = document.querySelector("#launch-instruction");
    if (instruction) state.launch.instruction = instruction.value;
    const brainInstruction = document.querySelector("#brain-instruction");
    if (brainInstruction && state.brainDraft) state.brainDraft.instruction = brainInstruction.value;
    const command = document.querySelector("#launch-command-input");
    if (command) state.launch.command = command.value;
  }

  /** Stores the active row's fields into the steps array and returns the array. */
  function commitActiveStep() {
    const steps = state.launch.steps.length ? state.launch.steps : [launchStepDraft()];
    steps[state.launch.active] = launchStepDraft();
    state.launch.steps = steps;
    return steps;
  }

  /** Stores the active row, then loads another row into the active fields. */
  function activateLaunchStep(index) {
    loadLaunchStep(commitActiveStep(), index);
  }

  /** Loads one row of the given steps into the active fields without storing the current one. */
  function loadLaunchStep(steps, index) {
    const row = steps[index] ?? { choice: null, command: "", instruction: "", continueFrom: null };
    state.launch.active = index;
    state.launch.choice = row.choice ?? null;
    state.launch.command = row.command ?? "";
    state.launch.instruction = row.instruction ?? "";
    state.launch.continueFrom = row.continueFrom ?? null;
    state.launch.editing = false;
  }

  /** Appends one row and makes it active. */
  function addLaunchStep() {
    const steps = commitActiveStep();
    steps.push({ choice: null, command: "", instruction: "", continueFrom: null });
    activateLaunchStep(steps.length - 1);
  }

  /**
   * Removes one draft row; the active row moves to the nearest remaining
   * editable one. Rows that belong to a record are history and never go. The
   * last editable row stays, so the picker always has something to edit.
   */
  function removeLaunchStep(index) {
    const steps = commitActiveStep();
    const fixed = state.launch.record ? state.launch.record.steps.length : 0;
    const firstPending = state.launch.record ? state.launch.record.steps.findIndex((step) => step.status === "pending") : -1;
    if (index < fixed) return;
    if (steps.length - fixed <= 1 && firstPending < 0) return;
    steps.splice(index, 1);
    for (const step of steps) if (step.continueFrom && step.continueFrom > steps.length) step.continueFrom = null;
    const nearest = Math.min(state.launch.active > index ? state.launch.active - 1 : state.launch.active, steps.length - 1);
    // Load without committing: the removed row must not be written back.
    loadLaunchStep(steps, nearest >= fixed || firstPending < 0 ? Math.max(nearest, fixed) : firstPending);
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
    const base = { instruction: row.instruction.trim(), continueFrom: row.continueFrom ?? null };
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
    if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return null;
    return (state.pipelines ?? []).find((item) => item.goal === goal.file) ?? null;
  }

  /** The draft rows the popover holds after a record's own steps: the steps to append. */
  function launchDraftRows(steps = commitActiveStep()) {
    const record = state.launch.record;
    return record ? steps.slice(record.steps.length) : steps;
  }

  /** The step list above the picker: rows, add, remove; describe mode has none. */
  function launchStepList() {
    if ([DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET].includes(state.launchTarget)) return "";
    const record = state.launch.record;
    const steps = commitActiveStep();
    const fixed = record ? record.steps.length : 0;
    const glyph = { complete: "✓", running: "●", pending: "○", skipped: "–", stopped: "■", ended: "■" };
    // Rows of a record: history stays fixed, pending rows edit in place.
    const recordRows = (record?.steps ?? []).map((step, index) => `
        <li class="launch-step ${step.status}${state.launch.active === index ? " selected" : ""}">
          ${step.status === "pending"
            ? `<button type="button" data-launch-step-select="${index}" title="Edit step ${step.index}"><b>${glyph[step.status]}</b><span>${step.index} · ${escapeHtml(step.label || launchStepLabel({ choice: step.launch, command: step.command }))}</span><em>${escapeHtml(clip(step.instruction, 60))}</em></button>`
            : `<span class="launch-step-fixed"><b>${glyph[step.status] ?? "○"}</b><span>${step.index} · ${escapeHtml(step.label || "agent")}</span><em>${escapeHtml(clip(step.instruction, 60))}</em></span>`}
        </li>`);
    // Draft rows: a new pipeline, or the steps to append after a record.
    const removable = record ? steps.length - fixed > 1 || record.steps.some((step) => step.status === "pending") : steps.length > 1;
    const draftRows = steps.slice(fixed).map((row, offset) => {
      const index = fixed + offset;
      return `
        <li class="launch-step draft${state.launch.active === index ? " selected" : ""}">
          <button type="button" data-launch-step-select="${index}" title="Edit step ${index + 1}"><b>${record ? "+" : index + 1}</b><span>${record ? `${index + 1} · ` : ""}${escapeHtml(launchStepLabel(row))}</span><em>${row.instruction?.trim() ? escapeHtml(clip(row.instruction.trim(), 60)) : "<i>no instruction</i>"}</em></button>
          ${removable ? `<button type="button" class="launch-step-remove" data-launch-step-remove="${index}" aria-label="Remove step ${index + 1}">×</button>` : ""}
        </li>`;
    });
    return `
      <ol class="launch-steps" aria-label="${record ? "Pipeline steps" : "Steps"}">${[...recordRows, ...draftRows].join("")}
      </ol>
      <button type="button" class="quiet-button launch-step-add" data-launch-step-add>+ Add step</button>`;
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
    const harnessButtons = (options.harnesses ?? []).map((harness) => `
      <button type="button" class="launch-option${currentHarness?.id === harness.id ? " selected" : ""}" data-launch-harness="${escapeHtml(harness.id)}">
        <span>${escapeHtml(harness.label)}</span>${preset.harness === harness.id ? `<span class="launch-default-tag">default</span>` : ""}
      </button>`).join("");
    const models = currentHarness?.models ?? [];
    const modelButtons = models.length
      ? models.map((model) => `
        <button type="button" class="launch-option${selection?.model?.id === model.id ? " selected" : ""}" data-launch-model="${escapeHtml(model.id)}">
          <span>${escapeHtml(model.label)}</span>${preset.harness === currentHarness?.id && preset.model === model.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("")
      : `<p class="launch-none">${currentHarness ? "No model choice. The command is complete." : "Pick a harness first."}</p>`;
    const efforts = selection?.model?.efforts ?? currentHarness?.efforts ?? [];
    const effortButtons = efforts.map((effort) => `
        <button type="button" class="launch-option${selection?.effort?.id === effort.id ? " selected" : ""}" data-launch-effort="${escapeHtml(effort.id)}">
          <span>${escapeHtml(effort.label)}</span>${preset.harness === currentHarness?.id && preset.effort === effort.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("");
    const command = selection?.command ?? "";
    const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
    const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
    const brainRef = braining ? [preset.harness, preset.model, preset.effort].filter(Boolean).join("/") : "";
    const brainSource = braining && preset.source ? (preset.source === state.brainDraft?.area ? "Set on this Area" : `Inherited from ${areaLabel(preset.source)}`) : "";
    const commandZone = braining
      ? `<section class="brain-launch-summary" aria-label="Resolved brain launch"><p class="kicker">Brain launch</p><strong>${escapeHtml(brainRef || "Not configured")}</strong><span>${escapeHtml(preset.label || presetError)}</span><code>${escapeHtml(preset.command || "")}</code>${brainSource ? `<small>${escapeHtml(brainSource)}</small>` : ""}<button class="quiet-button" type="button" data-default-agents-area="${escapeHtml(state.brainDraft?.area ?? "")}">Change default</button></section>`
      : settings
      ? `<div class="launch-command"><code>${escapeHtml(command)}</code></div>`
      : state.launch.editing
      ? `<div class="launch-command"><input id="launch-command-input" type="text" spellcheck="false" value="${escapeHtml(state.launch.command || command)}"><button class="quiet-button" type="button" data-launch-reset>Reset</button></div>
         <p class="form-note">The edited command applies to this run only.</p>`
      : `<div class="launch-command"><code>${escapeHtml(command)}</code>${selection?.edited ? `<span class="launch-default-tag">edited</span>` : ""}<button class="quiet-button" type="button" data-launch-edit>Edit command</button></div>`;
    const brain = braining ? brainForAreaCard(state.brainDraft?.area) : null;
    const brainResumes = Boolean(brain && !brain.live);
    const record = state.launch.record;
    const stepCount = describing || braining || settings ? 1 : commitActiveStep().length;
    const drafts = record ? launchDraftRows().length : 0;
    const startLabel = braining
      ? (brainResumes ? "Send and wake brain" : "Start brain")
      : record
      ? (state.launch.active < record.steps.length ? `Save step ${state.launch.active + 1}` : drafts > 1 ? `Add ${drafts} steps` : `Add step ${record.steps.length + 1}`)
      : stepCount > 1 ? `Start ${stepCount} steps` : `Start ${selection ? (selection.label || "agent") : "agent"}`;
    const brainZone = braining ? `
        <label class="brain-instruction"><span>${brainResumes ? "What should this brain do next?" : "What should this Area get done?"}</span><textarea id="brain-instruction" rows="5" placeholder="${brainResumes ? "The message that wakes this brain. It keeps its founding instruction and its plan, and reads this as the reason it is awake." : "The instruction the brain plans and dispatches from. It splits the work into Goals, starts agents in dependency order, reviews what comes back, and asks you only for real decisions."}">${escapeHtml(state.brainDraft?.instruction ?? "")}</textarea></label>
        ${brainResumes ? `<p class="form-note">A brain ran here before (${escapeHtml(brainStateLabel(brain).toLowerCase())}). Your message wakes it and keeps its founding instruction. Start over begins a new brain from the message above.</p>` : ""}` : "";
    const stepZone = describing || braining || settings ? "" : `
        <label class="launch-instruction"><span>Step ${state.launch.active + 1} does</span><textarea id="launch-instruction" rows="2" placeholder="${stepCount > 1 || record ? "What this agent does" : "What this agent does (optional for one step)"}">${escapeHtml(state.launch.instruction ?? "")}</textarea></label>
        ${state.launch.active > 0 ? `<label class="launch-continue"><span>Session</span><select data-launch-continue><option value="">Fresh session</option>${Array.from({ length: state.launch.active }, (_, k) => `<option value="${k + 1}"${state.launch.continueFrom === k + 1 ? " selected" : ""}>Continue step ${k + 1}</option>`).join("")}</select></label>` : ""}`;
    const settingsRows = settings ? defaultAgentRows(options) : "";
    const settingsMode = state.defaultAgents.mode;
    const showChoices = !braining && (!settings || (state.defaultAgents.editing && settingsMode === "launch"));
    const settingsEditor = settings && state.defaultAgents.editing ? `
      <section class="default-agent-editor" aria-label="Edit ${escapeHtml(state.defaultAgents.editing)} default">
        <p>${settingsMode === "launch" ? `Choose the harness, model, and effort for ${state.defaultAgents.editing === "brain" ? "Brain" : "Work"}.` : settingsMode === "work" ? "Brain will follow the Work default of this Area." : `The ${state.defaultAgents.editing === "brain" ? "Brain" : "Work"} default will inherit from the nearest parent Area.`}</p>
      </section>` : "";
    const settingsActions = settings ? `
      <div class="action-row start-actions">
        ${state.defaultAgents.editing ? `<button class="primary-button" type="button" data-launch-save ${settingsMode === "launch" && !selection?.harness ? "disabled" : ""}>Save</button><button class="quiet-button" type="button" data-default-agents-cancel>Cancel</button>` : ""}
        <button class="quiet-button" type="button" data-launch-close>Close</button>
      </div>` : "";
    return `
      <div class="launch-picker">
        ${settingsRows}
        ${launchStepList()}
        ${brainZone}
        ${settingsEditor}
        ${showChoices && (options.harnesses ?? []).length ? `
        <div class="launch-columns">
          <div class="launch-col"><p class="launch-col-title">Harness</p>${harnessButtons}</div>
          <div class="launch-col"><p class="launch-col-title">Model</p>${modelButtons}</div>
          ${efforts.length ? `<div class="launch-col"><p class="launch-col-title">Effort</p>${effortButtons}</div>` : ""}
        </div>` : showChoices ? `<p class="launch-none">No harness registry. Add one at <code>~/.tangent/trees/harnesses.md</code>.</p>` : ""}
        ${braining || showChoices ? commandZone : ""}
        ${stepZone}
        ${settingsActions || `<div class="action-row start-actions">
          <button class="primary-button" type="button" data-launch-start ${braining && !preset.harness ? "disabled" : ""}>${escapeHtml(startLabel)}</button>
          ${brainResumes ? `<button class="quiet-button" type="button" data-brain-start-over>Start over</button>` : ""}
          <button class="quiet-button" type="button" data-launch-close>${state.launchTarget ? "Close" : "Back"}</button>
        </div>`}
        <button class="quiet-button launch-registry-link" type="button" data-open-harnesses>Edit harnesses and models…</button>
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
          <button class="quiet-button" type="button" data-default-agent-edit="${kind}">Change</button>
          ${kind === "brain" ? `<button class="quiet-button" type="button" data-default-agent-mode="work" data-default-agent-kind="brain">Follow work</button>` : ""}
          ${local ? `<button class="quiet-button" type="button" data-default-agent-mode="inherit" data-default-agent-kind="${kind}">Use inherited</button>` : ""}
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
    state.defaultAgents = { area, editing: "", mode: "" };
    launchOptionsFor(area);
    const rect = button.getBoundingClientRect();
    state.launchAnchor = { top: Math.round(rect.bottom + 8), right: Math.round(rect.right) };
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
        state.defaultAgents = { area, editing: "", mode: "" };
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
    state.harnessDraft = null;
    state.view = "harnesses";
    api("/api/harnesses")
      .then((data) => { state.harnessDraft = data.registry; paint(true); })
      .catch((error) => showToast(error.message));
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
      state.launch = { area: "", kind: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null };
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
          <button class="primary-button" type="button" data-save-harnesses>Save</button>
          <button class="quiet-button" type="button" data-cancel-harnesses>Cancel</button>
        </div>
        <p class="form-note">Saved to <code>~/.tangent/trees/harnesses.md</code> and applied to the next launch. Area defaults keep pointing at unchanged ids.</p>
      </article>
    `;
  }

  /** Renders the complete native agent terminal without a second chat. */

  return { selectableAreas, preferredArea, areaOptions, renderCreate, renderDescribeCapture, describeSourcesBlock, launchOptionsFor, launchSelection, launchRequestFields, launchFieldsForArea, launchStepDraft, syncLaunchDraft, commitActiveStep, activateLaunchStep, loadLaunchStep, addLaunchStep, removeLaunchStep, launchStepLabel, launchStepRequest, launchIsPipeline, pipelineForGoal, pipelineRecordForGoal, launchDraftRows, launchStepList, launchPickerBlock, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, harnessSlug, saveHarnesses, renderHarnessEditor };
}
