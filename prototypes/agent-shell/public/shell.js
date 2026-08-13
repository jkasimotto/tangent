const savedOutcome = localStorage.getItem("agent-shell.current-outcome") || "";

/** Reads one optional JSON value from local storage. */
function storedJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

const state = {
  vault: null,
  sessions: [],
  currentFile: savedOutcome,
  view: savedOutcome ? "overview" : "work",
  brief: null,
  document: null,
  shapeDraft: storedJson("agent-shell.shape-draft"),
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

/** Escapes arbitrary text before it enters rendered HTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Renders the small inline Markdown subset used by vault notes. */
function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** Renders safe headings, paragraphs, and lists from Markdown. */
function markdownToHtml(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const html = [];
  let list = null;
  /** Closes the current list when the Markdown block type changes. */
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

/** Removes display Markdown and collapses whitespace. */
function cleanText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clips readable text at a nearby word boundary. */
function clip(value, length = 210) {
  const text = cleanText(value);
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, Math.max(boundary, length - 35))}…`;
}

/** Converts a progress note into a small set of readable points. */
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

/** Returns the three compact facts that restore an outcome's current thought. */
function currentBriefFields(outcome) {
  const points = progressPoints(outcome.stateText);
  const fields = {
    wanted: outcome.outcome || "No clear result is recorded yet.",
    changed: points[0],
    now: points.at(-1),
  };
  const labels = new Map([
    ["you wanted", "wanted"],
    ["what changed", "changed"],
    ["now", "now"],
  ]);
  let matched = false;
  for (const line of String(outcome.currentBrief ?? "").split("\n")) {
    const item = line.match(/^\s*[-*]?\s*(You wanted|What changed|Now)\s*:\s*(.+)$/i);
    if (!item) continue;
    fields[labels.get(item[1].toLowerCase())] = cleanText(item[2]);
    matched = true;
  }
  if (!matched && outcome.currentBrief?.trim()) fields.changed = clip(outcome.currentBrief, 320);
  return fields;
}

/** Parses the intentionally short Story so far section into ordered moments. */
function storyEntries(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const matches = [...source.matchAll(/^###\s+(.+)\n+([\s\S]*?)(?=^###\s+|$)/gm)];
  if (!matches.length) return [{ title: "Latest", body: clip(source, 320) }];
  return matches.slice(-5).map((match) => ({ title: cleanText(match[1]), body: clip(match[2], 320) }));
}

/** Extracts explicit unresolved questions without inventing new ones. */
function openQuestionPoints(text) {
  const source = String(text ?? "");
  const section = source.match(/^#{1,4}\s+(?:Unresolved decisions|Open questions)\s*\n([\s\S]*?)(?=^#{1,4}\s+|$)/im)?.[1] ?? "";
  const candidates = section
    ? progressPoints(section)
    : source.split("\n").map(cleanText).filter((line) => line.endsWith("?"));
  return candidates.filter((item) => item && item !== "No progress note exists yet.").slice(0, 4);
}

/** Produces a concise editable title from one sentence of natural language. */
function titleFromText(value) {
  const source = cleanText(value)
    .replace(/^(?:I|we)\s+(?:really\s+)?(?:want|need|would like)\s+to\s+/i, "")
    .replace(/^(?:I|we)\s+(?:really\s+)?(?:want|need)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const clipped = clip(source || "New body of work", 72);
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/** Creates a transparent first draft that the user can correct before save. */
function shapeDraftFromDescription(node, description) {
  const sentences = String(description)
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);
  const first = sentences[0] || description;
  const children = sentences.slice(1, 6).map((sentence) => ({
    title: titleFromText(sentence),
    outcome: sentence,
  }));
  return {
    node,
    description: String(description).trim(),
    parent: { title: titleFromText(first), outcome: first, state: "Not started." },
    children,
  };
}

/** Keeps an unfinished work-shaping draft across navigation and restarts. */
function saveShapeDraft() {
  if (state.shapeDraft) localStorage.setItem("agent-shell.shape-draft", JSON.stringify(state.shapeDraft));
  else localStorage.removeItem("agent-shell.shape-draft");
}

/** Shows one temporary status message. */
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

/** Calls a JSON API and converts non-success replies into errors. */
async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Agent Shell returned ${response.status}.`);
  return data;
}

