import terminalKeys from "./terminal-keys.js";
import terminalSelectionApi from "./terminal-selection.js";
import documentComments from "./document-comments.js";
import codeHighlight from "./code-highlight.js";
import areaMapCore from "./area-map-core.js";
import goalCardCore from "./goal-card-core.js";
import askCore from "./ask-core.js";
import goToCore from "./go-to-core.js";
import whatHappenedCore from "./what-happened-core.js";
import areaMapView from "./area-map.js";
import { createApiClient } from "./api-client.js";
import { createShellState } from "./shell-state.js";
import { shellDom } from "./shell-dom.js";
import { startRefreshLifecycle } from "./refresh-lifecycle.js";

const { api, post } = createApiClient();
const { requestedArea, requestedDocument, state } = createShellState();

const {
  screen, "back-button": backButton, "work-tab": workTab, "areas-tab": areasTab, "bar-context": barContext,
  "find-button": findButton, "secondary-action": secondaryAction, "modal-layer": modalLayer,
  "modal-kicker": modalKicker, "modal-title": modalTitle, "modal-copy": modalCopy, "modal-field": modalField,
  "modal-actions": modalActions, toast, "status-pill": statusPill, "awake-button": awakeButton,
  "shell-menu": shellMenu, "go-to-button": goToButton, "go-to-layer": goToLayer,
  "go-to-input": goToInput, "go-to-list": goToList,
} = shellDom();

/**
 * The global shortcuts. The keydown handler and every printed label read this
 * one table, so what the bar says and what the keyboard does cannot drift.
 */
const KEYMAP = {
  goTo: { key: "k", label: "⌘K" },
  findWork: { key: "/", label: "⌘/" },
};

/** True when the event is this binding: ⌘ plus the key, no other modifier. */
function shortcutMatches(event, binding) {
  return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
    && String(event.key).toLowerCase() === binding.key;
}

/** The printed shortcut for one binding, for a button or a hint. */
function shortcutKbd(name) {
  return `<kbd>${escapeHtml(KEYMAP[name].label)}</kbd>`;
}

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

/**
 * Renders the small inline Markdown subset used by vault notes. `visibleLine`
 * in document-comments.js mirrors these rules to map a selection back to the
 * source; change both together.
 */
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

