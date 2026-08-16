const savedGoal = localStorage.getItem("agent-shell.current-goal") || "";
const requestedLocation = new URLSearchParams(location.search);
const requestedView = requestedLocation.get("view");
const requestedArea = requestedLocation.get("area") || "";
const requestedDocument = requestedLocation.get("document") || "";
// Programs now live inside the Area card, so an old ?view=programs link opens Areas.
const initialView = requestedDocument ? "document" : ["areas", "programs"].includes(requestedView) ? "areas" : "work";

/** Reads one optional JSON value from local storage. */
function storedJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

const storedDescribeDraft = storedJson("agent-shell.describe-draft");
const savedDescribeSession = localStorage.getItem("agent-shell.describe-session") || storedDescribeDraft?.session || "";

const state = {
  vault: null,
  programs: { programs: [], errors: [], areas: [], liveCount: 0, timezone: "", scheduler: { installed: false, intervalMinutes: 30 } },
  sessions: [],
  currentFile: savedGoal,
  view: initialView,
  document: null,
  documentReturnView: "work",
  documentTrail: [],
  documentTrailIndex: -1,
  documentPositions: new Map(),
  describeReturnView: "work",
  describeDraft: storedDescribeDraft?.session ? null : storedDescribeDraft,
  describeSessionName: savedDescribeSession,
  areaSelection: requestedArea || localStorage.getItem("agent-shell.last-area") || "",
  createArea: "",
  createReturnView: "work",
  expandedAreas: new Set(storedJson("agent-shell.expanded-areas") || []),
  areaEdit: null,
  programId: "",
  programDraft: { type: "process", area: "", name: "", command: "", time: "07:30", cwd: "", model: "sonnet", prompt: "" },
  launch: { area: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null },
  pipelines: [],
  agentSessionName: null,
  goalSelection: [], // checked Goal files in checked order; transient, work view only
  launchTarget: "",
  launchAnchor: null,
  harnessDraft: null,
  harnessReturnView: "work",
  query: "",
  workFilter: localStorage.getItem("agent-shell.work-filter") || "all",
  caffeinate: false,
  decisionReturnView: "agent",
  agentReturnView: "work",
  offline: false,
  rebuilding: false,
  updateAvailable: false,
  bootId: "",
  loading: true,
  error: "",
  renderedKey: "",
};

const screen = document.querySelector("#screen");
const backButton = document.querySelector("#back-button");
const workTab = document.querySelector("#work-tab");
const areasTab = document.querySelector("#areas-tab");
const barContext = document.querySelector("#bar-context");
const findButton = document.querySelector("#find-button");
const secondaryAction = document.querySelector("#secondary-action");
const modalLayer = document.querySelector("#modal-layer");
const modalKicker = document.querySelector("#modal-kicker");
const modalTitle = document.querySelector("#modal-title");
const modalCopy = document.querySelector("#modal-copy");
const modalField = document.querySelector("#modal-field");
const modalActions = document.querySelector("#modal-actions");
const toast = document.querySelector("#toast");
const statusPill = document.querySelector("#status-pill");
const shellMenu = document.querySelector("#shell-menu");

let terminal = null;
let terminalFit = null;
let terminalSocket = null;
let terminalResizeObserver = null;
let terminalSession = "";
let terminalSelection = null;
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

/** Decodes one local link without failing on malformed percent escapes. */
function decodeLink(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

/** Resolves one local link path against the selected Document. */
function vaultLinkPath(target) {
  const raw = decodeLink(String(target ?? "").split("#")[0].split("?")[0]).replaceAll("\\", "/");
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  const parts = raw.startsWith("./") || raw.startsWith("../")
    ? [...String(state.document?.file ?? "").split("/").slice(0, -1), ...raw.split("/")]
    : raw.replace(/^\//, "").split("/");
  const resolved = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

/** Finds one vault record from a full, short, or relative link target. */
function vaultLinkRecord(target) {
  const value = vaultLinkPath(target).replace(/\.md$/i, "");
  const records = state.vault?.documents ?? [];
  if (value.includes("/")) return records.find((record) => record.file.replace(/\.md$/i, "") === value) ?? null;
  const currentDirectory = String(state.document?.file ?? "").split("/").slice(0, -1).join("/");
  const nearby = currentDirectory ? `${currentDirectory}/${value}` : "";
  if (nearby) {
    const record = records.find((item) => item.file.replace(/\.md$/i, "") === nearby);
    if (record) return record;
  }
  return records.find((record) => record.file.split("/").at(-1)?.replace(/\.md$/i, "") === value) ?? null;
}

/** Renders the small inline Markdown subset used by vault notes. */
function inlineMarkdown(value) {
  const links = [];
  const source = String(value ?? "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => {
      const index = links.push({ target: target.trim(), label: alias?.trim() || "", format: "wiki" }) - 1;
      return `\u0001${index}\u0002`;
    })
    .replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
      const index = links.push({ target: target.trim(), label: label.trim(), format: "markdown" }) - 1;
      return `\u0001${index}\u0002`;
    });
  let html = escapeHtml(source)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  for (const [index, link] of links.entries()) {
    if (/^(?:https?:|mailto:)/i.test(link.target)) {
      html = html.replace(
        `\u0001${index}\u0002`,
        `<a class="markdown-link external" href="${escapeHtml(link.target)}" target="_blank" rel="noreferrer">${escapeHtml(link.label || link.target)}</a>`
      );
      continue;
    }
    if (link.target.startsWith("#")) {
      const id = markdownHeadingAnchor(decodeLink(link.target.slice(1)), new Map());
      html = html.replace(
        `\u0001${index}\u0002`,
        `<a class="markdown-link" href="#${escapeHtml(id)}" data-document-heading="${escapeHtml(id)}">${escapeHtml(link.label || decodeLink(link.target.slice(1)))}</a>`
      );
      continue;
    }
    const record = vaultLinkRecord(link.target);
    const fallback = humanName(link.target.split("#")[0].split("/").at(-1)?.replace(/\.md$/i, "") || link.target);
    const label = link.label || record?.title || fallback;
    html = html.replace(
      `\u0001${index}\u0002`,
      `<button class="markdown-vault-link ${record ? "resolved" : "missing"}" type="button" data-open-vault-link="${escapeHtml(link.target)}">${escapeHtml(label)}</button>`
    );
  }
  return html;
}

/** Removes frontmatter from Markdown before display or structural analysis. */
function visibleMarkdown(text) {
  return String(text ?? "").replace(/\r/g, "").replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
}

