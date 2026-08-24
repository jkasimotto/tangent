import { markdownHeadings } from "./markdown-structure.js";
import { escapeHtml } from "./text-format.js";
import { activeBrainForArea } from "./brain-ownership.js";

/** Creates the document reader view product boundary. */
export function createDocumentReaderView({ state, markdownToHtml, currentGoal, goalByFile, sessionsForGoal, areaLabel, areaPath, humanName }) {
  /** The closest ancestor brain with a currently live session. */
  function activeDocumentBrain() {
    return activeBrainForArea(state.brains, state.document?.area);
  }

  /** Returns the Goal associated with the active Document. */
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
    const brain = activeDocumentBrain();
    const comments = state.document?.comments?.length ?? 0;
    const notifyLabel = brain ? `Tell ${brain.area} brain I added comments` : "No active brain to notify";
    const notifyTitle = !brain ? `No active brain covers ${state.document?.area ?? "this Area"}` : !comments ? "Add a comment before you notify the brain" : notifyLabel;
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
          ${brain ? `<details class="reader-brain-actions">
            <summary title="${escapeHtml(notifyLabel)}"><span>${escapeHtml(notifyLabel)}</span><i aria-hidden="true">⌄</i></summary>
            <div class="reader-brain-actions-popover" role="group" aria-label="Brain actions">
              <button class="reader-notify-brain" type="button" data-notify-document-comments title="${escapeHtml(notifyTitle)}" ${comments ? "" : "disabled"}>Tell brain I added comments</button>
              <button type="button" data-open-brain="${escapeHtml(brain.session)}">Go to brain</button>
            </div>
          </details>` : `<button class="reader-notify-brain" type="button" title="${escapeHtml(notifyTitle)}" disabled>${escapeHtml(notifyLabel)}</button>`}
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

  return { documentGoal, readerDocuments, documentOutlineItems, documentOutlineLinks, documentCommentControls, documentOutline, documentOutlineMenu, documentPicker, documentToolbar, renderDocumentArticle, renderDocument };
}
