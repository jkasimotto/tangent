const savedOutcome = localStorage.getItem("agent-shell.current-outcome") || "";

const state = {
  vault: null,
  sessions: [],
  currentFile: savedOutcome,
  view: savedOutcome ? "overview" : "work",
  brief: null,
  query: "",
  editingWords: false,
  caffeinate: false,
  decisionReturnView: "agent",
  loading: true,
  error: "",
  renderedKey: "",
};

const screen = document.querySelector("#screen");
const backButton = document.querySelector("#back-button");
const barContext = document.querySelector("#bar-context");
const findButton = document.querySelector("#find-button");
const secondaryAction = document.querySelector("#secondary-action");
const modalLayer = document.querySelector("#modal-layer");
const modalKicker = document.querySelector("#modal-kicker");
const modalTitle = document.querySelector("#modal-title");
const modalCopy = document.querySelector("#modal-copy");
const modalActions = document.querySelector("#modal-actions");
const toast = document.querySelector("#toast");

let terminal = null;
let terminalFit = null;
let terminalSocket = null;
let terminalResizeObserver = null;
let terminalSession = "";
let toastTimer = null;
let modalConfirm = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const html = [];
  let list = null;
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet || ordered) {
      const nextList = ordered ? "ol" : "ul";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return html.join("");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value, length = 210) {
  const text = cleanText(value);
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, Math.max(boundary, length - 35))}…`;
}

function progressPoints(text) {
  const units = String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n|\n(?=\s*[-*]\s+)/)
    .map((part) => cleanText(part.replace(/^\s*[-*]\s+/, "")))
    .filter((part) => part && !/^state$/i.test(part));
  const unique = [...new Set(units)];
  if (!unique.length) return ["No progress note exists yet."];
  if (unique.length <= 4) return unique.map((part) => clip(part));
  return [unique[0], unique[1], unique.at(-2), unique.at(-1)].map((part) => clip(part));
}

function goalParts(text) {
  const source = String(text ?? "").trim();
  const first = source.search(/(?:^|\s)1[.)]\s+/);
  if (first < 0) return { intro: source, items: [] };
  const intro = source.slice(0, first).trim();
  const numbered = source.slice(first).trim();
  const items = numbered.split(/(?:^|\s+)\d+[.)]\s+/).map((item) => item.trim()).filter(Boolean);
  return items.length > 1 ? { intro, items } : { intro: source, items: [] };
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Agent Shell returned ${response.status}.`);
  return data;
}

function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allOutcomes() {
  const byFile = new Map();
  for (const group of state.vault?.map ?? []) {
    for (const outcome of group.outcomes ?? []) byFile.set(outcome.file, outcome);
  }
  return [...byFile.values()];
}

function outcomeGroups(outcomes) {
  const rank = new Map(outcomes.map((outcome, index) => [outcome.file, index]));
  return (state.vault?.map ?? [])
    .map((group) => ({
      ...group,
      outcomes: (group.outcomes ?? []).filter((outcome) => rank.has(outcome.file)),
    }))
    .filter((group) => group.outcomes.length)
    .sort((a, b) => {
      const aRank = Math.min(...a.outcomes.map((outcome) => rank.get(outcome.file)));
      const bRank = Math.min(...b.outcomes.map((outcome) => rank.get(outcome.file)));
      return aRank - bRank;
    });
}

function outcomeByFile(file) {
  return allOutcomes().find((outcome) => outcome.file === file) || null;
}

function currentOutcome() {
  return outcomeByFile(state.currentFile);
}

function sessionForOutcome(outcome) {
  if (!outcome) return null;
  return state.sessions.find((session) => session.outcome === outcome.file || session.name === outcome.session) || null;
}

const NAME_MAP = new Map([
  ["otto", "Otto"],
  ["dnd", "D&D"],
  ["tangent", "Tangent"],
  ["neara", "Neara"],
  ["pgande", "PG&E"],
  ["pyth", "Python"],
]);