/** Posts one JSON object to the Agent Shell server. */
function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Returns every indexed outcome once. */
function allOutcomes() {
  const byFile = new Map();
  for (const group of state.vault?.map ?? []) {
    for (const outcome of group.outcomes ?? []) byFile.set(outcome.file, outcome);
  }
  return [...byFile.values()];
}

/** Retains the vault's project grouping for a selected outcome subset. */
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

/** Finds one indexed outcome by its vault-relative file. */
function outcomeByFile(file) {
  return allOutcomes().find((outcome) => outcome.file === file) || null;
}

/** Returns the outcome selected in the shell. */
function currentOutcome() {
  return outcomeByFile(state.currentFile);
}

/** Finds the live session bound to one outcome. */
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

/** Converts a stored node segment into its human label. */
function humanName(value) {
  const key = String(value ?? "").toLowerCase();
  if (NAME_MAP.has(key)) return NAME_MAP.get(key);
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Converts a node path into readable project segments. */
function projectParts(node) {
  return String(node ?? "").split("/").filter(Boolean).map(humanName);
}

/** Formats one complete readable project path. */
function projectLabel(node) {
  return projectParts(node).join(" / ");
}

/** Renders one compact project breadcrumb. */
function projectPath(node) {
  return `<div class="project-path">${projectParts(node).map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>`;
}

/** Identifies the selected agent from its command. */
function agentName(sessionOrCommand) {
  const command = typeof sessionOrCommand === "string" ? sessionOrCommand : sessionOrCommand?.command || "";
  const lower = command.toLowerCase();
  if (lower.includes("codex")) return "Codex";
  if (lower.includes("claude")) return "Claude";
  if (lower.includes("agy")) return "Agy";
  if (lower.includes("gemini")) return "Gemini";
  return "Agent";
}

/** Returns a sentence-safe reference to an agent. */
function agentReference(name) {
  return name === "Agent" ? "the agent" : name;
}

/** Formats a session start time as a compact relative age. */
function ageText(created) {
  const minutes = Math.max(0, Math.floor((Date.now() - Number(created || Date.now())) / 60000));
  if (minutes < 1) return "Started now";
  if (minutes < 60) return `Started ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Started ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Started ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Describes one outcome and session state in user terms. */
function stateLabel(outcome, session) {
  if (outcome.status === "done") return "Complete";
  if (!session) return "Ready";
  if (session.state === "waiting") return "Waiting for you";
  if (session.state === "working") return "Agent working";
  if (session.state === "shell") return "Agent did not start";
  return "Session open";
}

/** Renders one selectable outcome row. */
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

/** Renders the outcomes that belong to one project group. */
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

/** Renders one status section of grouped work. */
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

/** Renders the complete work selection page. */
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
        <div class="work-intro-actions">
          <button class="primary-button new-outcome-button" type="button" data-describe-work>${state.shapeDraft ? "Continue shaping work" : "Describe work"}</button>
          <button class="secondary-button new-outcome-button" type="button" data-new-outcome>New outcome</button>
        </div>
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

/** Returns the nodes a user can select when they define work. */
function selectableNodes() {
  return (state.vault?.nodes ?? [])
    .filter((node) => node.path && node.path !== "root")
    .sort((left, right) => projectLabel(left.path).localeCompare(projectLabel(right.path)));
}

/** Selects the closest useful project for a new-work form. */
function preferredNode() {
  return currentOutcome()?.node
    || state.shapeDraft?.node
    || localStorage.getItem("agent-shell.last-node")
    || state.vault?.map?.find((group) => group.path)?.path
    || selectableNodes()[0]?.path
    || "";
}

/** Renders project options with one selected node. */
function nodeOptions(selected = preferredNode()) {
  return selectableNodes()
    .map((node) => `<option value="${escapeHtml(node.path)}" ${node.path === selected ? "selected" : ""}>${escapeHtml(projectLabel(node.path))}</option>`)
    .join("");
}

/** Renders the fast path for one known outcome. */
function renderCreate() {
  return `
    <article class="create-page">
      <p class="kicker">New outcome</p>
      <h1>What result do you want?</h1>
      <p class="create-lede">Choose where this work belongs. Then state what will be true when the work is complete.</p>

      <form class="create-form" data-create-form data-command-enter-submit>
        <label>
          <span>Project</span>
          <select id="new-outcome-node" name="node" required>
            ${nodeOptions()}
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

/** Renders the natural-language capture step for a body of work. */
function renderShapeCapture() {
  const draft = state.shapeDraft;
  return `
    <article class="create-page shape-page">
      <p class="kicker">Describe work</p>
      <h1>What experience do you want to change?</h1>
      <p class="create-lede">Type or dictate naturally. Keep the whole thought together before you decide how to split it.</p>

      <form class="create-form" data-shape-capture-form data-command-enter-submit>
        <label>
          <span>Project</span>
          <select id="shape-node" name="node" required>${nodeOptions(draft?.node)}</select>
        </label>
        <label>
          <span>Your description</span>
          <textarea id="shape-description" name="description" class="shape-description" required placeholder="Describe the experience, the important results, and any breakdown you already have in mind.">${escapeHtml(draft?.description || "")}</textarea>
        </label>
        <div class="create-actions">
          <button class="primary-button" type="submit">Shape with an agent <kbd>⌘↵</kbd></button>
          <button class="quiet-button" type="button" data-save-idea>Save as an idea</button>
          <button class="quiet-button" type="button" data-cancel-shape>Cancel</button>
        </div>
        <p class="form-note">The agent receives this description. Nothing is saved until you confirm the proposed outcomes.</p>
      </form>
    </article>
  `;
}

/** Renders one editable child outcome inside a shaped work draft. */
function childDraftCard(child, index) {
  return `
    <fieldset class="child-draft" data-child-index="${index}">
      <legend>Child outcome ${index + 1}</legend>
      <label><span>Name</span><input name="child-title-${index}" data-shape-field="title" value="${escapeHtml(child.title)}" placeholder="A short result name" /></label>
      <label><span>Done looks like</span><textarea name="child-outcome-${index}" data-shape-field="outcome" class="short-textarea" placeholder="One finished result">${escapeHtml(child.outcome)}</textarea></label>
      <button class="quiet-button remove-child" type="button" data-remove-child="${index}">Remove</button>
    </fieldset>
  `;
}

/** Renders the confirmable parent-and-children draft. */
function renderShapeReview() {
  const draft = state.shapeDraft;
  if (!draft) return renderShapeCapture();
  return `
    <article class="create-page shape-page shape-review-page">
      <p class="kicker">${draft.shapedBy === "model" ? "Agent proposal" : "Editable first pass"}</p>
      <h1>Keep the whole. Split only useful results.</h1>
      <p class="create-lede">This is an editable first pass. Nothing enters the vault until you create these outcomes.</p>

      <form class="create-form shape-review-form" data-shape-review-form data-command-enter-submit>
        <section class="parent-draft">
          <p class="kicker">Parent outcome</p>
          <label><span>Name</span><input name="parent-title" data-parent-field="title" value="${escapeHtml(draft.parent.title)}" required /></label>
          <label><span>Done looks like</span><textarea name="parent-outcome" data-parent-field="outcome" required>${escapeHtml(draft.parent.outcome)}</textarea></label>
        </section>

        <section class="children-draft">
          <div class="draft-heading"><div><p class="kicker">Optional children</p><h2>Results worth doing alone</h2></div><button class="secondary-button" type="button" data-add-child>Add child outcome</button></div>
          <div class="children-list">${draft.children.length ? draft.children.map(childDraftCard).join("") : `<p class="empty-draft">No children. Starting the parent will cover the complete body of work.</p>`}</div>
        </section>

        <details class="original-details"><summary>Read my original description</summary><p>${escapeHtml(draft.description)}</p></details>

        <div class="create-actions">
          <button class="primary-button" type="submit">Create these outcomes <kbd>⌘↵</kbd></button>
          <button class="quiet-button" type="button" data-back-shape>Change my description</button>
          <button class="quiet-button" type="button" data-save-idea>Save as an idea</button>
        </div>
        <p class="form-note">The parent and each child will use the normal outcome start flow.</p>
      </form>
    </article>
  `;
}

/** Renders the compact present-tense memory at the top of an outcome. */
function currentBriefBlock(outcome) {
  const fields = currentBriefFields(outcome);
  return `
    <section class="brief-card">
      <p class="kicker">Current brief</p>
      <h2>${escapeHtml(outcome.outcome || outcome.title)}</h2>
      <dl class="brief-facts">
        <div><dt>You wanted</dt><dd>${escapeHtml(fields.wanted)}</dd></div>
        <div><dt>What changed</dt><dd>${escapeHtml(fields.changed)}</dd></div>
        <div><dt>Now</dt><dd>${escapeHtml(fields.now)}</dd></div>
      </dl>
    </section>
  `;
}

/** Renders the user's durable restatement of the work. */
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

/** Renders meaningful moments and leaves the full current state inspectable. */
function storyBlock(outcome) {
  const entries = storyEntries(outcome.storyText);
  return `
    <section class="summary-section memory-section">
      <div class="memory-heading"><div><p class="kicker">Story so far</p><h2>${entries.length ? `${entries.length} meaningful ${entries.length === 1 ? "moment" : "moments"}` : "No short history yet"}</h2></div><span>Full chat remains the evidence</span></div>
      ${entries.length
        ? `<ol class="story-list">${entries.map((entry) => `<li><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.body)}</p></li>`).join("")}</ol>`
        : `<p class="memory-empty">The agent adds a moment only when feedback, a decision, or a result changes the work.</p>`}
      ${outcome.stateText?.trim() ? `<details class="full-note"><summary>Read the full progress note</summary><div class="full-note-content">${markdownToHtml(outcome.stateText)}</div></details>` : ""}
    </section>
  `;
}

/** Renders linked living documents and the handoff action. */
function livingDocumentsBlock(outcome) {
  const documents = outcome.documents ?? [];
  return `
    <section class="summary-section memory-section">
      <div class="memory-heading"><div><p class="kicker">Living documents</p><h2>${documents.length ? "Current solution context" : "No linked design document"}</h2></div></div>
      ${documents.length
        ? `<div class="document-list">${documents.map((document) => `<button class="document-row" type="button" data-open-document="${escapeHtml(document.file)}"><span><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(projectLabel(document.file.split("/").slice(0, -1).join("/")))}</small></span><span aria-hidden="true">→</span></button>`).join("")}</div>`
        : `<p class="memory-empty">The outcome and native chat still provide the source context.</p>`}
      <button class="share-context-button" type="button" data-share-context>Prepare two-minute context <span aria-hidden="true">→</span></button>
    </section>
  `;
}

/** Renders sleep prevention only where it is useful or active. */
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

/** Renders the current live-agent state and its available actions. */
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
            <button class="primary-button" type="button" data-open-agent>Open ${escapeHtml(name)}</button>
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
            <button class="secondary-button" type="button" data-open-agent>Open ${escapeHtml(name)}</button>
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

/** Renders the next actions for an outcome without a live run. */
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

/** Renders the context-first summary for one outcome. */
function renderOverview(outcome, session) {
  return `
    <article class="summary-page">
      ${projectPath(outcome.node)}
      <h1 class="outcome-title">${escapeHtml(outcome.title)}</h1>
      ${outcome.file.endsWith("/outcome-ux-product-vision.md") ? `<button class="vision-link" type="button" data-open-vision>Explore the product vision <span aria-hidden="true">→</span></button>` : ""}

      ${currentBriefBlock(outcome)}
      ${wordsBlock(outcome)}
      ${session ? runCard(outcome, session) : startBlock(outcome)}
      ${storyBlock(outcome)}
      ${livingDocumentsBlock(outcome)}
    </article>
  `;
}

/** Renders the readable plan shown before execution. */
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

/** Renders the complete native agent terminal without a second chat. */
function renderAgent(outcome, session) {
  return `
    <section class="agent-page">
      <div class="terminal-wrap">
        <div id="agent-terminal" class="terminal-host" data-session="${escapeHtml(session.name)}"></div>
      </div>
    </section>
  `;
}

/** Renders explicit run and outcome decisions after an agent returns. */
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

/** Renders one linked Markdown document in the same reading column. */
function renderDocument() {
  if (!state.document) return `<div class="loading">Opening the document…</div>`;
  return `
    <article class="document-page">
      ${projectPath(state.document.node)}
      <p class="kicker">Living document</p>
      <h1>${escapeHtml(state.document.title)}</h1>
      <div class="document-content">${markdownToHtml(state.document.text)}</div>
      <p class="document-source">Source: ${escapeHtml(state.document.file)}</p>
    </article>
  `;
}

/** Builds the concise context text used by the screen and clipboard. */
function handoffText(outcome) {
  const brief = currentBriefFields(outcome);
  const moments = storyEntries(outcome.storyText);
  const questions = openQuestionPoints(outcome.stateText);
  const documents = outcome.documents ?? [];
  return [
    `# ${outcome.title}: two-minute context`,
    "",
    `Project: ${projectLabel(outcome.node)}`,
    "",
    "## Result",
    "",
    outcome.outcome,
    "",
    "## Current direction",
    "",
    brief.now,
    "",
    "## Current brief",
    "",
    `- You wanted: ${brief.wanted}`,
    `- What changed: ${brief.changed}`,
    `- Now: ${brief.now}`,
    "",
    "## Important moments",
    "",
    ...(moments.length ? moments.flatMap((moment) => [`- ${moment.title}: ${moment.body}`]) : ["- No short history is recorded yet."]),
    "",
    "## Open questions",
    "",
    ...(questions.length ? questions.map((question) => `- ${question}`) : ["- No open question is recorded."]),
    "",
    "## Sources",
    "",
    `- Outcome: ${outcome.file}`,
    ...documents.map((document) => `- ${document.title}: ${document.file}`),
    "- Native agent chat: complete conversation evidence",
  ].join("\n");
}

/** Renders shareable context derived from the current outcome sources. */
function renderHandoff(outcome) {
  const brief = currentBriefFields(outcome);
  const moments = storyEntries(outcome.storyText);
  const questions = openQuestionPoints(outcome.stateText);
  const documents = outcome.documents ?? [];
  const session = sessionForOutcome(outcome);
  return `
    <article class="handoff-page">
      <header class="handoff-header">
        <div><p class="kicker">Two-minute context</p><h1>${escapeHtml(outcome.title)}</h1><p>Prepared from the outcome, current brief, short story, and linked documents.</p></div>
        <button class="primary-button" type="button" data-copy-context>Copy context</button>
      </header>
      <section class="handoff-sheet">
        <article><h2>Result</h2><p>${escapeHtml(outcome.outcome)}</p></article>
        <article><h2>Current direction</h2><p>${escapeHtml(brief.now)}</p></article>
        <article><h2>What changed</h2><p>${escapeHtml(brief.changed)}</p></article>
        <article><h2>Important moments</h2>${moments.length ? `<ul>${moments.map((moment) => `<li><strong>${escapeHtml(moment.title)}.</strong> ${escapeHtml(moment.body)}</li>`).join("")}</ul>` : `<p>No short history is recorded yet.</p>`}</article>
        <article><h2>Open questions</h2>${questions.length ? `<ul>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul>` : `<p>No open question is recorded.</p>`}</article>
        <article><h2>Sources</h2><div class="source-chips"><span>Outcome · ${escapeHtml(outcome.title)}</span>${documents.map((document) => `<button type="button" data-open-document="${escapeHtml(document.file)}">Document · ${escapeHtml(document.title)}</button>`).join("")}${session ? `<button type="button" data-open-agent>Native chat · complete evidence</button>` : `<span>Native chat · no live run</span>`}</div></article>
      </section>
    </article>
  `;
}

/** Releases the terminal, socket, and resize observer. */
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

/** Mounts one stable xterm instance for the selected tmux session. */
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
  /** Fits xterm and reports its current dimensions to tmux. */
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

/** Computes the minimal state key that requires a fresh render. */
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
    state.document ? [state.document.file, state.document.hash] : null,
    state.shapeDraft,
    outcome ? [outcome.file, outcome.status, outcome.mtime, outcome.stateText, outcome.myUnderstanding, outcome.currentBrief, outcome.storyText, outcome.documents] : null,
    state.sessions.map((item) => [item.name, item.outcome, item.state, item.phase, item.command]),
  ]);
}

