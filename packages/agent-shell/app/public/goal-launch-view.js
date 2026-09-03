import { currentBriefFields, storyEntries } from "./goal-narrative.js";
import { escapeHtml } from "./text-format.js";

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

  /**
   * The plain composer behind `a` on an Area (D8): one message to that
   * Area's brain. A live brain gets it now; an inactive one starts with it
   * as its first message. Nothing else starts work.
   */
  function renderDescribeCapture() {
    const draft = state.describeDraft;
    const area = draft?.area || preferredArea();
    const brain = controllingBrainForArea(area);
    const startLabel = brain?.live ? "Send" : brain ? "Send and wake the brain" : "Send and start the brain";
    return `
      <article class="create-page describe-page">
        <p class="kicker">Message the brain</p>
        <h1>What do you want?</h1>
        <p class="create-lede">Say it in your words. The Area brain reads its notes, makes the Goals, and starts the workers.</p>

        ${describeSourcesBlock(draft)}

        <form class="create-form" data-describe-work-form data-command-enter-submit>
          <label>
            <span>Area</span>
            <select id="describe-area" name="area" required>${areaOptions(draft?.area)}</select>
          </label>
          <label>
            <span>Your message</span>
            <textarea id="describe-work" name="description" class="describe-work-input" required placeholder="What you want, and what you already know. Say “check it myself” when you want to see the result before it closes.">${escapeHtml(draft?.description || "")}</textarea>
          </label>
          <div class="create-actions">
            <button class="primary-button" type="submit">${escapeHtml(startLabel)} <kbd>⌘↵</kbd></button>
            <button class="quiet-button" type="button" data-cancel-describe>Cancel</button>
          </div>
          <p class="form-note">${brain?.live ? "The brain is live and reads this next." : "The brain opens in the Area folder with the Area note as its instructions."}</p>
        </form>
      </article>
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
      state.launch = { area, kind, options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", assignmentKind: "implementation", assignmentPath: "", continueFrom: null, steps: [], active: 0, record: null };
    } else state.launch.kind = kind;
    if (!state.launch.options && !state.launch.loading) {
      state.launch.loading = true;
      api(`/api/launch/options?area=${encodeURIComponent(area)}${kind === "launch" ? "" : `&kind=${kind}`}`)
        .then((options) => {
          state.launch.options = options;
          if (state.launchTarget === DEFAULT_AGENTS_TARGET && !state.launch.command) {
            state.launch.command = (options.declarations?.allow ?? []).map((ref) => [ref.harness, ref.model, ref.effort].filter(Boolean).join("/")).join("\n");
          }
        })
        .catch((error) => { state.launch.options = { harnesses: [], default: { error: error.message } }; })
        .finally(() => { state.launch.loading = false; paint(true); });
    }
    return state.launch.options;
  }

  /**
   * The picker's current selection, seeded from the last valid Area launch. Recognition
   * over recall: labels carry the choice, the composed command stays exact.
   */
  function launchSelection() {
    const options = state.launch.options;
    if (!options) return null;
    const preset = options.remembered && !options.remembered.error ? options.remembered : null;
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

  /** The label one draft row shows in the step list. */
  function launchStepLabel(row) {
    const options = state.launch.options;
    if (row.command?.trim()) return row.command.trim();
    const harness = row.choice ? (options?.harnesses ?? []).find((entry) => entry.id === row.choice.harness) : null;
    if (!harness) return options?.remembered && !options.remembered.error ? (options.remembered.label || options.remembered.command || "Last launch") : "Choose a launch";
    const model = (harness.models ?? []).find((entry) => entry.id === row.choice.model);
    const effort = (model?.efforts ?? harness.efforts ?? []).find((entry) => entry.id === row.choice.effort);
    return [harness.label, model?.label, effort?.label].filter(Boolean).join(" · ");
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

  /**
   * The keys the chooser prints and answers. One list renders the header
   * hint and the `<kbd>` on each button, so the hint cannot drift from the
   * controls (design: brain-launch-keyboard).
   */
  function launchSurfaceKeys() {
    const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
    const settings = state.launchTarget === DEFAULT_AGENTS_TARGET;
    const brain = braining ? brainForAreaCard(state.brainDraft?.area) : null;
    const brainResumes = Boolean(brain && !brain.live);
    const keys = [
      { key: "h/l", label: "column" },
      { key: "j/k", label: "choose" },
      { key: "↵", label: braining ? (brainResumes ? "wake" : "start") : settings ? "save" : "start" },
    ];
    if (brainResumes) keys.push({ id: "startOver", key: "n", label: "start over" });
    if (braining) keys.push({ id: "changeDefault", key: "d", label: "policy" });
    keys.push({ id: "registry", key: "e", label: "harnesses" });
    keys.push({ key: "Esc", label: "back" });
    return keys;
  }

  /** The header hint line, rendered from the same key list as the buttons. */
  function launchKeyHint() {
    return launchSurfaceKeys().map((entry) => `<kbd>${escapeHtml(entry.key)}</kbd> ${escapeHtml(entry.label)}`).join(" · ");
  }

  /** The printed key for one chooser command, or nothing when it has none. */
  function launchKeyFor(id) {
    return launchSurfaceKeys().find((entry) => entry.id === id)?.key ?? "";
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
    const presetCandidate = options.remembered;
    const presetError = presetCandidate?.error ?? "";
    const preset = presetCandidate && !presetCandidate.error ? presetCandidate : {};
    const currentHarness = selection?.harness ?? null;
    const harnessButtons = (options.harnesses ?? []).map((harness) => `
      <button type="button" role="radio" aria-checked="${currentHarness?.id === harness.id}" class="launch-option${currentHarness?.id === harness.id ? " selected" : ""}" data-launch-harness="${escapeHtml(harness.id)}" data-focus-key="launch:harness:${escapeHtml(harness.id)}">
        <span>${escapeHtml(harness.label)}</span>${preset.harness === harness.id ? `<span class="launch-default-tag">default</span>` : ""}
      </button>`).join("");
    const models = currentHarness?.models ?? [];
    const modelButtons = models.length
      ? models.map((model) => `
        <button type="button" role="radio" aria-checked="${selection?.model?.id === model.id}" class="launch-option${selection?.model?.id === model.id ? " selected" : ""}" data-launch-model="${escapeHtml(model.id)}" data-focus-key="launch:model:${escapeHtml(currentHarness?.id ?? "")}:${escapeHtml(model.id)}">
          <span>${escapeHtml(model.label)}</span>${preset.harness === currentHarness?.id && preset.model === model.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("")
      : `<p class="launch-none">${currentHarness ? "No model choice. The command is complete." : "Pick a harness first."}</p>`;
    const efforts = selection?.model?.efforts ?? currentHarness?.efforts ?? [];
    const effortButtons = efforts.map((effort) => `
        <button type="button" role="radio" aria-checked="${selection?.effort?.id === effort.id}" class="launch-option${selection?.effort?.id === effort.id ? " selected" : ""}" data-launch-effort="${escapeHtml(effort.id)}" data-focus-key="launch:effort:${escapeHtml(currentHarness?.id ?? "")}:${escapeHtml(selection?.model?.id ?? "")}:${escapeHtml(effort.id)}">
          <span>${escapeHtml(effort.label)}</span>${preset.harness === currentHarness?.id && preset.effort === effort.id ? `<span class="launch-default-tag">default</span>` : ""}
        </button>`).join("");
    const command = selection?.command ?? "";
    const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
    const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
    const brainRef = braining ? [selection?.harness?.id, selection?.model?.id, selection?.effort?.id].filter(Boolean).join("/") : "";
    const brainSource = braining && preset.source ? (preset.source === state.brainDraft?.area ? "Set on this Area" : `Inherited from ${areaLabel(preset.source)}`) : "";
    const brainOverride = braining && Boolean(state.launch.choice?.harness);
    const commandZone = braining
      ? `<section class="brain-launch-summary${brainOverride ? " override" : ""}" aria-label="Resolved brain launch"><p class="kicker">Brain launch</p><strong>${escapeHtml(brainRef || "Not configured")}</strong><span>${escapeHtml(selection?.label || presetError)}</span><code>${escapeHtml(selection?.command || "")}</code>${brainOverride ? `<small class="launch-override-note">One launch only · Area memory unchanged</small>` : brainSource ? `<small>${escapeHtml(brainSource)}</small>` : ""}<button class="quiet-button" type="button" data-default-agents-area="${escapeHtml(state.brainDraft?.area ?? "")}" data-default-agents-origin="brain" data-launch-key="${escapeHtml(launchKeyFor("changeDefault"))}" data-focus-key="launch:brain:default">Change policy <kbd>${escapeHtml(launchKeyFor("changeDefault"))}</kbd></button></section>`
      : settings
      ? `<div class="launch-command"><code>${escapeHtml(command)}</code></div>`
      : state.launch.editing
      ? `<div class="launch-command"><input id="launch-command-input" type="text" spellcheck="false" value="${escapeHtml(state.launch.command || command)}"><button class="quiet-button" type="button" data-launch-reset>Reset</button></div>
         <p class="form-note">The edited command applies to this run only.</p>`
      : `<div class="launch-command"><code>${escapeHtml(command)}</code>${selection?.edited ? `<span class="launch-default-tag">edited</span>` : ""}<button class="quiet-button" type="button" data-launch-edit>Edit command</button></div>`;
    const brain = braining ? brainForAreaCard(state.brainDraft?.area) : null;
    const brainResumes = Boolean(brain && !brain.live);
    const startLabel = braining
      ? (brainResumes ? "Wake brain" : "Start brain")
      : `Start ${selection ? (selection.label || "agent") : "agent"}`;
    // No instruction box: a brain starts from its Area note and AGENTS.md
    // chain, and Julian messages it when he has something to say (2026-08-28).
    const brainZone = braining && brainResumes
      ? `<p class="form-note">A brain ran here before (${escapeHtml(brainStateLabel(brain).toLowerCase())}). Wake keeps its founding instruction and its plan. Start over begins a new brain.</p>`
      : "";
    const settingsRows = settings ? defaultAgentRows(options) : "";
    const settingsMode = state.defaultAgents.mode;
    const showChoices = braining || !settings;
    const settingsEditor = settings ? `
      <section class="default-agent-editor" aria-label="Edit Area launch policy">
        <label for="launch-command-input">Allowed launches</label>
        <textarea id="launch-command-input" rows="6" spellcheck="false" placeholder="harness[/model[/effort]], one per line">${escapeHtml(state.launch.command)}</textarea>
        <p>Each child Area can narrow this policy. It cannot allow a launch that its parent rejects.</p>
      </section>` : "";
    const settingsActions = settings ? `
      <div class="action-row start-actions">
        <button class="primary-button" type="button" data-launch-save data-launch-primary data-focus-key="launch:default:save">Save <kbd>↵</kbd></button>
        <button class="quiet-button" type="button" data-launch-close data-focus-key="launch:close">${state.defaultAgents.origin === "brain" ? "Back" : "Close"}</button>
      </div>` : "";
    const columns = showChoices && (options.harnesses ?? []).length ? `
        <div class="launch-columns" aria-label="Agent choices">
          <div class="launch-col" data-launch-column="harness" role="radiogroup" aria-label="Harness"><p class="launch-col-title">Harness</p>${harnessButtons}</div>
          <div class="launch-col" data-launch-column="model" role="radiogroup" aria-label="Model"><p class="launch-col-title">Model</p>${modelButtons}</div>
          ${efforts.length ? `<div class="launch-col" data-launch-column="effort" role="radiogroup" aria-label="Effort"><p class="launch-col-title">Effort</p>${effortButtons}</div>` : ""}
        </div>` : showChoices ? `<p class="launch-none">No harness registry. Add one at <code>~/.tangent/trees/harnesses.md</code>.</p>` : "";
    const actions = settingsActions || `<div class="action-row start-actions">
          <button class="primary-button" type="button" data-launch-start data-launch-primary data-focus-key="launch:start" ${braining && !selection?.harness ? "disabled" : ""}>${escapeHtml(startLabel)} <kbd>↵</kbd></button>
          ${brainResumes ? `<button class="quiet-button" type="button" data-brain-start-over data-launch-key="${escapeHtml(launchKeyFor("startOver"))}" data-focus-key="launch:brain:start-over">Start over <kbd>${escapeHtml(launchKeyFor("startOver"))}</kbd></button>` : ""}
          <button class="quiet-button" type="button" data-launch-close data-focus-key="launch:close">${state.launchTarget ? "Close" : "Back"} <kbd>Esc</kbd></button>
        </div>`;
    const registryLink = `<button class="quiet-button launch-registry-link" type="button" data-open-harnesses data-launch-key="${escapeHtml(launchKeyFor("registry"))}" data-focus-key="launch:registry">Edit harnesses and models… <kbd>${escapeHtml(launchKeyFor("registry"))}</kbd></button>`;
    // The brain's common path is Enter on the default. Its summary and actions
    // sit above the columns so the fold never hides them.
    // The keys are printed above the choices they move, in the popover and in
    // the Brain pane alike. One list prints them and one grammar answers them.
    // A surface with no columns has no movement to describe.
    const keyHint = columns ? `<p class="launch-key-hint">${launchKeyHint()}</p>` : "";
    const body = braining
      ? `${brainZone}${commandZone}${actions}${keyHint}${columns}${registryLink}`
      : `${settingsRows}${brainZone}${settingsEditor}${keyHint}${columns}${showChoices ? commandZone : ""}${actions}${registryLink}`;
    return `
      <div class="launch-picker" data-launch-picker>
        ${body}
      </div>
    `;
  }

  /** Renders the effective policy and its declaration chain. */
  function defaultAgentRows(options) {
    const refs = (options.policy?.allow ?? []).map((ref) => [ref.harness, ref.model, ref.effort].filter(Boolean).join("/")).join(", ");
    const source = options.policy?.declaredBy?.length ? `Declared by ${options.policy.declaredBy.join(" → ")}` : "No Area policy";
    return `<div class="default-agent-rows"><div class="default-agent-row"><div class="default-agent-value"><strong>Allowed launches</strong><span>${escapeHtml(options.policy?.unrestricted ? "Unrestricted" : refs || "None")}</span><small>${escapeHtml(source)}</small></div></div></div>`;
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
    state.defaultAgents = { area, editing: "policy", mode: "policy", ...(button.dataset.defaultAgentsOrigin ? { origin: button.dataset.defaultAgentsOrigin } : {}) };
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
      const { area } = state.defaultAgents;
      if (!area) return;
      try {
        const allow = state.launch.command.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
        await post("/api/launch/policy", { area, allow });
        state.defaultAgents = { area, editing: "", mode: "", ...(state.defaultAgents.origin ? { origin: state.defaultAgents.origin } : {}) };
        state.launch.options = null;
        launchOptionsFor(area);
        showToast(`Saved the launch policy for ${areaLabel(area)}.`);
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
    draft.version = 2;
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
      state.launch = { area: "", kind: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", assignmentKind: "implementation", assignmentPath: "", continueFrom: null, steps: [], active: 0, record: null };
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

  return { selectableAreas, preferredArea, areaOptions, renderDescribeCapture, describeSourcesBlock, launchOptionsFor, launchSelection, launchRequestFields, blankLaunchStep, launchStepsForRecord, launchStepIsMutable, launchStepDraft, syncLaunchDraft, commitActiveStep, activateLaunchStep, loadLaunchStep, launchStepLabel, pipelineForGoal, pipelineRecordForGoal, launchPickerBlock, launchKeyHint, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, leaveHarnessEditor, harnessSlug, saveHarnesses, renderHarnessEditor };
}