function humanName(value) {
  const key = String(value ?? "").toLowerCase();
  if (NAME_MAP.has(key)) return NAME_MAP.get(key);
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectParts(node) {
  return String(node ?? "").split("/").filter(Boolean).map(humanName);
}

function projectLabel(node) {
  return projectParts(node).join(" / ");
}

function projectPath(node) {
  return `<div class="project-path">${projectParts(node).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
}

function agentName(sessionOrCommand) {
  const command = typeof sessionOrCommand === "string" ? sessionOrCommand : sessionOrCommand?.command || "";
  const lower = command.toLowerCase();
  if (lower.includes("codex")) return "Codex";
  if (lower.includes("claude")) return "Claude";
  if (lower.includes("agy")) return "Agy";
  if (lower.includes("gemini")) return "Gemini";
  return "Agent";
}

function agentReference(name) {
  return name === "Agent" ? "the agent" : name;
}

function ageText(created) {
  const minutes = Math.max(0, Math.floor((Date.now() - Number(created || Date.now())) / 60000));
  if (minutes < 1) return "Started now";
  if (minutes < 60) return `Started ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Started ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Started ${days} ${days === 1 ? "day" : "days"} ago`;
}

function stateLabel(outcome, session) {
  if (outcome.status === "done") return "Complete";
  if (!session) return "Ready";
  if (session.state === "waiting") return "Waiting for you";
  if (session.state === "working") return "Agent working";
  if (session.state === "shell") return "Agent did not start";
  return "Session open";
}

function workCard(outcome, className = "", { grouped = false, depthBase = 0 } = {}) {
  const session = sessionForOutcome(outcome);
  const depth = Math.max(0, Number(outcome.depth || 0) - depthBase);
  return `
    <button class="work-card ${className} ${depth ? "nested" : ""}" style="--outcome-depth: ${depth}" type="button" data-select-outcome="${escapeHtml(outcome.file)}">
      <span>
        ${grouped ? "" : `<span class="work-project">${escapeHtml(projectLabel(outcome.node))}</span>`}
        <span class="work-title">${escapeHtml(outcome.title)}</span>
        <span class="work-goal">${escapeHtml(clip(outcome.outcome, 180))}</span>
      </span>
      <span class="work-state">${escapeHtml(stateLabel(outcome, session))}</span>
    </button>
  `;
}

function workProjectGroup(group, className = "") {
  const depthBase = Math.min(...group.outcomes.map((outcome) => Number(outcome.depth || 0)));
  return `
    <section class="project-work-group">
      <div class="project-work-heading">
        <span>${escapeHtml(projectLabel(group.path))}</span>
        <span>${group.outcomes.length}</span>
      </div>
      <div class="work-list">${group.outcomes.map((outcome) => workCard(outcome, className, { grouped: true, depthBase })).join("")}</div>
    </section>
  `;
}

function workSection(title, outcomes, className = "", note = "") {
  if (!outcomes.length) return "";
  const groups = outcomeGroups(outcomes);
  return `
    <section class="work-section">
      <div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(note || String(outcomes.length))}</span></div>
      <div class="project-work-list">${groups.map((group) => workProjectGroup(group, className)).join("")}</div>
    </section>
  `;
}

function renderWork() {
  const query = state.query.trim().toLowerCase();
  const outcomes = allOutcomes();
  let content;
  if (query) {
    const results = outcomes
      .filter((outcome) => `${outcome.title} ${outcome.node} ${outcome.outcome} ${outcome.stateText} ${outcome.myUnderstanding}`.toLowerCase().includes(query))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    content = results.length
      ? workSection("Search results", results, "", `${results.length} found`)
      : `<div class="empty-state">No work matches “${escapeHtml(state.query)}”.</div>`;
  } else {
    const needsYou = outcomes.filter((outcome) => {
      const session = sessionForOutcome(outcome);
      return session && ["waiting", "shell"].includes(session.state);
    });
    const working = outcomes.filter((outcome) => sessionForOutcome(outcome)?.state === "working");
    const ready = outcomes.filter((outcome) => !sessionForOutcome(outcome) && !["done", "dropped", "deferred"].includes(outcome.status));
    const firstReady = ready.slice(0, 6);
    const moreReady = ready.slice(6);
    content = [
      workSection("Waiting for you", needsYou, "attention"),
      workSection("Agents working", working, "running"),
      workSection("Ready to start", firstReady),
      moreReady.length ? `<details class="more-work"><summary>Show ${moreReady.length} more</summary><div class="project-work-list">${outcomeGroups(moreReady).map((group) => workProjectGroup(group)).join("")}</div></details>` : "",
    ].join("") || `<div class="empty-state">No open work exists.</div>`;
  }

  return `
    <section class="work-page">
      <header class="work-intro">
        <div>
          <p class="kicker">Agent Shell</p>
          <h1 class="page-title">Your work</h1>
          <p class="page-lede">Choose one thing.</p>
        </div>
        <button class="primary-button new-outcome-button" type="button" data-new-outcome>New outcome</button>
      </header>
      <label class="search-field">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input id="work-search" type="search" value="${escapeHtml(state.query)}" placeholder="Find work" autocomplete="off" />
        <kbd>⌘/</kbd>
      </label>
      ${content}
    </section>
  `;
}

function renderCreate() {
  const nodes = (state.vault?.nodes ?? [])
    .filter((node) => node.path && node.path !== "root")
    .sort((a, b) => projectLabel(a.path).localeCompare(projectLabel(b.path)));
  const preferredNode = currentOutcome()?.node
    || localStorage.getItem("agent-shell.last-node")
    || state.vault?.map?.find((group) => group.path)?.path
    || nodes[0]?.path
    || "";
  return `
    <article class="create-page">
      <p class="kicker">New outcome</p>
      <h1>What result do you want?</h1>
      <p class="create-lede">Choose where this work belongs. Then state what will be true when the work is complete.</p>

      <form class="create-form" data-create-form data-command-enter-submit>
        <label>
          <span>Project</span>
          <select id="new-outcome-node" name="node" required>
            ${nodes.map((node) => `<option value="${escapeHtml(node.path)}" ${node.path === preferredNode ? "selected" : ""}>${escapeHtml(projectLabel(node.path))}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input id="new-outcome-title" name="title" type="text" required autocomplete="off" placeholder="A short name for this result" />
        </label>
        <label>
          <span>Done looks like</span>
          <textarea id="new-outcome-result" name="outcome" required placeholder="One clear sentence that describes the finished result"></textarea>
        </label>
        <label>
          <span>Starting point <small>Optional</small></span>
          <textarea id="new-outcome-state" name="state" class="short-textarea" placeholder="What is true now?"></textarea>
        </label>
        <div class="create-actions">
          <button class="primary-button" type="submit">Create outcome <kbd>⌘↵</kbd></button>
          <button class="quiet-button" type="button" data-cancel-create>Cancel</button>
        </div>
        <p class="form-note">Creating the outcome does not start an agent.</p>
      </form>
    </article>
  `;
}

function wordsBlock(outcome) {
  const words = outcome.myUnderstanding?.trim() || "";
  if (words && !state.editingWords) {
    return `
      <section class="summary-section">
        <div class="your-words">
          <p class="kicker">Your words</p>
          <h2>How you understand this work</h2>
          <blockquote>${escapeHtml(words)}</blockquote>
          <button class="quiet-button edit-words" type="button" data-edit-words>Edit my note</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="summary-section">
      <div class="your-words">
        <p class="kicker">Your words</p>
        <h2>Put this work back into your own words.</h2>
        <p>What did you ask for? What will tell you that it is right?</p>
        <form class="words-form" data-words-form data-command-enter-submit>
          <textarea id="my-understanding" name="understanding" placeholder="I asked for… I will know it is right when…">${escapeHtml(words)}</textarea>
          <div class="words-actions">
            <button class="primary-button" type="submit">Save my note <kbd>⌘↵</kbd></button>
            ${words ? `<button class="quiet-button" type="button" data-cancel-words>Cancel</button>` : ""}
          </div>
        </form>
      </div>
    </section>
  `;
}

function awakeControl({ useful = false } = {}) {
  if (!useful && !state.caffeinate) return "";
  const on = state.caffeinate;
  return `
    <button class="awake-control ${on ? "on" : ""}" type="button" data-toggle-awake aria-pressed="${on}">
      <span class="awake-symbol" aria-hidden="true">☕</span>
      <span class="awake-copy">
        <strong>${on ? "Mac stays awake" : "Keep Mac awake"}</strong>
        <small>${on ? "Until you turn this off or quit Agent Shell." : "Useful while an agent works."}</small>
      </span>
      <span class="awake-switch" aria-hidden="true"><span></span></span>
    </button>
  `;
}

function runCard(outcome, session) {
  const name = agentName(session);
  if (session.state === "waiting") {
    return `
      <section class="summary-section">
        <div class="run-card waiting">
          <div class="run-status">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h2>${escapeHtml(name)} is waiting for you.</h2><p>Read the message. Then continue, end this run, or complete the outcome.</p></div>
          </div>
          ${awakeControl()}
          <div class="action-row">
            <button class="primary-button" type="button" data-open-agent>Open agent</button>
            <button class="secondary-button" type="button" data-next-step>Choose next step…</button>
            <button class="danger-button" type="button" data-stop-agent>Stop agent…</button>
          </div>
        </div>
      </section>
    `;
  }
  if (session.state === "working") {
    return `
      <section class="summary-section">
        <div class="run-card working">
          <div class="run-status">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h2>${escapeHtml(name)} is working.</h2><p>${escapeHtml(ageText(session.created))}. You do not need to watch it.</p></div>
          </div>
          ${awakeControl({ useful: true })}
          <div class="action-row">
            <button class="secondary-button" type="button" data-open-agent>Open agent details</button>
            <button class="secondary-button" type="button" data-next-step>Choose next step…</button>
            <button class="danger-button" type="button" data-stop-agent>Stop agent…</button>
          </div>
        </div>
      </section>
    `;
  }
  if (session.state === "shell") {
    const discussion = session.phase === "understand";
    return `
      <section class="summary-section">
        <div class="run-card shell">
          <div class="run-status">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h2>The session is open, but the agent did not start.</h2><p>You can start it now or close the session.</p></div>
          </div>
          <div class="action-row">
            <button class="primary-button" type="button" data-launch-open-session>${discussion ? "Start the discussion" : "Start the agent"}</button>
            <button class="danger-button" type="button" data-stop-agent>Close session…</button>
            <button class="quiet-button" type="button" data-mark-complete>Mark outcome complete…</button>
          </div>
        </div>
      </section>
    `;
  }
  return `
    <section class="summary-section">
      <div class="run-card">
        <div class="run-status"><span class="status-mark" aria-hidden="true"></span><div><h2>A work session is open.</h2><p>Open it to see its current state.</p></div></div>
        <div class="action-row"><button class="primary-button" type="button" data-open-agent>Open agent</button><button class="secondary-button" type="button" data-next-step>Choose next step…</button><button class="danger-button" type="button" data-stop-agent>Stop agent…</button></div>
      </div>
    </section>
  `;
}

function startBlock(outcome) {
  if (["done", "dropped", "deferred"].includes(outcome.status)) {
    return `
      <section class="summary-section">
        <div class="run-card">
          <div class="run-status"><span class="status-mark" aria-hidden="true"></span><div><h2>This outcome is ${escapeHtml(outcome.status)}.</h2><p>No agent is working on it.</p></div></div>
          ${outcome.status === "done" ? `<div class="action-row"><button class="secondary-button" type="button" data-reopen-outcome>Reopen outcome</button></div>` : ""}
        </div>
      </section>
    `;
  }
  return `
    <section class="summary-section">
      <h2>Next action</h2>
      <div class="start-choices">
        <button class="start-choice" type="button" data-talk-first>
          <span><strong>Talk it through first</strong><span>Use this when the goal or approach is not clear.</span></span><span class="arrow">→</span>
        </button>
        <button class="start-choice" type="button" data-open-plan>
          <span><strong>See what the agent will do</strong><span>Read the plan before any work starts.</span></span><span class="arrow">→</span>
        </button>
      </div>
      <button class="quiet-button complete-without-run" type="button" data-mark-complete>Already finished? Mark this outcome complete…</button>
    </section>
  `;
}

function renderOverview(outcome, session) {
  const points = progressPoints(outcome.stateText);
  const goal = goalParts(outcome.outcome);
  return `
    <article class="summary-page">
      ${projectPath(outcome.node)}
      <h1 class="outcome-title">${escapeHtml(outcome.title)}</h1>
      ${outcome.file.endsWith("/outcome-ux-product-vision.md") ? `<button class="vision-link" type="button" data-open-vision>Explore the product vision <span aria-hidden="true">→</span></button>` : ""}

      <section class="goal-block">
        <h2>You wanted</h2>
        <p class="goal-copy">${escapeHtml(goal.intro || (goal.items.length ? "This work has these results:" : "This work does not have a clear result yet."))}</p>
        ${goal.items.length ? `<ol class="goal-points">${goal.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : ""}
      </section>

      <section class="summary-section">
        <h2>Where it stands</h2>
        <ul class="progress-points">${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
        ${outcome.stateText?.trim() ? `<details class="full-note"><summary>Read the full progress note</summary><div class="full-note-content">${markdownToHtml(outcome.stateText)}</div></details>` : ""}
      </section>

      ${wordsBlock(outcome)}
      ${session ? runCard(outcome, session) : startBlock(outcome)}
    </article>
  `;
}

function renderPlan(outcome) {
  if (!state.brief) return `<div class="loading">Preparing the plan…</div>`;
  const name = agentName(state.brief.agent);
  return `
    <article class="plan-page">
      ${projectPath(outcome.node)}
      <p class="kicker">Before ${escapeHtml(name)} starts</p>
      <h1>Read what will happen.</h1>
      <p class="plan-goal">${escapeHtml(outcome.outcome)}</p>

      <ol class="plan-list">
        <li><span>${escapeHtml(name)} reads this outcome and the project notes that give it context.</span></li>
        <li><span>${escapeHtml(name)} works only toward the result shown on this page.</span></li>
        <li><span>${escapeHtml(name)} keeps the progress note current as the work changes.</span></li>
        <li><span>${escapeHtml(name)} asks you before the whole outcome is marked complete.</span></li>
      </ol>

      ${outcome.myUnderstanding ? `<div class="your-words"><p class="kicker">Your words</p><blockquote>${escapeHtml(outcome.myUnderstanding)}</blockquote></div>` : ""}

      <div class="plan-actions">
        <button class="primary-button" type="button" data-start-agent>Start ${escapeHtml(name)}</button>
        <button class="secondary-button" type="button" data-talk-first>Talk it through instead</button>
        <button class="quiet-button" type="button" data-back-overview>Back</button>
      </div>

      <details class="instruction-details">
        <summary>Read the exact instructions</summary>
        <div class="instruction-document">${markdownToHtml(state.brief.markdown)}</div>
      </details>
    </article>
  `;
}

function renderAgent(outcome, session) {
  return `
    <section class="agent-page">
      <div class="terminal-wrap">
        <div id="agent-terminal" class="terminal-host" data-session="${escapeHtml(session.name)}"></div>
      </div>
    </section>
  `;
}

function renderDecision(outcome, session) {
  const name = agentName(session);
  const reference = agentReference(name);
  return `
    <article class="decision-page">
      <p class="kicker">${escapeHtml(projectLabel(outcome.node))}</p>
      <h1>What happens next?</h1>
      <p>Choose one result for this run.</p>
      <div class="decision-options">
        <button class="decision-option" type="button" data-keep-working><strong>Keep working with ${escapeHtml(reference)}</strong><span>Return to the agent and type your next message.</span></button>
        <button class="decision-option" type="button" data-finish-run><strong>End this agent run</strong><span>The session ends. The outcome and its progress note stay open.</span></button>
        <button class="decision-option" type="button" data-mark-complete><strong>The whole outcome is complete</strong><span>The outcome closes only after you approve a confirmation.</span></button>
      </div>
    </article>
  `;
}

function disposeTerminal() {
  terminalResizeObserver?.disconnect();
  terminalResizeObserver = null;
  if (terminalSocket) {
    terminalSocket.onclose = null;
    terminalSocket.close();
  }
  terminalSocket = null;
  terminal?.dispose();
  terminal = null;
  terminalFit = null;
  terminalSession = "";
}

function mountTerminal(host, sessionName) {
  if (terminal && terminalSession === sessionName) return;
  disposeTerminal();
  if (!window.Terminal || !window.FitAddon) {
    host.textContent = "The terminal did not load.";
    return;
  }
  terminalSession = sessionName;
  terminal = new Terminal({
    convertEol: true,
    cursorBlink: false,
    fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.32,
    scrollback: 8000,
    theme: {
      background: "#080a0d",
      foreground: "#dce1e6",
      cursor: "#dce1e6",
      selectionBackground: "#29415f",
    },
  });
  terminalFit = new FitAddon.FitAddon();
  terminal.loadAddon(terminalFit);
  terminal.open(host);
  const fit = () => {
    try {
      terminalFit.fit();
      if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(`\x00resize:${terminal.cols}x${terminal.rows}`);
    } catch {}
  };
  window.setTimeout(fit, 0);
  terminalResizeObserver = new ResizeObserver(fit);
  terminalResizeObserver.observe(host);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  terminalSocket = new WebSocket(`${protocol}//${location.host}/term?session=${encodeURIComponent(sessionName)}&cols=${terminal.cols}&rows=${terminal.rows}`);
  terminalSocket.binaryType = "arraybuffer";
  terminalSocket.onmessage = (event) => terminal.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
  terminalSocket.onopen = fit;
  terminalSocket.onclose = () => terminal?.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
  terminal.onData((data) => {
    if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(data);
  });
  terminal.focus();
}

function renderKey() {
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  if (state.view === "agent") {
    return JSON.stringify([state.view, outcome?.file, session?.name]);
  }
  return JSON.stringify([
    state.view,
    state.query,
    state.editingWords,
    state.caffeinate,
    Boolean(state.brief),
    outcome ? [outcome.file, outcome.status, outcome.mtime, outcome.stateText, outcome.myUnderstanding] : null,
    state.sessions.map((item) => [item.name, item.outcome, item.state, item.phase, item.command]),
  ]);
}

function updateHeader() {
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  const isWork = state.view === "work" || !outcome;
  const isCreate = state.view === "create";
  backButton.classList.toggle("has-back", !isWork || isCreate);
  backButton.textContent = isCreate
    ? "Work"
    : isWork
    ? "Agent Shell"
    : state.view === "overview"
      ? "Work"
      : state.view === "plan"
        ? "Outcome"
        : state.view === "agent"
          ? "Summary"
          : "Agent";
  barContext.textContent = isCreate
    ? "Define a new outcome"
    : outcome
    ? `${projectLabel(outcome.node)} · ${outcome.title}${session ? ` · ${stateLabel(outcome, session)}` : ""}`
    : "";

  secondaryAction.hidden = !session || ["work", "create"].includes(state.view);
  secondaryAction.textContent = session?.state === "shell" ? "Close session…" : "Stop agent…";

  if (state.view === "agent" && session?.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else if (["work", "create", "agent", "decision"].includes(state.view)) {
    findButton.hidden = true;
    findButton.textContent = "Find work";
    findButton.dataset.action = "find";
  } else {
    findButton.hidden = false;
    findButton.innerHTML = `Find work <kbd>⌘/</kbd>`;
    findButton.dataset.action = "find";
  }
}

function updateLiveHeader() {
  if (state.view !== "agent") return;
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  if (!session) return;
  barContext.textContent = `${projectLabel(outcome.node)} · ${outcome.title} · ${stateLabel(outcome, session)}`;
  if (session.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else {
    findButton.hidden = true;
  }
}

function renderScreen() {
  const outcome = currentOutcome();
  if (!outcome && !["work", "create"].includes(state.view)) state.view = "work";
  const session = sessionForOutcome(outcome);
  if (state.view === "agent" && !session) state.view = "overview";
  if (state.view !== "agent") disposeTerminal();

  if (state.view === "work") screen.innerHTML = renderWork();
  else if (state.view === "create") screen.innerHTML = renderCreate();
  else if (state.view === "plan") screen.innerHTML = renderPlan(outcome);
  else if (state.view === "agent") screen.innerHTML = renderAgent(outcome, session);
  else if (state.view === "decision" && session) screen.innerHTML = renderDecision(outcome, session);
  else screen.innerHTML = renderOverview(outcome, session);

  updateHeader();
  const host = screen.querySelector("[data-session]");
  if (host) mountTerminal(host, host.dataset.session);
}

function paint(force = false) {
  if (state.loading) {
    screen.innerHTML = `<div class="loading">Loading Agent Shell…</div>`;
    return;
  }
  if (state.error) {
    screen.innerHTML = `<div class="error-card">${escapeHtml(state.error)}</div>`;
    return;
  }
  const key = renderKey();
  const active = document.activeElement;
  if (!force && active && (["work-search", "my-understanding"].includes(active.id) || active.closest?.("[data-create-form]"))) {
    updateHeader();
    return;
  }
  if (force || key !== state.renderedKey) {
    state.renderedKey = key;
    renderScreen();
  } else {
    updateLiveHeader();
  }
}

async function refresh({ initial = false } = {}) {
  try {
    const [vault, sessionPayload] = await Promise.all([api("/api/vault"), api("/api/sessions")]);
    state.vault = vault;
    state.sessions = sessionPayload.sessions || [];
    state.caffeinate = Boolean(sessionPayload.caffeinate);
    state.loading = false;
    state.error = "";
    if (initial && state.currentFile && !outcomeByFile(state.currentFile)) {
      state.currentFile = "";
      state.view = "work";
      localStorage.removeItem("agent-shell.current-outcome");
    }
    paint(initial);
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    paint(true);
  }
}

function selectOutcome(file) {
  state.currentFile = file;
  state.view = "overview";
  state.brief = null;
  state.editingWords = false;
  localStorage.setItem("agent-shell.current-outcome", file);
  const outcome = outcomeByFile(file);
  if (outcome?.node) localStorage.setItem("agent-shell.last-node", outcome.node);
  paint(true);
}

function showWork({ focus = false } = {}) {
  state.view = "work";
  state.brief = null;
  state.editingWords = false;
  paint(true);
  if (focus) window.setTimeout(() => document.querySelector("#work-search")?.focus(), 0);
}

function showOverview() {
  state.view = "overview";
  state.brief = null;
  state.editingWords = false;
  paint(true);
}

function showCreate() {
  state.view = "create";
  state.brief = null;
  state.editingWords = false;
  paint(true);
  window.setTimeout(() => document.querySelector("#new-outcome-title")?.focus(), 0);
}

function showDecision(returnView = state.view) {
  state.decisionReturnView = returnView === "overview" ? "overview" : "agent";
  state.view = "decision";
  state.renderedKey = "";
  paint(true);
}

async function openPlan() {
  const outcome = currentOutcome();
  if (!outcome) return;
  state.view = "plan";
  state.brief = null;
  paint(true);
  try {
    state.brief = await api(`/api/outcome/brief?file=${encodeURIComponent(outcome.file)}`);
    paint(true);
  } catch (error) {
    showToast(error.message);
    showOverview();
  }
}

async function startDiscussion() {
  const outcome = currentOutcome();
  if (!outcome) return;
  try {
    await post("/api/outcome/discuss", { file: outcome.file, launch: true });
    await refresh();
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
    showToast("The discussion started. Use Summary or Stop agent at any time.");
  } catch (error) {
    showToast(error.message);
  }
}

async function startAgent() {
  const outcome = currentOutcome();
  if (!outcome) return;
  const name = agentName(state.brief?.agent || "");
  try {
    await post("/api/outcome/start", { file: outcome.file, approved: true, launch: true });
    state.view = "overview";
    state.brief = null;
    await refresh();
    paint(true);
    showToast(`${name} started. You can leave it alone.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function launchOpenSession() {
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  if (!outcome || !session) return;
  try {
    const endpoint = session.phase === "understand" ? "/api/outcome/discuss" : "/api/outcome/start";
    const body = session.phase === "understand"
      ? { file: outcome.file, launch: true }
      : { file: outcome.file, approved: true, launch: true };
    await post(endpoint, body);
    await refresh();
    state.view = session.phase === "understand" ? "agent" : "overview";
    state.renderedKey = "";
    paint(true);
    showToast("The agent started.");
  } catch (error) {
    showToast(error.message);
  }
}

function openModal({ kicker = "", title, copy, confirmLabel, danger = false, onConfirm }) {
  modalKicker.textContent = kicker;
  modalTitle.textContent = title;
  modalCopy.textContent = copy;
  modalActions.innerHTML = `
    <button class="quiet-button" type="button" data-modal-cancel>Cancel</button>
    <button class="${danger ? "danger-button" : "primary-button"}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
  `;
  modalConfirm = onConfirm;
  modalLayer.hidden = false;
  window.setTimeout(() => modalActions.querySelector("[data-modal-confirm]")?.focus(), 0);
}

function closeModal() {
  modalLayer.hidden = true;
  modalConfirm = null;
}

function confirmStop() {
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  if (!outcome || !session) return;
  const shell = session.state === "shell";
  openModal({
    kicker: shell ? "Open session" : "Live agent",
    title: shell ? "Close this session?" : `Stop ${agentName(session)}?`,
    copy: "This ends the live session. The outcome and its notes stay here.",
    confirmLabel: shell ? "Close session" : "Stop agent",
    danger: true,
    onConfirm: async () => {
      await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
      state.view = "overview";
      await refresh();
      paint(true);
      showToast(shell ? "The session closed." : "The agent stopped. The outcome stays open.");
    },
  });
}

function confirmComplete() {
  const outcome = currentOutcome();
  if (!outcome) return;
  openModal({
    kicker: "Whole outcome",
    title: `Mark “${outcome.title}” complete?`,
    copy: "This closes the outcome and ends its live session. Use this only when the complete result is met.",
    confirmLabel: "Mark complete",
    onConfirm: async () => {
      await post("/api/outcome/edit", { file: outcome.file, status: "done" });
      state.view = "overview";
      await refresh();
      paint(true);
      showToast("The outcome is complete.");
    },
  });
}

async function toggleAwake() {
  try {
    const result = await post("/api/caffeinate", { on: !state.caffeinate });
    state.caffeinate = Boolean(result.caffeinate);
    paint(true);
    showToast(state.caffeinate ? "This Mac will stay awake while Agent Shell is open." : "This Mac can sleep normally.");
  } catch (error) {
    showToast(error.message);
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  const select = target.closest("[data-select-outcome]");
  if (select) return selectOutcome(select.dataset.selectOutcome);
  if (target.closest("[data-new-outcome]")) return showCreate();
  if (target.closest("[data-open-vision]")) return window.location.assign("/vision");
  if (target.closest("[data-cancel-create]")) return showWork();
  if (target.closest("[data-back-overview]")) return showOverview();
  if (target.closest("[data-open-plan]")) return openPlan();
  if (target.closest("[data-talk-first]")) return startDiscussion();
  if (target.closest("[data-start-agent]")) return startAgent();
  if (target.closest("[data-launch-open-session]")) return launchOpenSession();
  if (target.closest("[data-open-agent]")) {
    state.view = "agent";
    state.renderedKey = "";
    return paint(true);
  }
  if (target.closest("[data-next-step]")) return showDecision("overview");
  if (target.closest("[data-toggle-awake]")) return toggleAwake();
  if (target.closest("[data-stop-agent]")) return confirmStop();
  if (target.closest("[data-edit-words]")) {
    state.editingWords = true;
    paint(true);
    return window.setTimeout(() => document.querySelector("#my-understanding")?.focus(), 0);
  }
  if (target.closest("[data-cancel-words]")) {
    state.editingWords = false;
    return paint(true);
  }
  if (target.closest("[data-keep-working]")) {
    state.view = "agent";
    state.renderedKey = "";
    return paint(true);
  }
  if (target.closest("[data-finish-run]")) {
    const outcome = currentOutcome();
    if (!outcome) return;
    try {
      await post("/api/outcome/accept", { file: outcome.file });
      state.view = "overview";
      await refresh();
      paint(true);
      showToast("The agent run ended. The outcome stays open.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (target.closest("[data-mark-complete]")) return confirmComplete();
  if (target.closest("[data-reopen-outcome]")) {
    const outcome = currentOutcome();
    if (!outcome) return;
    try {
      await post("/api/outcome/edit", { file: outcome.file, status: "open" });
      await refresh();
      paint(true);
      showToast("The outcome is open again.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (target.closest("[data-modal-cancel]")) return closeModal();
  if (target.closest("[data-modal-confirm]")) {
    const action = modalConfirm;
    closeModal();
    if (!action) return;
    try {
      await action();
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.matches("[data-create-form]")) {
    event.preventDefault();
    const fields = new FormData(event.target);
    const node = fields.get("node")?.toString() || "";
    const title = fields.get("title")?.toString().trim() || "";
    const outcome = fields.get("outcome")?.toString().trim() || "";
    const startingPoint = fields.get("state")?.toString().trim() || "";
    if (!node || !title || !outcome) {
      showToast("Choose a project, add a name, and state what done looks like.");
      return;
    }
    try {
      const created = await post("/api/outcome/new", { node, title, outcome, state: startingPoint });
      localStorage.setItem("agent-shell.last-node", node);
      await refresh();
      selectOutcome(created.file);
      showToast("The outcome is ready. No agent started.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  if (!event.target.matches("[data-words-form]")) return;
  event.preventDefault();
  const outcome = currentOutcome();
  const understanding = new FormData(event.target).get("understanding")?.toString().trim() || "";
  if (!outcome || !understanding) {
    showToast("Write what you think this work means.");
    return;
  }
  try {
    await post("/api/outcome/understanding", { file: outcome.file, understanding });
    state.editingWords = false;
    await refresh();
    paint(true);
    showToast("Your note is saved with this outcome.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "work-search") return;
  state.query = event.target.value;
  const cursor = event.target.selectionStart;
  screen.innerHTML = renderWork();
  const input = document.querySelector("#work-search");
  input?.focus();
  input?.setSelectionRange(cursor, cursor);
});

backButton.addEventListener("click", () => {
  if (state.view === "work") return;
  if (state.view === "create") return showWork();
  if (state.view === "overview") return showWork();
  if (state.view === "plan") return showOverview();
  if (state.view === "agent") return showOverview();
  if (state.view === "decision") {
    state.view = state.decisionReturnView;
    state.renderedKey = "";
    paint(true);
  }
});

findButton.addEventListener("click", () => {
  if (findButton.dataset.action === "next-step") {
    return showDecision("agent");
  }
  showWork({ focus: true });
});

secondaryAction.addEventListener("click", confirmStop);

modalLayer.addEventListener("click", (event) => {
  if (event.target === modalLayer) closeModal();
});

document.addEventListener("keydown", (event) => {
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
  if (event.key === "/" && event.metaKey) {
    event.preventDefault();
    showWork({ focus: true });
  }
});

window.addEventListener("resize", () => {
  try { terminalFit?.fit(); } catch {}
});

const reloadEvents = new EventSource("/api/reload/events");
reloadEvents.addEventListener("reload", () => location.reload());

void refresh({ initial: true });
window.setInterval(() => refresh(), 2500);
