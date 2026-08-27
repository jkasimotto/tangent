import documentComments from "./document-comments.js";
import codeHighlight from "./code-highlight.js";
import areaMapCore from "./area-map-core.js";
import goalCardCore from "./goal-card-core.js";
import goToCore from "./go-to-core.js";
import areaMapView from "./area-map.js";
import { createApiClient } from "./api-client.js";
import { createShellState } from "./shell-state.js";
import { shellDom } from "./shell-dom.js";
import { createRefreshCoordinator, readProjection, startRebuildRefresh, startRefreshLifecycle } from "./refresh-lifecycle.js";
import { FENCE_OPEN, fenceCloser, frontmatterLineCount, markdownHeadingAnchor, markdownHeadings, markdownTableAlignments, markdownTableCells, visibleMarkdown } from "./markdown-structure.js";
import { cleanText, clip, escapeHtml, progressPoints } from "./text-format.js";
import { rebuildCommitRows } from "./rebuild-commit-list.js";
import { buildGoToRows } from "./go-to-rows.js";
import { currentBriefFields, storyEntries } from "./goal-narrative.js";
import { createWhatHappenedView } from "./what-happened-view.js";
import { createWorkDeskView } from "./work-desk-view.js";
import { createAreaDirectoryView } from "./area-directory-view.js";
import { createProgramView } from "./program-view.js";
import { createGoalLaunchView } from "./goal-launch-view.js";
import { createAgentDecisionView } from "./agent-decision-view.js";
import { createDocumentReaderView } from "./document-reader-view.js";
import { createDocumentReaderController } from "./document-reader-controller.js";
import { mountMermaidDiagrams } from "./mermaid-diagram.js";
import { createShellCoordinator } from "./shell-coordinator.js";
import { bindShellEvents } from "./shell-event-bindings.js";
import { createTerminalController } from "./terminal-controller.js";
import { createActionTelemetry } from "./action-telemetry.js";
import { reconcileAreaFocus, writeAreaFocus } from "./area-focus-core.js";
import { ASK_DISMISSALS_KEY, readDismissedAskIds } from "./ask-dismissal-core.js";
import { renderPromptBestiary } from "./prompt-bestiary.js";

const actionTelemetry = createActionTelemetry();
actionTelemetry.observe();
const { api, post } = createApiClient(undefined, actionTelemetry);
const { api: healthApi } = createApiClient(undefined, actionTelemetry, 3_000);
const { requestedArea, requestedDocument, requestedGoal, state } = createShellState();

const {
  screen, "back-button": backButton, "work-tab": workTab, "areas-tab": areasTab, "prompts-tab": promptsTab, "bar-context": barContext,
  "find-button": findButton, "secondary-action": secondaryAction, "modal-layer": modalLayer,
  "modal-kicker": modalKicker, "modal-title": modalTitle, "modal-copy": modalCopy, "modal-field": modalField,
  "modal-actions": modalActions, toast, "status-pill": statusPill, "awake-button": awakeButton,
  "shell-menu": shellMenu, "go-to-button": goToButton, "go-to-layer": goToLayer,
  "go-to-input": goToInput, "go-to-list": goToList,
  "session-layer": sessionLayer, "session-layer-title": sessionLayerTitle, "session-layer-terminal": sessionLayerTerminal,
  "document-peek-layer": documentPeekLayer,
} = shellDom();

/**
 * The global shortcuts. The keydown handler and every printed label read this
 * one table, so what the bar says and what the keyboard does cannot drift.
 */