/** Matches a line that opens a fenced code block; group 1 is the fence marker, group 2 the language tag. */
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([\w+.#-]*)\s*$/;

/** The regex for the line that closes a fence opened with `marker`. */
function fenceCloser(marker) {
  return new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
}

/**
 * Flags each line markdownToHtml shows as fenced code, fence lines included.
 * Structural scans (markdownHeadings) skip these so a `# comment` inside a
 * code block never becomes a heading or shifts anchor numbering.
 */
function fencedLineFlags(lines) {
  const flags = new Array(lines.length).fill(false);
  let close = null;
  for (const [index, line] of lines.entries()) {
    const text = line.trimEnd();
    if (close) {
      flags[index] = true;
      if (close.test(text)) close = null;
      continue;
    }
    const fence = text.match(FENCE_OPEN);
    if (!fence) continue;
    flags[index] = true;
    close = fenceCloser(fence[1]);
  }
  return flags;
}

/** Returns the visible heading hierarchy with the same anchors as the renderer. */
function markdownHeadings(text) {
  const seen = new Map();
  const offset = frontmatterLineCount(text);
  const lines = visibleMarkdown(text).split("\n");
  const fenced = fencedLineFlags(lines);
  return lines.flatMap((line, index) => {
    if (fenced[index]) return [];
    const match = line.trimEnd().match(/^(#{1,4})\s+(.+)$/);
    if (!match) return [];
    return [{ level: match[1].length, title: cleanText(match[2]), id: markdownHeadingAnchor(match[2], seen), line: index + offset }];
  });
}

/** Lines that visibleMarkdown removes, so visible line numbers map to file lines. */
function frontmatterLineCount(text) {
  const full = String(text ?? "").replace(/\r/g, "").split("\n").length;
  return full - visibleMarkdown(text).split("\n").length;
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

/**
 * Renders safe headings, paragraphs, lists, tables, and fenced code from
 * Markdown. A fenced block's language tag is highlighted by code-highlight.js
 * when that language is known; an unknown tag still renders as a plain code
 * block. With `options.comments` (parsed by document-comments.js) each
 * comment renders as a red-ruled block under the block that holds it, and its
 * quoted words as a mark; `options.composer` places the comment composer at
 * its anchor line. Blocks carry `data-line`, the file line they came from, so
 * a selection can be mapped back to the Markdown. No line inside a fenced
 * block gets its own `data-line`: parseComments already treats that whole
 * range as code, so no comment can anchor there.
 */
function markdownToHtml(text, options = {}) {
  const source = visibleMarkdown(text);
  const lines = source.split("\n");
  const html = [];
  const headingIds = new Map();
  const comments = options.comments ?? [];
  const composer = options.composer ?? null;
  const lineOffset = frontmatterLineCount(text);
  /** Comment blocks (and the composer) that belong under one file line. */
  const tailFor = (fileLine) => {
    const parts = comments.filter((comment) => comment.line === fileLine)
      .map((comment) => composer?.editing?.index === comment.index ? commentComposerHtml(composer) : commentAsideHtml(comment));
    if (composer && !composer.editing && composer.placeLine === fileLine) parts.push(commentComposerHtml(composer));
    return parts.join("");
  };
  /** Removes comment markup from one line, leaving an open and a close marker for each mark. */
  const stripComments = (value, fileLine) => {
    if (!comments.length) return value;
    const tokens = documentComments.commentTokensOnLine(comments, fileLine);
    if (!tokens.length) return value;
    let out = "";
    let cursor = 0;
    for (const token of tokens) {
      out += value.slice(cursor, token.from);
      if (token.kind === "open") out += `\u0005${token.index}\u0006`;
      else if (token.kind === "close") out += "\u0005\u0006";
      cursor = Math.max(cursor, token.to);
    }
    return out + value.slice(cursor);
  };
  if (composer && !composer.editing && composer.placeLine < 0) html.push(commentComposerHtml(composer));
  let list = null;
  /** Closes the current list when the Markdown block type changes. */
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const fileLine = index + lineOffset;
    const raw = stripComments(lines[index], fileLine);
    const line = raw.trimEnd();
    const tail = tailFor(fileLine);
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const fence = line.match(FENCE_OPEN);
    const alignments = !fence && line.includes("|") ? markdownTableAlignments(lines[index + 1] ?? "") : null;
    const headers = alignments ? markdownTableCells(line) : [];
    if (fence) {
      closeList();
      const lang = fence[2] || "";
      const closeFence = fenceCloser(fence[1]);
      const body = [];
      index += 1;
      while (index < lines.length && !closeFence.test(stripComments(lines[index], index + lineOffset).trimEnd())) {
        body.push(stripComments(lines[index], index + lineOffset));
        index += 1;
      }
      const highlighter = codeHighlight;
      const language = highlighter?.normalizeLanguage(lang);
      const code = highlighter ? highlighter.highlightHtml(body.join("\n"), lang) : escapeHtml(body.join("\n"));
      const label = lang ? `<div class="markdown-code-lang">${escapeHtml(lang)}</div>` : "";
      html.push(
        `<div class="markdown-code-wrap" data-line="${fileLine}">${label}<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${code}</code></pre></div>${tail}`
      );
    } else if (alignments && headers.length === alignments.length) {
      closeList();
      const rows = [];
      const tableLine = fileLine;
      let tableTail = tail;
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = markdownTableCells(stripComments(lines[index], index + lineOffset));
        if (cells.length !== headers.length) break;
        rows.push(cells);
        tableTail += tailFor(index + lineOffset);
        index += 1;
      }
      index -= 1;
      /** Returns the alignment class for one table column. */
      const cellClass = (column) => ` class="align-${alignments[column]}"`;
      html.push(
        `<div class="markdown-table-wrap" data-line="${tableLine}"><table><thead><tr>${headers.map((cell, column) => `<th${cellClass(column)}>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${row.map((cell, column) => `<td${cellClass(column)}>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${tableTail}`
      );
    } else if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      const id = markdownHeadingAnchor(heading[2], headingIds);
      html.push(`<h${level} id="${escapeHtml(id)}" data-line="${fileLine}">${inlineMarkdown(heading[2])}</h${level}>${tail}`);
    } else if (bullet || ordered) {
      const nextList = ordered ? "ol" : "ul";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li data-line="${fileLine}">${inlineMarkdown((bullet || ordered)[1])}${tail}</li>`);
    } else if (!line.trim()) {
      closeList();
      if (tail) html.push(tail);
    } else {
      closeList();
      html.push(`<p data-line="${fileLine}">${inlineMarkdown(line)}</p>${tail}`);
    }
  }
  closeList();
  // Marks nest as their brackets nest, so every token becomes its own tag.
  return html.join("")
    .replace(/\u0005(\d+)\u0006/g, '<mark class="document-comment-mark" data-comment-index="$1">')
    .replace(/\u0005\u0006/g, "</mark>");
}

/** One comment as a red-ruled block: author, words, and an always-visible remove control. */
function commentAsideHtml(comment) {
  const author = comment.author || "Comment";
  return `<aside class="document-comment" id="document-comment-${comment.index}" role="note" aria-label="Comment from ${escapeHtml(author)}" data-comment-index="${comment.index}" tabindex="-1">
    <button class="document-comment-body" type="button" data-edit-comment="${comment.index}" title="Edit comment"><span class="document-comment-author">${escapeHtml(author)}</span><span class="document-comment-text">${escapeHtml(comment.text)}</span></button>
    <button class="document-comment-remove" type="button" data-remove-comment="${comment.index}" aria-label="Remove comment" title="Remove comment">×</button>
  </aside>`;
}

/** The inline comment composer, at its anchor, with its scope and printed keys. */
function commentComposerHtml(composer) {
  const anchor = composer.anchor;
  const where = composer.editing
    ? `<span>Editing your comment</span>`
    : anchor.kind === "selection"
      ? `<span>On “${escapeHtml(clip(anchor.quote, 70))}”</span>`
      : `<span class="document-comment-scope" role="group" aria-label="Where this comment goes">
          <button type="button" data-comment-scope="section" aria-pressed="${anchor.kind === "section"}" ${composer.section ? "" : "disabled"}>${composer.section ? `Section “${escapeHtml(clip(composer.section.title, 40))}”` : "This section"}</button>
          <button type="button" data-comment-scope="document" aria-pressed="${anchor.kind === "document"}">Whole Document</button>
        </span>`;
  return `<form class="document-comment-composer" data-comment-composer data-command-enter-submit aria-label="${composer.editing ? "Edit comment" : "New comment"}">
    <textarea id="comment-text" rows="2" placeholder="Your comment" aria-label="Comment">${escapeHtml(composer.text)}</textarea>
    <div class="document-comment-composer-row">
      <div class="document-comment-composer-where">${where}</div>
      <div class="document-comment-composer-actions">
        <button class="quiet-button" type="button" data-cancel-comment>Cancel <kbd>esc</kbd></button>
        <button class="primary-button" type="submit">Save comment <kbd>⌘↵</kbd></button>
      </div>
    </div>
    ${composer.notice ? `<p class="document-comment-composer-notice" role="alert">${escapeHtml(composer.notice)}</p>` : ""}
  </form>`;
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
/** The launch popover target while Julian gives an Area brain its instruction. */
const BRAIN_LAUNCH_TARGET = "__brain__";

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
function showToast(message, action = null) {
  toast.textContent = message;
  toast.classList.toggle("has-action", Boolean(action));
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      toast.classList.remove("show");
      action.run();
    });
    toast.append(button);
  }
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), action ? 8000 : 3200);
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

/**
 * Places one complete work tree in a single attention group. A tree in an Area
 * a live brain runs is never "waiting": what waits on Julian there is the
 * brain's own list, so the tree does not sort in front of it.
 */
function goalTreeState(tree) {
  const openGoals = tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  if (!openGoals.length) return "closed";
  const covered = goalCoveredByBrain(tree.root);
  const sessions = openGoals.map(sessionForGoal).filter(Boolean);
  if (sessions.some((session) => ["waiting", "shell"].includes(session.state))) return covered ? "open" : "waiting";
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

/** Every live session bound to one Goal, for the agent count on its card. */
function sessionsForGoal(goal) {
  if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return [];
  return state.sessions.filter((session) => session.goal === goal.file || session.name === goal.session);
}

/** Returns every live conversation that is defining work, newest first. */
function describeWorkSessions() {
  return state.sessions
    .filter((session) => session.kind === "work-definition")
    .sort((left, right) => Number(right.created || 0) - Number(left.created || 0));
}

/** Finds only the work-definition (or brain) conversation the user selected. */
function describeWorkSession() {
  return describeWorkSessions().find((session) => session.name === state.describeSessionName)
    ?? brainSessions().find((session) => session.name === state.describeSessionName)
    ?? null;
}

// ---- Area brains ----
// One long-lived orchestrating agent per Area (ADR-0024). The server keeps
// the record; the desk shows it as an icon and one line on the Area card,
// and opens its terminal through the same view as a describe-work agent.

/** Every live brain session. */
function brainSessions() {
  return state.sessions.filter((session) => session.kind === "brain");
}

/** The brain record of exactly this Area, or null. A parent card never shows a child brain. */
function brainForAreaCard(areaPath) {
  return (state.brains ?? []).find((brain) => brain.area === areaPath) ?? null;
}

/** The desk word for a brain's state: live pane state, else its record status. */
function brainStateLabel(brain) {
  if (!brain) return "No brain";
  if (brain.live) {
    if (brain.state === "working") return "Brain working";
    if (brain.state === "waiting") return brain.stateDetail === "decision" ? "Brain needs a decision" : "Brain waiting for you";
    if (brain.state === "shell") return "Brain did not start";
    return "Brain session open";
  }
  return brain.status === "ended" ? "Brain ended" : "Brain stopped";
}

/** The class that colours the brain icon: none, working, waiting, live, stopped, ended. */
function brainKind(brain) {
  if (!brain) return "none";
  if (brain.live) return brain.state === "waiting" ? "waiting" : brain.state === "working" ? "working" : "live";
  return brain.status === "ended" ? "ended" : "stopped";
}

/** The brain icon in the Area card header: dim without a brain, stateful with one. */
function deskBrainButton(areaPath) {
  const brain = brainForAreaCard(areaPath);
  const kind = brainKind(brain);
  const open = state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === areaPath;
  const title = !brain
    ? "Start a brain for this Area"
    : brain.live
      ? `Open the brain (generation ${brain.generation}, ${brainStateLabel(brain).toLowerCase()})`
      : `${brainStateLabel(brain)} after generation ${brain.generation}: resume or start over`;
  return `<button class="area-brain ${kind}${open ? " open" : ""}" type="button" data-launch-for="${BRAIN_LAUNCH_TARGET}" data-brain-area="${escapeHtml(areaPath)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-expanded="${open}"><span aria-hidden="true">🧠</span></button>`;
}

/** Opens the brain's terminal in the same view as a describe-work agent. */
function openBrainSession(name) {
  const session = brainSessions().find((item) => item.name === name);
  if (!session) return showToast("The brain session is not live.");
  state.describeReturn = captureReturnPoint();
  state.describeSessionName = session.name;
  state.document = null;
  saveDescribeSession();
  state.view = "describe-agent";
  state.renderedKey = "";
  paint(true);
}

/** Opens or closes the brain popover for one Area card; a live brain opens its terminal instead. */
function toggleBrainPopover(button) {
  const area = button.dataset.brainArea;
  const brain = brainForAreaCard(area);
  if (brain?.live) return openBrainSession(brain.session);
  if (state.launchTarget === BRAIN_LAUNCH_TARGET && state.brainDraft?.area === area) {
    state.launchTarget = "";
    state.launchAnchor = null;
    return paint(true);
  }
  launchOptionsFor(area);
  state.launch.record = null;
  state.launch.steps = [];
  state.launch.active = 0;
  state.launch.command = "";
  state.launch.editing = false;
  state.launch.instruction = "";
  state.launch.continueFrom = null;
  // Fable plans by default; the picker shows it selected when the registry
  // has it, and the server falls back to the Area default when it does not.
  state.launch.choice = brain?.launch ?? { harness: "claude", model: "fable-5", effort: null };
  state.brainDraft = { area, instruction: brain?.instruction ?? "" };
  const rect = button.getBoundingClientRect();
  state.launchTarget = BRAIN_LAUNCH_TARGET;
  state.launchAnchor = { top: Math.round(rect.bottom + 8), right: Math.round(rect.right) };
  state.launch.open = false;
  return paint(true);
}

/** Starts, resumes, or starts over the brain of the popover's Area. */
async function startBrain({ resume = false } = {}) {
  syncLaunchDraft();
  const area = state.brainDraft?.area;
  const instruction = (state.brainDraft?.instruction ?? "").trim();
  if (!area) return;
  if (!resume && !instruction) return showToast("Tell the brain what this Area should get done.");
  try {
    const result = await post("/api/brains/start", { area, instruction, ...(resume ? {} : launchRequestFields()), resume });
    state.launchTarget = "";
    state.launchAnchor = null;
    state.brainDraft = null;
    await refresh();
    showToast(result.reattached ? "The brain already runs." : resume ? `Brain resumed (generation ${result.generation}).` : "Brain started.");
    openBrainSession(result.session);
  } catch (error) {
    showToast(error.message);
  }
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

/**
 * True when this Area has a brain of its own that has not ended: its work
 * reports to the brain, so Tangent never infers a row for it. Coverage
 * follows the record, not the session, or a brain that stopped for a minute
 * would hand its Area back to the fallback and feed the card twice
 * (design-the-for-you-row-shows-only-direct-asks, Decision 6).
 */
function coveredByBrainRecord(areaPath) {
  const brain = brainForAreaCard(areaPath ?? "");
  return Boolean(brain && (brain.status === "running" || brain.status === "stopped"));
}

/** True when a brain owns this Goal's Area: it is the brain's to raise, not a desk item for Julian. */
function goalCoveredByBrain(goal) {
  return coveredByBrainRecord(goal?.area ?? "");
}

/** True when one stored handoff names the user, and no live brain already covers this Goal's Area. */
function goalNeedsYou(goal) {
  if (!goal || ["done", "dropped", "deferred"].includes(goal.status)) return false;
  if (goalCoveredByBrain(goal)) return false;
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

// Normalizes conversational wording for forgiving local search. The work
// search, the Go to finder, and the tests share one copy (see go-to-core.js).
const normalizedSearchText = goToCore.normalizedSearchText;

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
  const maxElapsedMs = deskMaxElapsedMs(matchingAreaPanels, Date.now());
  return `
    ${matchingAreaPanels.length ? `<section class="area-desk-grid search-area-results" aria-label="Matching Areas">${matchingAreaPanels.map((record, position) => deskAreaPanel(record, position, maxElapsedMs)).join("")}</section>` : ""}
    ${documents.length ? `<section class="work-section"><div class="section-heading"><h2>Documents</h2><span>${documents.length}</span></div><div class="search-result-list">${documents.map(documentSearchCard).join("")}</div></section>` : ""}
    ${goals.length ? workSection("Goals", goals, "", String(goals.length)) : ""}
    ${matchingAreas.length && !matchingAreaPanels.length ? `<section class="work-section"><div class="section-heading"><h2>Areas</h2><span>${matchingAreas.length}</span></div><div class="search-result-list">${matchingAreas.map((area) => `<button class="search-result-card" type="button" data-open-area="${escapeHtml(area.path)}"><span><span class="search-result-kind">Area</span><strong>${escapeHtml(areaLabel(area.path))}</strong><small>${escapeHtml(clip(area.purpose || area.path, 160))}</small></span><span aria-hidden="true">→</span></button>`).join("")}</div></section>` : ""}`;
}

/** Returns one compact, explicit state for an Area on the Work desk. */
function deskAreaState(path, trees, descriptions) {
  const goals = trees.flatMap((tree) => tree.goals).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...descriptions];
  // One list, one number: the Area pill counts the same asks the card shows.
  const waiting = forYouItems().filter((ask) => ask.area === path).length;
  const working = sessions.filter((session) => session.state === "working").length;
  if (waiting) return { kind: "waiting", label: `${waiting} ${waiting === 1 ? "item needs" : "items need"} you` };
  if (working) return { kind: "working", label: `${working} ${working === 1 ? "agent" : "agents"} working` };
  const ready = goals.filter((goal) => !sessionForGoal(goal)).length;
  if (ready) return { kind: "ready", label: `${ready} ${ready === 1 ? "Goal" : "Goals"} ready` };
  return { kind: "quiet", label: "Reference Area" };
}

/**
 * Whether a live session anywhere in a desk panel (its own Area or its
 * nested sections) is presently working, and the latest Goal or Document
 * change across them (recently-worked-areas-sort-to-the-top). Panels order
 * by this: working now first, then most recent activity.
 */
function panelActivity(record) {
  const parts = [
    { trees: record.trees, descriptions: record.descriptions, documents: record.area?.documents ?? [] },
    ...record.sections.map((section) => ({ trees: section.trees, descriptions: section.descriptions, documents: section.area?.documents ?? [] })),
  ];
  let working = false;
  let mtime = 0;
  for (const part of parts) {
    const goals = part.trees.flatMap((tree) => tree.goals);
    const sessions = [...goals.map(sessionForGoal).filter(Boolean), ...part.descriptions];
    if (sessions.some((session) => session.state === "working")) working = true;
    for (const goal of goals) mtime = Math.max(mtime, goal.changedAt ?? goal.mtime ?? 0);
    for (const doc of part.documents) mtime = Math.max(mtime, doc.changedAt ?? doc.mtime ?? 0);
  }
  return { working, mtime };
}

/**
 * Groups the Areas with open work into desk panels, sub-Areas nested inside
 * as sections (design-area-map Decision 1). An Area needs its own Goal
 * trees or a live "Describe work" session to earn a panel or a section this
 * way. An Area with only Documents and no goal-bearing ancestor already on
 * the desk still gets its own flat panel, as before Decision 1: the desk
 * must not go quiet on a subject that has notes but no open Goal yet.
 * Panels order by recent work, not path (recently-worked-areas-sort-to-
 * the-top): an Area with an agent working now first, then most recent
 * Goal or vault activity.
 */
function deskAreas() {
  const trees = filteredGoalTrees(goalTrees().filter((tree) => goalTreeState(tree) !== "closed"));
  const descriptions = state.workFilter === "inactive" ? [] : describeWorkSessions();
  const core = areaMapCore;
  const areaList = areas();
  const byPath = new Map(areaList.map((area) => [area.path, area]));
  /** One Area's own open Goal trees and definition sessions, not its descendants'. */
  const workOf = (path) => ({
    trees: trees.filter((tree) => tree.path === path),
    descriptions: descriptions.filter((session) => session.area === path),
  });
  const openCounts = new Map();
  for (const area of areaList) {
    const { trees: areaTrees, descriptions: areaDescriptions } = workOf(area.path);
    const openGoalCount = areaTrees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
    openCounts.set(area.path, Math.max(openGoalCount, areaDescriptions.length ? 1 : 0));
  }
  const projectedPanels = state.workFilter === "all" ? state.vault?.desk?.panels : null;
  const panelDefs = projectedPanels?.length ? projectedPanels : core.deskPanels(openCounts);
  const covered = new Set(panelDefs.flatMap((panel) => [panel.path, ...panel.sections]));
  const panels = panelDefs.map((panel) => {
    const area = byPath.get(panel.path);
    const own = workOf(panel.path);
    const sections = panel.sections
      .map((path) => ({ area: byPath.get(path), ...workOf(path) }))
      .filter((section) => section.area);
    const programs = state.programs.programs.filter((program) => program.area === panel.path);
    return { area, trees: own.trees, descriptions: own.descriptions, sections, programs };
  }).filter((record) => record.area);
  if (state.workFilter === "all") {
    for (const area of areaList) {
      if (covered.has(area.path)) continue;
      if (!(area.documents ?? []).length) continue;
      if (panels.some((panel) => core.isInside(area.path, panel.area.path))) continue;
      panels.push({ area, trees: [], descriptions: [], sections: [], programs: state.programs.programs.filter((program) => program.area === area.path) });
    }
  }
  return core.orderPanels(panels, panelActivity).map((record, index) => ({ ...record, index }));
}

/**
 * Whether the work on one Goal is over: its pipeline ran every step, or it
 * never had a pipeline and no session is live. Only a finished Goal asks
 * Julian to accept its result; work still running asks nothing by itself.
 */
function goalWorkFinished(goal) {
  const pipeline = pipelineRecordForGoal(goal);
  if (pipeline) return (pipeline.steps ?? []).every((step) => ["complete", "skipped"].includes(step.status));
  return !sessionForGoal(goal);
}

/**
 * What Tangent itself may ask for an Area with no brain of its own: a
 * pipeline step that stopped, a session sitting at a dialog, and a handover
 * that names Julian. Brains are the primary path, so this stays the minimal
 * fallback and grows nothing (design-the-for-you-row-shows-only-direct-asks,
 * Julian's answer 3). Idle, waiting, draft, and shell sessions reach no
 * builder at all, so machine state on its own can never make a row.
 * Describe-work sessions ask even under a brain: they answer to Julian.
 */
function fallbackAsks() {
  const ask = askCore;
  const goalAsks = allGoals().flatMap((goal) => {
    if (["done", "dropped", "deferred"].includes(goal.status)) return [];
    if (coveredByBrainRecord(goal.area)) return [];
    const pipeline = pipelineForGoal(goal);
    const stoppedStep = pipeline?.steps.find((step) => step.status === "stopped" || (step.status === "running" && !step.live));
    if (stoppedStep) return [ask.askFromStoppedStep(goal, stoppedStep)];
    const session = sessionForGoal(goal);
    if (session) {
      const action = { kind: "open-run", label: `Open ${agentName(session)}`, arg: { file: goal.file } };
      return [ask.askFromDialogSession(goal, session, { action })];
    }
    return [ask.askFromWaitingOn(goal, { finished: goalWorkFinished(goal) })];
  });
  const definitionAsks = describeWorkSessions().map((session) => ask.askFromDialogSession(
    null,
    session,
    { action: { kind: "select-definition", label: "Open", arg: { session: session.name } } }
  ));
  return [...goalAsks, ...definitionAsks]
    .filter(Boolean)
    .sort((left, right) => left.area.localeCompare(right.area) || left.subject.localeCompare(right.subject));
}

let dockBadgeCount = null;

/** Keeps the installed Safari web app's Dock badge equal to the For you count. */
async function syncDockBadge() {
  const count = forYouItems().length;
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
  showToast("The Dock badge now follows For you. No notification banners are sent.");
}

/**
 * The brain-written asks, grouped by Area in brain record order. One group:
 * { area, brain, stopped, asks }. Only a record that has not ended makes a
 * group; an ended brain's rows leave the card with it. A group with no ask
 * is left out, and a stopped brain says nothing about its own state: Julian
 * associates a brain with its Area and finds it there (Julian's answer 4).
 */
function askGroups() {
  const ask = askCore;
  return (state.brains ?? [])
    .filter((brain) => brain.status === "running" || brain.status === "stopped")
    .map((brain) => {
      const rows = (brain.forJulian ?? [])
        .filter((row) => !state.verdictLines.has(row.line))
        .map((row) => ask.askFromPlanRow(brain, row));
      // A brain stuck at its own dialog cannot write a plan line about being
      // stuck, so Tangent asks for it.
      const asks = [ask.askFromBrainDialog(brain), ...rows].filter(Boolean);
      return { area: brain.area, brain, stopped: !brain.live, asks };
    })
    .filter((group) => group.asks.length);
}

/** Every ask Tangent shows Julian: what the brains wrote, then the fallback. One list, one number. */
function forYouItems() {
  return [...askGroups().flatMap((group) => group.asks), ...fallbackAsks()];
}

/**
 * The brain-written For-you rows that belong on one Area's own panel: its
 * own brain's asks, and any brain's asks in a sub-Area. Empty when the Area
 * has no brain of its own, so a plain Area panel stays as it is today
 * (design-what-needs-julian-under-brains, goal-decisions-show-on-the-area-
 * view-not-just-a-count).
 */
function areaForYouGroups(areaPath) {
  if (!coveredByBrainRecord(areaPath)) return [];
  const core = areaMapCore;
  return askGroups().filter((group) => core.isInside(group.area, areaPath));
}

/** The verbs that open something; the first one a row carries is its main button. */
const ASK_PRIMARY_ACTIONS = ["open-document", "open-brain", "open-run", "reveal-goal", "select-definition", "answer"];

/** Carries one action's verb and its argument to the click delegation. */
function askActionAttributes(ask, action) {
  const arg = action.arg ?? {};
  if (action.kind === "open-document") return `data-open-document="${escapeHtml(arg.file ?? "")}"`;
  if (action.kind === "open-brain") return `data-open-brain="${escapeHtml(arg.session ?? "")}"`;
  if (action.kind === "open-run") return `data-open-goal-run="${escapeHtml(arg.file ?? "")}"`;
  if (action.kind === "reveal-goal") return `data-reveal-goal="${escapeHtml(arg.file ?? "")}"`;
  if (action.kind === "select-definition") return `data-select-work-definition="${escapeHtml(arg.session ?? "")}"`;
  if (action.kind === "answer" || action.kind === "reply") {
    return `data-reply-area="${escapeHtml(arg.area ?? ask.area)}" data-reply-session="${escapeHtml(arg.session ?? "")}" data-reply-subject="${escapeHtml(arg.subject ?? ask.subject)}"`;
  }
  return `data-verdict-area="${escapeHtml(arg.area ?? ask.area)}" data-verdict-line="${escapeHtml(arg.line ?? "")}" data-verdict="${escapeHtml(action.kind)}"`;
}

/**
 * One ask, whoever built it: who it is about, the facts under the name, and
 * the question on a line of its own, because the question is the only part
 * Julian must read. The first opening verb becomes the row's main button;
 * the answering verbs sit beside it. There is one renderer, so nothing that
 * is not an ask can be drawn here.
 */
function askRow(ask) {
  const text = `<span><strong>${escapeHtml(ask.subject)}</strong>${ask.detail ? `<small>${escapeHtml(ask.detail)}</small>` : ""}<span class="attention-question">${escapeHtml(ask.question)}</span></span>`;
  const primary = ask.actions.find((action) => ASK_PRIMARY_ACTIONS.includes(action.kind));
  const rest = ask.actions.filter((action) => action !== primary);
  const buttons = rest.length
    ? `<span class="attention-row-actions">${rest.map((action) => `<button class="attention-tried${action.kind === "reply" ? " attention-reply" : ""}" type="button" ${askActionAttributes(ask, action)}>${escapeHtml(action.label)}</button>`).join("")}</span>`
    : "";
  const head = primary
    ? `<button type="button" ${askActionAttributes(ask, primary)}>${text}<span>${escapeHtml(primary.label)} <b aria-hidden="true">→</b></span></button>`
    : text;
  return `<div class="attention-row">${head}${buttons}</div>`;
}

/**
 * One group's markup inside a For-you list: its header (Area label or "For
 * you", plus the one way to reach the brain) and its asks. A stopped brain's
 * asks stay standing; the header says it stopped and offers Resume.
 */
function forYouGroupMarkup(group, label) {
  const reach = group.brain.live
    ? `<button class="attention-tried" type="button" data-open-brain="${escapeHtml(group.brain.session ?? "")}">Reply to brain</button>`
    : `<span class="for-you-stopped">Brain stopped</span><button class="attention-tried" type="button" data-launch-for="${BRAIN_LAUNCH_TARGET}" data-brain-area="${escapeHtml(group.area)}">Resume</button>`;
  return `
    <div class="for-you-group${group.stopped ? " stopped" : ""}">
      <header><span>${escapeHtml(label)}</span>${reach}</header>
      <div class="attention-items">${group.asks.map(askRow).join("")}</div>
    </div>`;
}

/** The fallback asks grouped by Area, so every row says which Area it is from. */
function fallbackAskGroups(asks) {
  const byArea = new Map();
  for (const ask of asks) byArea.set(ask.area, [...(byArea.get(ask.area) ?? []), ask]);
  return [...byArea].map(([area, items]) => ({ area, asks: items }));
}

/**
 * The For-you rows on one Area's own panel, directly under its brain line:
 * Julian decides what the brain is asking without leaving the Area he is
 * looking at (design-what-needs-julian-under-brains, goal-decisions-show-
 * on-the-area-view-not-just-a-count). Empty when the Area has no brain of
 * its own; the panel then stays as it was before this Goal.
 */
function areaForYouSection(areaPath) {
  const groups = areaForYouGroups(areaPath);
  if (!groups.length) return "";
  const markup = groups.map((group) => forYouGroupMarkup(group, group.area === areaPath ? "For you" : areaLabel(group.area))).join("");
  return `<div class="area-for-you">${markup}</div>`;
}

/**
 * The For you card: what the brains asked, then what Tangent itself asks for
 * the Areas with no brain. Every row is a direct ask, and the number in the
 * header is the length of that one list.
 */
function deskAttentionQueue() {
  const groups = askGroups();
  const fallback = fallbackAsks();
  const count = groups.reduce((total, group) => total + group.asks.length, 0) + fallback.length;
  if (!count) return "";
  const enableBadge = typeof navigator.setAppBadge === "function"
    && window.__agentShellNativeDockBadge !== true
    && typeof Notification !== "undefined"
    && Notification.permission !== "granted";
  const groupMarkup = groups.map((group) => forYouGroupMarkup(group, areaLabel(group.area))).join("");
  const fallbackMarkup = fallbackAskGroups(fallback)
    .map((group) => `<div class="for-you-group fallback"><header><span>${escapeHtml(areaLabel(group.area))} · no brain</span></header><div class="attention-items">${group.asks.map(askRow).join("")}</div></div>`)
    .join("");
  return `
    <section class="attention-queue" aria-labelledby="attention-heading">
      <header><p class="kicker">Attention</p><h2 id="attention-heading">For you</h2>${enableBadge ? `<button class="attention-badge-button" type="button" data-enable-dock-badge>Show in Dock</button>` : ""}<span>${count}</span></header>
      ${groupMarkup}${fallbackMarkup}
    </section>`;
}

/**
 * Drops from `state.verdictLines` every line the server no longer lists, once
 * the plan commit has landed. A line is hidden only while its press is in
 * flight; a line the brain writes again later is shown again.
 */
function forgetVerdictLines() {
  if (!state.verdictLines.size) return;
  const listed = new Set((state.brains ?? []).flatMap((brain) => (brain.forJulian ?? []).map((row) => row.line)));
  for (const line of [...state.verdictLines]) if (!listed.has(line)) state.verdictLines.delete(line);
}

/**
 * Julian answered one row with Accept or Reject: the row goes now and the
 * plan follows, and the brain hears the verdict either way. An Undo puts the
 * line back and withdraws the verdict, so a mis-press costs one click and
 * never leaves the brain acting on an answer Julian took back.
 */
async function sendVerdict(area, line, verdict) {
  state.verdictLines.add(line);
  paint(true);
  try {
    const result = await post("/api/brains/verdict", { area, line, verdict });
    /** Puts the line (and any continuation line it left with) back, and tells the brain the verdict is off. */
    const undo = async () => {
      try {
        await post("/api/brains/verdict/undo", { area, line: result.removedText ?? line, index: result.index });
        state.verdictLines.delete(line);
        await refresh();
        paint(true);
      } catch (error) {
        showToast(error.message);
      }
    };
    showToast(verdict === "accept" ? "Accepted. The brain was told." : "Rejected. The brain parks it.", { label: "Undo", run: undo });
  } catch (error) {
    state.verdictLines.delete(line);
    paint(true);
    showToast(error.message);
  }
}

/**
 * Julian pressed `Reply`, or `Answer` on a question the brain asked with no
 * Document: tells the brain the row's subject, then opens its terminal, so
 * whatever he types next carries that context. Opens the terminal even when
 * the notice fails to send; the reply matters more.
 */
async function replyAboutRow(area, session, subject) {
  try {
    await post("/api/brains/reply", { area, subject });
  } catch (error) {
    showToast(error.message);
  }
  openBrainSession(session);
}

/**
 * The desk fill label ("310k"), shown only once a session's carried context
 * reaches the handover threshold; below it the row shows nothing
 * (design-worker-context-handover D7, principle 3).
 */
function deskFillLabel(context) {
  if (!context || !state.contextHandoverTokens) return "";
  if (context.usedTokens < state.contextHandoverTokens) return "";
  return `${Math.round(context.usedTokens / 1000)}k`;
}

/**
 * The state pill and the primary action of one Goal. The pill is one word:
 * the facts line under the title carries the duration, and the card keeps no
 * prose (design-goal-cards Decision 4).
 */
function deskGoalAction(goal) {
  const line = { stepLine: "", stepTitle: "", fill: "" };
  if (["done", "dropped", "deferred"].includes(goal.status)) {
    return { ...line, state: goal.status === "done" ? "Complete" : humanName(goal.status), action: "", kind: "complete", route: "" };
  }
  const session = sessionForGoal(goal);
  line.fill = deskFillLabel(session?.context);
  // Under a live brain a static pane waits for the brain, not for Julian: the
  // state stays as a fact, without the amber that means "you".
  const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
  if (!session) return { ...line, state: goalNeedsYou(goal) ? "Waiting" : "Ready", action: "Start agent", kind: goalNeedsYou(goal) ? idle : "ready", route: "run" };
  if (session.state === "working") return { ...line, state: "Working", action: `Open ${agentName(session)}`, kind: "working", route: "run" };
  if (session.state === "waiting") return { ...line, state: "Waiting", action: `Open ${agentName(session)}`, kind: idle, route: "run" };
  if (session.state === "shell") return { ...line, state: "Stopped", action: "Open session", kind: idle, route: "run" };
  return { ...line, state: "Ready", action: "Open agent", kind: "ready", route: "run" };
}

/** The idle time (ms) after which an idle step is offered "Send to next". */
const PIPELINE_SEND_AFTER_MS = 60_000;

/**
 * The pipeline row's state pill, primary action, and the small `Step N of M`
 * line above the pill. The step's agent and instruction stay in that line's
 * hover title: Julian reads the step in the launch popover, not on the card.
 */
function deskPipelineAction(goal, pipeline) {
  const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped") ?? pipeline.steps.find((item) => item.status === "pending");
  if (!step) return deskGoalAction(goal);
  const line = { stepLine: `Step ${step.index} of ${pipeline.steps.length}`, stepTitle: `${step.label || "agent"}: ${step.instruction ?? ""}`, fill: deskFillLabel(step.context) };
  const idle = goalCoveredByBrain(goal) ? "fact" : "waiting";
  if (step.status === "stopped" || (step.status === "running" && !step.live)) return { ...line, state: "Stopped", action: "", kind: idle, route: "" };
  if (step.status === "pending") return { ...line, state: "Not started", action: "", kind: idle, route: "" };
  if (step.state === "working") return { ...line, state: "Working", action: `Open step ${step.index}`, kind: "working", route: "run" };
  if (step.state === "waiting") return { ...line, state: "Waiting", action: `Open step ${step.index}`, kind: idle, route: "run" };
  if (step.state === "shell") return { ...line, state: "Stopped", action: `Open step ${step.index}`, kind: idle, route: "run" };
  return { ...line, state: "Ready", action: `Open step ${step.index}`, kind: "ready", route: "run" };
}

/** Restart, Skip, Stop work, and Send-to-next, only when they apply. */
function deskPipelineControls(goal, pipeline) {
  const step = pipeline.steps.find((item) => item.status === "running" || item.status === "stopped");
  if (!step) return "";
  const last = step.index >= pipeline.steps.length;
  const stopped = step.status === "stopped" || (step.status === "running" && !step.live);
  if (stopped) {
    // A step whose session died on its own. Julian's own Stop agent already
    // ends the run, so Stop work here is the same exit for a crashed step.
    return `<button class="desk-action" type="button" data-pipeline-control="restart" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Restart step ${step.index}</button>`
      + (last ? "" : `<button class="desk-action" type="button" data-pipeline-control="skip" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}">Skip to step ${step.index + 1}</button>`)
      + `<button class="desk-action" type="button" data-pipeline-control="end" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="End the run; the Goal stays open with its handovers">Stop work</button>`;
  }
  const idleLong = step.state === "waiting" && (step.stateDetail === "idle" || step.stateDetail === null) && step.idleSince && Date.now() - step.idleSince >= PIPELINE_SEND_AFTER_MS;
  if (idleLong && !last) {
    return `<button class="desk-action" type="button" data-pipeline-control="send" data-pipeline-goal="${escapeHtml(goal.file)}" data-pipeline-step="${step.index}" title="Use the agent's last message as its handover">Send to step ${step.index + 1}</button>`;
  }
  return "";
}

/**
 * The Goal's facts (pure, from the vault git log, live sessions, and the
 * pipeline record) plus the clock they were read at, computed once per row
 * so the bar and the agent-count fact stay in step (design-compact-work-desk).
 */
function deskGoalFactsData(goal) {
  const core = goalCardCore;
  const now = Date.now();
  const sessions = sessionsForGoal(goal);
  const facts = core ? core.goalCardFacts({ goal, sessions, pipeline: pipelineRecordForGoal(goal), now, handoffNeedsYou: goalNeedsYou(goal) }) : null;
  const names = [...new Set([...(goal.agents ?? []), ...sessions.map((session) => session.name)])];
  return { facts, names, now };
}

/**
 * The agent-count fact, the only text fact left on the card: how long the
 * Goal runs or waits is now the bar (design-compact-work-desk).
 */
function deskGoalFacts(facts, names, now) {
  const core = goalCardCore;
  if (!core || !facts) return "";
  const segment = core.factsSegments(facts, now, names).find((item) => item.kind === "agents");
  if (!segment) return "";
  return `<span class="desk-goal-facts"><span title="${escapeHtml(segment.title)}">${escapeHtml(segment.text)}</span></span>`;
}

/**
 * The elapsed-time text beside the bar: the same total the bar's length
 * encodes (deskGoalBar, elapsedLengthShare), printed compact so Julian reads
 * the actual age without a hover (Julian's word 2026-08-22: the redesign
 * that moved this text to the hover only took it too far).
 */
function deskGoalElapsed(facts, now) {
  const core = goalCardCore;
  if (!core || !facts) return "";
  const label = core.elapsedLabel(facts, now);
  if (!label) return "";
  const title = facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "";
  return `<span class="desk-goal-elapsed" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

/**
 * The bar: its drawn length encodes total elapsed time relative to the
 * longest-elapsed Goal on the desk right now, on a sqrt curve (Decision 2,
 * Julian's word 2026-08-20: a bar that was always full made every running
 * Goal look identical). Within that length, worked time (blue) splits from
 * the current wait (amber, or gray under a live brain: it waits for the
 * brain, not for Julian) at the start of the wait, the only split the
 * records can answer (Decision 1). The hover title carries the exact words
 * and the start time; a Goal nobody has started draws no bar.
 */
function deskGoalBar(goal, facts, now, maxElapsedMs) {
  const core = goalCardCore;
  if (!core || !facts) return "";
  const shares = core.factsBarShares(facts, now, { waitsForBrain: goalCoveredByBrain(goal) });
  if (!shares) return "";
  const lengthShare = core.elapsedLengthShare(now - facts.startedAt, maxElapsedMs);
  const words = core.factsSegments(facts, now).filter((segment) => segment.kind !== "agents").map((segment) => segment.text).join(" · ");
  const started = facts.startedAt ? `Started ${new Date(facts.startedAt).toLocaleString()}` : "";
  const title = [words, started].filter(Boolean).join("\n");
  return `<span class="desk-goal-bar" title="${escapeHtml(title)}" role="img" aria-label="${escapeHtml(words || "no agent yet")}">
    <i class="desk-goal-bar-worked" style="width:${(shares.workedShare * lengthShare * 100).toFixed(2)}%"></i>
    ${facts.waiting ? `<i class="desk-goal-bar-wait ${shares.waitKind}" style="width:${(shares.waitShare * lengthShare * 100).toFixed(2)}%"></i>` : ""}
  </span>`;
}

/**
 * The longest elapsed time (first start to now) among every Goal this paint
 * of the desk will draw a bar for, so every bar's length can be scaled to it
 * (deskGoalBar, Decision 2). Walks the same records, sections, and trees the
 * desk renders from; a Goal outside this pass (a different filter, a
 * collapsed section) is not part of the scale it did not draw into.
 */
function deskMaxElapsedMs(records, now) {
  let max = 0;
  /** Folds every started Goal of one list of Goal trees into the max. */
  const scanTrees = (trees) => {
    for (const tree of trees ?? []) {
      for (const goal of tree.goals ?? []) {
        const startedAt = deskGoalFactsData(goal).facts?.startedAt;
        if (startedAt) max = Math.max(max, now - startedAt);
      }
    }
  };
  for (const record of records ?? []) {
    scanTrees(record.trees);
    for (const section of record.sections ?? []) scanTrees(section.trees);
  }
  return max;
}

/**
 * The fixed `End · Won't do · Done` row. Every action stays visible and in
 * the same place: one that does not apply is disabled, never removed, so
 * Done never moves under the cursor (design-goal-cards Decision 4).
 */
function deskGoalSecondaryActions(goal, liveSession) {
  const open = !["done", "dropped", "deferred"].includes(goal.status);
  const buttons = [
    liveSession
      ? `<button class="desk-icon-action" type="button" data-stop-goal="${escapeHtml(goal.file)}" aria-label="End the agent run for ${escapeHtml(goal.title)}">End</button>`
      : `<button class="desk-icon-action" type="button" disabled title="No live agent to end">End</button>`,
    open
      ? `<button class="desk-icon-action" type="button" data-wont-do-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} won't do">Won't do</button>`
      : `<button class="desk-icon-action" type="button" disabled title="This Goal is closed">Won't do</button>`,
    open
      ? `<button class="desk-icon-action complete" type="button" data-complete-goal="${escapeHtml(goal.file)}" aria-label="Mark ${escapeHtml(goal.title)} complete">Done</button>`
      : `<button class="desk-icon-action complete" type="button" disabled title="This Goal is closed">Done</button>`,
  ];
  return `<span class="desk-secondary-actions">${buttons.join(`<i aria-hidden="true">·</i>`)}</span>`;
}

/**
 * Renders one Goal as a compact two-line card: title with step and status
 * on line one, the bar with the agent count and the actions on line two,
 * pipeline controls on a rare third line (design-compact-work-desk
 * Decision 3). The kicker and the Documents chip are gone; a Subgoal reads
 * from its indent and smaller title under the `To do that` disclosure.
 */
function deskGoalRow(goal, { subgoal = false, maxElapsedMs = 0 } = {}) {
  const pipeline = pipelineForGoal(goal);
  const record = pipelineRecordForGoal(goal);
  const action = pipeline ? deskPipelineAction(goal, pipeline) : deskGoalAction(goal);
  const liveSession = sessionForGoal(goal);
  const launchTitle = record ? "Add or edit steps" : "Choose agent or model";
  /** The ▾ that opens this Goal's launch popover: agent choice, or the step list once a pipeline exists. */
  const launchToggle = (label) => `<button class="desk-action desk-launch-toggle${state.launchTarget === goal.file ? " open" : ""}" type="button" data-launch-for="${escapeHtml(goal.file)}" title="${launchTitle}" aria-label="${launchTitle} for ${escapeHtml(goal.title)}" aria-expanded="${state.launchTarget === goal.file}">${label}</button>`;
  const route = `data-open-goal-run="${escapeHtml(goal.file)}"`;
  const controls = pipeline ? deskPipelineControls(goal, pipeline) : "";
  const selectable = action.action === "Start agent";
  const selected = selectable && state.goalSelection.includes(goal.file);
  const { facts, names, now } = deskGoalFactsData(goal);
  return `
    <article class="desk-goal ${subgoal ? "subgoal" : "root-goal"} ${action.kind}${selected ? " selected" : ""}" data-goal-anchor="${escapeHtml(goal.file)}">
      ${selectable ? `<label class="desk-select" title="Select for one shared agent"><input type="checkbox" data-check-goal="${escapeHtml(goal.file)}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(goal.title)} for one shared agent"></label>` : ""}
      <div class="desk-goal-main">
        <div class="desk-goal-line1">
          <strong title="${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</strong>
          <span class="desk-goal-status">
            ${action.stepLine ? `<small class="desk-step-line" title="${escapeHtml(action.stepTitle)}">${escapeHtml(action.stepLine)}</small><i aria-hidden="true">·</i>` : ""}
            ${action.fill ? `<small class="desk-fill" title="Carried context">${escapeHtml(action.fill)}</small><i aria-hidden="true">·</i>` : ""}
            <span class="desk-state ${action.kind}">${escapeHtml(action.state)}</span>
          </span>
        </div>
        <div class="desk-goal-line2">
          <span class="desk-goal-bar-group">
            ${deskGoalBar(goal, facts, now, maxElapsedMs)}
            ${deskGoalElapsed(facts, now)}
            ${deskGoalFacts(facts, names, now)}
          </span>
          <span class="desk-goal-actions">
            ${action.action === "Start agent"
              ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>Start agent</button>${launchToggle("▾")}</span>`
              : action.action
                ? (record ? `<span class="desk-split"><button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>${launchToggle("▾")}</span>` : `<button class="desk-action" type="button" ${route}>${escapeHtml(action.action)}</button>`)
                : record ? launchToggle("Steps ▾") : ""}
            ${deskGoalSecondaryActions(goal, liveSession)}
          </span>
        </div>
        ${controls ? `<div class="desk-goal-line3"><span class="desk-pipeline-controls">${controls}</span></div>` : ""}
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
function deskGoalGroup(tree, maxElapsedMs = 0) {
  const subgoals = tree.goals.slice(1).filter((goal) => !["done", "dropped", "deferred"].includes(goal.status));
  const expanded = subgoals.some((goal) => sessionForGoal(goal) || goalNeedsYou(goal));
  return `
    <section class="desk-goal-group">
      ${deskGoalRow(tree.root, { maxElapsedMs })}
      ${subgoals.length ? `<details class="desk-subgoal-disclosure" ${expanded ? "open" : ""}><summary><span>To do that</span><small>${subgoals.length} ${subgoals.length === 1 ? "Subgoal" : "Subgoals"}</small></summary><div class="desk-subgoals">${subgoals.map((goal) => deskGoalRow(goal, { subgoal: true, maxElapsedMs })).join("")}</div></details>` : ""}
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

/** Renders the Programs of one Area as a compact operational shelf. */
function deskProgramShelf(programs) {
  return `<div class="desk-programs">${programs.map((program) => {
    const control = programRowControl(program);
    return `
      <div class="desk-program ${programIsLive(program) ? "live" : ""}">
        <button type="button" data-select-program="${escapeHtml(program.id)}">
          <span aria-hidden="true">${program.type === "process" ? "SERVER" : program.type === "command" ? "COMMAND" : "AGENT"}</span>
          <strong>${escapeHtml(program.label)}</strong>
          <em>${escapeHtml(programState(program))}</em>
        </button>
        ${control ? `<button class="desk-icon-action" type="button" data-program-action="${control.action}" data-program-id="${escapeHtml(program.id)}" aria-label="${escapeHtml(control.label)} ${escapeHtml(program.label)}">${escapeHtml(control.label)}</button>` : ""}
      </div>`;
  }).join("")}</div>`;
}

/** Renders one stable Area landmark with work and knowledge together. */
function deskAreaPanel(record, position, maxElapsedMs = 0) {
  const { area, trees, descriptions, sections, programs } = record;
  const status = deskAreaState(area.path, trees, descriptions);
  const parentPath = area.path.split("/").slice(0, -1).join("/");
  const parent = areaParts(area.path).slice(0, -1).join(" / ") || "Top level";
  const openGoalCount = trees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
  const goalSectionTitle = state.workFilter === "all" ? "Goal work" : `${humanName(state.workFilter)} work`;
  return `
    <article class="area-desk-panel ${status.kind}" data-desk-area="${escapeHtml(area.path)}" style="--desk-order:${position}">
      <header class="area-desk-header">
        <span class="area-desk-index" aria-hidden="true">${String(position + 1).padStart(2, "0")}</span>
        <div>${parentPath ? `<small>${areaPath(parentPath)}</small>` : `<small>${escapeHtml(parent)}</small>`}<h2><button type="button" data-open-area="${escapeHtml(area.path)}" title="Open the ${escapeHtml(humanName(area.name))} Area map">${escapeHtml(humanName(area.name))}</button></h2></div>
        <span class="area-desk-state ${status.kind}">${escapeHtml(status.label)}</span>
        <button class="area-desk-what-happened" type="button" data-what-happened-for="${escapeHtml(area.path)}" aria-haspopup="dialog" aria-expanded="${state.whatHappened?.area === area.path}">What happened</button>
        ${deskBrainButton(area.path)}
      </header>
      ${areaForYouSection(area.path)}
      <div class="area-desk-body">
        ${descriptions.length ? `<section class="area-desk-section definitions"><div class="area-desk-section-heading"><h3>Dispatches</h3><span>${descriptions.length}</span></div>${descriptions.map(deskDefinitionRow).join("")}</section>` : ""}
        <section class="area-desk-section goals">
          <div class="area-desk-section-heading"><h3>${goalSectionTitle}</h3><span>${openGoalCount}</span>${deskSelectionBar(area.path, trees)}</div>
          ${trees.length ? orderedGoalTrees(trees).map((tree) => deskGoalGroup(tree, maxElapsedMs)).join("") : `<p class="desk-empty">No active Goals.</p>`}
        </section>
        ${sections.map((section) => deskAreaSection(section, maxElapsedMs)).join("")}
        ${programs.length ? `<section class="area-desk-section programs">
          <div class="area-desk-section-heading"><h3>Programs</h3><span>${programs.length}</span></div>
          ${deskProgramShelf(programs)}
        </section>` : ""}
      </div>
      <footer class="area-desk-actions">
        <button type="button" data-describe-area="${escapeHtml(area.path)}">Describe work here</button>
        <button type="button" data-open-area="${escapeHtml(area.path)}">Organize Area</button>
      </footer>
    </article>`;
}

/**
 * Renders one descendant Area with open work as an indented, collapsible
 * section of its ancestor's desk panel (design-area-map Decision 1). The
 * state pill stays visible even collapsed, so a live agent below cannot
 * hide behind a closed section.
 */
function deskAreaSection(section, maxElapsedMs = 0) {
  const { area, trees, descriptions } = section;
  const status = deskAreaState(area.path, trees, descriptions);
  const openGoalCount = trees.reduce((count, tree) => count + tree.goals.filter((goal) => !["done", "dropped", "deferred"].includes(goal.status)).length, 0);
  const expanded = !state.collapsedDeskSections.has(area.path);
  return `
    <section class="area-desk-section desk-subarea ${status.kind}${expanded ? "" : " collapsed"}">
      <div class="desk-subarea-head">
        <button class="desk-subarea-toggle" type="button" data-toggle-desk-section="${escapeHtml(area.path)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(humanName(area.name))}">
          <span class="desk-subarea-caret" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
          <strong>${escapeHtml(humanName(area.name))}</strong>
          <span class="desk-subarea-count">${openGoalCount} ${openGoalCount === 1 ? "Goal" : "Goals"}</span>
          <span class="desk-subarea-state desk-state ${status.kind}">${escapeHtml(status.label)}</span>
        </button>
        <button class="desk-subarea-open" type="button" data-open-area="${escapeHtml(area.path)}" title="Open the ${escapeHtml(humanName(area.name))} Area map" aria-label="Open the ${escapeHtml(humanName(area.name))} Area map">Map ↗</button>
      </div>
      ${expanded ? `
        <div class="desk-subarea-body">
          ${descriptions.length ? descriptions.map(deskDefinitionRow).join("") : ""}
          ${trees.length ? orderedGoalTrees(trees).map((tree) => deskGoalGroup(tree, maxElapsedMs)).join("") : ""}
        </div>` : ""}
    </section>`;
}

/** Renders the complete area-first work desk. */
function renderWork() {
  const query = state.query.trim();
  let content;
  if (query) {
    content = searchResults(query);
  } else {
    const records = deskAreas();
    const maxElapsedMs = deskMaxElapsedMs(records, Date.now());
    content = `${state.workFilter === "all" ? deskAttentionQueue() : ""}${records.length
      ? `<section class="area-desk-grid" aria-label="Work by Area">${records.map((record, position) => deskAreaPanel(record, position, maxElapsedMs)).join("")}</section>`
      : `<div class="empty-state">No ${state.workFilter === "all" ? "active Areas contain Goals or Documents" : `${state.workFilter} work`}.</div>`}`;
  }

  return `
    <section class="work-page">
      <div class="work-tools">
        <label class="search-field">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="work-search" type="search" value="${escapeHtml(state.query)}" placeholder="Find a Goal, Document, or Area" autocomplete="off" />
          ${shortcutKbd("findWork")}
        </label>
        <div class="work-filter" role="group" aria-label="Filter work by live session">
          ${["all", "active", "inactive"].map((filter) => `<button type="button" data-work-filter="${filter}" aria-pressed="${state.workFilter === filter}">${humanName(filter)}</button>`).join("")}
        </div>
      </div>
      ${content}
      ${launchPopover()}
      ${whatHappenedOverlay()}
    </section>
  `;
}

/**
 * The What happened look: one Area's closed work in the last 12 hours,
 * anchored at the panel header that opened it (design-done-goals-timeline).
 * The desk under it never moves; the poll can still add a new close at the
 * top while it is open.
 */
function whatHappenedOverlay() {
  if (!state.whatHappened) return "";
  const { area, anchor } = state.whatHappened;
  const width = Math.min(560, window.innerWidth - 32);
  const left = Math.max(16, anchor.right - width);
  const style = `top:${anchor.top}px;left:${left}px;width:${width}px;max-height:calc(100vh - ${anchor.top + 16}px)`;
  const label = `What happened in ${areaLabel(area)} in the last 12 hours`;
  if (!state.vault) {
    return `
      <div class="what-happened" data-what-happened role="dialog" aria-label="${escapeHtml(label)}" style="${style}">
        <header class="what-happened-header"><strong>What happened · last 12 hours</strong><small>esc</small></header>
        <p class="what-happened-empty">Loading the vault…</p>
      </div>`;
  }
  const core = whatHappenedCore;
  const now = Date.now();
  const closes = core.windowCloses(core.areaCloses(state.vault.recentCloses ?? [], area, areaMapCore.isInside), now);
  const timezoneOffset = new Date().getTimezoneOffset();
  const body = closes.length
    ? closes.map((close) => whatHappenedRow(close, area, now, timezoneOffset)).join("")
    : `<p class="what-happened-empty">Nothing was marked done or won't do in the last 12 hours.</p>`;
  return `
    <div class="what-happened" data-what-happened role="dialog" aria-label="${escapeHtml(label)}" style="${style}">
      <header class="what-happened-header"><strong>What happened · last 12 hours</strong><small>esc</small></header>
      ${body}
      <button class="what-happened-all" type="button" data-open-area="${escapeHtml(area)}">Everything ever done: Show done on the Area map →</button>
    </div>`;
}

/** One What happened row: time, mark and word, title, closer (design-done-goals-timeline Decision 3). */
function whatHappenedRow(close, panelArea, now, timezoneOffset) {
  const core = whatHappenedCore;
  const goal = goalByFile(close.file);
  const directory = close.file.split("/").slice(0, -1).join("/");
  const foreign = directory !== panelArea ? `<small class="what-happened-area">${escapeHtml(humanName(directory.split("/").pop()))}</small>` : "";
  const title = goal ? goal.title : humanName(close.file.split("/").pop().replace(/^goal-/, "").replace(/\.md$/, ""));
  const hoverTitle = !goal ? "" : close.kind === "done" ? goal.doneWhen : core.wontDoReason(goal.stateText);
  const word = close.kind === "done" ? "done" : "won't do";
  const mark = close.kind === "done" ? "✓" : "✕";
  return `
    <button class="what-happened-row" type="button" data-open-close="${escapeHtml(close.file)}" title="${escapeHtml(hoverTitle)}">
      <span class="what-happened-time">${escapeHtml(core.closeMomentLabel(close.at, now, timezoneOffset))}</span>
      <span class="what-happened-kind ${close.kind}">${mark} ${escapeHtml(word)}</span>
      <span class="what-happened-title">${escapeHtml(title)}${foreign}</span>
      <span class="what-happened-closer">${escapeHtml(core.closerLabel(close.session))}</span>
    </button>`;
}

/** The render key contribution of the What happened look: null closed, else the open Area and its newest windowed close. */
function whatHappenedRenderKey() {
  if (!state.whatHappened) return null;
  const { area, anchor } = state.whatHappened;
  const core = whatHappenedCore;
  const closes = state.vault ? core.windowCloses(core.areaCloses(state.vault.recentCloses ?? [], area, areaMapCore.isInside), Date.now()) : [];
  const first = closes[0] ?? null;
  return [area, anchor.top, anchor.right, first?.file ?? null, first?.at ?? null];
}

/**
 * The agent chooser, anchored at the Start-agent split control that opened
 * it. The choice lives at the point of starting: no page change, and the
 * fast path (plain Start agent) never passes through here.
 */
function launchPopover() {
  if (!state.launchTarget) return "";
  const describing = state.launchTarget === DESCRIBE_LAUNCH_TARGET;
  const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
  const goal = describing || braining ? null : goalByFile(state.launchTarget);
  if (!describing && !braining && !goal) return "";
  if (braining && !state.brainDraft?.area) return "";
  const area = describing ? describeLaunchArea() : braining ? state.brainDraft.area : goal.area;
  launchOptionsFor(area);
  const anchor = state.launchAnchor ?? { top: 120, right: window.innerWidth - 16 };
  const width = Math.min(640, window.innerWidth - 32);
  const left = Math.max(16, anchor.right - width);
  return `
    <div class="launch-popover" data-launch-popover role="dialog" aria-label="Choose agent and model" style="top:${anchor.top}px;left:${left}px;width:${width}px;max-height:calc(100vh - ${anchor.top + 16}px)">
      <header class="launch-popover-header"><small>${escapeHtml(areaLabel(area))}</small><strong>${describing ? "Describe work" : braining ? "Brain" : escapeHtml(goal.title)}</strong></header>
      ${launchPickerBlock()}
    </div>
  `;
}

/** Returns every area in stable path order. */
function areas() {
  return [...(state.vault?.areas ?? [])]
    .filter((area) => area.path && (state.showDoneAreas || !areaIsFolded(area.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** Every Area the vault knows, done ones included. */
function allAreas() {
  return [...(state.vault?.areas ?? [])].filter((area) => area.path);
}

/** True when a done Area folds this path away: itself or an ancestor is done, and it is not the selected Area. */
function areaIsFolded(path) {
  if (path === state.areaSelection) return false;
  const done = new Set(allAreas().filter((area) => area.status === "done").map((area) => area.path));
  const parts = String(path).split("/");
  return parts.some((part, index) => done.has(parts.slice(0, index + 1).join("/")));
}

/** Sets an Area's status on Julian's word and offers Undo. */
async function setAreaStatus(area, status) {
  const result = await api("/api/areas/status", { method: "POST", body: JSON.stringify({ area, status }) }).catch(() => null);
  if (!result || result.error) return showToast(result?.error || "The Area status did not save.");
  await refresh();
  if (status === "done") {
    const kept = result.openGoals ? ` ${result.openGoals} open ${result.openGoals === 1 ? "Goal stays" : "Goals stay"} open and hidden.` : "";
    /** Undo puts the Area back to active. */
    const undo = () => setAreaStatus(area, "active");
    showToast(`${humanName(area.split("/").pop())} is done.${kept}`, { label: "Undo", run: undo });
  } else {
    /** Undo marks the Area done again. */
    const undo = () => setAreaStatus(area, "done");
    showToast(`${humanName(area.split("/").pop())} is active again.`, { label: "Undo", run: undo });
  }
  paint(true);
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
        <button class="area-row ${area.status === "done" ? "done" : ""}" type="button" data-select-area="${escapeHtml(path)}"><span>${escapeHtml(humanName(area.name))}</span><small>${escapeHtml(path)}</small>${area.status === "done" ? `<span class="area-row-mark done">done</span>` : ""}${areaProgramMark(path, expanded)}</button>
      </div>`;
    if (!expanded) return row;
    return row + childPaths.map((child) => branch(child, depth + 1)).join("");
  };
  const doneCount = allAreas().filter((area) => area.status === "done").length;
  const doneToggle = doneCount
    ? `<button class="area-tree-done-toggle" type="button" data-toggle-done-areas aria-pressed="${state.showDoneAreas}">${state.showDoneAreas ? "Hide" : "Show"} ${doneCount} done ${doneCount === 1 ? "Area" : "Areas"}</button>`
    : "";
  return (children.get("") || []).map((root) => branch(root, 0)).join("") + doneToggle;
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

/** The desk's word for one Goal: waiting (needs Julian), working (an agent runs), or ready. */
function goalAttention(goal) {
  const projected = state.vault?.desk?.attention?.[goal.file];
  if (projected) return projected;
  const session = sessionForGoal(goal);
  if (goalNeedsYou(goal) || ["waiting", "shell"].includes(session?.state)) return "waiting";
  if (session) return "working";
  return "ready";
}

/** Desk order of Goal trees by their root's attention, then latest change (design-area-map Decision 2). */
function orderedGoalTrees(trees) {
  const byRoot = new Map(trees.map((tree) => [tree.root.file, tree]));
  return areaMapCore.orderGoals(trees.map((tree) => tree.root), goalAttention).map((root) => byRoot.get(root.file));
}

/** Fetches the stored map state of one Area once; the map mounts again when it arrives. */
function loadMapState(area) {
  if (state.mapStates.has(area)) return;
  state.mapStates.set(area, "loading");
  api(`/api/map-state?area=${encodeURIComponent(area)}`)
    .then((payload) => state.mapStates.set(area, payload?.state ?? {}))
    .catch(() => state.mapStates.set(area, {}))
    .then(() => { const host = [...screen.querySelectorAll("[data-area-map]")].find((element) => element.dataset.areaMap === area); if (host) mountAreaMap(host); });
}

/**
 * Mounts the Area map into its host after a repaint. The map keeps its own
 * DOM, positions, and filters across repaints (see public/area-map.js); this
 * only hands it the current facts and the shell's routes.
 */
function mountAreaMap(host) {
  const view = areaMapView;
  const area = host.dataset.areaMap;
  if (!view || !area || !state.vault) return;
  loadMapState(area);
  const stored = state.mapStates.get(area);
  const selectFile = state.mapSelectFile;
  state.mapSelectFile = "";
  /** The readable name of an Area path. */
  const areaName = (path) => humanName(String(path).split("/").pop());
  /** A short date for the card. */
  const dateLabel = (at) => (at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
  /** The desk word for a Goal record. */
  const attentionOf = (record) => goalAttention(goalByFile(record.file) ?? record);
  /** Opens a Document in the reader. */
  const onOpenDocument = (file) => openDocument(file);
  /** Opens a Goal. */
  const onSelectGoal = (file) => selectGoal(file);
  /** Moves the map to another Area. */
  const onSelectArea = (path) => { state.areaSelection = path; localStorage.setItem("agent-shell.last-area", path); revealArea(path); paint(true); };
  /** Stores positions and filters for this Area outside the vault. */
  const onSaveState = (mapState) => {
    state.mapStates.set(area, mapState);
    api("/api/map-state", { method: "POST", body: JSON.stringify({ area, state: mapState }) }).catch(() => {});
  };
  view.mount(host, {
    scope: area,
    records: state.vault.documents ?? [],
    areaPaths: areas().map((item) => item.path),
    now: Date.now(),
    timezoneOffset: new Date().getTimezoneOffset(),
    areaName, dateLabel, attentionOf,
    mapState: stored === "loading" ? null : stored,
    selectFile,
    onOpenDocument, onSelectGoal, onSelectArea, onSaveState,
  });
}

/** Renders the Area map screen: header, the map host, and the Area's Programs. */
function areaContents(area) {
  const programs = state.programs.programs.filter((program) => program.area === area.path);
  const problems = state.programs.errors.filter((item) => item.area === area.path);
  const done = area.status === "done";
  const current = clip(area.current ?? "", 240);
  return `
    <section class="area-contents area-map-screen ${done ? "area-done" : ""}">
      <header class="area-contents-heading">
        <div>
          ${areaPath(area.path)}
          <h2>${escapeHtml(humanName(area.name))}${area.status ? `<span class="area-status ${escapeHtml(area.status)}">${escapeHtml(area.status)}</span>` : ""}</h2>
          ${area.purpose ? `<p class="area-purpose">${escapeHtml(area.purpose)}</p>` : ""}
          ${current ? `<p class="area-current">${escapeHtml(current)}</p>` : ""}
        </div>
        <div class="area-contents-actions">
          <button class="quiet-button" type="button" data-describe-area="${escapeHtml(area.path)}">Describe work</button>
          <button class="quiet-button" type="button" data-new-area>Add nested Area</button>
          ${area.path.split("/").length > 1 ? `<button class="quiet-button" type="button" data-rename-area>Rename or move</button>` : ""}
          <span class="area-contents-actions-spacer"></span>
          ${done
            ? `<button class="quiet-button" type="button" data-reopen-area="${escapeHtml(area.path)}">Reopen</button>`
            : `<button class="quiet-button" type="button" data-mark-area-done="${escapeHtml(area.path)}">Mark done</button>`}
        </div>
      </header>
      <div class="area-map-host" data-area-map="${escapeHtml(area.path)}"></div>
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
  if (state.launchTarget === DESCRIBE_LAUNCH_TARGET || state.launchTarget === BRAIN_LAUNCH_TARGET) return "";
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
  const braining = state.launchTarget === BRAIN_LAUNCH_TARGET;
  const brain = braining ? brainForAreaCard(state.brainDraft?.area) : null;
  const brainResumes = Boolean(brain && !brain.live);
  const record = state.launch.record;
  const stepCount = describing || braining ? 1 : commitActiveStep().length;
  const drafts = record ? launchDraftRows().length : 0;
  const startLabel = braining
    ? (brainResumes ? "Resume brain" : "Start brain")
    : record
    ? (state.launch.active < record.steps.length ? `Save step ${state.launch.active + 1}` : drafts > 1 ? `Add ${drafts} steps` : `Add step ${record.steps.length + 1}`)
    : stepCount > 1 ? `Start ${stepCount} steps` : `Start ${selection ? (selection.label || "agent") : "agent"}`;
  const canSave = Boolean(state.launch.choice && selection?.harness && !selection?.edited);
  const brainZone = braining ? `
      <label class="brain-instruction"><span>What should this Area get done?</span><textarea id="brain-instruction" rows="5" placeholder="The instruction the brain plans and dispatches from. It splits the work into Goals, starts agents in dependency order, reviews what comes back, and asks you only for real decisions.">${escapeHtml(state.brainDraft?.instruction ?? "")}</textarea></label>
      ${brainResumes ? `<p class="form-note">A brain ran here before (generation ${brain.generation}, ${escapeHtml(brainStateLabel(brain).toLowerCase())}). Resume continues from its plan and handover. Start over begins a new brain from the instruction above.</p>` : ""}` : "";
  const stepZone = describing || braining ? "" : `
      <label class="launch-instruction"><span>Step ${state.launch.active + 1} does</span><textarea id="launch-instruction" rows="2" placeholder="${stepCount > 1 || record ? "What this agent does" : "What this agent does (optional for one step)"}">${escapeHtml(state.launch.instruction ?? "")}</textarea></label>
      ${state.launch.active > 0 ? `<label class="launch-continue"><span>Session</span><select data-launch-continue><option value="">Fresh session</option>${Array.from({ length: state.launch.active }, (_, k) => `<option value="${k + 1}"${state.launch.continueFrom === k + 1 ? " selected" : ""}>Continue step ${k + 1}</option>`).join("")}</select></label>` : ""}`;
  return `
    <div class="launch-picker">
      ${launchStepList()}
      ${brainZone}
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
        ${brainResumes ? `<button class="quiet-button" type="button" data-brain-start-over>Start over</button>` : ""}
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
    : state.launchTarget === BRAIN_LAUNCH_TARGET
      ? state.brainDraft?.area
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
  const items = documentOutlineItems();
  const comments = state.document?.comments ?? [];
  return items.map((heading, index) => {
    const next = items[index + 1]?.line ?? Number.MAX_SAFE_INTEGER;
    const count = comments.filter((comment) => comment.line > heading.line && comment.line < next).length;
    return `<a href="#${escapeHtml(heading.id)}" class="${count ? "has-comments" : ""}" style="--heading-depth:${Math.max(0, heading.level - 2)}" data-document-heading="${escapeHtml(heading.id)}">${escapeHtml(heading.title)}${count ? `<i class="outline-comment-dot" aria-label="${count} comment${count === 1 ? "" : "s"}" title="${count} comment${count === 1 ? "" : "s"}"></i>` : ""}</a>`;
  }).join("");
}

/** The toolbar's comment controls: a red count with next and previous, and one Comment action. */
function documentCommentControls() {
  const count = state.document?.comments?.length ?? 0;
  const nav = count
    ? `<div class="document-comment-nav" role="group" aria-label="Comments">
        <button type="button" data-comment-step="-1" aria-label="Previous comment" title="Previous comment (⌘⌥P)">‹</button>
        <span aria-live="polite">${count} comment${count === 1 ? "" : "s"}</span>
        <button type="button" data-comment-step="1" aria-label="Next comment" title="Next comment (⌘⌥N)">›</button>
      </div>`
    : "";
  return `${nav}<button class="reader-comment-action" type="button" data-comment-new title="Comment on the selected words or this section (⌘⌥M)">Comment <kbd>⌘⌥M</kbd></button>`;
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
        ${documentCommentControls()}
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
      <div class="document-content">${markdownToHtml(state.document.text, { comments: state.document.comments ?? [], composer: state.commentComposer })}</div>
      <p class="document-source">Source: ${escapeHtml(state.document.file)}</p>
    </article>
    <button class="selection-comment-button" type="button" data-comment-new hidden>Comment <kbd>⌘⌥M</kbd></button>`;
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
  terminalSelection = terminalSelectionApi?.preserveTerminalSelection({
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
  // xterm holds one custom key handler. Agent Shell's own key translations
  // come first, then the selection module gets the keys it owns.
  terminal.attachCustomKeyEventHandler((event) => {
    const keys = terminalKeys?.terminalKeySequence(event) ?? "";
    if (!keys) return terminalSelection?.handleKeyEvent(event) ?? true;
    terminalSelection?.noteInput();
    if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(keys);
    event.preventDefault();
    return false;
  });
  terminal.focus();
}

/** Captures vault fields that can change a visible list or search result. */
function vaultRenderProjection() {
  if (!state.vault) return null;
  /** Selects the Goal fields that affect visible rendering. */
  const goalFields = (goal) => [goal.file, goal.title, goal.status, goal.doneWhen, goal.mtime, goal.changedAt, goal.depth, goal.waitingOn, goal.storyText, goal.searchText, goal.agents, goal.firstStartAt, goal.lastEndAt, (goal.documents ?? []).map((document) => [document.file, document.changedAt])];
  return [
    (state.vault.map ?? []).map((group) => [group.path, (group.goals ?? []).map(goalFields)]),
    (state.vault.areas ?? []).map((area) => [area.path, area.status, area.children, area.purpose, area.body, (area.goals ?? []).map(goalFields), (area.documents ?? []).map((document) => [document.file, document.title, document.mtime, document.changedAt])]),
    (state.vault.documents ?? []).map((document) => [document.file, document.title, document.mtime, document.hash, document.docKind, document.changedAt, document.inDegree, document.searchText, document.goalHistory]),
  ];
}

/** Computes the minimal state key that requires a fresh render. */
function renderKey() {
  const goal = currentGoal();
  const session = sessionForGoal(goal);
  if (state.view === "document") {
    return JSON.stringify([state.view, state.document?.file, state.document?.hash, state.documentTrailIndex, state.documentTrail.length, commentComposerKey()]);
  }
  if (state.view === "agent") {
    return JSON.stringify([state.view, goal?.file, session?.name, state.agentReturnView, state.document?.hash]);
  }
  if (state.view === "describe-agent") {
    const describeSession = describeWorkSession();
    return JSON.stringify([state.view, describeSession?.name, state.describeReturn?.state.view, state.document?.hash]);
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
    // The card's durations count up, so a repaint is due once a minute even
    // when nothing else changed.
    Math.floor(Date.now() / 60_000),
    state.areaEdit,
    state.programId,
    state.programDraft,
    state.programs.programs.map((item) => [item.id, item.paused, item.lastRunAt, item.nextRunAt, item.session?.state]),
    vaultRenderProjection(),
    goal ? [goal.file, goal.status, goal.mtime, goal.stateText, goal.currentBrief, goal.storyText, goal.why, goal.subgoalItems, goal.documents] : null,
    [state.launch.area, state.launch.open, state.launch.editing, state.launch.command, state.launch.choice, state.launch.loading, Boolean(state.launch.options), state.launch.options?.default?.label ?? null, state.launch.options?.default?.command ?? null, state.launch.instruction, state.launch.continueFrom, state.launch.active, state.launch.steps, state.launch.record?.updatedAt ?? null],
    (state.pipelines ?? []).map((item) => [item.goal, item.status, item.updatedAt, item.steps.map((step) => [step.status, step.live, step.state, step.idleSince, step.waitingSince])]),
    (state.brains ?? []).map((item) => [item.area, item.status, item.generation, item.session, item.live, item.state, item.stateDetail, item.stateQuestion, item.updatedAt, (item.forJulian ?? []).map((row) => [row.line, row.commentCount, row.missing, row.goalStatus])]),
    [...state.verdictLines],
    state.brainDraft,
    [state.launchTarget, state.launchAnchor, Boolean(state.harnessDraft)],
    whatHappenedRenderKey(),
    state.sessions.map((item) => [item.name, item.goal, item.kind, item.area, item.state, item.stateDetail, item.stateQuestion, item.phase, item.command, item.created, item.workTitle, item.launchLabel, item.waitingSince]),
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
      ? returnPointLabel(state.describeReturn)
    : isAreaEdit
      ? "Areas"
    : isProgramDetail || isProgramCreate
      ? "Areas"
    : isProgramSession
      ? "Program"
    : state.view === "agent"
        ? state.agentReturnView === "document" && state.document ? "Document" : "Work"
        : state.view === "document"
          ? returnPointLabel(state.documentReturn, { brain: returnsToBrain() })
          : "Agent";
  // The reader is the one view Esc leaves, so its Back button prints the key.
  if (state.view === "document") backButton.innerHTML = `${escapeHtml(backButton.textContent)} <kbd>esc</kbd>`;
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
  const attentionCount = forYouItems().length;
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
    findButton.innerHTML = `Find work ${shortcutKbd("findWork")}`;
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
    barContext.textContent = session.kind === "brain"
      ? `${areaLabel(session.area)} · Brain · generation ${session.generation ?? "?"} · ${describeWorkStateLabel(session)}`
      : `${areaLabel(session.area)} · Defining work · ${describeWorkStateLabel(session)}`;
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
  restoreScreenScroll(scrollPositions);
  if (state.view === "document") bindDocumentReader();
  const host = screen.querySelector("[data-session]");
  if (host) mountTerminal(host, host.dataset.session);
  const mapHost = screen.querySelector("[data-area-map]");
  if (mapHost) mountAreaMap(mapHost);
}

/** The elements that scroll inside the screen, by a selector stable across repaints. */
const SCREEN_SCROLL_SELECTORS = [".document-reader-scroll", "[data-launch-popover]", "[data-what-happened]"];

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

// ---- Return points ----
// One mechanism for every screen that opens over another: the reader, the
// Describe work form, and the brain terminal. The point holds the state keys
// that identify the screen, its scroll positions, and the Document the reader
// showed. Back and Esc put it all back (design-find-a-document-by-title
// Decision 5).

const returnPointLabel = goToCore.returnPointLabel;

/** Captures the screen Julian is on, so the reader or the brain view can bring him back. */
function captureReturnPoint() {
  // A repaint replaces the textarea, so the typed description must be stored first.
  if (state.view === "describe") syncDescribeDraft();
  // The launch popover anchors to a fixed pixel position a repaint can move.
  if (state.launchTarget) {
    state.launchTarget = "";
    state.launchAnchor = null;
  }
  // Same reason: the What happened look anchors to a fixed pixel position too.
  state.whatHappened = null;
  const positions = rememberScreenScroll();
  return goToCore.returnPointFrom(state, { screen: positions.screen, inner: [...positions.inner] });
}

/** Puts back the scroll positions one return point captured. */
function restoreReturnScroll(scroll) {
  if (!scroll) return;
  screen.scrollTop = scroll.screen;
  for (const [selector, top] of scroll.inner) {
    const element = screen.querySelector(selector);
    if (element) element.scrollTop = top;
  }
}

/**
 * Puts the captured screen back: state, view, repaint, scroll. Without a point
 * the fallback is the Work desk. A restored view that cannot exist any more is
 * corrected by renderScreen(), as it corrects every other stale view.
 */
function restoreReturnPoint(point) {
  if (!point) return showWork();
  if (state.view === "document") rememberDocumentPosition();
  const previousSession = state.describeSessionName;
  const previousGoal = state.currentFile;
  Object.assign(state, point.state);
  if (state.describeSessionName !== previousSession) saveDescribeSession();
  if (state.currentFile && state.currentFile !== previousGoal) localStorage.setItem("agent-shell.current-goal", state.currentFile);
  if (point.state.view === "document") {
    if (!point.document) return showWork();
    state.documentTrail = [...point.document.trail];
    state.documentTrailIndex = point.document.trailIndex;
    void openDocument(point.document.file, { trail: "jump", trailIndex: point.document.trailIndex });
    return;
  }
  state.document = null;
  state.documentTrail = [];
  state.documentTrailIndex = -1;
  state.renderedKey = "";
  if (state.view === "areas") {
    revealArea(state.areaSelection);
    state.areaEdit = null;
  }
  paint(true);
  window.setTimeout(() => restoreReturnScroll(point.scroll), 0);
}

/** Back from the reader: restore its return point, or the Work desk without one. */
function leaveReader() {
  restoreReturnPoint(state.documentReturn);
}

/** True when the reader's return point is a brain terminal, not a defining agent. */
function returnsToBrain() {
  const point = state.documentReturn;
  if (point?.state?.view !== "describe-agent") return false;
  return state.sessions.some((session) => session.name === point.state.describeSessionName && session.kind === "brain");
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
  return Boolean(screen.querySelector("[data-create-form], [data-describe-work-form], [data-area-form], [data-program-form], [data-harness-form], [data-launch-popover], [data-comment-composer]"));
}

/** Refreshes the vault, program, and session projections from the server. */
async function refresh({ initial = false } = {}) {
  try {
    const [vault, sessionPayload, programs] = await Promise.all([api("/api/vault"), api("/api/sessions"), api("/api/programs")]);
    state.vault = vault;
    state.sessions = sessionPayload.sessions || [];
    state.pipelines = sessionPayload.pipelines || [];
    state.brains = sessionPayload.brains || [];
    state.contextHandoverTokens = Number(sessionPayload.contextHandoverTokens || 0);
    forgetVerdictLines();
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
    if (state.goTo) renderGoToList();
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
  awakeButton.classList.toggle("active", state.caffeinate);
  awakeButton.title = state.caffeinate ? "Let Mac sleep normally" : "Keep Mac awake";
  awakeButton.setAttribute("aria-label", awakeButton.title);
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

// ---- Go to ----
// One printed shortcut (⌘K) opens any Document, Area note, or Area brain by
// name from any screen. The layer lives outside #screen, so the screen under
// it never repaints, and Back or Esc returns to it exactly
// (design-find-a-document-by-title).

const GO_TO_LIMIT = 12;

/** The finder's word for a brain's state, from the desk label without its prefix. */
function brainStateWord(brain) {
  const label = brainStateLabel(brain).replace(/^Brain /, "");
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The finder's rows for the typed query: every Document, every Area note that
 * exists, and every Area brain. Null while the vault is still loading.
 */
function goToRows() {
  if (!state.vault) return null;
  const core = areaMapCore;
  const rows = [];
  for (const record of state.vault.documents ?? []) {
    if (record.kind !== "document" && !(record.kind === "note" && !record.missing)) continue;
    rows.push({
      key: record.file,
      kind: record.kind,
      kindLabel: record.kind === "note" ? "Area note" : core.kindLabel(record.docKind ?? "page"),
      name: record.title,
      area: record.area,
      areaLabel: areaLabel(record.area),
      detail: "",
      changedAt: Number(record.changedAt ?? record.mtime ?? 0),
      live: false,
      file: record.file,
    });
  }
  for (const brain of state.brains ?? []) {
    rows.push({
      key: `brain:${brain.area}`,
      kind: "brain",
      kindLabel: "Brain",
      name: areaLabel(brain.area),
      area: brain.area,
      areaLabel: areaLabel(brain.area),
      detail: `${brainStateWord(brain)} · generation ${brain.generation}`,
      changedAt: Date.parse(brain.updatedAt) || 0,
      live: Boolean(brain.live),
      session: brain.session,
    });
  }
  return goToCore.matchRows(rows, state.goTo.query, GO_TO_LIMIT);
}

/** Opens the finder over the current screen, or closes it when ⌘K repeats. */
function openGoTo() {
  if (!modalLayer.hidden) return;
  if (state.goTo) return closeGoTo();
  if (!shellMenu.hidden) toggleShellMenu(false);
  state.goTo = { query: "", selected: 0, rows: [], returnFocus: document.activeElement };
  goToInput.value = "";
  goToLayer.hidden = false;
  renderGoToList();
  goToInput.focus();
}

/** Closes the finder and gives the keyboard back to the screen underneath. */
function closeGoTo() {
  if (!state.goTo) return;
  const focus = state.goTo.returnFocus;
  state.goTo = null;
  goToLayer.hidden = true;
  goToList.innerHTML = "";
  if (focus && focus !== document.body && focus.isConnected) {
    try { focus.focus(); } catch {}
  }
}

/** Draws the finder's list. It never touches #screen. */
function renderGoToList() {
  if (!state.goTo) return;
  const rows = goToRows();
  if (rows === null) {
    state.goTo.rows = [];
    goToList.innerHTML = `<li class="go-to-empty">Loading the vault…</li>`;
    return;
  }
  state.goTo.rows = rows;
  state.goTo.selected = rows.length ? Math.min(Math.max(state.goTo.selected, 0), rows.length - 1) : 0;
  if (!rows.length) {
    goToList.innerHTML = `<li class="go-to-empty">Nothing is named “${escapeHtml(state.goTo.query)}”.</li>`;
    return;
  }
  goToList.innerHTML = rows.map((row, index) => `
    <li id="go-to-row-${index}" role="option" aria-selected="${index === state.goTo.selected}" data-go-to-row="${index}">
      <span class="search-result-kind">${escapeHtml(row.kindLabel)}</span>
      <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.detail || row.areaLabel)}</small></span>
    </li>`).join("");
  goToInput.setAttribute("aria-activedescendant", `go-to-row-${state.goTo.selected}`);
  goToList.children[state.goTo.selected]?.scrollIntoView?.({ block: "nearest" });
}

/** Goes to one chosen row. Enter never starts an agent. */
function chooseGoToRow(row) {
  if (!row) return;
  closeGoTo();
  if (row.kind === "brain") {
    if (row.live) return openBrainSession(row.session);
    return showWorkAt(row.area);
  }
  return openDocument(row.file);
}

/**
 * Opens the Work desk at one Area card, where the control that resumes a
 * stopped brain lives. Without a card for that Area the Areas screen is the
 * next nearest place. Neither starts anything.
 */
function showWorkAt(area) {
  if (!deskAreas().some((record) => record.area.path === area)) return showAreasAt(area);
  showWork();
  window.setTimeout(() => {
    const card = screen.querySelector(`[data-desk-area="${CSS.escape(area)}"]`);
    if (!card) return;
    try { card.scrollIntoView({ block: "start" }); } catch {}
    card.classList.add("flash");
    window.setTimeout(() => card.classList.remove("flash"), 1600);
  }, 0);
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
  // Cancelling the new-work form returns into this form; it is not a fresh
  // entry, so the return point it already holds stays.
  if (state.view !== "create") state.describeReturn = captureReturnPoint();
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
  state.describeReturn = captureReturnPoint();
  state.describeSessionName = session.name;
  state.document = null;
  saveDescribeSession();
  state.view = "describe-agent";
  state.renderedKey = "";
  paint(true);
}

/** Returns from work definition to the exact screen that opened it. */
function cancelDescribe() {
  restoreReturnPoint(state.describeReturn);
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
      state.documentReturn = captureReturnPoint();
      state.documentTrail = [];
      state.documentTrailIndex = -1;
    }
    state.view = "document";
    state.document = null;
    paint(true);
  }
  state.commentComposer = null;
  state.commentCursor = -1;
  try {
    state.document = await api(`/api/document?file=${encodeURIComponent(file)}`);
    updateDocumentTrail(file, trail, trailIndex);
    paint(true);
    restoreDocumentPosition(heading);
  } catch (error) {
    showToast(error.message);
    if (enteringReader) restoreReturnPoint(state.documentReturn);
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
    const top = scroll.getBoundingClientRect().top;
    for (const heading of headings) {
      if (heading.element.getBoundingClientRect().top - top <= 150) active = heading.id;
    }
    for (const link of links) {
      const current = link.dataset.documentHeading === active;
      link.classList.toggle("active", current);
      if (current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  // Only a real scroll may store the reading position. At bind time the reader
  // is still at the top, and storing that would wipe the place a save,
  // a refresh, or a return from an agent is about to restore.
  /** Stores the reading position on a real scroll. */
  const remember = () => {
    if (state.document) state.documentPositions.set(state.document.file, scroll.scrollTop);
  };
  scroll.addEventListener("scroll", update, { passive: true });
  scroll.addEventListener("scroll", remember, { passive: true });
  scroll.addEventListener("scroll", hideSelectionCommentButton, { passive: true });
  update();
  const composerField = screen.querySelector("#comment-text");
  if (composerField && document.activeElement !== composerField) {
    // Plain focus scrolls the field into view, which moves the words Julian is
    // reading. The composer sits at his selection, so it is already on screen.
    composerField.focus({ preventScroll: true });
    composerField.setSelectionRange(composerField.value.length, composerField.value.length);
  }
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

// ---- Document comments (design contract: design-comment-on-documents) ----
// A comment is CriticMarkup inside the Document text; document-comments.js
// parses, inserts, and removes it. Every change goes through the base-hash
// save, so a comment can never overwrite an agent's edit.

/** The stable part of the composer for the render key (typed text is synced, not keyed). */
function commentComposerKey() {
  const composer = state.commentComposer;
  return composer ? [composer.anchor?.kind, composer.placeLine, composer.editing?.index ?? -1, composer.notice] : null;
}

/** The nearest rendered block above a DOM node, which knows its file line. */
function readerBlockOf(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!element || element.closest?.(".document-comment, .document-comment-composer")) return null;
  return element.closest?.("[data-line]") ?? null;
}

/** The words Julian selected inside the reading column, mapped to their file line. */
function readerSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const content = screen.querySelector(".document-content");
  const range = selection.getRangeAt(0);
  const startBlock = readerBlockOf(range.startContainer);
  const endBlock = readerBlockOf(range.endContainer);
  if (!content || !startBlock || !content.contains(startBlock)) return null;
  const crossed = endBlock !== startBlock;
  const quote = (crossed ? selection.toString().split("\n")[0] : selection.toString()).replace(/\s+/g, " ").trim();
  if (!quote) return null;
  // The same words can stand twice in one block, so the composer also carries
  // how far into the block the selection started.
  const prefix = document.createRange();
  prefix.setStart(startBlock, 0);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().replace(/\s+/g, " ").trimStart().length;
  return { quote, line: Number(startBlock.dataset.line), offset, crossed, rect: range.getBoundingClientRect() };
}

/** Shows the floating Comment button beside a live selection, or hides it. */
function updateSelectionCommentButton() {
  const button = screen.querySelector(".selection-comment-button");
  if (!button) return;
  const selection = state.commentComposer ? null : readerSelection();
  if (!selection || !selection.rect.width) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.style.top = `${Math.max(8, selection.rect.top - 42)}px`;
  button.style.left = `${Math.max(8, selection.rect.left + selection.rect.width / 2)}px`;
}

/** Hides the floating Comment button without touching the selection. */
function hideSelectionCommentButton() {
  const button = screen.querySelector(".selection-comment-button");
  if (button) button.hidden = true;
}

/** The outline heading whose section is in view, so a section comment lands there. */
function readerSectionInView() {
  const scroll = screen.querySelector(".document-reader-scroll");
  const items = documentOutlineItems();
  if (!scroll || !items.length) return null;
  let active = null;
  const top = scroll.getBoundingClientRect().top;
  for (const heading of items) {
    const element = document.getElementById(heading.id);
    if (element && element.getBoundingClientRect().top - top <= 150) active = heading;
  }
  return active;
}

/** The file line of the Document title, where a whole-Document comment goes. */
function documentTitleLine() {
  return markdownHeadings(state.document?.text).find((heading) => heading.level === 1)?.line ?? -1;
}

/**
 * Opens the composer: on the selected words when there is a selection, else
 * under the section in view with a switch to the whole Document.
 */
function openCommentComposer() {
  if (state.view !== "document" || !state.document) return;
  const selection = readerSelection();
  const section = selection ? null : readerSectionInView();
  const composer = {
    text: "",
    notice: selection?.crossed ? "The selection crossed a paragraph. The comment goes on the first one." : "",
    editing: null,
    section,
    anchor: selection
      ? { kind: "selection", quote: selection.quote, line: selection.line, offset: selection.offset }
      : section ? { kind: "section", heading: section.title } : { kind: "document" },
    placeLine: selection ? selection.line : section ? section.line : documentTitleLine(),
  };
  state.commentComposer = composer;
  window.getSelection()?.removeAllRanges();
  paint(true);
}

/** Switches a new comment between the section in view and the whole Document. */
function setCommentScope(kind) {
  const composer = state.commentComposer;
  if (!composer || composer.editing) return;
  syncCommentDraft();
  composer.anchor = kind === "section" && composer.section ? { kind: "section", heading: composer.section.title } : { kind: "document" };
  composer.placeLine = composer.anchor.kind === "section" ? composer.section.line : documentTitleLine();
  paint(true);
}

/** Opens one existing comment in the composer. */
function editComment(index) {
  const comment = (state.document?.comments ?? [])[index];
  if (!comment) return;
  state.commentComposer = { text: comment.text, notice: "", editing: comment, section: null, anchor: { kind: "edit" }, placeLine: comment.line };
  paint(true);
}

/** Keeps the typed comment in state, so a repaint cannot lose it. */
function syncCommentDraft() {
  const field = screen.querySelector("#comment-text");
  if (field && state.commentComposer) state.commentComposer.text = field.value;
}

/** Closes the composer and drops its draft. */
function cancelCommentComposer() {
  if (!state.commentComposer) return;
  const focusIndex = state.commentComposer.editing?.index;
  state.commentComposer = null;
  paint(true);
  if (Number.isInteger(focusIndex)) document.getElementById(`document-comment-${focusIndex}`)?.focus();
}

/** Shows one line of trouble inside the composer and keeps the draft. */
function noteInComposer(message) {
  if (!state.commentComposer) return;
  syncCommentDraft();
  state.commentComposer.notice = message;
  paint(true);
}

/** Applies the composer to one Document text: the new markup, or why it cannot be placed. */
function composerResult(document, composer) {
  const helper = documentComments;
  if (composer.editing) {
    const match = (document.comments ?? []).find((comment) => comment.markup === composer.editing.markup && comment.line === composer.editing.line)
      ?? (document.comments ?? []).find((comment) => comment.markup === composer.editing.markup);
    if (!match) return { error: "That comment changed while you were editing. Read it again." };
    return { text: helper.replaceCommentText(document.text, match, composer.text) };
  }
  return helper.insertComment(document.text, composer.anchor, composer.text);
}

/** One base-hash save of the whole Document text; returns the raw reply so a 409 can be handled. */
async function saveDocumentText(text, summary, baseHash = state.document?.hash) {
  const response = await fetch("/api/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: state.document.file, text, baseHash, summary }),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/** Replaces the open Document with a saved copy without losing the reading place. */
function adoptSavedDocument(document) {
  rememberDocumentPosition();
  state.document = document;
  state.renderedKey = "";
  paint(true);
  restoreDocumentPosition();
}

/** Puts an earlier text back, for Undo, unless the file moved on again. */
async function restoreDocumentText(text, summary) {
  const result = await saveDocumentText(text, summary);
  if (!result.ok) return showToast(result.data.error === "document changed since it was opened" ? "The Document changed since then, so nothing was undone." : (result.data.error || "Undo did not save."));
  adoptSavedDocument(result.data);
}

/**
 * Saves the composer. On a 409 the current text comes back with the reply, so
 * the comment is placed again by heading or exact words and saved once more;
 * if its place is gone the composer stays open with the draft.
 */
async function submitCommentComposer() {
  const composer = state.commentComposer;
  if (!composer || !state.document) return;
  syncCommentDraft();
  if (!composer.text.trim()) return noteInComposer("Write the comment first.");
  const summary = composer.editing ? "edited a comment" : "added a comment";
  let attempt = composerResult(state.document, composer);
  if (attempt.error) return noteInComposer(attempt.error);
  let previous = state.document.text;
  let result = await saveDocumentText(attempt.text, summary);
  if (result.status === 409 && result.data.current) {
    state.document = { ...state.document, ...result.data.current };
    attempt = composerResult(state.document, composer);
    if (attempt.error) return noteInComposer(attempt.error);
    previous = state.document.text;
    result = await saveDocumentText(attempt.text, summary);
  }
  if (!result.ok) return noteInComposer(result.data.error || "The comment did not save.");
  const wasEditing = Boolean(composer.editing);
  state.commentComposer = null;
  adoptSavedDocument(result.data);
  showToast(wasEditing ? "Comment updated." : "Comment added.", {
    label: "Undo",
    /** Puts the text from before this comment change back. */
    run: () => restoreDocumentText(previous, wasEditing ? "undid a comment edit" : "removed a comment"),
  });
}

/** Removes one comment with Undo, never with a dialog. */
async function removeComment(index) {
  const comment = (state.document?.comments ?? [])[index];
  if (!comment) return;
  const previous = state.document.text;
  const text = documentComments.removeComment(previous, comment);
  const result = await saveDocumentText(text, "removed a comment");
  if (result.status === 409) return showToast("The Document changed since it was opened. Open it again, then remove the comment.");
  if (!result.ok) return showToast(result.data.error || "The comment did not save.");
  if (state.commentComposer?.editing?.index === index) state.commentComposer = null;
  adoptSavedDocument(result.data);
  showToast("Comment removed.", {
    label: "Undo",
    /** Puts the removed comment back. */
    run: () => restoreDocumentText(previous, "restored a comment"),
  });
}

/** Moves to the next or previous comment, wrapping at the ends, and gives it focus. */
function stepComment(direction) {
  const comments = state.document?.comments ?? [];
  if (!comments.length) return;
  const count = comments.length;
  state.commentCursor = ((state.commentCursor + direction) % count + count) % count;
  const element = document.getElementById(`document-comment-${state.commentCursor}`);
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
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
  const pipeline = describing ? null : pipelineForGoal(goal);
  const stepsLeft = pipeline ? pipeline.steps.filter((step) => step.status === "pending").length : 0;
  const returnToDocument = !describing && state.view === "agent" && state.agentReturnView === "document" && Boolean(state.document);
  openModal({
    kicker: shell ? "Open session" : "Live agent",
    title: shell ? "Close this session?" : `Stop ${agentName(session)}?`,
    copy: describing
      ? session.kind === "brain"
        ? "This ends the brain. Goals and pipelines it started keep running. Resume it later from the brain icon on the Area card."
        : "This ends the conversation about new work. Any Goals or Documents already created stay in Tangent."
      : pipeline
        ? `This ends the run${stepsLeft ? ` and its ${stepsLeft} remaining step${stepsLeft === 1 ? "" : "s"}` : ""}. The Goal, its notes, and its handovers stay here.`
        : "This ends the live session. The work and its notes stay here.",
    confirmLabel: shell ? "Close session" : "Stop agent",
    danger: true,
    /** Stops only the live run and preserves the goal. */
    onConfirm: async () => {
      await post(`/api/kill/${encodeURIComponent(session.name)}`, {});
      if (describing) {
        state.describeSessionName = "";
        saveDescribeSession();
        await refresh();
        restoreReturnPoint(state.describeReturn);
        showToast("The conversation ended. Saved work stays in Tangent.");
        return;
      }
      state.view = returnToDocument ? "document" : "work";
      await refresh();
      paint(true);
      if (returnToDocument) await refreshDocument();
      showToast(shell ? "The session closed." : "The agent stopped. The work stays open.");
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
  try { terminalFit?.fit(); } catch {}
});

document.addEventListener("selectionchange", () => {
  if (state.view === "document") updateSelectionCommentButton();
});

void (async () => {
  await refresh({ initial: true });
  if (requestedDocument) await openDocument(requestedDocument);
})();
// Mutations and reconciliation push invalidations. The slow timer is only a
// recovery path for a suspended browser or a dropped event stream.
startRefreshLifecycle(refresh);

// DOM-level exports keep tests on the module boundary instead of rebuilding
// the old order-dependent browser globals.
export { areaMapView, enableDockBadge, fallbackAsks, forYouItems, markdownHeadings, markdownToHtml, refresh };