/** Updates shell chrome for the current view and live session. */
function updateHeader() {
  const outcome = currentOutcome();
  const session = sessionForOutcome(outcome);
  const isWork = state.view === "work";
  const isCreate = state.view === "create";
  const isShape = state.view === "shape";
  const isShapeReview = state.view === "shape-review";
  backButton.classList.toggle("has-back", !isWork);
  backButton.textContent = isCreate || isShape
    ? "Work"
    : isShapeReview
      ? "Description"
    : isWork
    ? "Agent Shell"
    : state.view === "overview"
      ? "Work"
      : state.view === "plan"
        ? "Outcome"
        : state.view === "agent"
          ? "Summary"
          : state.view === "document" || state.view === "handoff"
            ? "Outcome"
            : "Agent";
  barContext.textContent = isCreate
    ? "Define a new outcome"
    : isShape
      ? "Describe a body of work"
      : isShapeReview
        ? "Review the parent and optional children"
        : state.view === "document" && state.document
          ? state.document.title
          : state.view === "handoff" && outcome
            ? `Share context · ${outcome.title}`
    : outcome
    ? `${projectLabel(outcome.node)} · ${outcome.title}${session ? ` · ${stateLabel(outcome, session)}` : ""}`
    : "";

  secondaryAction.hidden = !session || ["work", "create", "shape", "shape-review"].includes(state.view);
  secondaryAction.textContent = session?.state === "shell" ? "Close session…" : "Stop agent…";

  if (state.view === "agent" && session?.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else if (["work", "create", "shape", "shape-review", "agent", "decision"].includes(state.view)) {
    findButton.hidden = true;
    findButton.textContent = "Find work";
    findButton.dataset.action = "find";
  } else {
    findButton.hidden = false;
    findButton.innerHTML = `Find work <kbd>⌘/</kbd>`;
    findButton.dataset.action = "find";
  }
}

/** Refreshes live agent state without replacing the terminal. */
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

/** Selects and renders the current full-screen view. */
function renderScreen() {
  const outcome = currentOutcome();
  if (!outcome && !["work", "create", "shape", "shape-review"].includes(state.view)) state.view = "work";
  const session = sessionForOutcome(outcome);
  if (state.view === "agent" && !session) state.view = "overview";
  if (state.view !== "agent") disposeTerminal();

  if (state.view === "work") screen.innerHTML = renderWork();
  else if (state.view === "create") screen.innerHTML = renderCreate();
  else if (state.view === "shape") screen.innerHTML = renderShapeCapture();
  else if (state.view === "shape-review") screen.innerHTML = renderShapeReview();
  else if (state.view === "plan") screen.innerHTML = renderPlan(outcome);
  else if (state.view === "agent") screen.innerHTML = renderAgent(outcome, session);
  else if (state.view === "decision" && session) screen.innerHTML = renderDecision(outcome, session);
  else if (state.view === "document") screen.innerHTML = renderDocument();
  else if (state.view === "handoff") screen.innerHTML = renderHandoff(outcome);
  else screen.innerHTML = renderOverview(outcome, session);

  updateHeader();
  const host = screen.querySelector("[data-session]");
  if (host) mountTerminal(host, host.dataset.session);
}

/** Renders changed state while preserving active form inputs. */
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
  if (!force && active && (["work-search", "my-understanding"].includes(active.id) || active.closest?.("[data-create-form], [data-shape-capture-form], [data-shape-review-form]"))) {
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

/** Refreshes vault and session projections from the server. */
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

/** Selects an outcome without starting work. */
function selectOutcome(file) {
  state.currentFile = file;
  state.view = "overview";
  state.brief = null;
  state.document = null;
  state.editingWords = false;
  localStorage.setItem("agent-shell.current-outcome", file);
  const outcome = outcomeByFile(file);
  if (outcome?.node) localStorage.setItem("agent-shell.last-node", outcome.node);
  paint(true);
}

/** Returns to the work list and optionally focuses search. */
function showWork({ focus = false } = {}) {
  state.view = "work";
  state.brief = null;
  state.document = null;
  state.editingWords = false;
  paint(true);
  if (focus) window.setTimeout(() => document.querySelector("#work-search")?.focus(), 0);
}

/** Returns to the selected outcome summary. */
function showOverview() {
  state.view = "overview";
  state.brief = null;
  state.document = null;
  state.editingWords = false;
  paint(true);
}

/** Opens the fast new-outcome form. */
function showCreate() {
  state.view = "create";
  state.brief = null;
  state.document = null;
  state.editingWords = false;
  paint(true);
  window.setTimeout(() => document.querySelector("#new-outcome-title")?.focus(), 0);
}

/** Opens the saved shaping draft or starts a natural-language capture. */
function showShape() {
  state.view = state.shapeDraft?.parent ? "shape-review" : "shape";
  state.brief = null;
  state.document = null;
  paint(true);
  window.setTimeout(() => document.querySelector(state.view === "shape" ? "#shape-description" : "[data-parent-field='title']")?.focus(), 0);
}

/** Opens one linked document without leaving the selected outcome. */
async function openDocument(file) {
  state.view = "document";
  state.document = null;
  paint(true);
  try {
    state.document = await api(`/api/document?file=${encodeURIComponent(file)}`);
    paint(true);
  } catch (error) {
    showToast(error.message);
    showOverview();
  }
}

/** Opens the concise context derived from the current outcome. */
function showHandoff() {
  if (!currentOutcome()) return;
  state.view = "handoff";
  paint(true);
}

/** Copies the current two-minute context to the system clipboard. */
async function copyHandoff() {
  const outcome = currentOutcome();
  if (!outcome) return;
  try {
    await navigator.clipboard.writeText(handoffText(outcome));
    showToast("The two-minute context is copied.");
  } catch {
    showToast("Clipboard access failed. Select and copy the context manually.");
  }
}

/** Saves the visible natural description as an idea and creates no outcome. */
async function saveVisibleIdea() {
  const node = document.querySelector("#shape-node")?.value || state.shapeDraft?.node || "";
  const description = document.querySelector("#shape-description")?.value.trim() || state.shapeDraft?.description || "";
  if (!node || !description) {
    showToast("Choose a project and describe the idea first.");
    return;
  }
  try {
    await post("/api/idea/new", { node, description });
    state.shapeDraft = null;
    saveShapeDraft();
    showWork();
    showToast("The description is saved as an idea. No outcome was created.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Opens the explicit next-step decision page. */
function showDecision(returnView = state.view) {
  state.decisionReturnView = returnView === "overview" ? "overview" : "agent";
  state.view = "decision";
  state.renderedKey = "";
  paint(true);
}

/** Loads and opens the readable execution plan. */
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

/** Starts a native agent discussion without authorizing execution. */
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

/** Starts the approved execution plan. */
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

/** Launches the agent inside an already-created shell session. */
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

/** Opens one confirmation modal with an explicit effect. */
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

/** Closes the confirmation modal without acting. */
function closeModal() {
  modalLayer.hidden = true;
  modalConfirm = null;
}

/** Confirms and then stops the selected live session. */
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
    /** Stops only the live run and preserves the outcome. */
    onConfirm: async () => {
      await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
      state.view = "overview";
      await refresh();
      paint(true);
      showToast(shell ? "The session closed." : "The agent stopped. The outcome stays open.");
    },
  });
}

/** Confirms semantic completion separately from ending a run. */
function confirmComplete() {
  const outcome = currentOutcome();
  if (!outcome) return;
  openModal({
    kicker: "Whole outcome",
    title: `Mark “${outcome.title}” complete?`,
    copy: "This closes the outcome and ends its live session. Use this only when the complete result is met.",
    confirmLabel: "Mark complete",
    /** Marks the complete outcome done after explicit approval. */
    onConfirm: async () => {
      await post("/api/outcome/edit", { file: outcome.file, status: "done" });
      state.view = "overview";
      await refresh();
      paint(true);
      showToast("The outcome is complete.");
    },
  });
}

/** Toggles the server-owned macOS sleep assertion. */
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
  if (target.closest("[data-describe-work]")) return showShape();
  if (target.closest("[data-open-vision]")) return window.location.assign("/vision");
  if (target.closest("[data-cancel-create]")) return showWork();
  if (target.closest("[data-cancel-shape]")) return showWork();
  if (target.closest("[data-back-shape]")) {
    state.view = "shape";
    paint(true);
    return window.setTimeout(() => document.querySelector("#shape-description")?.focus(), 0);
  }
  if (target.closest("[data-add-child]")) {
    if (!state.shapeDraft) return;
    state.shapeDraft.children.push({ title: "", outcome: "" });
    saveShapeDraft();
    paint(true);
    return window.setTimeout(() => document.querySelector(".child-draft:last-child input")?.focus(), 0);
  }
  const removeChild = target.closest("[data-remove-child]");
  if (removeChild && state.shapeDraft) {
    state.shapeDraft.children.splice(Number(removeChild.dataset.removeChild), 1);
    saveShapeDraft();
    return paint(true);
  }
  if (target.closest("[data-save-idea]")) return saveVisibleIdea();
  const documentButton = target.closest("[data-open-document]");
  if (documentButton) return openDocument(documentButton.dataset.openDocument);
  if (target.closest("[data-share-context]")) return showHandoff();
  if (target.closest("[data-copy-context]")) return copyHandoff();
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
  if (event.target.matches("[data-shape-capture-form]")) {
    event.preventDefault();
    const fields = new FormData(event.target);
    const node = fields.get("node")?.toString() || "";
    const description = fields.get("description")?.toString().trim() || "";
    if (!node || !description) {
      showToast("Choose a project and describe the work.");
      return;
    }
    const submitButton = event.target.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "Shaping the work…";
    try {
      const proposal = await post("/api/work/shape", { description });
      state.shapeDraft = {
        node,
        description,
        parent: { ...proposal.parent, state: "Not started." },
        children: proposal.children || [],
        shapedBy: proposal.shapedBy || "model",
      };
    } catch {
      state.shapeDraft = { ...shapeDraftFromDescription(node, description), shapedBy: "local" };
    }
    localStorage.setItem("agent-shell.last-node", node);
    saveShapeDraft();
    state.view = "shape-review";
    paint(true);
    window.setTimeout(() => document.querySelector("[data-parent-field='title']")?.focus(), 0);
    return;
  }
  if (event.target.matches("[data-shape-review-form]")) {
    event.preventDefault();
    if (!state.shapeDraft) return;
    const parent = {
      title: event.target.querySelector("[data-parent-field='title']")?.value.trim() || "",
      outcome: event.target.querySelector("[data-parent-field='outcome']")?.value.trim() || "",
      state: state.shapeDraft.parent.state || "Not started.",
    };
    const children = [...event.target.querySelectorAll("[data-child-index]")]
      .map((card) => ({
        title: card.querySelector("[data-shape-field='title']")?.value.trim() || "",
        outcome: card.querySelector("[data-shape-field='outcome']")?.value.trim() || "",
      }))
      .filter((child) => child.title || child.outcome);
    if (!parent.title || !parent.outcome) {
      showToast("The parent needs a name and a clear done condition.");
      return;
    }
    if (children.some((child) => !child.title || !child.outcome)) {
      showToast("Each child needs a name and a clear done condition.");
      return;
    }
    try {
      const created = await post("/api/outcome/batch", {
        node: state.shapeDraft.node,
        description: state.shapeDraft.description,
        parent,
        children,
      });
      const count = 1 + children.length;
      state.shapeDraft = null;
      saveShapeDraft();
      await refresh();
      selectOutcome(created.file);
      showToast(`${count} ${count === 1 ? "outcome is" : "outcomes are"} ready. No agent started.`);
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
  if (["shape-node", "shape-description"].includes(event.target.id)) {
    const node = document.querySelector("#shape-node")?.value || preferredNode();
    const description = document.querySelector("#shape-description")?.value || "";
    state.shapeDraft = { node, description, parent: null, children: [] };
    saveShapeDraft();
    return;
  }
  if (event.target.matches("[data-parent-field]") && state.shapeDraft?.parent) {
    state.shapeDraft.parent[event.target.dataset.parentField] = event.target.value;
    saveShapeDraft();
    return;
  }
  if (event.target.matches("[data-shape-field]") && state.shapeDraft?.parent) {
    const card = event.target.closest("[data-child-index]");
    const child = state.shapeDraft.children[Number(card?.dataset.childIndex)];
    if (child) child[event.target.dataset.shapeField] = event.target.value;
    saveShapeDraft();
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

backButton.addEventListener("click", () => {
  if (state.view === "work") return;
  if (state.view === "create") return showWork();
  if (state.view === "shape") return showWork();
  if (state.view === "shape-review") {
    state.view = "shape";
    return paint(true);
  }
  if (state.view === "overview") return showWork();
  if (state.view === "plan") return showOverview();
  if (state.view === "agent") return showOverview();
  if (state.view === "document" || state.view === "handoff") return showOverview();
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