/** Creates a stable local anchor from one Markdown heading. */
function markdownHeadingAnchor(value, seen) {
  const base = cleanText(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

/** Returns the visible heading hierarchy with the same anchors as the renderer. */
function markdownHeadings(text) {
  const seen = new Map();
  return visibleMarkdown(text).split("\n").flatMap((line) => {
    const match = line.trimEnd().match(/^(#{1,4})\s+(.+)$/);
    if (!match) return [];
    return [{ level: match[1].length, title: cleanText(match[2]), id: markdownHeadingAnchor(match[2], seen) }];
  });
}

/** Splits one Markdown table row without treating escaped pipes as columns. */
function markdownTableCells(value) {
  const escapedPipe = "\u0000";
  let row = String(value ?? "").trim().replace(/\\\|/g, escapedPipe);
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim().replaceAll(escapedPipe, "|"));
}

/** Returns table alignment names when one row is a valid Markdown separator. */
function markdownTableAlignments(value) {
  const cells = markdownTableCells(value);
  if (cells.length < 2 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
}

/** Renders safe headings, paragraphs, lists, and tables from Markdown. */
function markdownToHtml(text) {
  const source = visibleMarkdown(text);
  const lines = source.split("\n");
  const html = [];
  const headingIds = new Map();
  let list = null;
  /** Closes the current list when the Markdown block type changes. */
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const alignments = line.includes("|") ? markdownTableAlignments(lines[index + 1] ?? "") : null;
    const headers = alignments ? markdownTableCells(line) : [];
    if (alignments && headers.length === alignments.length) {
      closeList();
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = markdownTableCells(lines[index]);
        if (cells.length !== headers.length) break;
        rows.push(cells);
        index += 1;
      }
      index -= 1;
      /** Returns the alignment class for one table column. */
      const cellClass = (column) => ` class="align-${alignments[column]}"`;
      html.push(
        `<div class="markdown-table-wrap"><table><thead><tr>${headers.map((cell, column) => `<th${cellClass(column)}>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${row.map((cell, column) => `<td${cellClass(column)}>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      );
    } else if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      const id = markdownHeadingAnchor(heading[2], headingIds);
      html.push(`<h${level} id="${escapeHtml(id)}">${inlineMarkdown(heading[2])}</h${level}>`);
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
    .replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, "$1")
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

/** Returns the compact fact that restores the selected Goal. */
function currentBriefFields(goal) {
  let wanted = goal.doneWhen || "No clear result is recorded yet.";
  for (const line of String(goal.currentBrief ?? "").split("\n")) {
    const item = line.match(/^\s*[-*]?\s*You wanted\s*:\s*(.+)$/i);
    if (item) wanted = cleanText(item[1]);
  }
  return { wanted };
}

/** Parses the intentionally short Story so far section into ordered moments. */
function storyEntries(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const matches = [...source.matchAll(/^###\s+(.+)\n+([\s\S]*?)(?=^###\s+|$)/gm)];
  if (!matches.length) return [{ title: "Latest", body: clip(source, 320) }];
  return matches.slice(-5).map((match) => ({ title: cleanText(match[1]), body: clip(match[2], 320) }));
}

// The launch popover's target when it chooses the agent for a describe-work
// conversation instead of a Goal. Never collides with a goal file path.
const DESCRIBE_LAUNCH_TARGET = "__describe__";

/** The Area a describe-work launch applies to, read live from the form. */
function describeLaunchArea() {
  return document.querySelector("#describe-area")?.value || state.describeDraft?.area || preferredArea();
}

/**
 * Captures the describe form's typed values into the stored draft. Any
 * re-render replaces the textarea, so every interaction that paints while the
 * describe form is visible must run this first or the text is lost.
 */
function syncDescribeDraft() {
  const textarea = document.querySelector("#describe-work");
  if (!textarea) return;
  state.describeDraft = { ...(state.describeDraft ?? { sources: [] }), area: describeLaunchArea(), description: textarea.value };
  saveDescribeDraft();
}

/** Keeps an unfinished work description across navigation and restarts. */
function saveDescribeDraft() {
  if (state.describeDraft) localStorage.setItem("agent-shell.describe-draft", JSON.stringify(state.describeDraft));
  else localStorage.removeItem("agent-shell.describe-draft");
}

/** Keeps the selected work-definition session separate from an unfinished description. */
function saveDescribeSession() {
  if (state.describeSessionName) localStorage.setItem("agent-shell.describe-session", state.describeSessionName);
  else localStorage.removeItem("agent-shell.describe-session");
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

/** Returns every indexed goal once. */
function allGoals() {
  const byFile = new Map();
  for (const group of state.vault?.map ?? []) {
    for (const goal of group.goals ?? []) byFile.set(goal.file, goal);
  }
  return [...byFile.values()];
}

/** Retains the vault's area grouping for a selected goal subset. */
function goalGroups(goals) {
  const rank = new Map(goals.map((goal, index) => [goal.file, index]));
  return (state.vault?.map ?? [])
    .map((group) => ({
      ...group,
      goals: (group.goals ?? []).filter((goal) => rank.has(goal.file)),
    }))
    .filter((group) => group.goals.length)
    .sort((a, b) => {
      const aRank = Math.min(...a.goals.map((goal) => rank.get(goal.file)));
      const bRank = Math.min(...b.goals.map((goal) => rank.get(goal.file)));
      return aRank - bRank;
    });
}

/** Splits the ordered vault projection into user-selectable Goal trees. */
function goalTrees() {
  const trees = [];
  for (const group of state.vault?.map ?? []) {
    let tree = null;
    for (const goal of group.goals ?? []) {
      if (!tree || Number(goal.depth || 0) === 0) {
        tree = { path: group.path, root: goal, goals: [goal] };
        trees.push(tree);
      } else {
        tree.goals.push(goal);
      }
    }
  }
  return trees;
}

/** Places one complete work tree in a single attention group. */
function goalTreeState(tree) {
  const openGoals = tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  if (!openGoals.length) return "closed";
  const sessions = openGoals.map(sessionForGoal).filter(Boolean);
  if (sessions.some((session) => ["waiting", "shell"].includes(session.state))) return "waiting";
  if (sessions.some((session) => session.state === "working")) return "working";
  if (sessions.length) return "open";
  if (openGoals.some(goalNeedsYou)) return "waiting";
  return "ready";
}

/** True when any open Goal in one complete Goal tree owns a live session. */
function goalTreeIsActive(tree) {
  return tree.goals.some((goal) => !["done", "dropped", "deferred"].includes(goal.status) && Boolean(sessionForGoal(goal)));
}

/** Applies the selected session-presence filter without splitting Goal trees. */
function filteredGoalTrees(trees) {
  if (state.workFilter === "active") return trees.filter(goalTreeIsActive);
  if (state.workFilter === "inactive") return trees.filter((tree) => !goalTreeIsActive(tree));
  return trees;
}

/** Stores the expansion state of the Area tree. */
function saveExpandedAreas() {
  localStorage.setItem("agent-shell.expanded-areas", JSON.stringify([...state.expandedAreas].sort()));
}

/** Expands the ancestors of one area so the selected row stays visible. */
function revealArea(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) state.expandedAreas.add(parts.slice(0, index).join("/"));
  saveExpandedAreas();
}

/** Finds one indexed goal by its vault-relative file. */
function goalByFile(file) {
  return allGoals().find((goal) => goal.file === file) || null;
}

/** Returns the goal selected in the shell. */
function currentGoal() {
  return goalByFile(state.currentFile);
}

/** Finds the live session bound to one goal. */
function sessionForGoal(goal) {
  if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return null;
  const bound = state.sessions.filter((session) => session.goal === goal.file || session.name === goal.session);
  // A pipeline leaves earlier step sessions alive on the same Goal: the one
  // Julian opened by name wins, then the Goal's bound session, then any.
  return bound.find((session) => session.name === state.agentSessionName)
    ?? bound.find((session) => session.name === goal.session)
    ?? bound[0]
    ?? null;
}

/** Returns every live conversation that is defining work, newest first. */
function describeWorkSessions() {
  return state.sessions
    .filter((session) => session.kind === "work-definition")
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0));
}

/** Finds only the work-definition conversation the user selected. */
function describeWorkSession() {
  return describeWorkSessions().find((session) => session.name === state.describeSessionName) ?? null;
}

const NAME_MAP = new Map([
  ["otto", "Otto"],
  ["dnd", "D&D"],
  ["tangent", "Tangent"],
  ["neara", "Neara"],
  ["pgande", "PG&E"],
  ["pyth", "Python"],
]);

/** Converts a stored area segment into its human label. */
function humanName(value) {
  const key = String(value ?? "").toLowerCase();
  if (NAME_MAP.has(key)) return NAME_MAP.get(key);
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Converts an Area path into readable segments. */
function areaParts(area) {
  return String(area ?? "").split("/").filter(Boolean).map(humanName);
}

/** Formats one complete readable area path. */
function areaLabel(area) {
  return areaParts(area).join(" / ");
}

/** Renders one compact Area breadcrumb with a direct route to each level. */
function areaPath(area) {
  const segments = String(area ?? "").split("/").filter(Boolean);
  return `<nav class="area-path" aria-label="Area path">${segments.map((segment, index) => {
    const path = segments.slice(0, index + 1).join("/");
    return `<button type="button" data-open-area="${escapeHtml(path)}">${escapeHtml(humanName(segment))}</button>`;
  }).join("")}</nav>`;
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

/** True when one stored handoff names the user. */
function goalNeedsYou(goal) {
  if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return false;
  return /\b(julian|you)\b/i.test(String(goal.waitingOn ?? ""));
}

/** The refined waiting label: why the static agent needs (or can wait for) you. */
function waitingLabel(session) {
  if (session.stateDetail === "decision") return "Needs your decision";
  if (session.stateDetail === "idle") return "Finished · ready for you";
  if (session.stateDetail === "draft") return "Holding your draft";
  return "Waiting for you";
}

/** Describes one Goal and Run state in user terms. */
function stateLabel(goal, session) {
  if (goal.status === "done") return "Complete";
  if (!session) return goalNeedsYou(goal) ? "Waiting for you" : "Ready";
  if (session.state === "waiting") return waitingLabel(session);
  if (session.state === "working") return "Agent working";
  if (session.state === "shell") return "Agent did not start";
  return "Session open";
}

/** Describes one work-definition conversation without a Goal status. */
function describeWorkStateLabel(session) {
  if (!session) return "Agent session ended";
  if (session.state === "waiting") return waitingLabel(session);
  if (session.state === "working") return "Agent working";
  if (session.state === "shell") return "Agent did not start";
  return "Session open";
}

/** Places a work-definition conversation in the same attention groups as Goal runs. */
function describeWorkAttention(session) {
  return session.state === "working" ? "working" : "waiting";
}

/** Renders one work-definition conversation as a first-class work row. */
function describeWorkCard(session, className = "") {
  const name = agentName(session);
  const reference = name === "Agent" ? "A native agent" : name;
  return `
    <button class="work-card work-definition ${className}" type="button" data-select-work-definition="${escapeHtml(session.name)}">
      <span>
        <span class="work-area">${escapeHtml(areaLabel(session.area))} · Defining work</span>
        <span class="work-title">${escapeHtml(session.workTitle || "Define new work")}</span>
        <span class="work-goal">${escapeHtml(reference)} is turning your description into confirmed Goals.</span>
      </span>
      <span class="work-state">${escapeHtml(describeWorkStateLabel(session))}</span>
    </button>
  `;
}

/** Renders one selectable goal row. */
function workCard(goal, className = "", { grouped = false, depthBase = 0, label = "" } = {}) {
  const session = sessionForGoal(goal);
  const depth = Math.max(0, Number(goal.depth || 0) - depthBase);
  return `
    <button class="work-card ${className} ${depth ? "nested" : ""}" style="--goal-depth: ${depth}" type="button" data-select-goal="${escapeHtml(goal.file)}">
      <span>
        ${grouped ? "" : `<span class="work-area">${escapeHtml(areaLabel(goal.area))}</span>`}
        <span class="work-title">${escapeHtml(goal.title)}</span>
        <span class="work-goal">${escapeHtml(clip(goal.doneWhen, 180))}</span>
      </span>
      <span class="work-state">${escapeHtml(label || stateLabel(goal, session))}</span>
    </button>
  `;
}

/** Describes attention anywhere inside one Goal tree. */
function goalTreeLabel(tree) {
  const stateName = goalTreeState(tree);
  const count = tree.goals.map(sessionForGoal).filter(Boolean).length;
  if (stateName === "waiting") return count > 1 ? `${count} runs · needs you` : "Waiting for you";
  if (stateName === "working") return count > 1 ? `${count} agents working` : "Agent working";
  if (stateName === "open") return count > 1 ? `${count} sessions open` : "Session open";
  return stateLabel(tree.root, sessionForGoal(tree.root));
}

/** Renders one Goal and its collapsible Subgoal chain. */
function goalTreeCard(tree, className = "") {
  const subgoals = tree.goals.slice(1);
  const hasActiveSubgoal = subgoals.some((goal) => sessionForGoal(goal));
  return `
    <section class="goal-tree">
      ${workCard(tree.root, className, { grouped: true, label: goalTreeLabel(tree) })}
      ${subgoals.length ? `
        <details class="goal-subgoals" ${hasActiveSubgoal ? "open" : ""}>
          <summary><span>To do that</span><small>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</small></summary>
          <div class="work-list">${subgoals.map((goal) => workCard(goal, className, { grouped: true, depthBase: 0 })).join("")}</div>
        </details>` : ""}
    </section>`;
}

/** Renders complete Goal trees under one Area path. */
function goalTreeAreaGroup(path, trees, className = "") {
  return `
    <details class="area-work-group" open>
      <summary class="area-work-heading"><span>${escapeHtml(areaLabel(path))}</span><span>${trees.length}</span></summary>
      <div class="goal-tree-list">${trees.map((tree) => goalTreeCard(tree, className)).join("")}</div>
    </details>`;
}

/** Renders Goal trees and defining conversations together under one Area. */
function workAttentionAreaGroup(path, trees, descriptions, className = "") {
  const count = trees.length + descriptions.length;
  return `
    <details class="area-work-group" open>
      <summary class="area-work-heading"><span>${escapeHtml(areaLabel(path))}</span><span>${count}</span></summary>
      <div class="goal-tree-list">
        ${descriptions.map((session) => describeWorkCard(session, className)).join("")}
        ${trees.map((tree) => goalTreeCard(tree, className)).join("")}
      </div>
    </details>`;
}

/** Renders one attention group containing Goal runs and work-definition agents. */
function workAttentionSection(title, trees, descriptions = [], className = "") {
  if (!trees.length && !descriptions.length) return "";
  const byPath = new Map();
  for (const tree of trees) {
    if (!byPath.has(tree.path)) byPath.set(tree.path, { trees: [], descriptions: [] });
    byPath.get(tree.path).trees.push(tree);
  }
  for (const session of descriptions) {
    if (!byPath.has(session.area)) byPath.set(session.area, { trees: [], descriptions: [] });
    byPath.get(session.area).descriptions.push(session);
  }
  return `
    <section class="work-section">
      <div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${trees.length + descriptions.length}</span></div>
      <div class="area-work-list">${[...byPath].map(([path, items]) => workAttentionAreaGroup(path, items.trees, items.descriptions, className)).join("")}</div>
    </section>`;
}

/** Renders one attention group as complete, collapsible Goal trees. */
function goalTreeSection(title, trees, className = "") {
  return workAttentionSection(title, trees, [], className);
}

/** Renders the goals that belong to one area group. */
function workAreaGroup(group, className = "") {
  const depthBase = Math.min(...group.goals.map((goal) => Number(goal.depth || 0)));
  return `
    <section class="area-work-group">
      <div class="area-work-heading">
        <span>${escapeHtml(areaLabel(group.path))}</span>
        <span>${group.goals.length}</span>
      </div>
      <div class="work-list">${group.goals.map((goal) => workCard(goal, className, { grouped: true, depthBase })).join("")}</div>
    </section>
  `;
}

/** Renders one status section of grouped work. */
function workSection(title, goals, className = "", note = "") {
  if (!goals.length) return "";
  const groups = goalGroups(goals);
  return `
    <section class="work-section">
      <div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(note || String(goals.length))}</span></div>
      <div class="area-work-list">${groups.map((group) => workAreaGroup(group, className)).join("")}</div>
    </section>
  `;
}

const SEARCH_FILLER = new Set(["a", "an", "and", "built", "did", "do", "for", "in", "it", "of", "on", "the", "thing", "things", "to", "we", "when"]);

/** Normalizes conversational wording for forgiving local search. */
function normalizedSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/p\s*&\s*g\s*&\s*e/g, "pgande")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.length > 4 && word.endsWith("ing") ? word.slice(0, -3) : word.length > 3 && word.endsWith("ed") ? word.slice(0, -2) : word)
    .join(" ");
}

/** Extracts the meaningful terms from one conversational query. */
function searchTerms(query) {
  return [...new Set(normalizedSearchText(query).split(" ").filter((word) => word && !SEARCH_FILLER.has(word)))];
}

/** Scores one record only when all meaningful query terms are present. */
function searchScore(record, terms, emphasis = "") {
  if (!terms.length) return 0;
  const text = normalizedSearchText(record.searchText || `${record.title || ""} ${record.area || ""} ${record.body || ""}`);
  const joinedText = text.replaceAll(" ", "");
  if (!terms.every((term) => text.includes(term) || joinedText.includes(term))) return 0;
  const strong = normalizedSearchText(emphasis || record.title || "");
  return terms.reduce((score, term) => score + 1 + (strong.includes(term) ? 4 : 0), 0) + Number(record.mtime || 0) / 1e15;
}

/** Renders one Document result with the Goal history that explains it. */
function documentSearchCard(document) {
  const history = document.goalHistory ?? [];
  const trail = history.length ? history.map((goal) => goal.title).join(" → ") : areaLabel(document.area);
  return `
    <button class="search-result-card document-result" type="button" data-open-document="${escapeHtml(document.file)}">
      <span><span class="search-result-kind">Document</span><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(trail)}</small></span>
      <span aria-hidden="true">→</span>
    </button>`;
}

/** Renders mixed results without hiding Documents behind Goal pages. */
function searchResults(query) {
  const terms = searchTerms(query);
  const goals = allGoals()
    .map((goal) => ({ goal, score: searchScore(goal, terms, goal.title) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.goal);
  const documents = (state.vault?.documents ?? [])
    .filter((document) => document.kind === "document")
    .map((document) => ({ document, score: searchScore(document, terms, `${document.title} ${(document.goalHistory ?? []).map((goal) => goal.title).join(" ")}`) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.document);
  const matchingAreas = areas()
    .map((area) => ({ area, score: searchScore({ ...area, searchText: `${area.path} ${area.purpose} ${area.body}` }, terms, areaLabel(area.path)) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.area);
  const deskRecords = new Map(deskAreas().map((record) => [record.area.path, record]));
  const matchingAreaPanels = matchingAreas.map((area) => deskRecords.get(area.path)).filter(Boolean);
  const count = goals.length + documents.length + matchingAreas.length;
  if (!count) return `<div class="empty-state">No Goals, Documents, or Areas match “${escapeHtml(query)}”.</div>`;
  return `
    ${matchingAreaPanels.length ? `<section class="area-desk-grid search-area-results" aria-label="Matching Areas">${matchingAreaPanels.map(deskAreaPanel).join("")}</section>` : ""}
    ${documents.length ? `<section class="work-section"><div class="section-heading"><h2>Documents</h2><span>${documents.length}</span></div><div class="search-result-list">${documents.map(documentSearchCard).join("")}</div></section>` : ""}
    ${goals.length ? workSection("Goals", goals, "", String(goals.length)) : ""}
    ${matchingAreas.length && !matchingAreaPanels.length ? `<section class="work-section"><div class="section-heading"><h2>Areas</h2><span>${matchingAreas.length}</span></div><div class="search-result-list">${matchingAreas.map((area) => `<button class="search-result-card" type="button" data-open-area="${escapeHtml(area.path)}"><span><span class="search-result-kind">Area</span><strong>${escapeHtml(areaLabel(area.path))}</strong><small>${escapeHtml(clip(area.purpose || area.path, 160))}</small></span><span aria-hidden="true">→</span></button>`).join("")}</div></section>` : ""}`;
}

/** Returns one compact, explicit state for an Area on the Work desk. */
function deskAreaState(path, trees, descriptions) {
  const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...descriptions];
  const waiting = sessions.filter((session) => ["waiting", "shell"].includes(session.state)).length
    + goals.filter((goal) => !sessionForGoal(goal) && goalNeedsYou(goal)).length;
  const working = sessions.filter((session) => session.state === "working").length;
  if (waiting) return { kind: "waiting", label: `${waiting} ${waiting === 1 ? "item needs" : "items need"} you` };
  if (working) return { kind: "working", label: `${working} ${working === 1 ? "agent" : "agents"} working` };
  const ready = goals.filter((goal) => !sessionForGoal(goal)).length;
  if (ready) return { kind: "ready", label: `${ready} ${ready === 1 ? "Goal" : "Goals"} ready` };
  return { kind: "quiet", label: "Reference Area" };
}

/** Returns the Areas that have direct work, Documents, or definition Runs. */
function deskAreas() {
  const trees = filteredGoalTrees(goalTrees().filter((tree) => goalTreeState(tree) !== "closed"));
  const descriptions = state.workFilter === "inactive" ? [] : describeWorkSessions();
  return areas().flatMap((area, index) => {
    const areaTrees = trees.filter((tree) => tree.path === area.path);
    const areaDescriptions = descriptions.filter((session) => session.area === area.path);
    const documents = [...new Map([
      ...(area.documents ?? []),
      ...areaTrees.flatMap((tree) => tree.goals.flatMap((goal) => goal.documents ?? [])),
    ].filter((document) => document.kind === "document" || !document.kind).map((document) => [document.file, document])).values()];
    if (state.workFilter !== "all" && !areaTrees.length && !areaDescriptions.length) return [];
    if (!areaTrees.length && !areaDescriptions.length && !documents.length) return [];
    return [{ area, trees: areaTrees, descriptions: areaDescriptions, documents, index }];
  });
}

/** Returns direct routes to every agent or handoff that needs the user. */
function deskAttentionItems() {
  const goalItems = allGoals().flatMap((goal) => {
    if (["done", "dropped", "deferred"].includes(goal.status)) return [];
    const session = sessionForGoal(goal);
    const pipeline = pipelineForGoal(goal);
    const stoppedStep = pipeline?.steps.find((step) => step.status === "stopped" || (step.status === "running" && !step.live));
    if (stoppedStep) return [{ kind: "pipeline", goal, session: null, area: goal.area, title: `${goal.title} · step ${stoppedStep.index} stopped` }];
    if (session && ["waiting", "shell"].includes(session.state)) {
      return [{ kind: "goal", goal, session, area: goal.area, title: goal.title }];
    }
    if (!session && goalNeedsYou(goal)) return [{ kind: "handoff", goal, area: goal.area, title: goal.title }];
    return [];
  });
  const definitionItems = describeWorkSessions()
    .filter((session) => describeWorkAttention(session) === "waiting")
    .map((session) => ({ kind: "definition", session, area: session.area, title: session.workTitle || "Define new work" }));
  return [...goalItems, ...definitionItems].sort((left, right) => left.area.localeCompare(right.area) || left.title.localeCompare(right.title));
}

let dockBadgeCount = null;

/** Keeps the installed Safari web app's Dock badge equal to the Needs you now projection. */
async function syncDockBadge() {
  const count = deskAttentionItems().length;
  if (count === dockBadgeCount) return;
  const nativeBridge = window.__agentShellNativeDockBadge === true;
  if (!nativeBridge && (typeof Notification === "undefined" || Notification.permission !== "granted")) return;
  try {
    if (count > 0) {
      if (typeof navigator.setAppBadge !== "function") return;
      await navigator.setAppBadge(count);
    } else if (typeof navigator.clearAppBadge === "function") {
      await navigator.clearAppBadge();
    } else if (typeof navigator.setAppBadge === "function") {
      await navigator.setAppBadge(0);
    } else {
      return;
    }
    dockBadgeCount = count;
  } catch {
    // Badge support and permission are browser-owned; retry on the next refresh.
  }
}

/** Requests the notification permission WebKit requires before it displays app-icon badges. */
async function enableDockBadge() {
  if (window.__agentShellNativeDockBadge === true) {
    dockBadgeCount = null;
    await syncDockBadge();
    return;
  }
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
    return showToast("This browser cannot enable Dock badges for Agent Shell.");
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    return showToast("Allow Agent Shell notifications in System Settings to show its Dock badge.");
  }
  dockBadgeCount = null;
  await syncDockBadge();
  paint(true);
  showToast("The Dock badge now follows Needs you now. No notification banners are sent.");
}

/** Renders the small action index above the stable Area map. */
function deskAttentionQueue() {
  const items = deskAttentionItems();
  if (!items.length) return "";
  const enableBadge = typeof navigator.setAppBadge === "function"
    && window.__agentShellNativeDockBadge !== true
    && typeof Notification !== "undefined"
    && Notification.permission !== "granted";
  return `
    <section class="attention-queue" aria-labelledby="attention-heading">
      <header><p class="kicker">Attention</p><h2 id="attention-heading">Needs you now</h2>${enableBadge ? `<button class="attention-badge-button" type="button" data-enable-dock-badge>Show in Dock</button>` : ""}<span>${items.length}</span></header>
      <div class="attention-items">${items.map((item) => {
        const name = item.session ? agentName(item.session) : "Handoff";
        const action = item.kind === "definition"
          ? `data-select-work-definition="${escapeHtml(item.session.name)}"`
          : item.kind === "handoff" || item.kind === "pipeline"
            ? `data-reveal-goal="${escapeHtml(item.goal.file)}"`
            : `data-open-goal-run="${escapeHtml(item.goal.file)}"`;
        const label = item.kind === "handoff" ? "See handoff" : item.kind === "pipeline" ? "See steps" : `Open ${name}`;
        return `<button type="button" ${action}><span><small>${escapeHtml(areaLabel(item.area))}</small><strong>${escapeHtml(item.title)}</strong></span><span>${escapeHtml(label)} <b aria-hidden="true">→</b></span></button>`;
      }).join("")}</div>
    </section>`;
}

/** Returns the action text for one Goal without hiding its current state. */
function deskGoalAction(goal) {
  if (["done", "dropped", "deferred"].includes(goal.status)) {
    return { state: goal.status === "done" ? "Complete" : humanName(goal.status), action: "", kind: "complete", route: "" };
  }
  const session = sessionForGoal(goal);
  if (!session) return { state: goalNeedsYou(goal) ? "Waiting for you" : "Ready", action: "Start agent", kind: goalNeedsYou(goal) ? "waiting" : "ready", route: "run" };
  if (session.state === "working") return { state: "Agent working", action: `Open ${agentName(session)}`, kind: "working", route: "run" };
  if (session.state === "waiting") return { state: "Waiting for you", action: `Open ${agentName(session)}`, kind: "waiting", route: "run" };
  if (session.state === "shell") return { state: "Agent did not start", action: "Open session", kind: "waiting", route: "run" };
  return { state: "Session open", action: "Open agent", kind: "ready", route: "run" };
}

/** The idle time (ms) after which an idle step is offered "Send to next". */
const PIPELINE_SEND_AFTER_MS = 60_000;

/** The pipeline row's state pill and primary action. */
function deskPipelineAction(goal, pipeline) {
  const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped") ?? pipeline.steps.find((item) => item.status === "pending");
  if (!step) return deskGoalAction(goal);
  const prefix = `Step ${step.index} of ${pipeline.steps.length} · ${step.label || "agent"}`;
  if (step.status === "stopped" || (step.status === "running" && !step.live)) return { state: `${prefix} · stopped`, action: "", kind: "waiting", route: "" };
  if (step.status === "pending") return { state: `${prefix} · not started`, action: "", kind: "waiting", route: "" };
  if (step.state === "working") return { state: `${prefix} · working`, action: `Open step ${step.index}`, kind: "working", route: "run" };
  if (step.state === "waiting") return { state: `${prefix} · waiting for you`, action: `Open step ${step.index}`, kind: "waiting", route: "run" };
  if (step.state === "shell") return { state: `${prefix} · agent did not start`, action: `Open step ${step.index}`, kind: "waiting", route: "run" };
  return { state: prefix, action: `Open step ${step.index}`, kind: "ready", route: "run" };
}

/** One chip per step and the first line of the latest handover. */
function deskPipelineSteps(goal) {
  const record = (state.pipelines ?? []).find((item) => item.goal === goal.file);
  if (!record || ["done", "dropped", "deferred"].includes(goal.status)) return "";
  const glyph = { complete: "✓", running: "●", pending: "○", skipped: "–", stopped: "■" };
  const chips = record.steps.map((step) => {
    const label = `${step.index} ${step.label || "agent"}: ${clip(step.instruction, 80)}`;
    const dead = step.status === "running" && !step.live;
    const status = dead ? "stopped" : step.status;
    return step.live
      ? `<button type="button" class="desk-step ${status}" data-open-session="${escapeHtml(step.session)}" data-open-session-goal="${escapeHtml(goal.file)}" title="Open ${escapeHtml(label)}"><b aria-hidden="true">${glyph[status] ?? "○"}</b>${step.index}</button>`
      : `<span class="desk-step ${status}" title="${escapeHtml(label)}${step.session ? " (no live session)" : ""}"><b aria-hidden="true">${glyph[status] ?? "○"}</b>${step.index}</span>`;
  }).join("");
  const latest = [...record.steps].reverse().find((step) => step.handover);
  const line = latest ? `<span class="desk-handover">Step ${latest.index}: ${escapeHtml(clip(String(latest.handover).split("\n")[0], 120))}</span>` : "";
  return `<span class="desk-pipeline-steps" aria-label="Pipeline steps">${chips}</span>${line}`;
}

/** Restart, Skip, and Send-to-next, only when they apply. */
function deskPipelineControls(goal, pipeline) {
  const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped");
  if (!step) return "";
  const last = step.index >= pipeline.steps.length;
  const stopped = step.status === "stopped" || (step.status === "running" && !step.live);
  if (stopped) {
    return `<button class="desk-action" type="button" data-pipeline-control="restart" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Restart step ${step.index}</button>`
      + (last ? "" : `<button class="desk-action" type="button" data-pipeline-control="skip" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Skip to step ${step.index + 1}</button>`);
  }
  const idleLong = step.state === "waiting" && (step.stateDetail === "idle" || step.stateDetail === null) && step.idleSince && Date.now() - step.idleSince >= PIPELINE_SEND_AFTER_MS;
  if (idleLong && !last) {
    return `<button class="desk-action" type="button" data-pipeline-control="send" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="Use the agent's last message as its handover">Send to step ${step.index + 1}</button>`;
  }
  return "";
}

/** Renders the Documents linked to one Goal as compact reader chips. */
function deskGoalDocuments(goal) {
  const documents = (goal.documents ?? []).filter((document) => document.kind === "document" || !document.kind);
  if (!documents.length) return "";
  return `<span class="desk-goal-docs">${documents.map((document) => `
    <button class="desk-doc-chip" type="button" data-open-document="${escapeHtml(document.file)}" title="Open ${escapeHtml(document.title)}"><b aria-hidden="true">DOC</b>${escapeHtml(document.title)}</button>`).join("")}</span>`;
}

/** Renders one Goal with its brief, Documents, handoff, and direct actions. */
function deskGoalRow(goal, { subgoal = false } = {}) {
  const pipeline = pipelineForGoal(goal);
  const record = pipelineRecordForGoal(goal);
  const action = pipeline ? deskPipelineAction(goal, pipeline) : deskGoalAction(goal);
  const liveSession = sessionForGoal(goal);
  const launchTitle = record ? "Add or edit steps" : "Choose agent or model";
  /** The ▾ that opens this Goal's launch popover: agent choice, or the step list once a pipeline exists. */
  const launchToggle = (label) => `<button class="desk-action desk-launch-toggle${state.launchTarget === goal.file ? " open" : ""}" type="button" data-launch-for="${escapeHtml(goal.file)}" title="${launchTitle}" aria-label="${launchTitle} for ${escapeHtml(goal.title)}" aria-expanded="${state.launchTarget === goal.file}">${label}</button>`;
  const complete = !["done", "dropped", "deferred"].includes(goal.status);
  const handoff = !sessionForGoal(goal) && goalNeedsYou(goal) ? String(goal.waitingOn ?? "").trim() : "";
  const route = `data-open-goal-run="${escapeHtml(goal.file)}"`;
  const selectable = action.action === "Start agent";
  const selected = selectable && state.goalSelection.includes(goal.file);
  return `
    <article class="desk-goal ${subgoal ? "subgoal" : "root-goal"} ${action.kind}${selected ? " selected" : ""}" data-goal-anchor="${escapeHtml(goal.file)}">
      ${selectable ? `<label class="desk-select" title="Select for one shared agent"><input type="checkbox" data-check-goal="${escapeHtml(goal.file)}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(goal.title)} for one shared agent"></label>` : ""}
      <div class="desk-goal-main">
        <small>${subgoal ? "Subgoal" : "Goal"}</small>
        <strong>${escapeHtml(goal.title)}</strong>
        <span>${escapeHtml(currentBriefFields(goal).wanted)}</span>
        ${handoff ? `<span class="desk-goal-handoff">Handoff: ${escapeHtml(clip(handoff, 180))}</span>` : ""}
        ${deskPipelineSteps(goal)}
        ${deskGoalDocuments(goal)}
      </div>
      <div class="desk-goal-controls">
        <span class="desk-state ${action.kind}">${escapeHtml(action.state)}</span>
        ${pipeline ? deskPipelineControls(goal, pipeline) : ""}
        ${action.action === "Start agent"
          ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>Start agent</button>${launchToggle("▾")}</span>`
          : action.action
            ? (record ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>${launchToggle("▾")}</span>` : `<button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>`)
            : record ? launchToggle("Steps ▾") : ""}
        ${liveSession ? `<button class="desk-icon-action" type="button" data-stop-goal="${escapeHtml(goal.file)}" aria-label="End the agent run for ${escapeHtml(goal.title)}">End agent</button>` : ""}
        ${complete ? `<button class="desk-icon-action" type="button" data-wont-do-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} won't do">Won't do</button><button class="desk-icon-action complete" type="button" data-complete-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} complete">Done</button>` : ""}
      </div>
    </article>`;
}

/** The checked Goal files that belong to one Area panel, in checked order. */
function selectedGoalFiles(trees) {
  const panelFiles = new Set(trees.flatMap((tree) => tree.goals.map((goal) => goal.file)));
  return state.goalSelection.filter((file) => panelFiles.has(file));
}

/**
 * The one action for a checked set of Goals: start a single agent that owns
 * them all and works them in checked order. Renders only while something in
 * this Area panel is checked; checking itself never starts anything.
 */
function deskSelectionBar(areaPath, trees) {
  const selected = selectedGoalFiles(trees);
  if (!selected.length) return "";
  const count = selected.length;
  const primary = selected[0];
  return `
    <span class="desk-selection-bar">
      <span class="desk-split">
        <button class="desk-action" type="button" data-start-selected="${escapeHtml(areaPath)}">Start agent on ${count} ${count === 1 ? "Goal" : "Goals"}</button>
        <button class="desk-action desk-launch-toggle${state.launchTarget === primary ? " open" : ""}" type="button" data-launch-for="${escapeHtml(primary)}" title="Choose agent or model" aria-label="Choose agent or model for the ${count} selected ${count === 1 ? "Goal" : "Goals"}" aria-expanded="${state.launchTarget === primary}">▾</button>
      </span>
      <button class="desk-icon-action" type="button" data-clear-selection>Clear <kbd>Esc</kbd></button>
    </span>`;
}

/** Renders a root Goal and visually distinct Subgoals as one group. */
function deskGoalGroup(tree) {
  const subgoals = tree.goals.slice(1).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  const expanded = subgoals.some((goal) => sessionForGoal(goal) || goalNeedsYou(goal));
  return `
    <section class="desk-goal-group">
      ${deskGoalRow(tree.root)}
      ${subgoals.length ? `<details class="desk-subgoal-disclosure" ${expanded ? "open" : ""}><summary><span>To do that</span><small>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</small></summary><div class="desk-subgoals">${subgoals.map((goal) => deskGoalRow(goal, { subgoal: true })).join("")}</div></details>` : ""}
    </section>`;
}

/** Renders one work-definition Run inside its durable Area. */
function deskDefinitionRow(session) {
  const name = agentName(session);
  const stateName = describeWorkStateLabel(session);
  const kind = session.state === "working" ? "working" : "waiting";
  return `
    <button class="desk-definition ${kind}" type="button" data-select-work-definition="${escapeHtml(session.name)}">
      <span><small>Defining work</small><strong>${escapeHtml(session.workTitle || "Define new work")}</strong></span>
      <span><em class="desk-state ${kind}">${escapeHtml(stateName)}</em><b>Open ${escapeHtml(name)} →</b></span>
    </button>`;
}

/** Renders Documents as a reading shelf, not another set of Goal cards. */
function deskDocumentShelf(documents) {
  if (!documents.length) return `<p class="desk-empty">No Documents in this Area.</p>`;
  return `<div class="desk-documents">${documents.map((document) => `
    <button type="button" data-open-document="${escapeHtml(document.file)}">
      <span aria-hidden="true">DOC</span><strong>${escapeHtml(document.title)}</strong><b aria-hidden="true">↗</b>
    </button>`).join("")}</div>`;
}

/** Renders one stable Area landmark with work and knowledge together. */
function deskAreaPanel(record, position) {
  const { area, trees, descriptions, documents } = record;
  const status = deskAreaState(area.path, trees, descriptions);
  const parent = areaParts(area.path).slice(0, -1).join(" / ") || "Top level";
  const openGoalCount = trees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
  const goalSectionTitle = state.workFilter === "all" ? "Goal work" : `${humanName(state.workFilter)} work`;
  return `
    <article class="area-desk-panel ${status.kind}" style="--desk-order:${position}">
      <header class="area-desk-header">
        <span class="area-desk-index" aria-hidden="true">${String(position + 1).padStart(2, "0")}</span>
        <div><small>${escapeHtml(parent)}</small><h2>${escapeHtml(humanName(area.name))}</h2></div>
        <span class="area-desk-state ${status.kind}">${escapeHtml(status.label)}</span>
      </header>
      <div class="area-desk-body">
        ${descriptions.length ? `<section class="area-desk-section definitions"><div class="area-desk-section-heading"><h3>Dispatches</h3><span>${descriptions.length}</span></div>${descriptions.map(deskDefinitionRow).join("")}</section>` : ""}
        <section class="area-desk-section goals">
          <div class="area-desk-section-heading"><h3>${goalSectionTitle}</h3><span>${openGoalCount}</span>${deskSelectionBar(area.path, trees)}</div>
          ${trees.length ? trees.map(deskGoalGroup).join("") : `<p class="desk-empty">No active Goals.</p>`}
        </section>
        <section class="area-desk-section documents">
          <div class="area-desk-section-heading"><h3>Documents</h3><span>${documents.length}</span></div>
          ${deskDocumentShelf(documents)}
        </section>
      </div>
      <footer class="area-desk-actions">
        <button type="button" data-describe-area="${escapeHtml(area.path)}">Describe work here</button>
        <button type="button" data-open-area="${escapeHtml(area.path)}">Organize Area</button>
      </footer>
    </article>`;
}

/** Renders the complete area-first work desk. */
function renderWork() {
  const query = state.query.trim();
  let content;
  if (query) {
    content = searchResults(query);
  } else {
    const records = deskAreas();
    content = `${state.workFilter === "all" ? deskAttentionQueue() : ""}${records.length
      ? `<section class="area-desk-grid" aria-label="Work by Area">${records.map(deskAreaPanel).join("")}</section>`
      : `<div class="empty-state">No ${state.workFilter === "all" ? "active Areas contain Goals or Documents" : `${state.workFilter} work`}.</div>`}`;
  }

  return `
    <section class="work-page">
      <header class="work-intro">
        <div>
          <p class="kicker">Dispatch desk</p>
          <h1 class="page-title">Work by Area</h1>
          <p class="page-lede">Areas stay put. Agents and Goals change inside them.</p>
        </div>
        <div class="work-intro-actions">
          <button class="primary-button work-intro-button" type="button" data-describe-work>Describe work</button>
        </div>
      </header>
      <div class="work-tools">
        <label class="search-field">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="work-search" type="search" value="${escapeHtml(state.query)}" placeholder="Find a Goal, Document, or Area" autocomplete="off" />
          <kbd>⌘/</kbd>
        </label>
        <div class="work-filter" role="group" aria-label="Filter work by live session">
          ${["all", "active", "inactive"].map((filter) => `<button type="button" data-work-filter="${filter}" aria-pressed="${state.workFilter === filter}">${humanName(filter)}</button>`).join("")}
        </div>
      </div>
      ${content}
      ${launchPopover()}
    </section>
  `;
}

/**
 * The agent chooser, anchored at the Start-agent split control that opened
 * it. The choice lives at the point of starting: no page change, and the
 * fast path (plain Start agent) never passes through here.
 */
function launchPopover() {
  if (!state.launchTarget) return "";
  const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
  const goal = describing ? null : goalByFile(state.launchTarget);
  if (!describing && !goal) return "";
  const area = describing ? describeLaunchArea() : goal.area;
  launchOptionsFor(area);
  const anchor = state.launchAnchor ?? { top: 120, right: window.innerWidth - 16 };
  const width = Math.min(640, window.innerWidth - 32);
  const left = Math.max(16, anchor.right - width);
  return `
    <div class="launch-popover" data-launch-popover role="dialog" aria-label="Choose agent and model" style="top:${anchor.top}px;left:${left}px;width:${width}px;max-height:calc(100vh - ${anchor.top + 16}px)">
      <header class="launch-popover-header"><small>${escapeHtml(areaLabel(area))}</small><strong>${describing ? "Describe work" : escapeHtml(goal.title)}</strong></header>
      ${launchPickerBlock()}
    </div>
  `;
}

/** Returns every area in stable path order. */
function areas() {
  return [...(state.vault?.areas ?? [])].filter((area) => area.path).sort((left, right) => left.path.localeCompare(right.path));
}

/** Returns the selected area when it still exists. */
function selectedArea() {
  return areas().find((area) => area.path === state.areaSelection) ?? areas()[0] ?? null;
}

/** Returns the parent path of one area, or an empty root marker. */
function areaParent(path) {
  return String(path ?? "").split("/").slice(0, -1).join("/");
}

/** Builds the collapsible Area tree. */
function areaTreeRows() {
  const areaItems = areas();
  const byPath = new Map(areaItems.map((area) => [area.path, area]));
  const relevant = new Set(areaItems.map((area) => area.path));
  const children = new Map();
  for (const path of relevant) {
    const parent = relevant.has(areaParent(path)) ? areaParent(path) : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(path);
  }
  for (const list of children.values()) list.sort((left, right) => left.localeCompare(right));

  /** Renders one area and its expanded children. */
  const branch = (path, depth) => {
    const area = byPath.get(path);
    const childPaths = children.get(path) || [];
    const expandable = childPaths.length > 0;
    const expanded = expandable && state.expandedAreas.has(path);
    const selected = selectedArea()?.path === path;
    const row = `
      <div class="area-tree-row ${selected ? "selected" : ""}" style="--area-depth:${depth}">
        ${expandable
          ? `<button class="area-toggle" type="button" data-toggle-area="${escapeHtml(path)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(humanName(area.name))}"><span aria-hidden="true">${expanded ? "▾" : "▸"}</span></button>`
          : `<span class="area-toggle-spacer" aria-hidden="true"></span>`}
        <button class="area-row" type="button" data-select-area="${escapeHtml(path)}"><span>${escapeHtml(humanName(area.name))}</span><small>${escapeHtml(path)}</small>${areaProgramMark(path, expanded)}</button>
      </div>`;
    if (!expanded) return row;
    return row + childPaths.map((child) => branch(child, depth + 1)).join("");
  };
  return (children.get("") || []).map((root) => branch(root, 0)).join("");
}

/**
 * Marks the Area rows that carry running Programs or a broken Program file.
 * The tree is the only place a Program in another Area can announce itself
 * now that the Programs tab is gone, so a collapsed row counts its whole
 * subtree.
 */
function areaProgramMark(path, expanded) {
  /** True while one Program or problem belongs to the counted scope. */
  const inScope = (value) => value === path || (!expanded && value.startsWith(`${path}/`));
  const live = state.programs.programs.filter((program) => inScope(program.area) && programIsLive(program)).length;
  const broken = state.programs.errors.some((item) => inScope(item.area));
  if (live) return `<span class="area-row-mark live">${live} running</span>`;
  if (broken) return `<span class="area-row-mark warn">Program problem</span>`;
  return "";
}

/** Renders one Area Goal with its current brief. */
function areaGoalRow(goal) {
  return `
    <button type="button" data-select-goal="${escapeHtml(goal.file)}">
      <span class="area-goal-main"><strong>${escapeHtml(goal.title)}</strong><small>${escapeHtml(clip(goal.doneWhen, 150))}</small></span>
      <span class="area-goal-brief"><em>Current brief</em><small>${escapeHtml(currentBriefFields(goal).wanted)}</small></span>
    </button>`;
}

/** Renders the Goals, Documents, and Programs stored directly in one Area. */
function areaContents(area) {
  const goals = (area.goals ?? []).filter((goal) => goal.area === area.path);
  const programs = state.programs.programs.filter((program) => program.area === area.path);
  const problems = state.programs.errors.filter((item) => item.area === area.path);
  const authoredOrder = new Map(goals.flatMap((goal) => goal.documents ?? []).map((document, index) => [document.file, index]));
  const documents = [...(area.documents ?? [])].sort((left, right) =>
    (authoredOrder.get(left.file) ?? Number.MAX_SAFE_INTEGER) - (authoredOrder.get(right.file) ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title));
  return `
    <section class="area-contents">
      <header class="area-contents-heading">
        <div><p class="kicker">Selected Area</p><h2>${escapeHtml(humanName(area.name))}</h2><small>${escapeHtml(area.path)}</small></div>
        <div class="area-contents-actions">
          <button class="quiet-button" type="button" data-new-area>Add nested Area</button>
          ${area.path.split("/").length > 1 ? `<button class="quiet-button" type="button" data-rename-area>Rename or move</button>` : ""}
        </div>
      </header>
      <section class="area-content-section">
        <div class="memory-heading"><div><p class="kicker">Documents</p><h3>${documents.length} ${documents.length === 1 ? "Document" : "Documents"}</h3></div></div>
        ${documents.length
          ? `<div class="document-list">${documents.map((document) => `<button class="document-row" type="button" data-open-document="${escapeHtml(document.file)}"><span><strong>${escapeHtml(document.title)}</strong><small>Document</small></span><span aria-hidden="true">→</span></button>`).join("")}</div>`
          : `<p class="memory-empty">No Documents exist in this Area.</p>`}
      </section>
      <section class="area-content-section">
        <div class="memory-heading"><div><p class="kicker">Goals</p><h3>${goals.length} ${goals.length === 1 ? "Goal" : "Goals"}</h3></div></div>
        ${goals.length
          ? `<div class="goal-relation-list area-goal-list">${goals.map(areaGoalRow).join("")}</div>`
          : `<p class="memory-empty">No Goals exist in this Area.</p>`}
      </section>
      <section class="area-content-section">
        <div class="memory-heading">
          <div><p class="kicker">Programs</p><h3>${programs.length} ${programs.length === 1 ? "Program" : "Programs"}</h3></div>
          <button class="quiet-button" type="button" data-new-program>New program</button>
        </div>
        ${programs.length
          ? `<div class="program-list">${programs.map(programRow).join("")}</div>`
          : `<p class="memory-empty">No Programs exist in this Area. Servers, commands, and daily agents belong here.</p>`}
        ${problems.length ? `<details class="program-errors"><summary>${problems.length} configuration ${problems.length === 1 ? "problem" : "problems"}</summary>${problems.map((item) => `<p>${escapeHtml(item.file)} — ${escapeHtml(item.error)}</p>`).join("")}</details>` : ""}
      </section>
    </section>`;
}

/** Renders the Area hierarchy and the contents of the selected Area. */
function renderAreas() {
  const selected = selectedArea();
  const rows = areaTreeRows();
  return `
    <section class="areas-page">
      <header class="surface-heading">
        <div><p class="kicker">Areas</p><h1>Where work belongs</h1><p>Choose an Area. Change it only when you need to.</p></div>
      </header>
      <div class="area-layout">
        <div class="area-browser">${rows || `<div class="empty-state">No areas exist.</div>`}</div>
        ${selected ? areaContents(selected) : ""}
      </div>
    </section>`;
}

/** Renders valid destination parents for one area edit. */
function areaParentOptions(selected, source = "") {
  return areas()
    .filter((area) => !source || (area.path !== source && !area.path.startsWith(`${source}/`)))
    .map((area) => `<option value="${escapeHtml(area.path)}" ${area.path === selected ? "selected" : ""}>${escapeHtml(areaLabel(area.path))}</option>`)
    .join("");
}

/** Renders area creation, rename, or move with an exact preview. */
function renderAreaEditor() {
  const edit = state.areaEdit;
  if (!edit) return renderAreas();
  const moving = edit.kind === "move";
  const preview = edit.preview;
  return `
    <article class="create-page area-edit-page">
      <p class="kicker">${moving ? "Rename or move" : "New area"}</p>
      <h1>${moving ? escapeHtml(areaLabel(edit.area)) : "Add one area"}</h1>
      <p class="create-lede">${moving ? "Review every affected path before anything moves." : "Put the area under the area that gives it meaning."}</p>
      <form class="create-form" data-area-form data-command-enter-submit>
        <label><span>Inside Area</span><select name="parent" required>${areaParentOptions(edit.parent, moving ? edit.area : "")}</select></label>
        <label><span>Name</span><input name="name" value="${escapeHtml(edit.name)}" required autocomplete="off" /></label>
        ${preview ? `
          <section class="path-preview">
            <p class="kicker">Path preview</p>
            <ul>${preview.changedPaths.map((item) => `<li><span>${escapeHtml(item.from)}</span><strong>→</strong><span>${escapeHtml(item.to)}</span></li>`).join("")}</ul>
          </section>` : ""}
        <div class="create-actions">
          ${preview ? `<button class="primary-button" type="button" data-confirm-area-move>Move area</button>` : `<button class="primary-button" type="submit">${moving ? "Preview change" : "Create area"} <kbd>⌘↵</kbd></button>`}
          <button class="quiet-button" type="button" data-cancel-area-edit>Cancel</button>
        </div>
        <p class="form-note">${moving ? "Live sessions follow the new path. Pending vault edits must be saved first." : "This creates an empty area. It does not start work."}</p>
      </form>
    </article>`;
}

/** Returns one program by its stable UI identity. */
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
  if (program.paused) return "Paused";
  if (!program.session) return program.type === "routine" ? "Scheduled" : "Not running";
  if (["stopped", "shell"].includes(program.session.state)) return "Stopped · log kept";
  return program.type === "routine" ? "Agent running" : "Running";
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
  return program.type === "process" ? "Server or watcher" : program.type === "command" ? "Command" : "Daily agent";
}

/**
 * The one runtime control a program row offers. Stopping a runaway program
 * must not be a hidden feature, so the row carries it beside the state.
 */
function programRowControl(program) {
  if (programIsLive(program)) return { action: "stop", label: "Stop" };
  if (program.type === "routine") return { action: "run", label: "Run now" };
  if (!program.available) return null;
  return program.type === "process" ? { action: "start", label: "Start" } : { action: "run", label: "Run" };
}

/** Renders one compact program row with its state and one control. */
function programRow(program) {
  const control = programRowControl(program);
  return `
    <div class="program-row">
      <button class="program-open" type="button" data-select-program="${escapeHtml(program.id)}">
        <small>${escapeHtml(programKind(program))}</small><strong>${escapeHtml(program.label)}</strong><em>${escapeHtml(program.type === "routine" ? program.schedule : program.command)}</em>
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
  } else {
    actions = [
      live ? `<button class="secondary-button" type="button" data-open-program-session>Open agent</button><button class="danger-button" type="button" data-program-action="stop">Stop agent…</button>` : "",
      `<button class="primary-button" type="button" data-program-action="run">Run now…</button>`,
      `<button class="quiet-button" type="button" data-program-action="${program.paused ? "resume" : "pause"}">${program.paused ? "Resume schedule" : "Pause schedule"}</button>`,
    ].join("");
  }
  return `
    <article class="program-detail">
      ${areaPath(program.area)}
      <p class="kicker">${escapeHtml(programKind(program))}</p>
      <h1>${escapeHtml(program.label)}</h1>
      <p class="program-detail-state"><span class="status-mark"></span>${escapeHtml(programState(program))}</p>
      <dl class="program-facts">
        ${program.type === "routine" ? `<div><dt>Schedule</dt><dd>${escapeHtml(program.schedule)} · ${escapeHtml(state.programs.timezone || "local time")}</dd></div><div><dt>Dispatcher</dt><dd>${state.programs.scheduler.installed ? `Active · checks every ${state.programs.scheduler.intervalMinutes} minutes` : "Not installed"}</dd></div><div><dt>Next run</dt><dd>${program.paused ? "Paused" : escapeHtml(localMoment(program.nextRunAt))}</dd></div><div><dt>Last run</dt><dd>${escapeHtml(localMoment(program.lastRunAt))}</dd></div><div><dt>Agent</dt><dd>${escapeHtml(program.model)}</dd></div>` : `<div><dt>Command</dt><dd><code>${escapeHtml(program.command)}</code></dd></div>`}
        <div><dt>Folder</dt><dd><code>${escapeHtml(program.cwd || "No area folder is recorded")}</code></dd></div>
        ${program.session ? `<div><dt>Session</dt><dd><code>${escapeHtml(program.sessionName)}</code></dd></div>` : ""}
      </dl>
      ${program.type === "routine" ? `<section class="routine-prompt"><p class="kicker">What the agent does</p><p>${escapeHtml(program.prompt)}</p></section>` : ""}
      <div class="program-actions">${actions}</div>
    </article>`;
}

/** Selects a useful default folder for a new program. */
function programAreaDirectory(area) {
  return state.programs.areas.find((item) => item.path === area)?.cwd || "";
}

/** Renders creation for a process, command, or daily agent. */
function renderProgramCreate() {
  const draft = state.programDraft;
  return `
    <article class="create-page program-create-page">
      <p class="kicker">New program</p><h1>What should run?</h1>
      <p class="create-lede">Keep the setup with its area. Nothing runs until you use a clear action.</p>
      <form class="create-form" data-program-form data-command-enter-submit>
        <label><span>Kind</span><select name="type" data-program-draft="type"><option value="process" ${draft.type === "process" ? "selected" : ""}>Server or watcher</option><option value="command" ${draft.type === "command" ? "selected" : ""}>One-off command</option><option value="routine" ${draft.type === "routine" ? "selected" : ""}>Daily agent</option></select></label>
        <label><span>Area</span><select name="area" data-program-draft="area" required>${areaOptions(draft.area)}</select></label>
        <label><span>Name</span><input name="name" data-program-draft="name" value="${escapeHtml(draft.name)}" required placeholder="Development server" /></label>
        ${draft.type === "routine" ? `
          <label><span>Daily time</span><input name="time" data-program-draft="time" type="time" value="${escapeHtml(draft.time)}" required /></label>
          <label><span>Working folder</span><input name="cwd" data-program-draft="cwd" value="${escapeHtml(draft.cwd)}" required placeholder="/path/to/repository" /></label>
          <label><span>Model</span><input name="model" data-program-draft="model" value="${escapeHtml(draft.model)}" required /></label>
          <label><span>Instructions</span><textarea name="prompt" data-program-draft="prompt" required placeholder="Describe the complete job and what proof the agent must leave.">${escapeHtml(draft.prompt)}</textarea></label>` : `
          <label><span>Working folder</span><input name="cwd" data-program-draft="cwd" value="${escapeHtml(draft.cwd)}" required placeholder="/path/to/repository" /></label>
          <label><span>Command</span><input name="command" data-program-draft="command" value="${escapeHtml(draft.command)}" required placeholder="npm run dev" /></label>`}
        <div class="create-actions"><button class="primary-button" type="submit">Save program <kbd>⌘↵</kbd></button><button class="quiet-button" type="button" data-cancel-program-create>Cancel</button></div>
        <p class="form-note">${draft.type === "routine" ? "The local scheduler checks twice an hour. It never starts a second copy while one is running." : "Commands always ask before they run. Process sessions keep their scrollback after Stop."}</p>
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
  return `
    <article class="create-page">
      <p class="kicker">New goal</p>
      <h1>What result do you want?</h1>
      <p class="create-lede">Choose where this work belongs. Then state what will be true when the work is complete.</p>

      <form class="create-form" data-create-form data-command-enter-submit>
        <label>
          <span>Area</span>
          <select id="new-goal-area" name="area" required>
            ${areaOptions(state.createArea || preferredArea())}
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
  launchOptionsFor(draft?.area || preferredArea());
  const selection = launchSelection();
  const startLabel = selection?.label ? `Start ${selection.label}` : "Start agent";
  const chooserOpen = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
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
            <button class="primary-button describe-launch-toggle${chooserOpen ? " open" : ""}" type="button" data-launch-for="${DESCRIBE_LAUNCH_TARGET}" title="Choose agent or model" aria-label="Choose the agent for this conversation" aria-expanded="${chooserOpen}">▾</button>
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
  if (state.launch.area !== area) {
    state.launch = { area, options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null };
  }
  if (!state.launch.options && !state.launch.loading) {
    state.launch.loading = true;
    api(`/api/launch/options?area=${encodeURIComponent(area)}`)
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
  const preset = options.default && !options.default.error ? options.default : null;
  const choice = state.launch.choice ?? (preset?.harness ? { harness: preset.harness, model: preset.model, effort: preset.effort ?? null } : null);
  const harness = choice ? (options.harnesses ?? []).find((entry) => entry.id === choice.harness) : null;
  if (!harness) {
    return preset ? { harness: null, model: null, effort: null, command: preset.command, label: preset.label || "", edited: false } : null;
  }
  const model = (harness.models ?? []).find((entry) => entry.id === choice.model) ?? null;
  const effort = (harness.efforts ?? []).find((entry) => entry.id === choice.effort) ?? null;
  const edited = Boolean(state.launch.command.trim());
  const command = edited ? state.launch.command.trim() : [harness.command, model?.args, effort?.args].filter(Boolean).join(" ");
  const label = edited ? "Edited command" : [harness.label, model?.label, effort?.label].filter(Boolean).join(" · ");
  return { harness, model, effort, command, label, edited };
}

/** Explicit per-run launch fields for a start request, or nothing. */
function launchRequestFields() {
  const selection = launchSelection();
  if (!selection) return {};
  if (selection.edited) return { command: selection.command };
  if (state.launch.choice && selection.harness) {
    return { choice: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) } };
  }
  return {};
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
  if (row.command?.trim()) return "Edited command";
  const harness = row.choice ? (options?.harnesses ?? []).find((entry) => entry.id === row.choice.harness) : null;
  if (!harness) return options?.default && !options.default.error ? (options.default.label || options.default.command || "Area default") : "Area default";
  const model = (harness.models ?? []).find((entry) => entry.id === row.choice.model);
  const effort = (harness.efforts ?? []).find((entry) => entry.id === row.choice.effort);
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
  if (state.launchTarget === DESCRIBE_LAUNCH_TARGET) return "";
  const record = state.launch.record;
  const steps = commitActiveStep();
  const fixed = record ? record.steps.length : 0;
  const glyph = { complete: "✓", running: "●", pending: "○", skipped: "–", stopped: "■" };
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
  const selection = launchSelection();
  const preset = options.default && !options.default.error ? options.default : {};
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
  const efforts = currentHarness?.efforts ?? [];
  const effortButtons = efforts.map((effort) => `
      <button type="button" class="launch-option${selection?.effort?.id === effort.id ? " selected" : ""}" data-launch-effort="${escapeHtml(effort.id)}">
        <span>${escapeHtml(effort.label)}</span>${preset.harness === currentHarness?.id && preset.effort === effort.id ? `<span class="launch-default-tag">default</span>` : ""}
      </button>`).join("");
  const command = selection?.command ?? "";
  const commandZone = state.launch.editing
    ? `<div class="launch-command"><input id="launch-command-input" type="text" spellcheck="false" value="${escapeHtml(state.launch.command || command)}"><button class="quiet-button" type="button" data-launch-reset>Reset</button></div>
       <p class="form-note">The edited command applies to this run only.</p>`
    : `<div class="launch-command"><code>${escapeHtml(command)}</code>${selection?.edited ? `<span class="launch-default-tag">edited</span>` : ""}<button class="quiet-button" type="button" data-launch-edit>Edit command</button></div>`;
  const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
  const record = state.launch.record;
  const stepCount = describing ? 1 : commitActiveStep().length;
  const drafts = record ? launchDraftRows().length : 0;
  const startLabel = record
    ? (state.launch.active < record.steps.length ? `Save step ${state.launch.active + 1}` : drafts > 1 ? `Add ${drafts} steps` : `Add step ${record.steps.length + 1}`)
    : stepCount > 1 ? `Start ${stepCount} steps` : `Start ${selection ? (selection.label || "agent") : "agent"}`;
  const canSave = Boolean(state.launch.choice && selection?.harness && !selection?.edited);
  const stepZone = describing ? "" : `
      <label class="launch-instruction"><span>Step ${state.launch.active + 1} does</span><textarea id="launch-instruction" rows="2" placeholder="${stepCount > 1 || record ? "What this agent does" : "What this agent does (optional for one step)"}">${escapeHtml(state.launch.instruction ?? "")}</textarea></label>
      ${state.launch.active > 0 ? `<label class="launch-continue"><span>Session</span><select data-launch-continue><option value="">Fresh session</option>${Array.from({ length: state.launch.active }, (_, k) => `<option value="${k + 1}"${state.launch.continueFrom === k + 1 ? " selected" : ""}>Continue step ${k + 1}</option>`).join("")}</select></label>` : ""}`;
  return `
    <div class="launch-picker">
      ${launchStepList()}
      ${(options.harnesses ?? []).length ? `
      <div class="launch-columns">
        <div class="launch-col"><p class="launch-col-title">Harness</p>${harnessButtons}</div>
        <div class="launch-col"><p class="launch-col-title">Model</p>${modelButtons}</div>
        ${efforts.length ? `<div class="launch-col"><p class="launch-col-title">Effort</p>${effortButtons}</div>` : ""}
      </div>` : `<p class="launch-none">No harness registry. Add one at <code>~/.tangent/trees/harnesses.md</code>.</p>`}
      ${commandZone}
      ${stepZone}
      <div class="action-row start-actions">
        <button class="primary-button" type="button" data-launch-start>${escapeHtml(startLabel)}</button>
        ${canSave ? `<button class="quiet-button" type="button" data-launch-save>Save as Area default</button>` : ""}
        <button class="quiet-button" type="button" data-launch-close>${state.launchTarget ? "Close" : "Back"}</button>
      </div>
      <button class="quiet-button launch-registry-link" type="button" data-open-harnesses>Edit harnesses and models…</button>
    </div>
  `;
}

/** Saves the current picker selection as the Area's durable default. */
async function saveLaunchDefault() {
  const area = state.launchTarget === DESCRIBE_LAUNCH_TARGET
    ? describeLaunchArea()
    : (state.launchTarget ? goalByFile(state.launchTarget)?.area : currentGoal()?.area);
  const selection = launchSelection();
  if (!area || !selection?.harness || selection.edited) return;
  try {
    const saved = await post("/api/launch/default", {
      area,
      launch: { harness: selection.harness.id, ...(selection.model ? { model: selection.model.id } : {}), ...(selection.effort ? { effort: selection.effort.id } : {}) },
    });
    state.launch.options = null;
    launchOptionsFor(area);
    showToast(`${saved.label} is now the default for ${areaLabel(area)}.`);
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
    state.launch = { area: "", options: null, loading: false, choice: null, command: "", editing: false, open: false, instruction: "", continueFrom: null, steps: [], active: 0, record: null };
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
function renderAgent(goal, session) {
  return `
    <section class="agent-page">
      <div class="terminal-wrap">
        <div id="agent-terminal" class="terminal-host" data-session="${escapeHtml(session.name)}"></div>
      </div>
    </section>
  `;
}

/** Renders the native conversation that defines new work. */
function renderDescribeWorkAgent(session) {
  return `
    <section class="agent-page">
      <div class="terminal-wrap">
        <div id="describe-work-terminal" class="terminal-host" data-session="${escapeHtml(session.name)}"></div>
      </div>
    </section>
  `;
}

/** Renders explicit run and goal decisions after an agent returns. */
function renderDecision(goal, session) {
  const name = agentName(session);
  const reference = agentReference(name);
  return `
    <article class="decision-page">
      <p class="kicker">${escapeHtml(areaLabel(goal.area))}</p>
      <h1>What happens next?</h1>
      <p>Choose one result for this run.</p>
      <div class="decision-options">
        <button class="decision-option" type="button" data-keep-working><strong>Keep working with ${escapeHtml(reference)}</strong><span>Return to the agent and type your next message.</span></button>
        <button class="decision-option" type="button" data-finish-run><strong>End this agent run</strong><span>The session ends. The work and its progress note stay open.</span></button>
        <button class="decision-option" type="button" data-mark-complete><strong>The complete work is done</strong><span>The work closes only after you approve a confirmation.</span></button>
        <button class="decision-option" type="button" data-mark-wont-do><strong>This work won't be done</strong><span>Give a brief reason so that you can recall the decision later.</span></button>
      </div>
    </article>
  `;
}

/** Returns the newest open linked Goal that owns the complete Document review. */
function documentGoal() {
  const history = state.document?.goalHistory ?? [];
  /** Tests whether a linked Goal remains active. */
  const open = (goal) => goal && !["done", "dropped", "deferred"].includes(goal.status);
  const current = currentGoal();
  if (open(current) && history.some((item) => item.file === current.file)) return current;
  return [...history].reverse().map((item) => goalByFile(item.file)).find(open) ?? null;
}

/** Returns the nearby Documents for the compact reader picker. */
function readerDocuments(goal) {
  const areaDocuments = (state.vault?.documents ?? []).filter((document) => document.kind === "document" && document.area === state.document?.area);
  const documents = [...(goal?.documents?.length ? goal.documents : areaDocuments)];
  if (state.document && !documents.some((document) => document.file === state.document.file)) {
    documents.push({ file: state.document.file, title: state.document.title, kind: "document" });
  }
  return documents;
}

/** Returns the headings that give a useful overview of the current Document. */
function documentOutlineItems() {
  return markdownHeadings(state.document?.text).filter((heading) => [2, 3].includes(heading.level));
}

/** Renders one set of heading links for the wide outline or compact menu. */
function documentOutlineLinks() {
  return documentOutlineItems().map((heading) => `<a href="#${escapeHtml(heading.id)}" style="--heading-depth:${Math.max(0, heading.level - 2)}" data-document-heading="${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join("");
}

/** Renders the quiet wide-screen page outline. */
function documentOutline() {
  const links = documentOutlineLinks();
  if (!links) return "";
  return `
    <aside class="document-outline" aria-label="On this page">
      <p>On this page</p>
      <nav>${links}</nav>
    </aside>`;
}

/** Renders the small outline menu used when the wide outline does not fit. */
function documentOutlineMenu() {
  const links = documentOutlineLinks();
  if (!links) return "";
  return `
    <details class="document-outline-menu">
      <summary>On this page</summary>
      <nav aria-label="On this page">${links}</nav>
    </details>`;
}

/** Renders one compact picker for the Documents near the current Goal or Area. */
function documentPicker(goal) {
  const documents = readerDocuments(goal);
  return `
    <details class="document-picker">
      <summary aria-label="Choose a Document">
        <span>${escapeHtml(state.document?.title || "Document")}</span>
        <i aria-hidden="true">⌄</i>
      </summary>
      <div class="document-picker-popover">
        <p>${goal ? `Linked to ${escapeHtml(goal.title)}` : `${escapeHtml(areaLabel(state.document?.area))} Documents`}</p>
        <nav aria-label="Documents">${documents.map((document) => `
          <button class="${document.file === state.document?.file ? "selected" : ""}" type="button" data-open-document="${escapeHtml(document.file)}">
            <span>${escapeHtml(document.title)}</span>
            ${document.file === state.document?.file ? `<small>Current</small>` : ""}
          </button>`).join("")}</nav>
      </div>
    </details>`;
}

/** Renders minimal reader controls without a permanent navigation rail. */
function documentToolbar(goal) {
  const canGoBack = state.documentTrailIndex > 0;
  const canGoForward = state.documentTrailIndex >= 0 && state.documentTrailIndex < state.documentTrail.length - 1;
  return `
    <header class="document-reader-toolbar">
      <div class="document-reader-route">
        <div class="document-history-controls" aria-label="Reading history">
          <button type="button" data-document-history="back" aria-label="Previous Document" title="Previous Document" ${canGoBack ? "" : "disabled"}>←</button>
          <button type="button" data-document-history="forward" aria-label="Next Document" title="Next Document" ${canGoForward ? "" : "disabled"}>→</button>
        </div>
        ${areaPath(state.document?.area)}
        <span class="document-route-separator" aria-hidden="true">/</span>
        ${documentPicker(goal)}
      </div>
      <div class="document-reader-actions">
        ${documentOutlineMenu()}
        ${goal ? `<button class="reader-agent-action" type="button" data-open-reader-agent>Open agent</button>` : ""}
      </div>
    </header>`;
}

/** Renders one linked Markdown Document in the reading column. */
function renderDocumentArticle() {
  if (!state.document) return `<div class="loading">Opening the Document…</div>`;
  return `
    <article class="document-page">
      <header class="document-heading">
        <h1>${escapeHtml(state.document.title)}</h1>
      </header>
      <div class="document-content">${markdownToHtml(state.document.text)}</div>
      <p class="document-source">Source: ${escapeHtml(state.document.file)}</p>
    </article>`;
}

/** Renders one calm Document reader with optional navigation at the edge. */
function renderDocument() {
  if (!state.document) return `<div class="loading">Opening the Document…</div>`;
  const goal = documentGoal();
  return `
    <section class="document-reader">
      ${documentToolbar(goal)}
      <div class="document-reader-scroll">
        <div class="document-reader-grid">
          ${renderDocumentArticle()}
          ${documentOutline()}
        </div>
      </div>
    </section>`;
}

/** Releases the terminal, socket, and resize observer. */
function disposeTerminal() {
  terminalSelection?.dispose();
  terminalSelection = null;
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

/**
 * Renders the terminal on a WebGL canvas instead of xterm's DOM renderer.
 * The DOM renderer left stale glyphs on screen when Safari partially
 * repainted a scrolled terminal; a canvas repaints whole frames, so an
 * earlier frame cannot survive. On WebGL context loss the addon is
 * disposed and xterm falls back to the DOM renderer instead of going blank.
 */
function loadTerminalWebgl(term) {
  if (!window.WebglAddon) return;
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {}
}

/** Mounts one stable xterm instance for the selected tmux session. */
function mountTerminal(host, sessionName) {
  if (terminal && terminalSession === sessionName && terminal.element && host.contains(terminal.element)) return;
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
    macOptionClickForcesSelection: true,
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
  loadTerminalWebgl(terminal);
  terminalSelection = window.AgentShellTerminalSelection?.preserveTerminalSelection({
    terminal,
    host,
    clipboard: navigator.clipboard,
  });
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
    terminalSelection?.noteInput();
    if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(data);
  });
  terminal.focus();
}

/** Captures vault fields that can change a visible list or search result. */
function vaultRenderProjection() {
  if (!state.vault) return null;
  /** Selects the Goal fields that affect visible rendering. */
  const goalFields = (goal) => [goal.file, goal.title, goal.status, goal.doneWhen, goal.mtime, goal.depth, goal.waitingOn, goal.storyText, goal.searchText];
  return [
    (state.vault.map ?? []).map((group) => [group.path, (group.goals ?? []).map(goalFields)]),
    (state.vault.areas ?? []).map((area) => [area.path, area.purpose, area.body, (area.goals ?? []).map(goalFields), (area.documents ?? []).map((document) => [document.file, document.title, document.mtime])]),
    (state.vault.documents ?? []).map((document) => [document.file, document.title, document.mtime, document.hash, document.searchText, document.goalHistory]),
  ];
}

/** Computes the minimal state key that requires a fresh render. */
function renderKey() {
  const goal = currentGoal();
  const session = sessionForGoal(goal);
  if (state.view === "document") {
    return JSON.stringify([state.view, state.document?.file, state.document?.hash, state.documentTrailIndex, state.documentTrail.length]);
  }
  if (state.view === "agent") {
    return JSON.stringify([state.view, goal?.file, session?.name, state.agentReturnView, state.document?.hash]);
  }
  if (state.view === "describe-agent") {
    const describeSession = describeWorkSession();
    return JSON.stringify([state.view, describeSession?.name, state.describeReturnView, state.document?.hash]);
  }
  if (state.view === "program-session") {
    const program = currentProgram();
    return JSON.stringify([state.view, program?.id, program?.sessionName]);
  }
  return JSON.stringify([
    state.view,
    state.query,
    state.caffeinate,
    state.document ? [state.document.file, state.document.hash, state.documentTrailIndex, state.documentTrail.length] : null,
    state.describeDraft,
    state.describeSessionName,
    state.areaSelection,
    state.goalSelection,
    [...state.expandedAreas].sort(),
    state.areaEdit,
    state.programId,
    state.programDraft,
    state.programs.programs.map((item) => [item.id, item.paused, item.lastRunAt, item.nextRunAt, item.session?.state]),
    vaultRenderProjection(),
    goal ? [goal.file, goal.status, goal.mtime, goal.stateText, goal.currentBrief, goal.storyText, goal.why, goal.subgoalItems, goal.documents] : null,
    [state.launch.area, state.launch.open, state.launch.editing, state.launch.command, state.launch.choice, state.launch.loading, Boolean(state.launch.options), state.launch.options?.default?.label ?? null, state.launch.options?.default?.command ?? null, state.launch.instruction, state.launch.continueFrom, state.launch.active, state.launch.steps, state.launch.record?.updatedAt ?? null],
    (state.pipelines ?? []).map((item) => [item.goal, item.status, item.updatedAt, item.steps.map((step) => [step.status, step.live, step.state, step.idleSince])]),
    [state.launchTarget, state.launchAnchor, Boolean(state.harnessDraft)],
    state.sessions.map((item) => [item.name, item.goal, item.kind, item.area, item.state, item.phase, item.command, item.created, item.workTitle, item.launchLabel]),
  ]);
}

/** Updates shell chrome for the current view and live session. */
function updateHeader() {
  const goal = currentGoal();
  const goalSession = sessionForGoal(goal);
  const describeSession = describeWorkSession();
  const session = state.view === "describe-agent" ? describeSession : goalSession;
  const isWork = state.view === "work";
  const isCreate = state.view === "create";
  const isDescribe = state.view === "describe";
  const isDescribeAgent = state.view === "describe-agent";
  const isAreas = state.view === "areas";
  const isAreaEdit = state.view === "area-edit";
  const isProgramDetail = state.view === "program-detail";
  const isProgramCreate = state.view === "program-create";
  const isProgramSession = state.view === "program-session";
  const program = currentProgram();
  const isTopLevel = isWork || isAreas;
  backButton.classList.toggle("has-back", !isTopLevel);
  backButton.textContent = isTopLevel
    ? "Agent Shell"
    : isCreate
      ? state.createReturnView === "areas" ? "Areas" : "Work"
    : isDescribe || isDescribeAgent
      ? state.describeReturnView === "document" && state.document ? "Document" : "Work"
    : isAreaEdit
      ? "Areas"
    : isProgramDetail || isProgramCreate
      ? "Areas"
    : isProgramSession
      ? "Program"
    : state.view === "agent"
        ? state.agentReturnView === "document" && state.document ? "Document" : "Work"
        : state.view === "document"
          ? state.documentReturnView === "areas" ? "Areas" : "Work"
          : "Agent";
  barContext.textContent = isCreate
    ? "Define new work"
    : isDescribe
      ? "Describe work"
      : isDescribeAgent && describeSession
        ? `${areaLabel(describeSession.area)} · Defining work · ${describeWorkStateLabel(describeSession)}`
        : isAreas
          ? "Organize Areas"
        : isAreaEdit
          ? "Review the path before it changes"
        : (isProgramDetail || isProgramSession) && program
          ? `${areaLabel(program.area)} · ${program.label} · ${programState(program)}`
        : isProgramCreate
          ? "Add a program to one area"
          : state.view === "document" && state.document
            ? ""
            : goal
              ? `${areaLabel(goal.area)} · ${goal.title}${goalSession ? ` · ${stateLabel(goal, goalSession)}` : ""}`
              : "";

  const topLevel = isWork
    ? "work"
    : isAreas || isAreaEdit || isProgramDetail || isProgramCreate || isProgramSession || (isCreate && state.createReturnView === "areas")
      ? "areas"
      : "";
  const attentionCount = deskAttentionItems().length;
  workTab.textContent = attentionCount ? `Work · ${attentionCount}` : "Work";
  workTab.classList.toggle("active", topLevel === "work");
  workTab.classList.toggle("has-attention", attentionCount > 0);
  areasTab.classList.toggle("active", topLevel === "areas");
  for (const [button, active] of [[workTab, topLevel === "work"], [areasTab, topLevel === "areas"]]) {
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  secondaryAction.hidden = !session || ["work", "create", "describe", "areas", "area-edit", "program-detail", "program-create", "program-session", "document"].includes(state.view);
  secondaryAction.textContent = session?.state === "shell" ? "Close session…" : "Stop agent…";

  if (state.view === "agent" && session?.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else if (["work", "create", "describe", "describe-agent", "areas", "area-edit", "program-detail", "program-create", "program-session", "agent", "decision"].includes(state.view)) {
    findButton.hidden = true;
    findButton.textContent = "Find work";
    findButton.dataset.action = "find";
  } else {
    findButton.hidden = false;
    findButton.innerHTML = `Find work <kbd>⌘/</kbd>`;
    findButton.dataset.action = "find";
  }
  updateLiveProgramCount();
}

/**
 * Announces running Programs on the Areas tab. Programs sit inside the Area
 * card now, so this count is the only view-independent sign that something
 * still runs.
 */
function updateLiveProgramCount() {
  const live = state.programs.liveCount;
  areasTab.textContent = live ? `Areas · ${live}` : "Areas";
  areasTab.title = live ? `${live} ${live === 1 ? "Program is" : "Programs are"} running` : "";
  areasTab.classList.toggle("has-live", live > 0);
}

/** Refreshes live agent state without replacing the terminal. */
function updateLiveHeader() {
  if (state.view === "describe-agent") {
    const session = describeWorkSession();
    if (!session) return;
    barContext.textContent = `${areaLabel(session.area)} · Defining work · ${describeWorkStateLabel(session)}`;
    findButton.hidden = true;
    updateLiveProgramCount();
    return;
  }
  if (state.view !== "agent") return;
  const goal = currentGoal();
  const session = sessionForGoal(goal);
  if (!session) return;
  barContext.textContent = state.agentReturnView === "document" && state.document
    ? `${state.document.title} · ${goal.title} · ${stateLabel(goal, session)}`
    : `${areaLabel(goal.area)} · ${goal.title} · ${stateLabel(goal, session)}`;
  if (state.view === "agent" && session.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else {
    findButton.hidden = true;
  }
  updateLiveProgramCount();
}

/** Selects and renders the current full-screen view. */
function renderScreen() {
  const goal = currentGoal();
  const goalFreeViews = ["work", "create", "describe", "describe-agent", "areas", "area-edit", "program-detail", "program-create", "program-session", "document", "harnesses"];
  if (!goal && !goalFreeViews.includes(state.view)) state.view = "work";
  const session = sessionForGoal(goal);
  const describeSession = describeWorkSession();
  if (["program-detail", "program-session"].includes(state.view) && !currentProgram()) state.view = "areas";
  if (state.view === "program-session" && !currentProgram()?.session) state.view = "program-detail";
  if (state.view === "agent" && !session) state.view = state.agentReturnView === "document" && state.document ? "document" : "work";
  if (state.view === "describe-agent" && !describeSession) {
    state.describeSessionName = "";
    saveDescribeSession();
    state.view = "work";
  }
  if (!["agent", "describe-agent", "program-session"].includes(state.view)) disposeTerminal();

  screen.classList.remove("split-screen");
  screen.classList.toggle("terminal-screen", ["agent", "describe-agent", "program-session"].includes(state.view));
  screen.classList.toggle("review-screen", state.view === "document");

  const scrollPositions = rememberScreenScroll();
  if (state.view === "work") screen.innerHTML = renderWork();
  else if (state.view === "create") screen.innerHTML = renderCreate();
  else if (state.view === "describe") screen.innerHTML = renderDescribeCapture();
  else if (state.view === "describe-agent") screen.innerHTML = renderDescribeWorkAgent(describeSession);
  else if (state.view === "areas") screen.innerHTML = renderAreas();
  else if (state.view === "area-edit") screen.innerHTML = renderAreaEditor();
  else if (state.view === "program-detail") screen.innerHTML = renderProgramDetail(currentProgram());
  else if (state.view === "program-create") screen.innerHTML = renderProgramCreate();
  else if (state.view === "program-session") screen.innerHTML = renderProgramSession(currentProgram());
  else if (state.view === "harnesses") screen.innerHTML = renderHarnessEditor();
  else if (state.view === "agent") screen.innerHTML = renderAgent(goal, session);
  else if (state.view === "decision" && session) screen.innerHTML = renderDecision(goal, session);
  else if (state.view === "document") screen.innerHTML = renderDocument();
  else {
    state.view = "work";
    screen.innerHTML = renderWork();
  }

  updateHeader();
  if (state.view === "document") bindDocumentReader();
  restoreScreenScroll(scrollPositions);
  const host = screen.querySelector("[data-session]");
  if (host) mountTerminal(host, host.dataset.session);
}

/** The elements that scroll inside the screen, by a selector stable across repaints. */
const SCREEN_SCROLL_SELECTORS = [".document-reader-scroll", "[data-launch-popover]"];

/**
 * Captures every scroll position on the screen before its markup is replaced.
 * A repaint rebuilds the DOM from strings, which puts each container back at
 * the top; the reading position must survive that.
 */
function rememberScreenScroll() {
  const positions = { view: state.view, screen: screen.scrollTop, inner: new Map() };
  for (const selector of SCREEN_SCROLL_SELECTORS) {
    const element = screen.querySelector(selector);
    if (element) positions.inner.set(selector, element.scrollTop);
  }
  return positions;
}

/** Puts the captured scroll positions back after a repaint of the same view. */
function restoreScreenScroll(positions) {
  if (positions.view !== state.view) return;
  if (positions.screen) screen.scrollTop = positions.screen;
  for (const [selector, top] of positions.inner) {
    const element = screen.querySelector(selector);
    if (element && top) element.scrollTop = top;
  }
}

/** Renders changed state while preserving active form inputs. */
function paint(force = false) {
  // Goal selection is a work-view gesture: leaving the desk clears it.
  if (state.view !== "work" && state.goalSelection.length) state.goalSelection = [];
  if (state.loading) {
    screen.innerHTML = `<div class="loading">Loading Agent Shell…</div>`;
    return;
  }
  if (state.error) {
    screen.innerHTML = `<div class="error-card">${escapeHtml(state.error)}</div>`;
    return;
  }
  const key = renderKey();
  if (!force && editingSurfaceOnScreen()) {
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

/**
 * True while Julian is on a surface he edits by hand: a form, the launch
 * popover, or a focused text field. Background polls never rebuild the screen
 * while one is present, focused or not; a rebuild would reset scroll, drop
 * focus, and recreate every input. Only his own actions repaint these
 * surfaces (paint(true)), and the deferred rebuild happens when he leaves.
 */
function editingSurfaceOnScreen() {
  const active = document.activeElement;
  if (active && (["work-search", "launch-command-input"].includes(active.id) || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return true;
  return Boolean(screen.querySelector("[data-create-form], [data-describe-work-form], [data-area-form], [data-program-form], [data-harness-form], [data-launch-popover]"));
}

/** Refreshes the vault, program, and session projections from the server. */
async function refresh({ initial = false } = {}) {
  try {
    const [vault, sessionPayload, programs] = await Promise.all([api("/api/vault"), api("/api/sessions"), api("/api/programs")]);
    state.vault = vault;
    state.sessions = sessionPayload.sessions || [];
    state.pipelines = sessionPayload.pipelines || [];
    state.programs = {
      programs: programs.programs || [],
      errors: programs.errors || [],
      areas: programs.areas || [],
      liveCount: Number(programs.liveCount || 0),
      timezone: programs.timezone || "",
      scheduler: programs.scheduler || { installed: false, intervalMinutes: 30 },
    };
    state.caffeinate = Boolean(sessionPayload.caffeinate);
    if (sessionPayload.sourceChanged) state.updateAvailable = true;
    state.loading = false;
    state.error = "";
    state.offline = false;
    noteServerBoot(sessionPayload.boot || "");
    if (state.view === "program-session" && !currentProgram()?.session) {
      disposeTerminal();
      state.view = currentProgram() ? "program-detail" : "areas";
      state.renderedKey = "";
    }
    if (initial && state.currentFile && !goalByFile(state.currentFile)) {
      state.currentFile = "";
      state.view = "work";
      localStorage.removeItem("agent-shell.current-goal");
    }
    if (state.view === "areas") {
      if (!areas().some((area) => area.path === state.areaSelection)) state.areaSelection = preferredArea();
      revealArea(state.areaSelection);
    }
    void syncDockBadge();
    updateStatusPill();
    paint(initial);
  } catch (error) {
    state.loading = false;
    // A poll that fails after the app has data means the server is away,
    // usually because an agent is rebuilding it. Keep the screen exactly as
    // it is and show one quiet pill; the next successful poll clears it.
    if (state.vault) {
      state.offline = true;
      updateStatusPill();
      return;
    }
    state.error = error.message;
    paint(true);
  }
}

/**
 * Tracks the server process identity across polls. A changed boot id means
 * new code is live; the app never reloads itself unless the user asked for
 * the rebuild from the Agent Shell menu.
 */
function noteServerBoot(boot) {
  if (!boot) return;
  if (!state.bootId) {
    state.bootId = boot;
    return;
  }
  if (boot === state.bootId) return;
  if (state.rebuilding) return location.reload();
  state.updateAvailable = true;
  updateStatusPill();
}

/** Keeps the quiet connection pill and the menu's update hint current. */
function updateStatusPill() {
  const text = state.rebuilding
    ? "Rebuilding Agent Shell…"
    : state.offline
      ? "Server offline · reconnecting"
      : "";
  statusPill.textContent = text;
  statusPill.hidden = !text;
  backButton.classList.toggle("has-update", state.updateAvailable);
  const updateItem = shellMenu.querySelector("#menu-update");
  if (updateItem) updateItem.hidden = !state.updateAvailable;
}

/** Opens or closes the Agent Shell menu under the top-left title. */
function toggleShellMenu(open = shellMenu.hidden) {
  if (!open) {
    shellMenu.hidden = true;
    return;
  }
  const awakeItem = shellMenu.querySelector("#menu-awake");
  if (awakeItem) awakeItem.textContent = state.caffeinate ? "Let Mac sleep normally" : "Keep Mac awake";
  updateStatusPill();
  const rect = backButton.getBoundingClientRect();
  shellMenu.style.top = `${Math.round(rect.bottom + 6)}px`;
  shellMenu.style.left = `${Math.round(rect.left)}px`;
  shellMenu.hidden = false;
}

/** Rebuilds the workspace and restarts the server after explicit confirmation. */
function confirmRebuild() {
  toggleShellMenu(false);
  openModal({
    kicker: "Agent Shell",
    title: "Rebuild and restart Agent Shell?",
    copy: "The server rebuilds the workspace and restarts itself. Agent sessions keep running in tmux. This page reloads automatically when the new server is up.",
    confirmLabel: "Rebuild and restart",
    /** Starts the rebuild and waits for the new server boot id. */
    onConfirm: async () => {
      await post("/api/shell/rebuild", {});
      state.rebuilding = true;
      updateStatusPill();
      showToast("Rebuilding. The app reloads when the new server is ready.");
    },
  });
}

/**
 * Shows a Goal where it lives: its row on the Work desk. There is no
 * separate Goal page; the row carries the brief, Documents, handoff, and
 * actions. Selection never spawns anything.
 */
function selectGoal(file) {
  const goal = rememberGoal(file);
  state.view = "work";
  state.query = "";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  if (goal && state.workFilter !== "all" && !filteredGoalTrees(goalTrees().filter((tree) => tree.goals.some((item) => item.file === file))).length) {
    state.workFilter = "all";
    localStorage.setItem("agent-shell.work-filter", state.workFilter);
  }
  paint(true);
  window.setTimeout(() => {
    const row = document.querySelector(`[data-goal-anchor='${String(file).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}']`);
    if (!row) return;
    try { row.scrollIntoView({ block: "center" }); } catch {}
    row.classList.add("flash");
    window.setTimeout(() => row.classList.remove("flash"), 1600);
  }, 0);
}

/** Stores one Goal as the active Run context without changing the view. */
function rememberGoal(file) {
  state.currentFile = file;
  localStorage.setItem("agent-shell.current-goal", file);
  const goal = goalByFile(file);
  if (goal?.area) localStorage.setItem("agent-shell.last-area", goal.area);
  return goal;
}

/** Opens an existing Run, or starts a ready Goal, directly from Work. */
async function openGoalRun(file) {
  const goal = rememberGoal(file);
  if (!goal) return;
  state.agentSessionName = null;
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  const session = sessionForGoal(goal);
  if (!session) return openGoalAgent({ returnView: "work" });
  state.agentReturnView = "work";
  state.view = "agent";
  state.renderedKey = "";
  paint(true);
}

/** Returns to the work list and optionally focuses search. */
function showWork({ focus = false } = {}) {
  state.view = "work";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  paint(true);
  if (focus) window.setTimeout(() => document.querySelector("#work-search")?.focus(), 0);
}

/** Opens the temporary area hierarchy. */
function showAreas() {
  if (!areas().some((area) => area.path === state.areaSelection)) state.areaSelection = preferredArea();
  revealArea(state.areaSelection);
  state.areaEdit = null;
  state.view = "areas";
  paint(true);
}

/** Opens area creation under the selected area. */
function beginAreaCreate() {
  const parent = selectedArea()?.path || preferredArea();
  if (!parent) return showToast("Create a root area group outside Agent Shell first.");
  state.areaEdit = { kind: "new", parent, name: "", preview: null };
  state.view = "area-edit";
  paint(true);
  window.setTimeout(() => document.querySelector("[data-area-form] input[name='name']")?.focus(), 0);
}

/** Opens the safe rename and move preview for one area. */
function beginAreaMove() {
  const selected = selectedArea();
  if (!selected || selected.path.split("/").length < 2) return;
  const parts = selected.path.split("/");
  state.areaEdit = { kind: "move", area: selected.path, parent: parts.slice(0, -1).join("/"), name: humanName(parts.at(-1)), preview: null };
  state.view = "area-edit";
  paint(true);
}

/** Returns to the Areas surface with one Area selected. */
function showAreasAt(path) {
  if (path && areas().some((area) => area.path === path)) state.areaSelection = path;
  showAreas();
}

/** Opens one program without changing its runtime. */
function selectProgram(id) {
  state.programId = id;
  state.view = "program-detail";
  paint(true);
}

/** Opens the new-program form with the selected area as its default. */
function showProgramCreate() {
  const area = selectedArea()?.path || preferredArea();
  state.programDraft = { type: "process", area, name: "", command: "", time: "07:30", cwd: programAreaDirectory(area), model: "sonnet", prompt: "" };
  state.view = "program-create";
  paint(true);
  window.setTimeout(() => document.querySelector("[data-program-form] input[name='name']")?.focus(), 0);
}

/** Opens a program's existing tmux session. */
function openProgramSession() {
  const program = currentProgram();
  if (!program?.session) return showToast("This program has no live or saved session.");
  state.view = "program-session";
  state.renderedKey = "";
  paint(true);
}

/** Executes one already-confirmed program control. */
async function performProgramAction(action, id) {
  const program = programById(id);
  if (!program) return;
  await post("/api/programs/control", { id: program.id, action });
  if (["stop", "close"].includes(action) && state.view === "program-session") state.view = "program-detail";
  await refresh();
  paint(true);
  const messages = { start: "The process started.", restart: "The process restarted.", stop: "The program stopped.", close: "The saved session was removed.", run: program.type === "routine" ? "The agent started." : "The command started.", pause: "The schedule is paused.", resume: "The schedule is active." };
  showToast(messages[action] || "The program changed.");
}

/** Adds confirmation where a program action starts or destroys work. */
function controlProgram(action, id = state.programId) {
  const program = programById(id);
  if (!program) return;
  if (["start", "pause", "resume"].includes(action)) {
    performProgramAction(action, id).catch((error) => showToast(error.message));
    return;
  }
  const descriptions = {
    run: program.type === "routine"
      ? `Start ${program.label} now in ${program.cwd}. The normal schedule does not change.`
      : `Run “${program.command}” in ${program.cwd}.`,
    restart: `Stop the current process, then run “${program.command}” again.`,
    stop: "Stop the live program. A managed process keeps its session and scrollback.",
    close: "Remove the retained tmux session and its scrollback. The program definition stays here.",
  };
  openModal({
    kicker: program.type === "routine" ? "Scheduled agent" : program.type === "command" ? "Command" : "Managed process",
    title: action === "run" ? `Run ${program.label}?` : action === "restart" ? `Restart ${program.label}?` : action === "close" ? "Remove the saved log?" : `Stop ${program.label}?`,
    copy: descriptions[action],
    confirmLabel: action === "run" ? "Run now" : action === "restart" ? "Restart" : action === "close" ? "Remove log" : "Stop",
    danger: ["stop", "close"].includes(action),
    /** Applies the confirmed Program action. */
    onConfirm: () => performProgramAction(action, id),
  });
}

/** Rewrites one stored path when its area subtree moves. */
function movedPath(value, source, destination) {
  return value === source || value.startsWith(`${source}/`) ? `${destination}${value.slice(source.length)}` : value;
}

/** Applies the area move that is already visible in the path preview. */
async function confirmAreaMove() {
  const edit = state.areaEdit;
  if (!edit?.preview) return;
  try {
    const moved = await post("/api/areas/move", { area: edit.area, parent: edit.parent, name: edit.name });
    state.currentFile = movedPath(state.currentFile, moved.source, moved.destination);
    state.areaSelection = moved.destination;
    localStorage.setItem("agent-shell.last-area", movedPath(localStorage.getItem("agent-shell.last-area") || "", moved.source, moved.destination));
    if (state.currentFile) localStorage.setItem("agent-shell.current-goal", state.currentFile);
    state.areaEdit = null;
    await refresh();
    state.view = "areas";
    paint(true);
    showToast("The Area moved. Its nested paths and live sessions followed it.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Opens the fast new-goal form. */
function showCreate(area = "", returnView = state.view) {
  state.createReturnView = ["areas", "describe"].includes(returnView) ? returnView : "work";
  state.createArea = area || (state.createReturnView === "areas" ? selectedArea()?.path : "") || preferredArea();
  state.view = "create";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  paint(true);
  window.setTimeout(() => document.querySelector("#new-goal-title")?.focus(), 0);
}

/**
 * Moves from the describe form to manual Goal creation without losing the
 * typed description: the switch re-renders the page, so the textarea value
 * must land in the stored draft first. Cancel from manual create returns to
 * the describe form with the text intact.
 */
function switchDescribeToManualCreate() {
  syncDescribeDraft();
  showCreate(describeLaunchArea(), "describe");
}

/** Returns from manual Goal creation to the surface that opened it. */
function cancelCreate() {
  state.createArea = "";
  if (state.createReturnView === "areas") return showAreas();
  if (state.createReturnView === "describe") return showDescribe();
  return showWork();
}

/** Adds one Document to a work description without duplicating its source link. */
function addDescribeSource(source) {
  const sources = state.describeDraft?.sources ?? [];
  if (!sources.some((item) => item.file === source.file)) sources.push(source);
  state.describeDraft.sources = sources;
}

/** Opens a fresh or unfinished description without taking over another defining agent. */
function showDescribe({ source = null, area = "" } = {}) {
  state.describeReturnView = source && state.document ? "document" : "work";
  if (source) {
    state.describeDraft = { area: source.area, description: "", sources: [] };
    addDescribeSource(source);
  } else if (area) {
    state.describeDraft = { area, description: "", sources: [] };
  } else if (!state.describeDraft) {
    state.describeDraft = { area: preferredArea(), description: "", sources: [] };
  }
  saveDescribeDraft();
  state.view = "describe";
  if (!source) state.document = null;
  paint(true);
  window.setTimeout(() => document.querySelector("#describe-work")?.focus(), 0);
}

/** Opens one selected work-definition agent from its row in the work list. */
function openDescribeSession(name) {
  const session = describeWorkSessions().find((item) => item.name === name);
  if (!session) return;
  state.describeSessionName = session.name;
  state.describeReturnView = "work";
  state.document = null;
  saveDescribeSession();
  state.view = "describe-agent";
  state.renderedKey = "";
  paint(true);
}

/** Returns from work definition to its source Document, when present. */
function cancelDescribe() {
  if (state.describeReturnView === "document" && state.document) {
    state.view = "document";
    return paint(true);
  }
  showWork();
}

/** Saves the reading position before the reader changes or closes. */
function rememberDocumentPosition() {
  const scroll = screen.querySelector(".document-reader-scroll");
  if (state.document && scroll) state.documentPositions.set(state.document.file, scroll.scrollTop);
}

/** Restores a heading target or the last saved reading position. */
function restoreDocumentPosition(heading = "") {
  window.setTimeout(() => {
    const scroll = screen.querySelector(".document-reader-scroll");
    if (!scroll || !state.document) return;
    if (heading) {
      const wanted = markdownHeadingAnchor(decodeLink(heading.split("#").at(-1)), new Map());
      const match = markdownHeadings(state.document.text).find((item) => item.id === wanted || item.title.toLowerCase() === decodeLink(heading).toLowerCase());
      document.getElementById(match?.id || wanted)?.scrollIntoView?.({ block: "start" });
      return;
    }
    scroll.scrollTop = state.documentPositions.get(state.document.file) || 0;
  }, 0);
}

/** Records one successful Document change in the local reading trail. */
function updateDocumentTrail(file, mode, index) {
  if (mode === "jump") {
    state.documentTrailIndex = index;
    return;
  }
  if (state.documentTrail[state.documentTrailIndex] === file) return;
  state.documentTrail = state.documentTrail.slice(0, state.documentTrailIndex + 1);
  state.documentTrail.push(file);
  state.documentTrailIndex = state.documentTrail.length - 1;
}

/** Opens one Document and records its place in the reading trail. */
async function openDocument(file, { trail = "push", trailIndex = -1, heading = "" } = {}) {
  const enteringReader = state.view !== "document" || !state.document;
  rememberDocumentPosition();
  if (enteringReader) {
    if (state.view !== "document") {
      state.documentReturnView = state.view === "areas" ? "areas" : "work";
      state.documentTrail = [];
      state.documentTrailIndex = -1;
    }
    state.view = "document";
    state.document = null;
    paint(true);
  }
  try {
    state.document = await api(`/api/document?file=${encodeURIComponent(file)}`);
    updateDocumentTrail(file, trail, trailIndex);
    paint(true);
    restoreDocumentPosition(heading);
  } catch (error) {
    showToast(error.message);
    if (enteringReader) showWork();
  }
}

/** Moves backward or forward through Documents opened in this reader. */
function navigateDocumentHistory(direction) {
  const nextIndex = state.documentTrailIndex + (direction === "back" ? -1 : 1);
  const file = state.documentTrail[nextIndex];
  if (!file) return;
  return openDocument(file, { trail: "jump", trailIndex: nextIndex });
}

/** Opens one linked Goal, Document, Area note, or heading. */
async function openVaultLink(target) {
  const parts = String(target ?? "").split("#");
  const path = parts.shift() || "";
  const heading = parts.at(-1) || "";
  if (!path && heading) return openDocumentHeading(markdownHeadingAnchor(decodeLink(heading), new Map()));
  const record = vaultLinkRecord(target);
  if (!record) return showToast(`Agent Shell cannot find “${target}”.`);
  if (record.kind === "goal") return selectGoal(record.file);
  if (record.kind === "note") {
    state.areaSelection = record.area;
    localStorage.setItem("agent-shell.last-area", record.area);
    state.view = "areas";
    revealArea(record.area);
    return paint(true);
  }
  return openDocument(record.file, { heading });
}

/** Moves the current reading pane to one visible Document heading. */
function openDocumentHeading(id) {
  const heading = document.getElementById(id);
  heading?.scrollIntoView?.({ block: "start" });
  document.querySelectorAll(".document-outline-menu[open]").forEach((menu) => { menu.open = false; });
}

/** Updates the active heading as the user moves through the Document. */
function bindDocumentReader() {
  const scroll = screen.querySelector(".document-reader-scroll");
  if (!scroll) return;
  const headings = documentOutlineItems().map((item) => ({ ...item, element: document.getElementById(item.id) })).filter((item) => item.element);
  const links = [...screen.querySelectorAll("[data-document-heading]")];
  /** Synchronizes the reader outline with the scroll position. */
  const update = () => {
    let active = headings[0]?.id || "";
    for (const heading of headings) {
      if (heading.element.offsetTop <= scroll.scrollTop + 150) active = heading.id;
    }
    for (const link of links) {
      const current = link.dataset.documentHeading === active;
      link.classList.toggle("active", current);
      if (current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if (state.document) state.documentPositions.set(state.document.file, scroll.scrollTop);
  };
  scroll.addEventListener("scroll", update, { passive: true });
  update();
}

/** Reloads the visible Document after an agent changes its source file. */
async function refreshDocument({ announce = false } = {}) {
  if (!state.document) return;
  rememberDocumentPosition();
  try {
    state.document = await api(`/api/document?file=${encodeURIComponent(state.document.file)}`);
    state.renderedKey = "";
    paint(true);
    restoreDocumentPosition();
    if (announce) showToast("The Document is current.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Saves the visible natural description as an idea and creates no goal. */
async function saveVisibleIdea() {
  const area = document.querySelector("#describe-area")?.value || state.describeDraft?.area || "";
  const description = document.querySelector("#describe-work")?.value.trim() || state.describeDraft?.description || "";
  if (!area || !description) {
    showToast("Choose an Area and describe the idea first.");
    return;
  }
  try {
    await post("/api/idea/new", { area, description });
    state.describeDraft = null;
    saveDescribeDraft();
    showWork();
    showToast("The description is saved as an idea. No goal was created.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Opens the explicit next-step decision page. */
function showDecision(returnView = state.view) {
  state.decisionReturnView = "agent";
  state.view = "decision";
  state.renderedKey = "";
  paint(true);
}

/** Opens a native agent with the complete Goal context. */
/** The checked Goal files that belong to one Area, in checked order. */
function selectionForArea(areaPath) {
  return state.goalSelection.filter((file) => goalByFile(file)?.area === areaPath);
}

/**
 * Starts one agent that owns every Goal checked in one Area panel. The first
 * checked Goal is the primary: it names the session and leads the prompt; the
 * rest ride along as "Also in this session" and flip to active on the same
 * session binding.
 */
/**
 * Starts the popover's step list as one pipeline on the target Goal (and the
 * other checked Goals of its Area, which ride along in every step). One step
 * without an instruction never comes here; that is a plain start.
 */
async function startPipeline(targetFile) {
  const goal = goalByFile(targetFile);
  if (!goal) return;
  const steps = commitActiveStep().map(launchStepRequest);
  const selection = selectionForArea(goal.area);
  const extraFiles = selection[0] === targetFile ? selection.slice(1) : [];
  try {
    const result = await post("/api/goals/start", { file: targetFile, steps, extraFiles });
    state.launch.open = false;
    state.launchTarget = "";
    state.launchAnchor = null;
    state.launch.steps = [];
    state.launch.active = 0;
    state.launch.instruction = "";
    state.launch.continueFrom = null;
    state.goalSelection = [];
    await refresh();
    rememberGoal(targetFile);
    state.agentReturnView = "work";
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
    showToast(steps.length > 1 ? `Started ${steps.length} steps; step 1 is ${result.pipeline?.steps?.[0]?.label || "running"}.` : "The agent started.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Saves the active pending step of a running pipeline. */
async function savePipelineStep(targetFile) {
  const record = state.launch.record;
  if (!record) return;
  const row = launchStepDraft();
  const step = record.steps[state.launch.active];
  if (!step || step.status !== "pending") return showToast("Only pending steps change.");
  const request = launchStepRequest(row);
  try {
    await post("/api/pipelines/edit", { goal: targetFile, step: step.index, instruction: request.instruction, ...(request.command ? { command: request.command } : request.launch ? { choice: request.launch } : {}), continueFrom: request.continueFrom });
    await refresh();
    state.launch.record = pipelineForGoal(goalByFile(targetFile));
    paint(true);
    showToast(`Step ${step.index} saved.`);
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * Appends the popover's draft rows to the Goal's pipeline. The server says
 * what happened: the steps wait behind the running step, the finished last
 * agent was asked to hand over again, or the first new step started.
 */
async function appendPipelineSteps(targetFile) {
  const record = state.launch.record;
  if (!record) return;
  const drafts = launchDraftRows();
  if (!drafts.length) return showToast("Add a step first.");
  const steps = drafts.map(launchStepRequest);
  try {
    const result = await post("/api/pipelines/append", { goal: targetFile, steps });
    state.launch.open = false;
    state.launchTarget = "";
    state.launchAnchor = null;
    state.launch.record = null;
    state.launch.steps = [];
    state.launch.active = 0;
    state.launch.instruction = "";
    state.launch.continueFrom = null;
    await refresh();
    paint(true);
    const added = result.added ?? [];
    const which = added.length > 1 ? `Steps ${added[0]} to ${added[added.length - 1]} added` : `Step ${added[0]} added`;
    if (result.status === "asked") showToast(`${which}; step ${result.after}'s agent was asked to hand over again.`);
    else if (result.status === "started") showToast(`${which}; step ${result.next?.index ?? added[0]} started.`);
    else showToast(`${which}; it starts when step ${result.after} hands over.`);
  } catch (error) {
    showToast(error.message);
  }
}

/** Starts one agent that owns every checked Goal in one Area. */
async function startSelectedGoals(areaPath) {
  const files = selectionForArea(areaPath);
  const [primary, ...extraFiles] = files;
  if (!primary) return;
  try {
    rememberGoal(primary);
    await post("/api/goals/agent", { file: primary, launch: true, extraFiles, ...launchRequestFields() });
    state.goalSelection = state.goalSelection.filter((file) => !files.includes(file));
    await refresh();
    state.agentReturnView = "work";
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
    showToast(files.length === 1 ? "The agent opened with this Goal." : `The agent opened with ${files.length} Goals.`);
  } catch (error) {
    showToast(error.message);
  }
}

/** Opens the agent for the selected Goal and remembers the return view. */
async function openGoalAgent({ returnView = "work" } = {}) {
  const goal = currentGoal();
  if (!goal) return;
  try {
    await post("/api/goals/agent", { file: goal.file, launch: true, ...launchRequestFields() });
    await refresh();
    state.agentReturnView = returnView;
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
    showToast("The agent opened with this Goal and its linked Documents.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Replaces the reader with the linked Goal agent. */
async function openReaderAgent() {
  const goal = documentGoal();
  if (!goal || !state.document) return showToast("Link this Document to an open Goal before you open an agent.");
  rememberDocumentPosition();
  state.currentFile = goal.file;
  localStorage.setItem("agent-shell.current-goal", goal.file);
  localStorage.setItem("agent-shell.last-area", goal.area);
  try {
    if (!sessionForGoal(goal)) {
      await post("/api/goals/agent", { file: goal.file, document: state.document.file, launch: true });
      await refresh();
    }
    if (!sessionForGoal(currentGoal())) throw new Error("The agent session did not open.");
    state.agentReturnView = "document";
    state.view = "agent";
    state.renderedKey = "";
    paint(true);
    showToast("The agent opened with this Goal and all linked Documents.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Launches the agent inside an already-created shell session. */
async function launchOpenSession() {
  const goal = currentGoal();
  const session = sessionForGoal(goal);
  if (!goal || !session) return;
  try {
    const endpoint = session.phase === "collaborate" ? "/api/goals/agent" : "/api/goals/start";
    const body = session.phase === "collaborate"
      ? { file: goal.file, launch: true, ...launchRequestFields() }
      : { file: goal.file, approved: true, launch: true, ...launchRequestFields() };
    await post(endpoint, body);
    await refresh();
    state.agentReturnView = "work";
    state.view = session.phase === "collaborate" ? "agent" : "work";
    state.renderedKey = "";
    paint(true);
    showToast("The agent started.");
  } catch (error) {
    showToast(error.message);
  }
}

/** Opens one confirmation modal with an explicit effect. */
function openModal({ kicker = "", title, copy, field = null, confirmLabel, danger = false, onConfirm }) {
  modalKicker.textContent = kicker;
  modalTitle.textContent = title;
  modalCopy.textContent = copy;
  modalField.hidden = !field;
  modalField.innerHTML = field
    ? `<label><span>${escapeHtml(field.label)}</span><textarea data-modal-input required placeholder="${escapeHtml(field.placeholder)}"></textarea></label>`
    : "";
  modalActions.innerHTML = `
    <button class="quiet-button" type="button" data-modal-cancel>Cancel</button>
    <button class="${danger ? "danger-button" : "primary-button"}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
  `;
  modalConfirm = onConfirm;
  modalLayer.hidden = false;
  window.setTimeout(() => (modalField.querySelector("[data-modal-input]") || modalActions.querySelector("[data-modal-confirm]"))?.focus(), 0);
}

/** Closes the confirmation modal without acting. */
function closeModal() {
  modalLayer.hidden = true;
  modalField.hidden = true;
  modalField.innerHTML = "";
  modalConfirm = null;
}

/** Confirms and then stops the selected live session. */
function confirmStop() {
  const describing = state.view === "describe-agent";
  const goal = currentGoal();
  const session = describing ? describeWorkSession() : sessionForGoal(goal);
  if (!session || (!describing && !goal)) return;
  const shell = session.state === "shell";
  const returnToDocument = describing
    ? state.describeReturnView === "document" && Boolean(state.document)
    : state.view === "agent" && state.agentReturnView === "document" && Boolean(state.document);
  openModal({
    kicker: shell ? "Open session" : "Live agent",
    title: shell ? "Close this session?" : `Stop ${agentName(session)}?`,
    copy: describing
      ? "This ends the conversation about new work. Any Goals or Documents already created stay in Tangent."
      : "This ends the live session. The work and its notes stay here.",
    confirmLabel: shell ? "Close session" : "Stop agent",
    danger: true,
    /** Stops only the live run and preserves the goal. */
    onConfirm: async () => {
      await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
      if (describing) {
        state.describeSessionName = "";
        saveDescribeSession();
      }
      state.view = returnToDocument ? "document" : "work";
      await refresh();
      paint(true);
      if (returnToDocument) await refreshDocument();
      showToast(describing
        ? "The conversation ended. Saved work stays in Tangent."
        : shell ? "The session closed." : "The agent stopped. The work stays open.");
    },
  });
}

/** Confirms semantic completion separately from ending a run. */
function confirmComplete() {
  const goal = currentGoal();
  if (!goal) return;
  openModal({
    kicker: "Complete work",
    title: `Mark “${goal.title}” complete?`,
    copy: "This closes the work and ends its live session. Use this only when the complete result is met.",
    confirmLabel: "Mark complete",
    /** Marks the complete goal done after explicit approval. */
    onConfirm: async () => {
      await post("/api/goals/edit", { file: goal.file, status: "done" });
      state.view = "work";
      await refresh();
      paint(true);
      showToast("The work is complete.");
    },
  });
}

/** Requires a recallable reason before the selected goal closes as dropped. */
function confirmWontDo() {
  const goal = currentGoal();
  if (!goal) return;
  openModal({
    kicker: "Won't do",
    title: `Mark “${goal.title}” won't do?`,
    copy: "This closes the work and ends its live session. The goal file stays available for later recall.",
    field: {
      label: "Why won't this be done?",
      placeholder: "Give a brief reason",
    },
    confirmLabel: "Mark won't do",
    danger: true,
    /** Drops the goal only after a brief reason is present. */
    onConfirm: async () => {
      const reason = modalField.querySelector("[data-modal-input]")?.value.trim() || "";
      if (!reason) {
        showToast("Give a brief reason before you mark this work won't do.");
        modalField.querySelector("[data-modal-input]")?.focus();
        return false;
      }
      await post("/api/goals/edit", { file: goal.file, status: "dropped", reason });
      state.view = "work";
      await refresh();
      paint(true);
      showToast("The work is marked won't do.");
      return true;
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
  const workFilter = target.closest("[data-work-filter]");
  if (workFilter) {
    state.workFilter = workFilter.dataset.workFilter;
    localStorage.setItem("agent-shell.work-filter", state.workFilter);
    return paint(true);
  }
  if (target.closest("[data-enable-dock-badge]")) return enableDockBadge();
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
  const area = target.closest("[data-select-area]");
  if (area) {
    state.areaSelection = area.dataset.selectArea;
    localStorage.setItem("agent-shell.last-area", state.areaSelection);
    return paint(true);
  }
  const openArea = target.closest("[data-open-area]");
  if (openArea) {
    state.areaSelection = openArea.dataset.openArea;
    localStorage.setItem("agent-shell.last-area", state.areaSelection);
    state.view = "areas";
    revealArea(state.areaSelection);
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
  if (target.closest("[data-open-vision]")) return window.location.assign("/vision");
  if (target.closest("[data-cancel-create]")) return cancelCreate();
  if (target.closest("[data-cancel-describe]")) return cancelDescribe();
  const removeSource = target.closest("[data-remove-describe-source]");
  if (removeSource && state.describeDraft) {
    state.describeDraft.sources = (state.describeDraft.sources ?? []).filter((source) => source.file !== removeSource.dataset.removeDescribeSource);
    saveDescribeDraft();
    return paint(true);
  }
  if (target.closest("[data-save-idea]")) return saveVisibleIdea();
  const vaultLink = target.closest("[data-open-vault-link]");
  if (vaultLink) return openVaultLink(vaultLink.dataset.openVaultLink);
  const documentHeading = target.closest("[data-document-heading]");
  if (documentHeading) {
    event.preventDefault();
    return openDocumentHeading(documentHeading.dataset.documentHeading);
  }
  const documentButton = target.closest("[data-open-document]");
  if (documentButton) return openDocument(documentButton.dataset.openDocument);
  const documentHistory = target.closest("[data-document-history]");
  if (documentHistory) return navigateDocumentHistory(documentHistory.dataset.documentHistory);
  if (target.closest("[data-open-reader-agent]")) return openReaderAgent();
  if (target.closest("[data-open-goal-agent]")) return openGoalAgent({ returnView: "work" });
  if (target.closest("[data-launch-change]")) {
    state.launch.open = true;
    return paint(true);
  }
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
      showToast(result.next ? `Step ${result.next.index} started.` : action === "skip" ? `Step ${step} skipped; the pipeline is complete.` : `Step ${step} ${action}ed.`);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  const launchFor = target.closest("[data-launch-for]");
  if (launchFor) {
    const file = launchFor.dataset.launchFor;
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
  if (target.closest("[data-launch-start]")) {
    syncLaunchDraft();
    const targetFile = state.launchTarget;
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
    const action = modalConfirm;
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
  if (["work", "areas"].includes(state.view)) return toggleShellMenu();
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
  if (state.view === "document") {
    rememberDocumentPosition();
    if (state.documentReturnView === "areas") return showAreas();
    return showWork();
  }
  if (state.view === "decision") {
    state.view = state.decisionReturnView;
    state.renderedKey = "";
    paint(true);
  }
});

workTab.addEventListener("click", showWork);
areasTab.addEventListener("click", showAreas);

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
  if (item.id === "menu-update") return confirmRebuild();
  if (item.id === "menu-rebuild") return confirmRebuild();
  if (item.id === "menu-awake") return toggleAwake();
});

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
  if (event.key === "Escape" && !shellMenu.hidden) {
    event.preventDefault();
    toggleShellMenu(false);
    return;
  }
  if (event.key === "Escape" && state.launchTarget) {
    event.preventDefault();
    if (state.view === "describe") syncDescribeDraft();
    state.launchTarget = "";
    state.launchAnchor = null;
    paint(true);
    return;
  }
  if (event.key === "Escape" && state.goalSelection.length) {
    event.preventDefault();
    state.goalSelection = [];
    paint(true);
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

void (async () => {
  await refresh({ initial: true });
  if (requestedDocument) await openDocument(requestedDocument);
})();
window.setInterval(() => refresh(), 2500);
