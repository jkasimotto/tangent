import { escapeHtml } from "./text-format.js";

/** Creates the program view product boundary. */
export function createProgramView({ state, areaLabel, areaPath, humanName, agentName, areaOptions }) {
  /** Finds a Program by its stable identifier. */
  function programById(id) {
    return state.programs.programs.find((program) => program.id === id) ?? null;
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
    if (program.type === "trigger") {
      if (program.paused) return "Paused";
      if (program.session && !["stopped", "shell"].includes(program.session.state)) return "Agent running";
      if (program.runtime?.error) return "Check failed";
      if (program.runtime?.lastOutcome?.status === "attention" && program.runtime.acknowledgedKey !== program.runtime.lastOutcome.key) return "Needs attention";
      return program.runtime?.lastCheckedAt ? "Waiting" : "Not checked";
    }
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

  /** Names the kind of one program for a reader. */
  function programKind(program) {
    return program.type === "process" ? "Server or watcher" : program.type === "trigger" ? "Trigger" : "Command";
  }

  /**
   * The one runtime control a program row offers. Stopping a runaway program
   * must not be a hidden feature, so the row carries it beside the state.
   */
  function programRowControl(program) {
    if (program.type === "trigger") return program.available && !program.paused ? { action: "check", label: "Check now" } : null;
    if (programIsLive(program)) return { action: "stop", label: "Stop" };
    if (!program.available) return null;
    return program.type === "process" ? { action: "start", label: "Start" } : { action: "run", label: "Run" };
  }

  /** Renders one compact program row with its state and one control. */
  function programRow(program) {
    const control = programRowControl(program);
    return `
      <div class="program-row">
        <button class="program-open" type="button" data-select-program="${escapeHtml(program.id)}">
          <small>${escapeHtml(programKind(program))}</small><strong>${escapeHtml(program.label)}</strong><em>${escapeHtml(program.command)}</em>
        </button>
        <div class="program-row-controls">
          <span class="program-state ${programIsLive(program) ? "live" : ""}">${escapeHtml(programState(program))}</span>
          ${control ? `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>` : ""}
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
    } else if (program.type === "trigger") {
      const attention = program.runtime?.lastOutcome?.status === "attention" && program.runtime.acknowledgedKey !== program.runtime.lastOutcome.key;
      actions = [
        retained ? `<button class="secondary-button" type="button" data-open-program-session>Open session</button>` : "",
        !program.paused ? `<button class="primary-button" type="button" data-program-action="check">Check now</button>` : "",
        attention ? `<button class="secondary-button" type="button" data-program-action="acknowledge">Acknowledge</button>` : "",
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
          ${program.type === "trigger" ? `<div><dt>Cadence</dt><dd>${escapeHtml(program.every)}</dd></div><div><dt>Instructions</dt><dd><code>${escapeHtml(program.instructions)}</code></dd></div><div><dt>Last check</dt><dd>${escapeHtml(localMoment(program.runtime?.lastCheckedAt))}</dd></div>${program.runtime?.lastOutcome?.status === "attention" ? `<div><dt>Attention</dt><dd>${escapeHtml(program.runtime.lastOutcome.message)}</dd></div>` : ""}${program.runtime?.error ? `<div><dt>Error</dt><dd>${escapeHtml(program.runtime.error)}</dd></div>` : ""}` : ""}
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
          <label><span>Kind</span><select name="type" data-program-draft="type"><option value="process" ${draft.type === "process" ? "selected" : ""}>Server or watcher</option><option value="command" ${draft.type === "command" ? "selected" : ""}>One-off command</option></select></label>
          <label><span>Area</span><select name="area" data-program-draft="area" required>${areaOptions(draft.area)}</select></label>
          <label><span>Name</span><input name="name" data-program-draft="name" value="${escapeHtml(draft.name)}" required placeholder="Development server" /></label>
          <label><span>Working folder</span><input name="cwd" data-program-draft="cwd" value="${escapeHtml(draft.cwd)}" required placeholder="/path/to/repository" /></label>
          <label><span>Command</span><input name="command" data-program-draft="command" value="${escapeHtml(draft.command)}" required placeholder="npm run dev" /></label>
          <div class="create-actions"><button class="primary-button" type="submit">Save program <kbd>⌘↵</kbd></button><button class="quiet-button" type="button" data-cancel-program-create>Cancel</button></div>
          <p class="form-note">Commands always ask before they run. Process sessions keep their scrollback after Stop.</p>
        </form>
      </article>`;
  }

  /** Renders the retained tmux surface for one program. */
  function renderProgramSession(program) {
    return `
      <section class="agent-page">
        <div class="agent-toolbar"><div class="agent-context"><strong>${escapeHtml(program.label)}</strong><span>${escapeHtml(areaLabel(program.area))} · ${escapeHtml(programState(program))}</span></div><div class="agent-controls"><button class="quiet-button" type="button" data-back-program>Program details</button></div></div>
        <div class="terminal-wrap"><div class="terminal-host" data-session="${escapeHtml(program.sessionName)}"></div></div>
      </section>`;
  }

  /** Returns the areas a user can select when they define work. */

  return { programById, currentProgram, programIsLive, programState, localMoment, programKind, programRowControl, programRow, renderProgramDetail, programAreaDirectory, renderProgramCreate, renderProgramSession };
}