const KEYMAP = {
  goTo: { key: "k", label: "⌘K" },
  findWork: { key: "/", label: "⌘/" },
  session: { key: "j", label: "⌘J" },
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

let toastTimer = null;
let modalConfirm = null;

/** Decodes one local link without failing on malformed percent escapes. */
function decodeLink(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

/**
 * Resolves one local link path against the Document that is on screen. The
 * quick Document layer shows a different file than the full reader, so the
 * source file is a parameter, not `state.document`
 * (design-quick-returnable-document-search 5.3).
 */
function vaultLinkPath(target, baseFile = state.document?.file ?? "") {
  const raw = decodeLink(String(target ?? "").split("#")[0].split("?")[0]).replaceAll("\\", "/");
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  const parts = raw.startsWith("./") || raw.startsWith("../")
    ? [...String(baseFile ?? "").split("/").slice(0, -1), ...raw.split("/")]
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
function vaultLinkRecord(target, baseFile = state.document?.file ?? "") {
  const value = vaultLinkPath(target, baseFile).replace(/\.md$/i, "");
  const records = state.vault?.documents ?? [];
  if (value.includes("/")) return records.find((record) => record.file.replace(/\.md$/i, "") === value) ?? null;
  const currentDirectory = String(baseFile ?? "").split("/").slice(0, -1).join("/");
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
function inlineMarkdown(value, baseFile = state.document?.file ?? "") {
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
    const record = vaultLinkRecord(link.target, baseFile);
    const fallback = humanName(link.target.split("#")[0].split("/").at(-1)?.replace(/\.md$/i, "") || link.target);
    const label = link.label || record?.title || fallback;
    html = html.replace(
      `\u0001${index}\u0002`,
      `<button class="markdown-vault-link ${record ? "resolved" : "missing"}" type="button" data-open-vault-link="${escapeHtml(link.target)}">${escapeHtml(label)}</button>`
    );
  }
  return html;
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
  // The quick Document layer reads a file the screen is not showing, and it
  // owns no write controls (design-quick-returnable-document-search D5).
  const baseFile = options.baseFile ?? state.document?.file ?? "";
  const readOnly = Boolean(options.readOnly);
  const lineOffset = frontmatterLineCount(text);
  /** Comment blocks (and the composer) that belong under one file line. */
  const tailFor = (fileLine) => {
    const parts = comments.filter((comment) => comment.line === fileLine)
      .map((comment) => composer?.editing?.index === comment.index ? commentComposerHtml(composer) : commentAsideHtml(comment, readOnly));
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
      if (lang.toLowerCase() === "mermaid") {
        const source = escapeHtml(body.join("\n"));
        html.push(`<div class="markdown-diagram" data-mermaid-diagram data-line="${fileLine}"><pre><code>${source}</code></pre></div>${tail}`);
        continue;
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
        `<div class="markdown-table-wrap" data-line="${tableLine}"><table><thead><tr>${headers.map((cell, column) => `<th${cellClass(column)}>${inlineMarkdown(cell, baseFile)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${row.map((cell, column) => `<td${cellClass(column)}>${inlineMarkdown(cell, baseFile)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${tableTail}`
      );
    } else if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length);
      const id = markdownHeadingAnchor(heading[2], headingIds);
      html.push(`<h${level} id="${escapeHtml(id)}" data-line="${fileLine}">${inlineMarkdown(heading[2], baseFile)}</h${level}>${tail}`);
    } else if (bullet || ordered) {
      const nextList = ordered ? "ol" : "ul";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li data-line="${fileLine}">${inlineMarkdown((bullet || ordered)[1], baseFile)}${tail}</li>`);
    } else if (!line.trim()) {
      closeList();
      if (tail) html.push(tail);
    } else {
      closeList();
      html.push(`<p data-line="${fileLine}">${inlineMarkdown(line, baseFile)}</p>${tail}`);
    }
  }
  closeList();
  // Marks nest as their brackets nest, so every token becomes its own tag.
  return html.join("")
    .replace(/\u0005(\d+)\u0006/g, '<mark class="document-comment-mark" data-comment-index="$1">')
    .replace(/\u0005\u0006/g, "</mark>");
}

/**
 * One comment as a red-ruled block with readable words and explicit actions.
 * Read-only mode shows the same words without actions, because the quick
 * Document layer never writes a file.
 */
function commentAsideHtml(comment, readOnly = false) {
  const author = comment.author || "Comment";
  const body = `<span class="document-comment-author">${escapeHtml(author)}</span><span class="document-comment-text">${escapeHtml(comment.text)}</span>`;
  if (readOnly) {
    // No id: the full reader below the quick layer already owns these ids.
    return `<aside class="document-comment read-only" role="note" aria-label="Comment from ${escapeHtml(author)}" data-comment-index="${comment.index}">
    <span class="document-comment-body">${body}</span>
  </aside>`;
  }
  return `<aside class="document-comment" id="document-comment-${comment.index}" role="note" aria-label="Comment from ${escapeHtml(author)}" data-comment-index="${comment.index}" tabindex="-1">
    <span class="document-comment-body">${body}</span>
    <span class="document-comment-actions" role="group" aria-label="Comment actions">
      <button type="button" data-edit-comment="${comment.index}" aria-keyshortcuts="e" title="Edit this comment (e)">Edit <kbd>e</kbd></button>
      <button type="button" data-reply-comment="${comment.index}" aria-keyshortcuts="r" title="Reply at this comment's anchor (r)">Reply <kbd>r</kbd></button>
      <button type="button" data-resolve-comment="${comment.index}" aria-keyshortcuts="x" title="Resolve this comment with a note (x)">Resolve <kbd>x</kbd></button>
    </span>
  </aside>`;
}

/** The inline comment composer, at its anchor, with its scope and printed keys. */
function commentComposerHtml(composer) {
  const anchor = composer.anchor;
  const where = composer.editing
    ? `<span>Editing your comment</span>`
    : composer.replying
      ? `<span>Replying at this comment's anchor</span>`
    : anchor.kind === "selection"
      ? `<span>On “${escapeHtml(clip(anchor.quote, 70))}”</span>`
      : `<span class="document-comment-scope" role="group" aria-label="Where this comment goes">
          <button type="button" data-comment-scope="section" aria-pressed="${anchor.kind === "section"}" ${composer.section ? "" : "disabled"}>${composer.section ? `Section “${escapeHtml(clip(composer.section.title, 40))}”` : "This section"}</button>
          <button type="button" data-comment-scope="document" aria-pressed="${anchor.kind === "document"}">Whole Document</button>
        </span>`;
  const label = composer.editing ? "Edit comment" : composer.replying ? "Reply to comment" : "New comment";
  return `<form class="document-comment-composer" data-comment-composer data-command-enter-submit aria-label="${label}">
    <textarea id="comment-text" rows="2" placeholder="${composer.replying ? "Your reply" : "Your comment"}" aria-label="${label}">${escapeHtml(composer.text)}</textarea>
    <div class="document-comment-composer-row">
      <div class="document-comment-composer-where">${where}</div>
      <div class="document-comment-composer-actions">
        <button class="quiet-button" type="button" data-cancel-comment>Cancel <kbd>esc</kbd></button>
        <button class="primary-button" type="submit">${composer.replying ? "Add reply" : "Save comment"} <kbd>⌘↵</kbd></button>
      </div>
    </div>
    ${composer.notice ? `<p class="document-comment-composer-notice" role="alert">${escapeHtml(composer.notice)}</p>` : ""}
  </form>`;
}


// The launch popover's target when it chooses the agent for a describe-work
// conversation instead of a Goal. Never collides with a goal file path.
const DESCRIBE_LAUNCH_TARGET = "__describe__";
/** The launch popover target while Julian gives an Area brain its instruction. */
const BRAIN_LAUNCH_TARGET = "__brain__";
/** The launch popover target while an Area edits its two durable defaults. */
const DEFAULT_AGENTS_TARGET = "__default_agents__";

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

const terminalController = createTerminalController({ state, showToast });
const { disposeTerminal, mountTerminal } = terminalController;

/** Defers reading a feature function until the circular view graph is assembled. */
function forward(read) {
  return (...args) => read()(...args);
}

const workDeskView = createWorkDeskView({
  shell: { state, api, post, paint, refresh, showToast, openModal: forward(() => openModal), captureReturnPoint, saveDescribeSession, openSessionLayer: forward(() => openSessionLayer) },
  launch: {
    launchSelection: forward(() => launchSelection), launchRequestFields: forward(() => launchRequestFields),
    syncLaunchDraft: forward(() => syncLaunchDraft), preferredArea: forward(() => preferredArea),
    launchOptionsFor: forward(() => launchOptionsFor), pipelineForGoal: forward(() => pipelineForGoal),
    pipelineRecordForGoal: forward(() => pipelineRecordForGoal), launchPopover: forward(() => launchPopover),
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  },
  areaModel: { areas: forward(() => areas), allAreas: forward(() => allAreas), orderedGoalTrees: forward(() => orderedGoalTrees) },
  programs: {
    programRowControls: forward(() => programRowControls), programIsLive: forward(() => programIsLive),
    programState: forward(() => programState), localMoment: forward(() => localMoment),
  },
  chrome: { shortcutKbd, whatHappenedOverlay: forward(() => whatHappenedOverlay) },
});
const {
  allGoals, goalGroups, goalTrees, goalTreeState, goalTreeIsActive, filteredGoalTrees, saveExpandedAreas, revealArea, goalByFile,
  currentGoal, sessionForGoal, sessionsForGoal, describeWorkSessions, describeWorkSession, brainSessions,
  brainForAreaCard, brainStateLabel, brainKind, deskBrainButton, openBrainSession, openOrStartBrain, toggleBrainPopover, startBrain, confirmStopBrain,
  humanName, areaParts, areaLabel, areaPath, agentName, agentReference, ageText, stateLabel, describeWorkStateLabel,
  goalNeedsYou, goalWorkFinished, workCard, goalTreeCard,
  forgetVerdictLines, openRequest, openQuestionsReview, openAreaCapture, sendVerdict, replyAboutRow, areaQuestions, areaBlockers,
  goalGroupRoot, setSubgoalsExpanded, toggleSubgoals, setWorkAreaFolded, toggleWorkArea,
  openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery, applyAreaFocus, clearAreaFocus, renderWork, paintWorkCaption,
} = workDeskView;

const programView = createProgramView({
  state, areaLabel, areaPath, humanName, agentName,
  /** Returns Area options. */ areaOptions: (...args) => areaOptions(...args),
});
const {
  programById, currentProgram, programIsLive, programState, localMoment, programKind, programRowControls,
  programRow, renderProgramDetail, programAreaDirectory, renderProgramCreate,
} = programView;

const areaDirectoryView = createAreaDirectoryView({
  shell: { state, api, post, paint, showToast, screen },
  documents: { openDocument: forward(() => openDocument) },
  work: {
    selectGoal: forward(() => selectGoal), allGoals, goalTrees, goalTreeState, goalTreeIsActive, goalByFile,
    goalNeedsYou, goalWorkFinished, sessionForGoal, brainForAreaCard, brainStateLabel, brainKind, humanName, areaLabel,
    areaPath, agentName, ageText, deskBrainButton, workCard, goalTreeCard,
  },
  programs: {
    programRow: forward(() => programRow), programKind: forward(() => programKind),
    programIsLive: forward(() => programIsLive),
  },
});
const {
  areas, allAreas, areaIsFolded, setAreaStatus, selectedArea, areaParent, areaTreeRows, areaProgramMark,
  areaGoalRow, goalAttention, orderedGoalTrees, loadMapState, loadAreaJournal, mountAreaMap, areaContents, renderAreas,
  areaParentOptions, renderAreaEditor,
} = areaDirectoryView;

const goalLaunchView = createGoalLaunchView({
  shell: { state, api, post, paint, showToast },
  areaModel: { allAreas, areaLabel, areaPath },
  work: { humanName, agentName, describeLaunchArea, goalByFile, currentGoal, sessionForGoal, brainForAreaCard, brainStateLabel, brainKind },
  overlays: { launchPopover: forward(() => launchPopover), DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET },
});
const {
  selectableAreas, preferredArea, areaOptions, renderDescribeCapture, describeSourcesBlock,
  launchOptionsFor, launchSelection, launchRequestFields, launchFieldsForArea, launchStepDraft, syncLaunchDraft, commitActiveStep,
  blankLaunchStep, launchStepsForRecord, launchStepIsMutable, activateLaunchStep, loadLaunchStep, launchStepLabel,
  pipelineForGoal, pipelineRecordForGoal, launchStepList, launchPickerBlock,
  toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, leaveHarnessEditor, harnessSlug, saveHarnesses, renderHarnessEditor,
} = goalLaunchView;

const agentDecisionView = createAgentDecisionView({ state, agentName, areaLabel, currentBriefFields, storyEntries });
const { renderDecision } = agentDecisionView;

const documentReaderView = createDocumentReaderView({
  state, markdownToHtml, currentGoal, goalByFile, sessionsForGoal, areaLabel, areaPath, humanName,
});
const {
  documentGoal, readerDocuments, documentOutlineItems, documentOutlineLinks, documentCommentControls,
  documentOutline, documentOutlineMenu, documentPicker, documentToolbar, renderDocumentArticle, renderDocumentPeek, renderDocument,
} = documentReaderView;

const documentReaderController = createDocumentReaderController({
  shell: { state, api, post, paint, showToast, screen, paintPeek: forward(() => renderDocumentPeekLayer), documentPeekLayer },
  rendering: { documentComments, markdownHeadings, documentOutlineItems, documentGoal, renderDocumentArticle },
  work: { goalByFile, currentGoal, sessionsForGoal, humanName, areaLabel, agentReference },
  navigation: {
    decodeLink, vaultLinkRecord, revealArea, captureReturnPoint, restoreReturnPoint,
    selectGoal: forward(() => selectGoal), showWorkAt: forward(() => showWorkAt),
    openGoalAgent: forward(() => openGoalAgent), closeSessionLayer: forward(() => closeSessionLayer),
  },
});
const {
  rememberDocumentPosition, restoreDocumentPosition, updateDocumentTrail, openDocument, navigateDocumentHistory,
  openDocumentPeek, retryDocumentPeek, navigateDocumentPeekHistory, closeDocumentPeek, promoteDocumentPeek, openPeekLink, openPeekHeading,
  leaveQuickPath,
  openVaultLink, openDocumentHeading, bindDocumentReader, refreshDocument, commentComposerKey, readerBlockOf,
  readerSelection, updateSelectionCommentButton, hideSelectionCommentButton, readerSectionInView, documentTitleLine,
  openCommentComposer, setCommentScope, syncCommentDraft, cancelCommentComposer, noteInComposer,
  composerResult, saveDocumentText, adoptSavedDocument, restoreDocumentText, submitCommentComposer,
  commentIdentity, syncCommentCursor, activeCommentIdentity, focusCommentIdentity, editActiveComment, replyToActiveComment,
  resolveActiveComment, stepComment, saveVisibleIdea, notifyDocumentComments,
} = documentReaderController;

const shellCoordinator = createShellCoordinator({
  shell: { state, api, post, actionTelemetry, paint, refresh, showToast },
  chrome: {
    screen, backButton, shellMenu, goToButton, goToLayer, goToInput, goToList, modalLayer, modalKicker, modalTitle, modalCopy,
    modalField, modalActions, buildGoToRows, goToCore, rememberScreenScroll, restoreReturnPoint, captureReturnPoint,
    restoreReturnScroll, disposeTerminal, mountTerminal, updateStatusPill, openSessionLayer: forward(() => openSessionLayer),
    closeSessionLayer: forward(() => closeSessionLayer), documentPeekLayer, syncLayerInertness,
  },
  work: {
    areaLabel, humanName, agentName, goalByFile, currentGoal, sessionForGoal, describeWorkSession,
    goalTrees, filteredGoalTrees,
    describeWorkSessions, stopSession, brainForAreaCard, brainStateLabel, agentReference, saveDescribeDraft,
    saveDescribeSession, describeLaunchArea, openBrainSession, openOrStartBrain,
  },
  areasFeature: { allAreas, areaParent, preferredArea, areas, revealArea, selectedArea },
  programs: { currentProgram, programById, programIsLive, programAreaDirectory },
  launch: {
    launchOptionsFor, launchSelection, launchRequestFields, launchFieldsForArea, syncLaunchDraft, launchStepDraft,
    pipelineForGoal, pipelineRecordForGoal, syncDescribeDraft,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET,
  },
  documents: { openDocument, refreshDocument, rememberDocumentPosition, documentGoal, openDocumentPeek, closeDocumentPeek },
});
const {
  toggleShellMenu, goToRows, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWorkAt, confirmRebuild, reloadChanges,
  selectGoal, rememberGoal, openGoalRun, showWork, showAreas, beginAreaCreate, beginAreaMove, showAreasAt,
  selectProgram, showProgramCreate, openProgramSession, performProgramAction, controlProgram, movedPath,
  confirmAreaMove, addDescribeSource, showDescribe,
  openDescribeSession, cancelDescribe, showDecision, startPipeline, savePipelineChanges, replaceGoalAttempt,
  openGoalAgent, openReaderAgent, launchOpenSession, openModal, closeModal, getModalConfirm,
  confirmStop, confirmComplete, confirmWontDo,
} = shellCoordinator;

const whatHappenedView = createWhatHappenedView({ state, areaLabel, goalByFile, humanName });

/** Renders the recent-close overlay through its product view module. */
function whatHappenedOverlay() {
  return whatHappenedView.overlay();
}

/** Returns the recent-close overlay's render-key contribution. */
function whatHappenedRenderKey() {
  return whatHappenedView.renderKey();
}

/** Keeps an anchored chooser usable when its trigger sits near a viewport edge. */
function launchPopoverVerticalStyle(anchor) {
  const gap = 16;
  const viewport = Math.max(0, Number(window.innerHeight) || 0);
  const usable = Math.max(0, viewport - gap * 2);
  const wanted = Math.min(360, usable);
  const preferredTop = Number.isFinite(Number(anchor?.top)) ? Number(anchor.top) : 120;
  const aboveEdge = Number(anchor?.above);
  const belowSpace = Math.max(0, viewport - preferredTop - gap);
  const aboveSpace = Number.isFinite(aboveEdge) ? Math.max(0, aboveEdge - gap) : 0;
  if (Number.isFinite(aboveEdge) && belowSpace < wanted && aboveSpace > belowSpace) {
    return `bottom:${Math.max(gap, viewport - aboveEdge)}px;max-height:${aboveSpace}px`;
  }
  const latestTop = Math.max(gap, viewport - wanted - gap);
  const top = Math.max(gap, Math.min(preferredTop, latestTop));
  return `top:${top}px;max-height:${Math.max(0, viewport - top - gap)}px`;
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
  const settings = state.launchTarget === DEFAULT_AGENTS_TARGET;
  const replacing = Boolean(state.launch.replacement);
  const goal = describing || braining || settings ? null : goalByFile(state.launchTarget);
  if (!describing && !braining && !settings && !goal) return "";
  if (braining && !state.brainDraft?.area) return "";
  if (settings && !state.defaultAgents.area) return "";
  const area = describing ? describeLaunchArea() : braining ? state.brainDraft.area : settings ? state.defaultAgents.area : goal.area;
  launchOptionsFor(area);
  const anchor = state.launchAnchor ?? { top: 120, right: window.innerWidth - 16 };
  const width = Math.min(640, window.innerWidth - 32);
  const left = Math.max(16, anchor.right - width);
  return `
    <div class="launch-popover" data-launch-popover data-focus-key="launch:surface" tabindex="-1" role="dialog" aria-modal="false" aria-label="${settings ? "Default agents" : replacing ? "Change agent" : "Choose agent and model"}" style="${launchPopoverVerticalStyle(anchor)};left:${left}px;width:${width}px">
      <header class="launch-popover-header"><small>${escapeHtml(areaLabel(area))}</small><strong>${describing ? "Describe work" : braining ? "Brain" : settings ? "Default agents" : replacing ? `Change agent · ${escapeHtml(goal.title)}` : escapeHtml(goal.title)}</strong><span class="launch-key-hint"><kbd>j/k</kbd> choices · <kbd>h/l</kbd> columns · <kbd>Enter</kbd> select · <kbd>Esc</kbd> back</span></header>
      ${launchPickerBlock()}
    </div>
  `;
}

/** Returns every area in stable path order. */
function vaultRenderProjection() {
  if (!state.vault) return null;
  /** Selects the Goal fields that affect visible rendering. */
  const goalFields = (goal) => [goal.file, goal.title, goal.status, goal.doneWhen, goal.mtime, goal.changedAt, goal.depth, goal.waitingOn, goal.storyText, goal.agents, goal.firstStartAt, goal.lastEndAt, (goal.documents ?? []).map((document) => [document.file, document.changedAt])];
  return [
    (state.vault.map ?? []).map((group) => [group.path, (group.goals ?? []).map(goalFields)]),
    (state.vault.areas ?? []).map((area) => [area.path, area.status, area.children, area.purpose, area.body, (area.goals ?? []).map(goalFields), (area.documents ?? []).map((document) => [document.file, document.title, document.mtime, document.changedAt])]),
    (state.vault.documents ?? []).map((document) => [document.file, document.title, document.mtime, document.hash, document.docKind, document.changedAt, document.inDegree, document.goalHistory]),
  ];
}

/** Computes the minimal state key that requires a fresh render. */
function renderKey() {
  const goal = currentGoal();
  const session = sessionForGoal(goal);
  if (state.view === "document") {
    return JSON.stringify([state.view, state.document?.file, state.document?.hash, state.goalDetail, state.documentTrailIndex, state.documentTrail.length, commentComposerKey()]);
  }
  return JSON.stringify([
    state.view, state.workCursor,
    state.query,
    state.caffeinate,
    state.document ? [state.document.file, state.document.hash, state.documentTrailIndex, state.documentTrail.length] : null,
    state.describeDraft,
    state.describeSessionName,
    state.areaSelection,
    [...state.expandedAreas].sort(),
    [state.workFilter, state.areaFocus, [...state.collapsedDeskSections].sort(), [...state.collapsedGoalTrees].sort(), Boolean(state.areaFocusPicker)],
    // The card's durations count up, so a repaint is due once a minute even
    // when nothing else changed.
    Math.floor(Date.now() / 60_000),
    state.areaEdit,
    state.programId,
    state.programDraft,
    state.programs.operations.map((item) => [item.id, item.paused, item.lastRunAt, item.nextRunAt, item.session?.state]),
    vaultRenderProjection(),
    goal ? [goal.file, goal.status, goal.mtime, goal.stateText, goal.currentBrief, goal.storyText, goal.why, goal.subgoalItems, goal.documents] : null,
    [state.launch.area, state.launch.kind, state.launch.open, state.launch.editing, state.launch.command, state.launch.choice, state.launch.loading, state.launch.options, state.launch.instruction, state.launch.assignmentKind, state.launch.assignmentPath, state.launch.continueFrom, state.launch.active, state.launch.steps, state.launch.record?.updatedAt ?? null],
    (state.pipelines ?? []).map((item) => [item.goal, item.status, item.updatedAt, item.steps.map((step) => [step.status, step.session, step.startedAt, step.endedAt, step.live, step.state, step.idleSince, step.waitingSince])]),
    (state.brains ?? []).map((item) => [item.area, item.status, item.generation, item.session, item.live, item.state, item.stateDetail, item.stateQuestion, item.waitingSince, item.updatedAt, (item.forJulian ?? []).map((row) => [row.line, row.commentCount, row.missing, row.goalStatus]), (item.requests ?? []).map((request) => [request.id, request.status, request.subject, request.question, request.proposal, request.detail])]),
    (state.goalCleanups ?? []).map((item) => [item.goal, item.lastAttemptAt, item.retryCount, item.failures]),
    [...state.verdictLines],
    [...state.dismissedAskIds].sort(),
    state.brainDraft,
    [state.launchTarget, state.launchAnchor, state.defaultAgents, Boolean(state.harnessDraft)],
    whatHappenedRenderKey(),
    state.sessions.map((item) => [item.name, item.goal, item.kind, item.area, item.state, item.stateDetail, item.stateQuestion, item.phase, item.command, item.created, item.workTitle, item.launchLabel, item.launchRef, item.waitingSince]),
  ]);
}

/** Makes stale stored cursor identities resolve to one visible row. */
function reconcileWorkCursor() {
  const rows = [...screen.querySelectorAll("[data-work-cursor]")].filter((row) => !row.hidden);
  if (!rows.length) return;
  let row = rows.find((item) => item.dataset.workCursor === state.workCursor);
  if (!row) {
    row = rows[0];
    state.workCursor = row.dataset.workCursor;
    localStorage.setItem("agent-shell.work-cursor", state.workCursor);
  }
  for (const item of rows) item.classList.toggle("cursor", item === row);
  paintWorkCaption(screen);
  if (!state.sessionPeek && document.activeElement === document.body) row.querySelector("[data-work-row-title], [data-work-cursor-control]")?.focus({ preventScroll: true });
}

/**
 * Returns the session controlled by the visible Stop action. The terminal's
 * selected tmux name remains authoritative while live-session refreshes are in
 * flight, so a transiently missing row cannot make the button inert.
 */
function stopSession() {
  if (state.view !== "describe-agent") return sessionForGoal(currentGoal());
  const live = describeWorkSession();
  if (live) return live;
  const name = state.describeSessionName;
  if (!name) return null;
  const brain = (state.brains ?? []).find((item) => item.session === name);
  return {
    name,
    kind: brain ? "brain" : "describe",
    area: brain?.area ?? "",
    generation: brain?.generation ?? null,
    state: brain?.state ?? "working",
  };
}

/** Updates shell chrome for the current view and live session. */
function updateHeader() {
  const goal = currentGoal();
  const goalSession = sessionForGoal(goal);
  const describeSession = describeWorkSession();
  const session = stopSession();
  const isWork = state.view === "work";
  const isDescribe = state.view === "describe";
  const isDescribeAgent = state.view === "describe-agent";
  const isAreas = state.view === "areas";
  const isPrompts = state.view === "prompts";
  const isAreaEdit = state.view === "area-edit";
  const isProgramDetail = state.view === "program-detail";
  const isProgramCreate = state.view === "program-create";
  const isProgramSession = state.view === "program-session";
  const isHarnesses = state.view === "harnesses";
  const program = currentProgram();
  const isTopLevel = isWork || isAreas || isPrompts;
  backButton.classList.toggle("has-back", !isTopLevel);
  const backLabel = isTopLevel
    ? "Agent Shell"
    : isDescribe || isDescribeAgent
      ? returnPointLabel(state.describeReturn)
    : isAreaEdit
      ? "Areas"
    : isProgramDetail || isProgramCreate
      ? "Areas"
    : isProgramSession
      ? "Program"
    : isHarnesses
      ? state.harnessReturnView === "areas" ? "Areas" : "Work"
    : state.view === "agent"
        ? state.agentReturnView === "document" && state.document ? "Document" : "Work"
        : state.view === "document"
          ? returnPointLabel(state.documentReturn, { brain: returnsToBrain() })
          : "Agent";
  const deployedRevision = String(state.deployedCommit || "").slice(0, 7);
  backButton.innerHTML = isTopLevel && deployedRevision
    ? `<span>Agent Shell</span><small>[${escapeHtml(deployedRevision)}]</small>`
    : escapeHtml(backLabel);
  // Browser-managed child screens share one visible Escape/Back operation.
  if (state.view === "document" || isHarnesses) backButton.innerHTML = `${escapeHtml(backButton.textContent)} <kbd>esc</kbd>`;
  barContext.textContent = isDescribe
      ? "Message the brain"
      : isDescribeAgent && describeSession
        ? `${areaLabel(describeSession.area)} · Defining work · ${describeWorkStateLabel(describeSession)}`
        : isAreas
          ? "Organize Areas"
        : isPrompts
          ? "Tangent model"
        : isAreaEdit
          ? "Review the path before it changes"
        : (isProgramDetail || isProgramSession) && program
          ? `${areaLabel(program.area)} · ${program.label} · ${programState(program)}`
        : isProgramCreate
          ? "Add a program to one area"
        : isHarnesses
          ? "Edit harnesses, models, and efforts"
          : state.view === "document" && state.document
            ? ""
            : goal
              ? `${areaLabel(goal.area)} · ${goal.title}${goalSession ? ` · ${stateLabel(goal, goalSession)}` : ""}`
              : "";

  const topLevel = isWork || isAreas || isAreaEdit || isProgramDetail || isProgramCreate || isProgramSession
    ? "work"
    : isPrompts
      ? "prompts"
      : "";
  workTab.textContent = "Work";
  workTab.classList.toggle("active", topLevel === "work");
  workTab.classList.remove("has-attention");
  areasTab.classList.toggle("active", false);
  promptsTab.classList.toggle("active", topLevel === "prompts");
  for (const [button, active] of [[workTab, topLevel === "work"], [areasTab, false], [promptsTab, topLevel === "prompts"]]) {
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  secondaryAction.hidden = !session || ["work", "create", "describe", "areas", "prompts", "area-edit", "program-detail", "program-create", "program-session", "document"].includes(state.view);
  secondaryAction.textContent = session?.state === "shell" ? "Close session" : session?.kind === "brain" ? "Stop brain" : "Stop agent";

  if (state.view === "agent" && session?.state === "waiting") {
    findButton.hidden = false;
    findButton.textContent = "Next step";
    findButton.dataset.action = "next-step";
  } else if (["work", "create", "describe", "describe-agent", "areas", "prompts", "area-edit", "program-detail", "program-create", "program-session", "agent", "decision"].includes(state.view)) {
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
  workTab.title = live ? `${live} ${live === 1 ? "Program is" : "Programs are"} running` : "";
}

/** Refreshes live agent state without replacing the terminal. */
function updateLiveHeader() {
  if (state.view === "describe-agent") {
    const session = describeWorkSession();
    if (!session) return;
    barContext.textContent = session.kind === "brain"
      ? `${areaLabel(session.area)} · Brain · ${describeWorkStateLabel(session)}`
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
  const goalFreeViews = ["work", "create", "describe", "describe-agent", "areas", "prompts", "area-edit", "program-detail", "program-create", "program-session", "document", "harnesses"];
  if (!goal && !goalFreeViews.includes(state.view)) state.view = "work";
  const session = sessionForGoal(goal);
  const describeSession = describeWorkSession();
  if (["program-detail", "program-session"].includes(state.view) && !currentProgram()) state.view = "areas";
  if (state.view === "program-session" && !currentProgram()?.session) state.view = "program-detail";
  if (state.view === "agent" && !session) state.view = state.agentReturnView === "document" && state.document ? "document" : "work";
  if (state.view === "describe-agent" && !describeSession && !state.describeSessionName) {
    state.describeSessionName = "";
    saveDescribeSession();
    state.view = "work";
  }
  if (!state.sessionPeek) disposeTerminal();

  screen.classList.remove("split-screen");
  screen.classList.remove("terminal-screen");
  screen.classList.toggle("review-screen", state.view === "document");

  const scrollPositions = rememberScreenScroll();
  const focusKey = rememberScreenFocus();
  if (state.view === "work") screen.innerHTML = renderWork();
  else if (state.view === "describe") screen.innerHTML = renderDescribeCapture();
  else if (state.view === "areas") screen.innerHTML = renderAreas() + launchPopover();
  else if (state.view === "prompts") screen.innerHTML = renderPromptBestiary({ goals: allGoals(), brains: state.brains, sessions: state.sessions, pipelines: state.pipelines, programs: state.programs.operations, asks: areaQuestions("").map((item) => ({ area: item.area, subject: item.request.subject, question: item.request.question })), inspector: state.promptInspector, selection: state.bestiarySelection });
  else if (state.view === "area-edit") screen.innerHTML = renderAreaEditor();
  else if (state.view === "program-detail") screen.innerHTML = renderProgramDetail(currentProgram());
  else if (state.view === "program-create") screen.innerHTML = renderProgramCreate();
  else if (state.view === "harnesses") screen.innerHTML = renderHarnessEditor();
  else if (state.view === "decision" && session) screen.innerHTML = renderDecision(goal, session);
  else if (state.view === "document") screen.innerHTML = renderDocument() + launchPopover();
  else {
    state.view = "work";
    screen.innerHTML = renderWork();
  }

  updateHeader();
  restoreScreenScroll(scrollPositions);
  restoreScreenFocus(focusKey);
  if (state.view === "work") reconcileWorkCursor();
  if (state.view === "document") {
    bindDocumentReader();
    mountMermaidDiagrams(screen.querySelector(".document-content"));
  }
  const host = screen.querySelector("[data-session]");
  if (host) mountTerminal(host, host.dataset.session);
  renderSessionLayer();
  const mapHost = screen.querySelector("[data-area-map]");
  if (mapHost) mountAreaMap(mapHost);
}

/** Opens the one presentation used by every live session. */
function openSessionLayer(session, kind = "agent", returnPoint = null) {
  if (!session?.name) return showToast("This row has nothing live to enter.");
  state.sessionPeek = { session: session.name, kind, returnPoint: returnPoint ?? captureReturnPoint() };
  state.renderedKey = "";
  paint(true);
}

/** Returns to the exact screen and row below the session. */
function closeSessionLayer() {
  const point = state.sessionPeek?.returnPoint;
  state.sessionPeek = null;
  disposeTerminal();
  sessionLayerTerminal.replaceChildren();
  sessionLayer.hidden = true;
  syncLayerInertness();
  if (point) restoreReturnPoint(point);
  else paint(true);
}

/** Keeps the terminal above the current screen without replacing that screen. */
function renderSessionLayer() {
  const peek = state.sessionPeek;
  sessionLayer.hidden = !peek;
  syncLayerInertness();
  if (!peek) return;
  const session = state.sessions.find((item) => item.name === peek.session) ?? null;
  const goal = session?.goal
    ? goalByFile(session.goal)
    : allGoals().find((item) => sessionForGoal(item)?.name === peek.session) ?? null;
  const queue = goal ? state.pipelines.find((item) => item.goal === goal.file) ?? null : null;
  const assignment = queue?.steps?.find((item) => item.session === peek.session) ?? null;
  const brain = peek.kind === "brain"
    ? state.brains.find((item) => item.session === peek.session || item.area === session?.area) ?? null
    : null;
  const program = peek.kind === "program"
    ? state.programs.operations.find((item) => item.session === peek.session) ?? null
    : null;
  const primary = goal?.title
    ?? (brain ? areaLabel(brain.area || session?.area) : null)
    ?? program?.label
    ?? (session?.area ? areaLabel(session.area) : null)
    ?? "Agent session";
  const launch = assignment?.launchDisclosure?.launch
    ?? (typeof assignment?.launch === "string" ? assignment.launch : "")
    ?? brain?.resolvedLaunch?.label
    ?? "";
  const secondary = goal
    ? [agentName(session), launch].filter(Boolean).join(" · ")
    : brain
      ? [agentName(session), "Area brain", brain.resolvedLaunch?.label].filter(Boolean).join(" · ")
      : program
        ? "Program session"
        : [agentName(session), peek.kind === "definition" ? "Defining work" : "Agent"].filter(Boolean).join(" · ");
  const detail = assignment
    ? `Step ${assignment.index} of ${queue.steps.length}${assignment.kind ? ` · ${assignment.kind}` : ""}`
    : brain?.generation
      ? `Generation ${brain.generation}`
      : session?.state
        ? session.state
        : "";
  sessionLayerTitle.innerHTML = `<strong>${escapeHtml(primary)}</strong><span>${escapeHtml(secondary)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
  sessionLayer.querySelector(".session-surface")?.setAttribute("aria-label", `${primary} session`);
  sessionLayerTerminal.dataset.session = peek.session;
  mountTerminal(sessionLayerTerminal, peek.session);
}

/**
 * Marks every layer below the top one inert, so only the visible dialog takes
 * pointer, keyboard, and assistive input. The finder opens above the quick
 * Document, so that Document is itself a lower layer while `Go to` is open
 * (design-quick-returnable-document-search 5.1).
 */
function syncLayerInertness() {
  const goToOpen = Boolean(state.goTo);
  const modalOpen = !modalLayer.hidden;
  const documentPeekOpen = Boolean(state.documentPeek);
  const sessionOpen = Boolean(state.sessionPeek);
  screen.toggleAttribute("inert", goToOpen || modalOpen || documentPeekOpen || sessionOpen);
  sessionLayer.toggleAttribute("inert", goToOpen || modalOpen || documentPeekOpen);
  documentPeekLayer.toggleAttribute("inert", goToOpen || modalOpen);
  goToLayer.toggleAttribute("inert", modalOpen);
  modalLayer.removeAttribute("inert");
}

/**
 * Draws the quick Document layer above the current screen and session. It
 * never touches `#screen`, and it makes the surfaces below it inert, so only
 * the top layer takes pointer and assistive input
 * (design-quick-returnable-document-search 5.1).
 */
function renderDocumentPeekLayer() {
  const peek = state.documentPeek;
  const open = Boolean(peek);
  documentPeekLayer.hidden = !open;
  syncLayerInertness();
  if (!open) {
    documentPeekLayer.replaceChildren();
    return;
  }
  const focusKey = documentPeekLayer.contains(document.activeElement) ? document.activeElement?.dataset?.peekKey ?? "" : "";
  documentPeekLayer.innerHTML = renderDocumentPeek(peek);
  const restored = focusKey ? documentPeekLayer.querySelector(`[data-peek-key="${focusKey}"]`) : null;
  (restored ?? documentPeekLayer.querySelector(".document-peek-surface"))?.focus?.({ preventScroll: true });
  mountMermaidDiagrams(documentPeekLayer.querySelector(".document-content"));
}

/**
 * The stable identity of the focused control, if it carries one. A poll that
 * changes any visible fact rebuilds the screen from strings, which would drop
 * focus mid-scan; `data-focus-key` names the control across that rebuild
 * (design-redesign-work-as-a-compact-table, "Polls and stable focus").
 */
function rememberScreenFocus() {
  const active = document.activeElement;
  if (!active || !screen.contains(active)) return "";
  return active.dataset?.focusKey ?? "";
}

/** Puts focus back on the same control after a repaint of the same view. */
function restoreScreenFocus(key) {
  if (!key) return;
  const selector = String(key).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const target = screen.querySelector(`[data-focus-key="${selector}"]`);
  if (target) target.focus({ preventScroll: true });
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

/** Removes stale Focus roots from the current vault and updates the local preference. */
function reconcileCurrentAreaFocus() {
  const reconciled = reconcileAreaFocus(state.areaFocus, (state.vault?.areas ?? []).map((area) => area.path));
  if (JSON.stringify(reconciled) === JSON.stringify(state.areaFocus)) return;
  state.areaFocus = reconciled;
  if (!writeAreaFocus(localStorage, state.areaFocus)) state.areaFocusStorageError = true;
}

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
  reconcileCurrentAreaFocus();
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
  state.goalDetail = null;
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
  // The screen under the quick Document layer must not rebuild while that
  // layer is open: a rebuild would discard the exact surface Escape reveals.
  // Closing and promoting the layer are the only paths that repaint it
  // (design-quick-returnable-document-search D8).
  if (state.documentPeek || state.goTo) return updateHeader();
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

/** Reports one connection transition with only local runtime identifiers. */
function transitionConnection(phase, trigger, error = null) {
  const previous = state.connection.phase;
  const now = Date.now();
  state.connection.phase = phase;
  state.connection.lastFailureAt = phase === "online" ? null : now;
  state.connection.lastError = error ? {
    kind: error.kind || "unknown",
    status: Number(error.status || 0),
    path: error.path || "",
    operationId: error.operationId || "",
  } : null;
  if (previous === phase) return;
  actionTelemetry.record("connection", `${previous}->${phase}`, {
    trigger,
    retryAttempt: state.connection.retryAttempt,
    lastSuccessAgeMs: state.connection.lastSuccessAt ? now - state.connection.lastSuccessAt : 0,
    gatewayBoot: state.connection.gatewayBoot,
    controllerBoot: state.connection.controllerBoot,
    eventStream: state.connection.eventStream,
    status: Number(error?.status || 0),
    operationId: error?.operationId || "",
  });
}

/** Tracks the stable gateway and replaceable controller as separate identities. */
function noteRuntimeIdentity(gatewayBoot, controllerBoot) {
  if (controllerBoot) state.connection.controllerBoot = controllerBoot;
  if (!gatewayBoot) return;
  if (!state.connection.gatewayBoot) {
    state.connection.gatewayBoot = gatewayBoot;
    return;
  }
  if (gatewayBoot === state.connection.gatewayBoot) return;
  state.connection.gatewayBoot = gatewayBoot;
  const reloadKey = "agent-shell.reloaded-gateway-boot";
  if (sessionStorage.getItem(reloadKey) === gatewayBoot) return;
  sessionStorage.setItem(reloadKey, gatewayBoot);
  location.reload();
}

/** Records native event-stream recovery without declaring the gateway offline. */
function noteEventStream(eventStream) {
  if (state.connection.eventStream === eventStream) return;
  state.connection.eventStream = eventStream;
  actionTelemetry.record("connection", `event-stream:${eventStream}`, {
    retryAttempt: state.connection.retryAttempt,
    gatewayBoot: state.connection.gatewayBoot,
    controllerBoot: state.connection.controllerBoot,
    eventStream,
  });
}

/** Returns the next bounded delay for projection recovery. */
function recoveryDelay() {
  const delays = [250, 500, 1_000, 2_000];
  const attempt = state.connection.retryAttempt;
  state.connection.retryAttempt += 1;
  const delay = delays[Math.min(attempt, delays.length - 1)];
  state.connection.nextRetryAt = Date.now() + delay;
  return delay;
}

/** Uses gateway health to classify one material projection error. */
async function diagnoseConnection(error, trigger) {
  try {
    const health = await healthApi("/api/health");
    noteRuntimeIdentity(health.boot || "", health.controller?.boot || "");
    transitionConnection("controller-recovering", trigger, error);
  } catch {
    transitionConnection("transport-retrying", trigger, error);
  }
  updateStatusPill();
  return recoveryDelay();
}

/** Refreshes the vault, program, and session projections from the server. */
async function performRefresh({ initial = false, trigger = initial ? "initial" : "direct" } = {}) {
  try {
    const [vault, sessionPayload, programs] = await readProjection(api);
    state.vault = vault;
    state.sessions = sessionPayload.sessions || [];
    state.pipelines = sessionPayload.pipelines || [];
    state.brains = sessionPayload.brains || [];
    state.contextHandoverTokens = Number(sessionPayload.contextHandoverTokens || 0);
    forgetVerdictLines();
    state.programs = {
      operations: programs.operations || [],
      processes: programs.processes || [],
      problems: programs.problems || [],
      areas: programs.areas || [],
      liveCount: Number(programs.liveCount || 0),
    };
    state.caffeinate = Boolean(sessionPayload.caffeinate);
    state.pendingCommits = sessionPayload.pendingCommits || [];
    state.deployedCommit = sessionPayload.deployedCommit || "";
    state.currentCommit = sessionPayload.currentCommit || "";
    state.updateAvailable = Boolean(sessionPayload.sourceChanged);
    state.rebuild = sessionPayload.rebuild || null;
    state.goalCleanups = sessionPayload.goalCleanups || [];
    state.rebuilding = ["building", "restarting", "reconnecting"].includes(state.rebuild?.phase);
    const gatewayRuntime = sessionPayload.runtime?.gateway;
    noteRuntimeIdentity(gatewayRuntime?.boot || sessionPayload.boot || "", gatewayRuntime?.controller?.boot || sessionPayload.boot || "");
    reconcileCurrentAreaFocus();
    state.loading = false;
    state.error = "";
    state.connection.lastSuccessAt = Date.now();
    state.connection.retryAttempt = 0;
    state.connection.nextRetryAt = null;
    transitionConnection("online", trigger);
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
    updateStatusPill();
    if (state.goTo) renderGoToList();
    paint(initial);
    return null;
  } catch (error) {
    state.loading = false;
    if (error?.status === 429) {
      if (!state.vault) {
        state.error = error.message;
        paint(true);
      }
      return { retryAfterMs: error.retryAfterMs || 250 };
    }
    if (state.vault) {
      return { retryAfterMs: await diagnoseConnection(error, trigger) };
    }
    state.error = error.message;
    const retryAfterMs = await diagnoseConnection(error, trigger);
    paint(true);
    return { retryAfterMs };
  }
}

const refreshCoordinator = createRefreshCoordinator(performRefresh);

/** Requests one serialized projection refresh. */
function refresh(options = {}) { return refreshCoordinator.request(options); }

/** Keeps the quiet connection pill and the menu's update hint current. */
function updateStatusPill() {
  const phase = state.rebuild?.phase;
  const labels = { building: "Building Tangent…", restarting: "Restarting Tangent…", reconnecting: "Reconnecting to Tangent…" };
  const text = state.rebuilding
    ? labels[phase] || "Updating Tangent…"
    : state.connection.phase === "controller-recovering"
      ? "Work data delayed · reconnecting"
      : state.connection.phase === "transport-retrying"
        ? "Connection lost · retrying"
      : "";
  statusPill.textContent = text;
  statusPill.hidden = !text;
  awakeButton.classList.toggle("active", state.caffeinate);
  awakeButton.title = state.caffeinate ? "Let Mac sleep normally" : "Keep Mac awake";
  awakeButton.setAttribute("aria-label", awakeButton.title);
  backButton.classList.toggle("has-update", state.updateAvailable);
  const updateItem = shellMenu.querySelector("#menu-update");
  if (updateItem) {
    updateItem.hidden = !state.updateAvailable;
    const count = state.pendingCommits.length;
    updateItem.textContent = count ? `Update available · ${count} commit${count === 1 ? "" : "s"}` : "Update available";
  }
  renderUpdatePanel(phase);
}

/** Shows durable rebuild progress without blocking the current screen. */
function renderUpdatePanel(phase = state.rebuild?.phase) {
  const panel = document.querySelector("#update-panel");
  if (!panel) return;
  const operation = state.rebuild;
  const dismissed = operation?.id && localStorage.getItem("agent-shell.dismissed-rebuild") === operation.id;
  if (!operation || dismissed || operation.phase === "succeeded") {
    panel.hidden = true;
    if (operation?.phase === "succeeded" && operation.id && localStorage.getItem("agent-shell.seen-rebuild") !== operation.id) {
      localStorage.setItem("agent-shell.seen-rebuild", operation.id);
      const count = operation.commits?.length || 0;
      showToast(`Tangent reloaded${count ? ` · ${count} commit${count === 1 ? "" : "s"}` : ""}.`);
    }
    return;
  }
  const count = operation.commits?.length || 0;
  const titles = { ready: `${count || "No new"} commit${count === 1 ? "" : "s"} ready`, building: `Building ${count || "the deployed"} commit${count === 1 ? "" : "s"}`, restarting: "Restarting Tangent", reconnecting: "Reconnecting to Tangent", failed: "Build failed" };
  panel.querySelector("#update-panel-title").textContent = titles[phase] || "Updating Tangent";
  panel.querySelector("#update-panel-copy").textContent = phase === "ready"
    ? count
      ? "Agent sessions keep running in tmux. Commits included:"
      : "No new commits. The deployed commit will be rebuilt. Agent sessions keep running in tmux."
    : phase === "failed"
    ? operation.error || "The build did not complete. The current Agent Shell is still available."
    : "Agent sessions keep running in tmux. You can continue to use this screen.";
  const commitList = panel.querySelector("#update-panel-commits");
  if (commitList) {
    const listed = phase === "ready" ? operation.commits ?? [] : [];
    commitList.innerHTML = rebuildCommitRows(listed);
    commitList.hidden = !listed.length;
  }
  panel.querySelector("#update-panel-actions").innerHTML = phase === "ready"
    ? `<button class="quiet-button" type="button" data-rebuild-dismiss>Cancel</button><button class="primary-button" type="button" data-rebuild-start>Rebuild and restart</button>`
    : phase === "failed"
    ? `<button class="quiet-button" type="button" data-rebuild-log>Copy log path</button><button class="primary-button" type="button" data-rebuild-retry>Try again</button><button class="quiet-button" type="button" data-rebuild-dismiss>Dismiss</button>`
    : `<button class="quiet-button" type="button" data-rebuild-dismiss>Hide</button>`;
  panel.hidden = false;
}

/** Opens or closes the Agent Shell menu under the top-left title. */
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

/** Opens the top-level prompt bestiary. */
function showPrompts() {
  state.view = "prompts";
  state.renderedKey = "";
  paint(true);
}

/** Loads one Goal's exact current execution prompt. */
async function loadGoalPrompt(file, mode = "goal") {
  if (!file) return showToast("Choose a Goal first.");
  state.bestiarySelection = mode === "pipeline"
    ? { ...state.bestiarySelection, mode: "messages", lifecycle: "brain-pipeline", transition: "nextAssignment" }
    : { ...state.bestiarySelection, mode: "messages", lifecycle: "brain-solo", transition: "assignment" };
  state.promptInspector = { loading: true, title: "", text: "", error: "", file, area: "" };
  paint(true);
  try {
    const brief = await api(`/api/goals/brief?file=${encodeURIComponent(file)}&mode=${encodeURIComponent(mode)}`);
    const label = mode === "pipeline" ? "Pipeline step" : mode === "collaborate" ? "Collaboration" : "Goal assignment";
    state.promptInspector = { loading: false, title: `${label} · ${brief.goal.title}`, text: brief.markdown, error: "", file, area: "" };
  } catch (error) {
    state.promptInspector = { loading: false, title: "", text: "", error: error.message, file, area: "" };
  }
  paint(true);
}

/** Loads one live brain generation's exact current opening prompt. */
async function loadBrainPrompt(area) {
  if (!area) return showToast("Choose a brain first.");
  state.bestiarySelection = { ...state.bestiarySelection, mode: "messages", lifecycle: "plan", transition: "work" };
  state.promptInspector = { loading: true, title: "", text: "", error: "", file: "", area };
  paint(true);
  try {
    const result = await api(`/api/brains/show?area=${encodeURIComponent(area)}`);
    state.promptInspector = { loading: false, title: `Brain generation · ${area}`, text: result.prompt, error: "", file: "", area };
  } catch (error) {
    state.promptInspector = { loading: false, title: "", text: "", error: error.message, file: "", area };
  }
  paint(true);
}

/** Closes the exact prompt preview without leaving the bestiary. */
function closePromptPreview() {
  state.promptInspector = { ...state.promptInspector, loading: false, title: "", text: "", error: "" };
  paint(true);
}

/** Selects one canonical lifecycle and resets its boundary selection. */
function selectBestiaryLifecycle(lifecycle) {
  state.bestiarySelection = { ...state.bestiarySelection, lifecycle, transition: "" };
  paint(true);
}

/** Selects one boundary inside the current canonical lifecycle. */
function selectBestiaryTransition(transition) {
  state.bestiarySelection = { ...state.bestiarySelection, transition };
  paint(true);
}

/** Selects the concept map, lifecycle guide, or exact message contracts. */
function selectModelMode(mode) {
  state.bestiarySelection = { ...state.bestiarySelection, mode };
  paint(true);
}

/** Selects one canonical concept without changing current Tangent data. */
function selectModelConcept(concept) {
  state.bestiarySelection = { ...state.bestiarySelection, concept };
  paint(true);
}

bindShellEvents({
  shell: { state, post, paint, refresh, showToast },
  chrome: {
    screen, backButton, workTab, areasTab, promptsTab, findButton, secondaryAction, shellMenu, goToButton, goToLayer,
    goToInput, modalLayer, documentPeekLayer, terminalFit: terminalController.fit, KEYMAP, shortcutMatches, shortcutKbd, toggleShellMenu,
    confirmRebuild, reloadChanges, openGoTo, closeGoTo, renderGoToList, chooseGoToRow, showWork, showAreas, showPrompts, restoreReturnPoint,
    showDecision, showDescribe, toggleAwake, openModal, closeModal, modalConfirm: getModalConfirm, openSessionLayer, closeSessionLayer,
  },
  prompts: {
    loadGoalPrompt, loadBrainPrompt, closePromptPreview, selectBestiaryLifecycle, selectBestiaryTransition,
    selectModelMode, selectModelConcept,
  },
  work: {
    selectGoal, rememberGoal, openGoalRun, goalByFile, currentGoal, sessionForGoal, startBrain, brainForAreaCard,
    openBrainSession, openOrStartBrain, toggleBrainPopover, confirmStopBrain, saveDescribeDraft, saveDescribeSession, describeWorkSession,
    openDescribeSession, addDescribeSource,
    openGoalAgent, launchOpenSession, confirmStop, confirmComplete, confirmWontDo, openRequest, openQuestionsReview, openAreaCapture, sendVerdict,
    replyAboutRow, openAreaFocusPicker, cancelAreaFocusPicker, toggleAreaFocusDraft, updateAreaFocusQuery,
    applyAreaFocus, clearAreaFocus, renderWork, paintWorkCaption, describeLaunchArea, describeWorkSessions,
    goalGroupRoot, setSubgoalsExpanded, toggleSubgoals, setWorkAreaFolded, toggleWorkArea,
  },
  areas: {
    showAreasAt, beginAreaCreate, beginAreaMove, confirmAreaMove, cancelDescribe, areaIsFolded,
    saveExpandedAreas, revealArea, setAreaStatus, preferredArea, areaLabel, loadAreaJournal,
  },
  programs: {
    showProgramCreate, selectProgram, openProgramSession, controlProgram, performProgramAction, currentProgram,
    programAreaDirectory,
  },
  launch: {
    syncDescribeDraft, launchSelection, launchRequestFields, syncLaunchDraft,
    launchStepsForRecord, toggleDefaultAgents, editDefaultAgent, setDefaultAgentMode, saveLaunchDefault, showHarnessEditor, leaveHarnessEditor, saveHarnesses,
    replaceGoalAttempt, launchOptionsFor, pipelineRecordForGoal, loadLaunchStep,
    DESCRIBE_LAUNCH_TARGET, BRAIN_LAUNCH_TARGET, DEFAULT_AGENTS_TARGET,
  },
  documents: {
    openDocument, navigateDocumentHistory, openVaultLink, openDocumentHeading, openCommentComposer, setCommentScope,
    cancelCommentComposer, submitCommentComposer, commentIdentity, syncCommentCursor,
    activeCommentIdentity, focusCommentIdentity, editActiveComment, replyToActiveComment, resolveActiveComment, stepComment, saveVisibleIdea,
    notifyDocumentComments, refreshDocument, leaveReader, updateSelectionCommentButton, openReaderAgent,
    closeDocumentPeek, promoteDocumentPeek, retryDocumentPeek, navigateDocumentPeekHistory, openPeekLink, openPeekHeading,
    leaveQuickPath,
  },
});

// localStorage is shared by Agent Shell tabs. Apply another tab's receipt
// before the next server refresh so one dismissed event stays hidden everywhere.
window.addEventListener("storage", (event) => {
  if (event.key !== ASK_DISMISSALS_KEY) return;
  state.dismissedAskIds = readDismissedAskIds(localStorage);
  paint(true);
});

void (async () => {
  await refresh({ initial: true });
  if (requestedDocument) await openDocument(requestedDocument);
  else if (requestedGoal) selectGoal(requestedGoal);
  else if (state.view === "areas") window.setTimeout(() => {
    const input = document.querySelector("#area-search");
    input?.focus();
    input?.select();
  }, 0);
})();
// Mutations and reconciliation push invalidations. The slow timer is only a
// recovery path for a suspended browser or a dropped event stream.
startRefreshLifecycle(refresh, globalThis, noteEventStream);
startRebuildRefresh(() => state.rebuilding, refresh);

// DOM-level exports keep tests on the module boundary instead of rebuilding
// the old order-dependent browser globals.
export { areaMapView, areaQuestions, markdownHeadings, markdownToHtml, refresh, showDescribe };
