const savedGoal = localStorage.getItem("agent-shell.current-goal") || "";
const requestedLocation = new URLSearchParams(location.search);
const requestedView = requestedLocation.get("view");
const requestedArea = requestedLocation.get("area") || "";
const requestedDocument = requestedLocation.get("document") || "";
const initialView = requestedDocument ? "document" : ["areas", "programs"].includes(requestedView) ? requestedView : "work";

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
  query: "",
  editingWords: false,
  caffeinate: false,
  decisionReturnView: "agent",
  agentReturnView: "overview",
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
const programsButton = document.querySelector("#programs-button");
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

/** Stores the one shared expansion state used by Areas and Programs. */
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
  return state.sessions.find((session) => session.goal === goal.file || session.name === goal.session) || null;
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

/** Describes one Goal and Run state in user terms. */
function stateLabel(goal, session) {
  if (goal.status === "done") return "Complete";
  if (!session) return goalNeedsYou(goal) ? "Waiting for you" : "Ready";
  if (session.state === "waiting") return "Waiting for you";
  if (session.state === "working") return "Agent working";
  if (session.state === "shell") return "Agent did not start";
  return "Session open";
}

/** Describes one work-definition conversation without a Goal status. */
function describeWorkStateLabel(session) {
  if (!session) return "Agent session ended";
  if (session.state === "waiting") return "Waiting for you";
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
  if (!terms.every((term) => text.includes(term))) return 0;
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
  const count = goals.length + documents.length + matchingAreas.length;
  if (!count) return `<div class="empty-state">No Goals, Documents, or Areas match “${escapeHtml(query)}”.</div>`;
  return `
    ${documents.length ? `<section class="work-section"><div class="section-heading"><h2>Documents</h2><span>${documents.length}</span></div><div class="search-result-list">${documents.map(documentSearchCard).join("")}</div></section>` : ""}
    ${goals.length ? workSection("Goals", goals, "", String(goals.length)) : ""}
    ${matchingAreas.length ? `<section class="work-section"><div class="section-heading"><h2>Areas</h2><span>${matchingAreas.length}</span></div><div class="search-result-list">${matchingAreas.map((area) => `<button class="search-result-card" type="button" data-open-area="${escapeHtml(area.path)}"><span><span class="search-result-kind">Area</span><strong>${escapeHtml(areaLabel(area.path))}</strong><small>${escapeHtml(clip(area.purpose || area.path, 160))}</small></span><span aria-hidden="true">→</span></button>`).join("")}</div></section>` : ""}`;
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
  const trees = goalTrees().filter((tree) => goalTreeState(tree) !== "closed");
  const descriptions = describeWorkSessions();
  return areas().flatMap((area, index) => {
    const areaTrees = trees.filter((tree) => tree.path === area.path);
    const areaDescriptions = descriptions.filter((session) => session.area === area.path);
    const documents = [...new Map([
      ...(area.documents ?? []),
      ...areaTrees.flatMap((tree) => tree.goals.flatMap((goal) => goal.documents ?? [])),
    ].filter((document) => document.kind === "document" || !document.kind).map((document) => [document.file, document])).values()];
    if (!areaTrees.length && !areaDescriptions.length && !documents.length) return [];
    return [{ area, trees: areaTrees, descriptions: areaDescriptions, documents, index }];
  });
}

