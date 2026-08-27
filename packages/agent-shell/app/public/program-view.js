import { escapeHtml } from "./text-format.js";

/** Creates the program view product boundary. */
export function createProgramView({ state, areaLabel, areaPath, humanName, agentName, areaOptions }) {
  /** Finds a Program by its stable identifier. */
  function programById(id) {
    return state.programs.operations.find((program) => program.id === id) ?? null;
  }

  /** Returns the program the shell has open. */
  function currentProgram() {
    return programById(state.programId);
  }

  /** True while one program holds a running session. */
  function programIsLive(program) {
    return Boolean(program.session && !["stopped", "shell"].includes(program.session.state));
  }

  /** Describes one program's current state in plain language. */
  function programState(program) {
    if (!program.session) return "Not running";
    if (["stopped", "shell"].includes(program.session.state)) return "Stopped · log kept";
    return "Running";
  }

  /** Formats one stored instant for the local reader. */
  function localMoment(value) {
    if (!value) return "Not yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  /** Names the kind of one program for a reader: the stored kind `process` is a Service (D19). */
  function programKind(program) {
    return program.type === "process" ? "Service" : "Command";
  }

  /**
   * The runtime controls a program row offers. Stopping a runaway program
   * must not be a hidden feature, so the row carries it beside the state.
   */
  function programRowControls(program) {
    const live = programIsLive(program);
    const controls = live ? [{ action: "stop", label: "Stop" }] : [];
    if (live || !program.available) return controls;
    controls.push(program.type === "process" ? { action: "start", label: "Start" } : { action: "run", label: "Run" });
    return controls;
  }

  /** Renders one row control so every surface that lists Programs matches. */
  function programRowControlButton(program, control) {
    return `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>`;
  }

  /** Renders one compact program row with its state and its controls. */
  function programRow(program) {
    return `
      <div class="program-row">
        <button class="program-open" type="button" data-select-program="${escapeHtml(program.id)}">
          <small>${escapeHtml(programKind(program))}</small><strong>${escapeHtml(program.label)}</strong><em>${escapeHtml(program.command)}</em>
        </button>
        <div class="program-row-controls">
          <span class="program-state ${programIsLive(program) ? "live" : ""}">${escapeHtml(programState(program))}</span>
          ${programRowControls(program).map((control) => programRowControlButton(program, control)).join("")}
        </div>
      </div>`;
  }

  /** Renders the controls and facts for one selected program. */
  function renderProgramDetail(program) {
    if (!program) return renderAreas();
    const live = programIsLive(program);
    const retained = Boolean(program.session);
    let actions = "";
    if (program.type === "process") {
      actions = [
        retained ? `<button class="secondary-button" type="button" data-open-program-session>Open session</button>` : "",
        live ? `<button class="secondary-button" type="button" data-program-action="restart">Restart…</button><button class="danger-button" type="button" data-program-action="stop">Stop…</button>` : `<button class="primary-button" type="button" data-program-action="start">Start</button>`,
        retained && !live ? `<button class="quiet-button" type="button" data-program-action="close">Remove saved log…</button>` : "",
      ].join("");
    } else if (program.type === "command") {
      actions = [
        retained ? `<button class="secondary-button" type="button" data-open-program-session>Open session</button>` : "",
        live ? `<button class="danger-button" type="button" data-program-action="stop">Stop…</button>` : `<button class="primary-button" type="button" data-program-action="run">Run…</button>`,
        retained && !live ? `<button class="quiet-button" type="button" data-program-action="close">Remove saved log…</button>` : "",
      ].join("");
    }
    return `
      <article class="program-detail">
        ${areaPath(program.area)}
        <p class="kicker">${escapeHtml(programKind(program))}</p>
        <h1>${escapeHtml(program.label)}</h1>
        <p class="program-detail-state"><span class="status-mark"></span>${escapeHtml(programState(program))}</p>
        <dl class="program-facts">
          <div><dt>Command</dt><dd><code>${escapeHtml(program.command)}</code></dd></div>
          <div><dt>Folder</dt><dd><code>${escapeHtml(program.cwd || "No area folder is recorded")}</code></dd></div>
          ${program.session ? `<div><dt>Session</dt><dd><code>${escapeHtml(program.sessionName)}</code></dd></div>` : ""}
        </dl>
        <div class="program-actions">${actions}</div>
      </article>`;
  }

  /** Selects a useful default folder for a new program. */
  function programAreaDirectory(area) {
    return state.programs.areas.find((item) => item.path === area)?.cwd || "";
  }

  /** Renders creation for a process or command. */
  function renderProgramCreate() {
    const draft = state.programDraft;
    return `
      <article class="create-page program-create-page">
        <p class="kicker">New program</p><h1>What should run?</h1>
        <p class="create-lede">Keep the setup with its area. Nothing runs until you use a clear action.</p>
        <form class="create-form" data-program-form data-command-enter-submit>
          <label><span>Kind</span><select name="type" data-program-draft="type"><option value="process" ${draft.type === "process" ? "selected" : ""}>Service (server or watcher)</option><option value="command" ${draft.type === "command" ? "selected" : ""}>One-off command</option></select></label>
          <label><span>Area</span><select name="area" data-program-draft="area" required>${areaOptions(draft.area)}</select></label>
          <label><span>Name</span><input name="name" data-program-draft="name" value="${escapeHtml(draft.name)}" required placeholder="Development server" /></label>
          <label><span>Working folder</span><input name="cwd" data-program-draft="cwd" value="${escapeHtml(draft.cwd)}" required placeholder="/path/to/repository" /></label>
          <label><span>Command</span><input name="command" data-program-draft="command" value="${escapeHtml(draft.command)}" required placeholder="npm run dev" /></label>
          <div class="create-actions"><button class="primary-button" type="submit">Save program <kbd>⌘↵</kbd></button><button class="quiet-button" type="button" data-cancel-program-create>Cancel</button></div>
          <p class="form-note">Commands always ask before they run. Service sessions keep their scrollback after Stop.</p>
        </form>
      </article>`;
  }

  /** Renders retained session controls for compatibility; the shell mounts terminals only in the session layer. */
  function renderProgramSession(program) {
    return `
      <section class="agent-page">
        <div class="agent-toolbar"><div class="agent-context"><strong>${escapeHtml(program.label)}</strong><span>${escapeHtml(areaLabel(program.area))} · ${escapeHtml(programState(program))}</span></div><div class="agent-controls">${programIsLive(program) ? `<button class="danger-button" type="button" data-program-action="stop" data-program-id="${escapeHtml(program.id)}">Stop…</button>` : ""}<button class="quiet-button" type="button" data-back-program>Program details</button></div></div>
      </section>`;
  }

  /** Returns the areas a user can select when they define work. */

  return { programById, currentProgram, programIsLive, programState, localMoment, programKind, programRowControls, programRow, renderProgramDetail, programAreaDirectory, renderProgramCreate, renderProgramSession };
}