/** Returns direct routes to every agent or handoff that needs the user. */
function deskAttentionItems() {
  const goalItems = allGoals().flatMap((goal) => {
    if (["done", "dropped", "deferred"].includes(goal.status)) return [];
    const session = sessionForGoal(goal);
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

/** Renders the small action index above the stable Area map. */
function deskAttentionQueue() {
  const items = deskAttentionItems();
  if (!items.length) return "";
  return `
    <section class="attention-queue" aria-labelledby="attention-heading">
      <header><p class="kicker">Attention</p><h2 id="attention-heading">Needs you now</h2><span>${items.length}</span></header>
      <div class="attention-items">${items.map((item) => {
        const name = item.session ? agentName(item.session) : "Handoff";
        const action = item.kind === "definition"
          ? `data-select-work-definition="${escapeHtml(item.session.name)}"`
          : item.kind === "handoff"
            ? `data-view-goal="${escapeHtml(item.goal.file)}"`
            : `data-open-goal-run="${escapeHtml(item.goal.file)}"`;
        return `<button type="button" ${action}><span><small>${escapeHtml(areaLabel(item.area))}</small><strong>${escapeHtml(item.title)}</strong></span><span>${escapeHtml(item.kind === "handoff" ? "Review handoff" : `Open ${name}`)} <b aria-hidden="true">→</b></span></button>`;
      }).join("")}</div>
    </section>`;
}

/** Returns the action text for one Goal without hiding its current state. */
function deskGoalAction(goal) {
  if (["done", "dropped", "deferred"].includes(goal.status)) {
    return { state: goal.status === "done" ? "Complete" : humanName(goal.status), action: "View details", kind: "complete", route: "details" };
  }
  const session = sessionForGoal(goal);
  if (!session) return { state: goalNeedsYou(goal) ? "Waiting for you" : "Ready", action: goalNeedsYou(goal) ? "Review handoff" : "Start agent", kind: goalNeedsYou(goal) ? "waiting" : "ready", route: goalNeedsYou(goal) ? "details" : "run" };
  if (session.state === "working") return { state: "Agent working", action: `Open ${agentName(session)}`, kind: "working", route: "run" };
  if (session.state === "waiting") return { state: "Waiting for you", action: `Open ${agentName(session)}`, kind: "waiting", route: "run" };
  if (session.state === "shell") return { state: "Agent did not start", action: "Open session", kind: "waiting", route: "run" };
  return { state: "Session open", action: "Open agent", kind: "ready", route: "run" };
}

/** Renders one Goal with direct Run, detail, and completion actions. */
function deskGoalRow(goal, { subgoal = false } = {}) {
  const action = deskGoalAction(goal);
  const complete = !["done", "dropped", "deferred"].includes(goal.status);
  const route = action.route === "run"
    ? `data-open-goal-run="${escapeHtml(goal.file)}"`
    : `data-view-goal="${escapeHtml(goal.file)}"`;
  return `
    <article class="desk-goal ${subgoal ? "subgoal" : "root-goal"} ${action.kind}">
      <button class="desk-goal-main" type="button" data-view-goal="${escapeHtml(goal.file)}">
        <small>${subgoal ? "Subgoal" : "Goal"}</small>
        <strong>${escapeHtml(goal.title)}</strong>
        <span>${escapeHtml(currentBriefFields(goal).wanted)}</span>
      </button>
      <div class="desk-goal-controls">
        <span class="desk-state ${action.kind}">${escapeHtml(action.state)}</span>
        <button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>
        ${action.route === "run" ? `<button class="desk-icon-action" type="button" data-view-goal="${escapeHtml(goal.file)}" aria-label="View details for ${escapeHtml(goal.title)}">Details</button>` : ""}
        ${complete ? `<button class="desk-icon-action complete" type="button" data-complete-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} complete">Done</button>` : ""}
      </div>
    </article>`;
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
          <div class="area-desk-section-heading"><h3>Active work</h3><span>${openGoalCount}</span></div>
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
    content = `${deskAttentionQueue()}${records.length
      ? `<section class="area-desk-grid" aria-label="Work by Area">${records.map(deskAreaPanel).join("")}</section>`
      : `<div class="empty-state">No active Areas contain Goals or Documents.</div>`}`;
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
      <label class="search-field">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input id="work-search" type="search" value="${escapeHtml(state.query)}" placeholder="Find a Goal, Document, or Area" autocomplete="off" />
        <kbd>⌘/</kbd>
      </label>
      ${content}
    </section>
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

/** Builds one shared collapsible area tree for Areas and Programs. */
function areaTreeRows({ mode, programsByArea = new Map() }) {
  const areaItems = areas();
  const byPath = new Map(areaItems.map((area) => [area.path, area]));
  const relevant = new Set();
  if (mode === "programs") {
    for (const area of programsByArea.keys()) {
      const parts = area.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        const path = parts.slice(0, index).join("/");
        if (byPath.has(path)) relevant.add(path);
      }
    }
  } else {
    for (const area of areaItems) relevant.add(area.path);
  }
  const children = new Map();
  for (const path of relevant) {
    const parent = relevant.has(areaParent(path)) ? areaParent(path) : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(path);
  }
  for (const list of children.values()) list.sort((left, right) => left.localeCompare(right));

  /** Renders one area and its expanded contents. */
  const branch = (path, depth) => {
    const area = byPath.get(path);
    const childPaths = children.get(path) || [];
    const programs = programsByArea.get(path) || [];
    const expandable = childPaths.length > 0 || programs.length > 0;
    const expanded = expandable && state.expandedAreas.has(path);
    const selected = mode === "areas" && selectedArea()?.path === path;
    const row = `
      <div class="area-tree-row ${selected ? "selected" : ""}" style="--area-depth:${depth}">
        ${expandable
          ? `<button class="area-toggle" type="button" data-toggle-area="${escapeHtml(path)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(humanName(area.name))}"><span aria-hidden="true">${expanded ? "▾" : "▸"}</span></button>`
          : `<span class="area-toggle-spacer" aria-hidden="true"></span>`}
        ${mode === "areas"
          ? `<button class="area-row" type="button" data-select-area="${escapeHtml(path)}"><span>${escapeHtml(humanName(area.name))}</span><small>${escapeHtml(path)}</small></button>`
          : `<button class="area-program-row" type="button" ${expandable ? `data-toggle-area="${escapeHtml(path)}" aria-expanded="${expanded}"` : "disabled"}><span>${escapeHtml(humanName(area.name))}</span><small>${programs.length ? `${programs.length} here` : ""}</small></button>`}
      </div>`;
    if (!expanded) return row;
    const owned = programs.length
      ? `<div class="area-programs" style="--area-depth:${depth + 1}">${programs.map(programRow).join("")}</div>`
      : "";
    return row + owned + childPaths.map((child) => branch(child, depth + 1)).join("");
  };
  return (children.get("") || []).map((root) => branch(root, 0)).join("");
}

/** Renders one Area Goal with its current brief. */
function areaGoalRow(goal) {
  return `
    <button type="button" data-select-goal="${escapeHtml(goal.file)}">
      <span class="area-goal-main"><strong>${escapeHtml(goal.title)}</strong><small>${escapeHtml(clip(goal.doneWhen, 150))}</small></span>
      <span class="area-goal-brief"><em>Current brief</em><small>${escapeHtml(currentBriefFields(goal).wanted)}</small></span>
    </button>`;
}

/** Renders the Goals and Documents stored directly in one Area. */
function areaContents(area) {
  const goals = (area.goals ?? []).filter((goal) => goal.area === area.path);
  const authoredOrder = new Map(goals.flatMap((goal) => goal.documents ?? []).map((document, index) => [document.file, index]));
  const documents = [...(area.documents ?? [])].sort((left, right) =>
    (authoredOrder.get(left.file) ?? Number.MAX_SAFE_INTEGER) - (authoredOrder.get(right.file) ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title));
  return `
    <section class="area-contents">
      <header class="area-contents-heading">
        <div><p class="kicker">Selected Area</p><h2>${escapeHtml(humanName(area.name))}</h2><small>${escapeHtml(area.path)}</small></div>
        <div class="area-contents-actions">
          <button class="primary-button" type="button" data-new-goal>Create Goal</button>
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
    </section>`;
}

/** Renders the Area hierarchy and the contents of the selected Area. */
function renderAreas() {
  const selected = selectedArea();
  const rows = areaTreeRows({ mode: "areas" });
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
function currentProgram() {
  return state.programs.programs.find((program) => program.id === state.programId) ?? null;
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

/** Renders one compact program row. */
function programRow(program) {
  const type = program.type === "process" ? "Server or watcher" : program.type === "command" ? "Command" : "Daily agent";
  return `
    <button class="program-row" type="button" data-select-program="${escapeHtml(program.id)}">
      <span><small>${escapeHtml(type)}</small><strong>${escapeHtml(program.label)}</strong><em>${escapeHtml(program.type === "routine" ? program.schedule : program.command)}</em></span>
      <span class="program-state ${program.session && !["stopped", "shell"].includes(program.session.state) ? "live" : ""}">${escapeHtml(programState(program))}</span>
    </button>`;
}

/** Renders the area-grouped operational surface. */
function renderPrograms() {
  const groups = new Map();
  for (const program of state.programs.programs) {
    if (!groups.has(program.area)) groups.set(program.area, []);
    groups.get(program.area).push(program);
  }
  return `
    <section class="programs-page">
      <header class="surface-heading">
        <div><p class="kicker">Programs</p><h1>Things that run</h1><p>Servers, useful commands, and scheduled agents stay with their areas.</p></div>
        <button class="primary-button" type="button" data-new-program>New program</button>
      </header>
      <div class="program-groups area-tree">
        ${groups.size ? areaTreeRows({ mode: "programs", programsByArea: groups }) : `<div class="empty-state">No programs exist yet.</div>`}
      </div>
      ${state.programs.errors.length ? `<details class="program-errors"><summary>${state.programs.errors.length} configuration ${state.programs.errors.length === 1 ? "problem" : "problems"}</summary>${state.programs.errors.map((item) => `<p>${escapeHtml(item.file)} — ${escapeHtml(item.error)}</p>`).join("")}</details>` : ""}
    </section>`;
}

/** Renders the controls and facts for one selected program. */
function renderProgramDetail(program) {
  if (!program) return renderPrograms();
  const live = program.session && !["stopped", "shell"].includes(program.session.state);
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
      <p class="kicker">${program.type === "process" ? "Server or watcher" : program.type === "command" ? "Command" : "Daily agent"}</p>
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
          <button class="primary-button" type="submit">Open agent <kbd>⌘↵</kbd></button>
          <button class="quiet-button" type="button" data-save-idea>Save as an idea</button>
          <button class="quiet-button" type="button" data-cancel-describe>Cancel</button>
        </div>
        <p class="form-note">The agent reads the Area notes and can inspect its vault and repository. It discusses the structure before it creates Goals.</p>
      </form>
    </article>
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

/** Renders the compact present-tense memory at the top of a Goal. */
function currentBriefBlock(goal) {
  const fields = currentBriefFields(goal);
  return `
    <section class="brief-card">
      <p class="kicker">Current brief</p>
      <p class="brief-wanted">${escapeHtml(fields.wanted)}</p>
    </section>
  `;
}

/** Renders the Goal chain that explains why the selected Goal exists. */
function whyBlock(goal) {
  const why = goal.why ?? [];
  if (!why.length) return "";
  return `
    <section class="summary-section goal-relations">
      <div class="memory-heading"><div><p class="kicker">Why</p><h2>This Goal helps complete</h2></div></div>
      <div class="goal-relation-list">${why.map((item) => `<button type="button" data-select-goal="${escapeHtml(item.file)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(clip(item.doneWhen, 150))}</small></button>`).join("")}</div>
    </section>`;
}

/** Renders the immediate Goals needed to complete the selected Goal. */
function subgoalsBlock(goal) {
  const subgoals = goal.subgoalItems ?? [];
  if (!subgoals.length) return "";
  return `
    <section class="summary-section goal-relations">
      <div class="memory-heading"><div><p class="kicker">To do that</p><h2>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</h2></div></div>
      <div class="goal-relation-list">${subgoals.map((item) => `<button type="button" data-select-goal="${escapeHtml(item.file)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(clip(item.doneWhen, 150))}</small></button>`).join("")}</div>
    </section>`;
}

/** Renders the user's durable restatement of the work. */
function wordsBlock(goal) {
  const words = goal.myUnderstanding?.trim() || "";
  if (!words) return "";
  return `<section class="summary-section"><div class="your-words"><p class="kicker">Your words</p><blockquote>${escapeHtml(words)}</blockquote></div></section>`;
}

/** Keeps Goal history available without making it part of the normal route. */
function storyBlock(goal) {
  const entries = storyEntries(goal.storyText);
  return `
    <section class="summary-section history-section">
      <details class="goal-history">
        <summary><span><small>Optional context</small><strong>History${entries.length ? ` · ${entries.length} ${entries.length === 1 ? "update" : "updates"}` : ""}</strong></span><b aria-hidden="true">+</b></summary>
        <div class="goal-history-body">
          ${entries.length
            ? `<ol class="story-list">${entries.map((entry) => `<li><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.body)}</p></li>`).join("")}</ol>`
            : `<p class="memory-empty">No short history exists.</p>`}
          ${goal.stateText?.trim() ? `<details class="full-note"><summary>Read the full progress note</summary><div class="full-note-content">${markdownToHtml(goal.stateText)}</div></details>` : ""}
        </div>
      </details>
    </section>
  `;
}

/** Renders the Documents linked to one Goal. */
function livingDocumentsBlock(goal) {
  const documents = goal.documents ?? [];
  return `
    <section class="summary-section memory-section">
      <div class="memory-heading"><div><p class="kicker">Documents</p><h2>${documents.length ? `${documents.length} linked ${documents.length === 1 ? "Document" : "Documents"}` : "No linked Documents"}</h2></div></div>
      ${documents.length
        ? `<div class="document-list">${documents.map((document) => `<button class="document-row" type="button" data-open-document="${escapeHtml(document.file)}"><span><strong>${escapeHtml(document.title)}</strong><small>Document</small></span><span aria-hidden="true">→</span></button>`).join("")}</div>`
        : `<p class="memory-empty">The Goal and native chat still provide the source context.</p>`}
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
function runCard(goal, session) {
  const name = agentName(session);
  if (session.state === "waiting") {
    return `
      <section class="summary-section">
        <div class="run-card waiting">
          <div class="run-status">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h2>${escapeHtml(name)} is waiting for you.</h2><p>Read the message. Then continue, end this run, or complete the work.</p></div>
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
    const collaboration = session.phase === "collaborate";
    return `
      <section class="summary-section">
        <div class="run-card shell">
          <div class="run-status">
            <span class="status-mark" aria-hidden="true"></span>
            <div><h2>The session is open, but the agent did not start.</h2><p>You can start it now or close the session.</p></div>
          </div>
          <div class="action-row">
            <button class="primary-button" type="button" data-launch-open-session>${collaboration ? "Open the agent" : "Start the agent"}</button>
            <button class="quiet-button" type="button" data-mark-complete>Mark work complete…</button>
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

/** Renders the next actions for a Goal without a live Run. */
function startBlock(goal) {
  if (["done", "dropped", "deferred"].includes(goal.status)) {
    return `
      <section class="summary-section">
        <div class="run-card">
          <div class="run-status"><span class="status-mark" aria-hidden="true"></span><div><h2>This work is ${escapeHtml(goal.status)}.</h2><p>No agent is working on it.</p></div></div>
          ${goal.status === "done" ? `<div class="action-row"><button class="secondary-button" type="button" data-reopen-goal>Reopen work</button></div>` : ""}
        </div>
      </section>
    `;
  }
  return `
    <section class="summary-section">
      <h2>Continue with an agent</h2>
      <p class="next-action-copy">Open the native agent to discuss the Goal, give feedback, or ask for work.</p>
      <div class="action-row start-actions">
        <button class="primary-button" type="button" data-open-goal-agent>Open agent</button>
      </div>
      <button class="quiet-button complete-without-run" type="button" data-mark-complete>Already finished? Mark this work complete…</button>
    </section>
  `;
}

/** Renders optional Goal details without blocking the Work-to-agent route. */
function renderOverview(goal, session) {
  return `
    <article class="summary-page">
      ${areaPath(goal.area)}
      <p class="goal-detail-label">Goal details</p>
      <h1 class="goal-title">${escapeHtml(goal.title)}</h1>

      ${currentBriefBlock(goal)}
      ${livingDocumentsBlock(goal)}
      ${session ? runCard(goal, session) : startBlock(goal)}
      ${whyBlock(goal)}
      ${subgoalsBlock(goal)}
      ${storyBlock(goal)}
      ${wordsBlock(goal)}
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
    state.editingWords,
    state.caffeinate,
    state.document ? [state.document.file, state.document.hash, state.documentTrailIndex, state.documentTrail.length] : null,
    state.describeDraft,
    state.describeSessionName,
    state.areaSelection,
    [...state.expandedAreas].sort(),
    state.areaEdit,
    state.programId,
    state.programDraft,
    state.programs.programs.map((item) => [item.id, item.paused, item.lastRunAt, item.nextRunAt, item.session?.state]),
    vaultRenderProjection(),
    goal ? [goal.file, goal.status, goal.mtime, goal.stateText, goal.currentBrief, goal.storyText, goal.why, goal.subgoalItems, goal.documents] : null,
    state.sessions.map((item) => [item.name, item.goal, item.kind, item.area, item.state, item.phase, item.command, item.created, item.workTitle]),
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
  const isPrograms = state.view === "programs";
  const isProgramDetail = state.view === "program-detail";
  const isProgramCreate = state.view === "program-create";
  const isProgramSession = state.view === "program-session";
  const program = currentProgram();
  const isTopLevel = isWork || isAreas || isPrograms;
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
      ? "Programs"
    : isProgramSession
      ? "Program"
    : isWork
        ? "Agent Shell"
        : state.view === "overview"
          ? "Work"
          : state.view === "agent"
              ? state.agentReturnView === "document" && state.document ? "Document" : "Work"
              : state.view === "document"
                ? state.documentReturnView === "areas"
                  ? "Areas"
                  : state.documentReturnView === "overview"
                    ? "Summary"
                    : "Work"
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
        : isPrograms
          ? "Servers, commands, and scheduled agents"
        : (isProgramDetail || isProgramSession) && program
          ? `${areaLabel(program.area)} · ${program.label} · ${programState(program)}`
        : isProgramCreate
          ? "Add a program to one area"
          : state.view === "document" && state.document
            ? ""
            : goal
              ? `${state.view === "overview" ? "Goal details · " : ""}${areaLabel(goal.area)} · ${goal.title}${goalSession ? ` · ${stateLabel(goal, goalSession)}` : ""}`
              : "";

  const topLevel = isWork
    ? "work"
    : isAreas || isAreaEdit || (isCreate && state.createReturnView === "areas")
      ? "areas"
      : isPrograms || isProgramDetail || isProgramCreate || isProgramSession
        ? "programs"
        : "";
  const attentionCount = deskAttentionItems().length;
  workTab.textContent = attentionCount ? `Work · ${attentionCount}` : "Work";
  workTab.classList.toggle("active", topLevel === "work");
  workTab.classList.toggle("has-attention", attentionCount > 0);
  areasTab.classList.toggle("active", topLevel === "areas");
  programsButton.classList.toggle("active", topLevel === "programs");
  for (const [button, active] of [[workTab, topLevel === "work"], [areasTab, topLevel === "areas"], [programsButton, topLevel === "programs"]]) {
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  secondaryAction.hidden = !session || ["work", "create", "describe", "areas", "area-edit", "programs", "program-detail", "program-create", "program-session", "document"].includes(state.view);
  secondaryAction.textContent = session?.state === "shell" ? "Close session…" : "Stop agent…";

  if (state.view === "agent" && session?.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else if (["work", "create", "describe", "describe-agent", "areas", "area-edit", "programs", "program-detail", "program-create", "program-session", "agent", "decision"].includes(state.view)) {
    findButton.hidden = true;
    findButton.textContent = "Find work";
    findButton.dataset.action = "find";
  } else {
    findButton.hidden = false;
    findButton.innerHTML = `Find work <kbd>⌘/</kbd>`;
    findButton.dataset.action = "find";
  }
  programsButton.textContent = state.programs.liveCount ? `Programs · ${state.programs.liveCount}` : "Programs";
}

/** Refreshes live agent state without replacing the terminal. */
function updateLiveHeader() {
  if (state.view === "describe-agent") {
    const session = describeWorkSession();
    if (!session) return;
    barContext.textContent = `${areaLabel(session.area)} · Defining work · ${describeWorkStateLabel(session)}`;
    findButton.hidden = true;
    programsButton.textContent = state.programs.liveCount ? `Programs · ${state.programs.liveCount}` : "Programs";
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
  programsButton.textContent = state.programs.liveCount ? `Programs · ${state.programs.liveCount}` : "Programs";
}

/** Selects and renders the current full-screen view. */
function renderScreen() {
  const goal = currentGoal();
  const goalFreeViews = ["work", "create", "describe", "describe-agent", "areas", "area-edit", "programs", "program-detail", "program-create", "program-session", "document"];
  if (!goal && !goalFreeViews.includes(state.view)) state.view = "work";
  const session = sessionForGoal(goal);
  const describeSession = describeWorkSession();
  if (["program-detail", "program-session"].includes(state.view) && !currentProgram()) state.view = "programs";
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

  if (state.view === "work") screen.innerHTML = renderWork();
  else if (state.view === "create") screen.innerHTML = renderCreate();
  else if (state.view === "describe") screen.innerHTML = renderDescribeCapture();
  else if (state.view === "describe-agent") screen.innerHTML = renderDescribeWorkAgent(describeSession);
  else if (state.view === "areas") screen.innerHTML = renderAreas();
  else if (state.view === "area-edit") screen.innerHTML = renderAreaEditor();
  else if (state.view === "programs") screen.innerHTML = renderPrograms();
  else if (state.view === "program-detail") screen.innerHTML = renderProgramDetail(currentProgram());
  else if (state.view === "program-create") screen.innerHTML = renderProgramCreate();
  else if (state.view === "program-session") screen.innerHTML = renderProgramSession(currentProgram());
  else if (state.view === "agent") screen.innerHTML = renderAgent(goal, session);
  else if (state.view === "decision" && session) screen.innerHTML = renderDecision(goal, session);
  else if (state.view === "document") screen.innerHTML = renderDocument();
  else screen.innerHTML = renderOverview(goal, session);

  updateHeader();
  if (state.view === "document") bindDocumentReader();
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
  if (!force && active && (["work-search", "my-understanding"].includes(active.id) || active.closest?.("[data-create-form], [data-describe-work-form], [data-area-form], [data-program-form]"))) {
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

/** Refreshes the vault, program, and session projections from the server. */
async function refresh({ initial = false } = {}) {
  try {
    const [vault, sessionPayload, programs] = await Promise.all([api("/api/vault"), api("/api/sessions"), api("/api/programs")]);
    state.vault = vault;
    state.sessions = sessionPayload.sessions || [];
    state.programs = {
      programs: programs.programs || [],
      errors: programs.errors || [],
      areas: programs.areas || [],
      liveCount: Number(programs.liveCount || 0),
      timezone: programs.timezone || "",
      scheduler: programs.scheduler || { installed: false, intervalMinutes: 30 },
    };
    state.caffeinate = Boolean(sessionPayload.caffeinate);
    state.loading = false;
    state.error = "";
    if (state.view === "program-session" && !currentProgram()?.session) {
      disposeTerminal();
      state.view = currentProgram() ? "program-detail" : "programs";
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
    paint(initial);
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    paint(true);
  }
}

/** Selects a Goal without starting work. */
function selectGoal(file) {
  state.currentFile = file;
  state.view = "overview";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  state.editingWords = false;
  localStorage.setItem("agent-shell.current-goal", file);
  const goal = goalByFile(file);
  if (goal?.area) localStorage.setItem("agent-shell.last-area", goal.area);
  paint(true);
}

/** Stores one Goal as the active Run context without opening Goal details. */
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
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  state.editingWords = false;
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
  state.editingWords = false;
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

/** Opens the area-grouped program list. */
function showPrograms() {
  state.view = "programs";
  state.programId = "";
  paint(true);
}

/** Opens one program without changing its runtime. */
function selectProgram(id) {
  state.programId = id;
  state.view = "program-detail";
  paint(true);
}

/** Opens the new-program form with the current area as its default. */
function showProgramCreate() {
  const area = preferredArea();
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
async function performProgramAction(action) {
  const program = currentProgram();
  if (!program) return;
  await post("/api/programs/control", { id: program.id, action });
  if (["stop", "close"].includes(action) && state.view === "program-session") state.view = "program-detail";
  await refresh();
  paint(true);
  const messages = { start: "The process started.", restart: "The process restarted.", stop: "The program stopped.", close: "The saved session was removed.", run: program.type === "routine" ? "The agent started." : "The command started.", pause: "The schedule is paused.", resume: "The schedule is active." };
  showToast(messages[action] || "The program changed.");
}

/** Adds confirmation where a program action starts or destroys work. */
function controlProgram(action) {
  const program = currentProgram();
  if (!program) return;
  if (["start", "pause", "resume"].includes(action)) {
    performProgramAction(action).catch((error) => showToast(error.message));
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
    onConfirm: () => performProgramAction(action),
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

/** Returns to the selected goal summary. */
function showOverview() {
  state.view = "overview";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  state.editingWords = false;
  paint(true);
}

/** Opens the fast new-goal form. */
function showCreate(area = "") {
  state.createReturnView = state.view === "areas" ? "areas" : "work";
  state.createArea = area || (state.createReturnView === "areas" ? selectedArea()?.path : "") || preferredArea();
  state.view = "create";
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  state.editingWords = false;
  paint(true);
  window.setTimeout(() => document.querySelector("#new-goal-title")?.focus(), 0);
}

/** Returns from manual Goal creation to the surface that opened it. */
function cancelCreate() {
  state.createArea = "";
  if (state.createReturnView === "areas") return showAreas();
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
      state.documentReturnView = ["overview", "areas"].includes(state.view) ? state.view : "work";
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
  state.decisionReturnView = returnView === "overview" ? "overview" : "agent";
  state.view = "decision";
  state.renderedKey = "";
  paint(true);
}

/** Opens a native agent with the complete Goal context. */
async function openGoalAgent({ returnView = "work" } = {}) {
  const goal = currentGoal();
  if (!goal) return;
  try {
    await post("/api/goals/agent", { file: goal.file, launch: true });
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
      ? { file: goal.file, launch: true }
      : { file: goal.file, approved: true, launch: true };
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
  const goalRun = target.closest("[data-open-goal-run]");
  if (goalRun) return openGoalRun(goalRun.dataset.openGoalRun);
  const goalDetails = target.closest("[data-view-goal]");
  if (goalDetails) return selectGoal(goalDetails.dataset.viewGoal);
  const completeGoal = target.closest("[data-complete-goal]");
  if (completeGoal) {
    rememberGoal(completeGoal.dataset.completeGoal);
    return confirmComplete();
  }
  const select = target.closest("[data-select-goal]");
  if (select) return selectGoal(select.dataset.selectGoal);
  if (target.closest("[data-show-areas]")) return showAreas();
  if (target.closest("[data-show-programs]")) return showPrograms();
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
  if (target.closest("[data-cancel-program-create]")) return showPrograms();
  if (target.closest("[data-open-program-session]")) return openProgramSession();
  if (target.closest("[data-back-program]")) {
    state.view = "program-detail";
    return paint(true);
  }
  const programAction = target.closest("[data-program-action]");
  if (programAction) return controlProgram(programAction.dataset.programAction);
  if (target.closest("[data-new-goal]")) return showCreate(selectedArea()?.path || "");
  const workDefinition = target.closest("[data-select-work-definition]");
  if (workDefinition) return openDescribeSession(workDefinition.dataset.selectWorkDefinition);
  const describeArea = target.closest("[data-describe-area]");
  if (describeArea) return showDescribe({ area: describeArea.dataset.describeArea });
  if (target.closest("[data-describe-work]")) return showDescribe();
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
  if (target.closest("[data-back-overview]")) return showOverview();
  if (target.closest("[data-open-goal-agent]")) return openGoalAgent({ returnView: "work" });
  if (target.closest("[data-launch-open-session]")) return launchOpenSession();
  if (target.closest("[data-open-agent]")) {
    state.agentReturnView = "work";
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
      submitButton.innerHTML = `Open agent <kbd>⌘↵</kbd>`;
      showToast(error.message);
    }
    return;
  }
  if (!event.target.matches("[data-words-form]")) return;
  event.preventDefault();
  const goal = currentGoal();
  const understanding = new FormData(event.target).get("understanding")?.toString().trim() || "";
  if (!goal || !understanding) {
    showToast("Write what you think this work means.");
    return;
  }
  try {
    await post("/api/goals/understanding", { file: goal.file, understanding });
    state.editingWords = false;
    await refresh();
    paint(true);
    showToast("Your note is saved with this goal.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("input", (event) => {
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

backButton.addEventListener("click", async () => {
  if (state.view === "work") return;
  if (state.view === "areas" || state.view === "programs") return showWork();
  if (state.view === "area-edit") return showAreas();
  if (state.view === "program-detail" || state.view === "program-create") return showPrograms();
  if (state.view === "program-session") {
    state.view = "program-detail";
    return paint(true);
  }
  if (state.view === "create") return cancelCreate();
  if (state.view === "describe" || state.view === "describe-agent") return cancelDescribe();
  if (state.view === "overview") return showWork();
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
    if (state.documentReturnView === "overview" && currentGoal()) return showOverview();
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
programsButton.addEventListener("click", showPrograms);

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

void (async () => {
  await refresh({ initial: true });
  if (requestedDocument) await openDocument(requestedDocument);
})();
window.setInterval(() => refresh(), 2500);
