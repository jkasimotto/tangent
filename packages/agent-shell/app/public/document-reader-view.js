import { markdownHeadings } from "./markdown-structure.js";
import { escapeHtml } from "./text-format.js";
import { activeBrainForArea } from "./brain-ownership.js";

/** Creates the document reader view product boundary. */
export function createDocumentReaderView({ state, markdownToHtml, currentGoal, goalByFile, sessionsForGoal, areaLabel, areaPath, humanName }) {
  /** One non-repainting copy control; event bindings update its two text nodes. */
  function documentCopyButton(surface) {
    return `<button class="quiet-button document-copy-action" type="button" data-document-copy="${surface}" aria-keyshortcuts="y" title="Copy the selection, or the whole Document (y)"><span data-copy-label>Copy</span> <kbd>y</kbd><span class="visually-hidden" data-copy-status aria-live="polite" aria-atomic="true"></span></button>`;
  }
  /** The exact Document Area brain with a currently live session. */
  function activeDocumentBrain() {
    return activeBrainForArea(state.brains, state.document?.area);
  }

  /** Returns the Goal associated with the active Document. */
  function documentGoal() {
    if (state.goalDetail?.goal?.file === state.document?.file) {
      return { ...(goalByFile(state.goalDetail.goal.file) ?? {}), ...state.goalDetail.goal };
    }
    const history = state.document?.goalHistory ?? [];
    /** Tests whether a linked Goal remains active. */
    const open = (goal) => goal && !["done", "dropped", "parked", "deferred"].includes(goal.status);
    const current = currentGoal();
    if (open(current) && history.some((item) => item.file === current.file)) return current;
    return [...history].reverse().map((item) => goalByFile(item.file)).find(open) ?? null;
  }

  /** Returns the nearby Documents for the compact reader picker. */
  function readerDocuments(goal) {
    const areaDocuments = (state.vault?.documents ?? []).filter((document) => document.kind === "document" && document.area === state.document?.area);
    const related = state.goalDetail?.goal && state.goalDetail.goal.file === goal?.file ? state.goalDetail.relatedDocuments : null;
    const documents = [...(related?.length ? related : goal?.documents?.length ? goal.documents : areaDocuments)];
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
          <button type="button" data-comment-step="-1" aria-label="Previous comment" aria-keyshortcuts="Shift+N" title="Previous comment (N)">‹</button>
          <span aria-live="polite">${count} comment${count === 1 ? "" : "s"}</span>
          <button type="button" data-comment-step="1" aria-label="Next comment" aria-keyshortcuts="n" title="Next comment (n)">›</button>
        </div>`
      : "";
    return `${nav}<button class="reader-comment-action" type="button" data-comment-new aria-keyshortcuts="c" title="Comment on the selected words or this section (c)">Comment <kbd>c</kbd></button>`;
  }

  /** The same comment movement and creation controls used by the quick reader. */
  function peekCommentControls(source) {
    const count = source?.comments?.length ?? 0;
    const nav = count
      ? `<div class="document-comment-nav document-peek-comment-nav" role="group" aria-label="Comments">
          <button type="button" data-document-peek-comment-step="-1" aria-label="Previous comment" aria-keyshortcuts="Shift+N" title="Previous comment (N)">‹</button>
          <span>${count}</span>
          <button type="button" data-document-peek-comment-step="1" aria-label="Next comment" aria-keyshortcuts="n" title="Next comment (n)">›</button>
        </div>`
      : "";
    return `${nav}${source?.repositoryFile ? "" : `<button class="reader-comment-action" type="button" data-comment-new aria-keyshortcuts="c" title="Comment on the selected words or this section (c)">Comment <kbd>c</kbd></button>`}`;
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
    const repositoryFile = state.document?.repositoryFile === true;
    const goalCanOpenAgent = goal && (sessionsForGoal(goal).length || !state.goalDetail || ["open", "active"].includes(goal.status));
    const notifyLabel = brain ? `Tell ${brain.area} brain I added comments` : "No active brain to notify";
    const notifyTitle = !brain ? `No active brain covers ${state.document?.area ?? "this Area"}` : !comments ? "Add a comment before you notify the brain" : notifyLabel;
    return `
      <header class="document-reader-toolbar">
        <div class="document-reader-route">
          <div class="document-history-controls" aria-label="Reading history">
            <button type="button" data-document-history="back" aria-label="Previous Document" aria-keyshortcuts="Shift+H" title="Previous Document (H)" ${canGoBack ? "" : "disabled"}>←</button>
            <button type="button" data-document-history="forward" aria-label="Next Document" aria-keyshortcuts="Shift+L" title="Next Document (L)" ${canGoForward ? "" : "disabled"}>→</button>
          </div>
          ${areaPath(state.document?.area)}
          <span class="document-route-separator" aria-hidden="true">/</span>
          ${documentPicker(goal)}
        </div>
        <div class="document-reader-actions">
          ${documentOutlineMenu()}
          ${documentCopyButton("full")}
          ${repositoryFile ? "" : documentCommentControls()}
          ${state.goalDetail?.goal ? "" : `<button class="document-keys-action" type="button" data-document-keys aria-keyshortcuts="Shift+/" title="Document reading keys (?)">Keys <kbd>?</kbd></button>`}
          ${repositoryFile ? "" : brain ? `<details class="reader-brain-actions">
            <summary title="${escapeHtml(notifyLabel)}"><span>${escapeHtml(notifyLabel)}</span><i aria-hidden="true">⌄</i></summary>
            <div class="reader-brain-actions-popover" role="group" aria-label="Brain actions">
              <button class="reader-notify-brain" type="button" data-notify-document-comments title="${escapeHtml(notifyTitle)}" ${comments ? "" : "disabled"}>Tell brain I added comments</button>
              <button type="button" data-open-brain="${escapeHtml(brain.session)}">Go to brain</button>
            </div>
          </details>` : `<button class="reader-notify-brain" type="button" title="${escapeHtml(notifyTitle)}" disabled>${escapeHtml(notifyLabel)}</button>`}
          ${state.goalDetail?.goal ? `<button class="quiet-button reader-goal-actions" type="button" data-reader-goal-actions="${escapeHtml(state.goalDetail.goal.file)}" data-focus-key="reader:goal-actions:${escapeHtml(state.goalDetail.goal.file)}" aria-keyshortcuts="Shift+/" title="Goal keys (?)">Keys <kbd>?</kbd></button>` : ""}
          ${goalCanOpenAgent ? `<button class="reader-agent-action" type="button" data-open-reader-agent>Open agent</button>` : ""}
          <button class="reader-close-action" type="button" data-leave-document aria-keyshortcuts="Escape" title="Leave the Document reader (Esc)">Close <kbd>esc</kbd></button>
        </div>
      </header>`;
  }

  /** One terse launch label from an assignment or attempt snapshot. */
  function goalLaunchLabel(item) {
    const launch = item?.resolvedLaunch ?? item?.launch ?? null;
    if (!launch) return item?.command ?? "";
    if (typeof launch === "string") return launch;
    return [launch.harness, launch.model, launch.effort].filter(Boolean).join("/") || launch.command || "";
  }

  /** The `used of window` reading of one attempt's last context fill, or "". */
  function attemptFillLabel(fill) {
    if (!fill || typeof fill.usedTokens !== "number") return "";
    const window = fill.windowTokens ? ` of ${Math.round(fill.windowTokens / 1000)}k` : "";
    return `${Math.round(fill.usedTokens / 1000)}k${window}`;
  }

  /**
   * One attempt in the Goal reader with its Resume verb (ADR-0042). The verb
   * prints its key. A live attempt attaches. A dead one with a resume command
   * opens a new session with the command typed. Nothing hidden: an attempt
   * that cannot be resumed says why in place of the verb.
   */
  function attemptHistoryRow(item, goalFile) {
    const resume = item.resume ?? {};
    const facts = [item.status || item.assignmentStatus, goalLaunchLabel(item), attemptFillLabel(resume.contextFill ?? item.contextFill)].filter(Boolean).join(" · ");
    const conversation = resume.conversationId ? `<code class="attempt-conversation" title="Conversation id">${escapeHtml(resume.conversationId)}</code>` : "";
    const verb = resume.live || resume.command
      ? `<button class="quiet-button" type="button" data-resume-agent="${escapeHtml(item.session ?? "")}"${resume.conversationId ? ` data-resume-conversation="${escapeHtml(resume.conversationId)}"` : ""} aria-keyshortcuts="r" title="${escapeHtml(resume.live ? "Attach to the live Agent (r)" : `Open a new unbound Agent in ${resume.cwd || "its folder"}`)}">${resume.live ? "Open Agent" : "Resume"} <kbd>r</kbd></button>`
      : `<small class="attempt-no-resume">${escapeHtml(resume.conversationId ? "No resume command for this harness." : "No conversation id recorded.")}</small>`;
    return `<li><strong>${escapeHtml(item.session || item.id || "Attempt")}</strong><small>${escapeHtml(facts)}</small>${conversation}${item.current ? `<em>current</em>` : ""}${verb}</li>`;
  }

  /** Renders one complete server-owned Goal read model above its Markdown. */
  function goalDetailPanel() {
    const detail = state.goalDetail;
    if (!detail) return "";
    if (detail.error) return `<section class="goal-reader-detail error" role="alert"><p>${escapeHtml(detail.error)}</p></section>`;
    const goal = detail.goal ?? {};
    const dependencies = detail.dependencies ?? {};
    const references = [
      ...(dependencies.prerequisites ?? []).map((item) => ({ ...item, relation: "Needs" })),
      ...(dependencies.requiredBy ?? []).map((item) => ({ ...item, relation: "Required by" })),
      ...(dependencies.unresolvedReferences ?? []).map((item) => ({ file: String(item), title: String(item), status: "missing", relation: "Missing" })),
    ];
    const assignments = detail.queue?.assignments ?? detail.queue?.steps ?? [];
    const attempts = detail.attempts ?? [];
    const relatedDocuments = detail.relatedDocuments ?? [];
    const cards = detail.cards ?? [];
    const runOptions = (detail.runs ?? []).map((item) => `<option value="${escapeHtml(String(item.run))}"${item.run === detail.job?.run ? " selected" : ""}>Run ${escapeHtml(String(item.run))} · ${escapeHtml(item.status)}</option>`).join("");
    /** Renders a link or a vault document action. */
    const cardUrl = (url, label) => url?.href ? `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : `<button type="button" data-open-document="${escapeHtml(url?.file ?? "")}">${escapeHtml(label)}</button>`;
    /** Renders the fields for one Goal card. */
    const cardBody = (card) => {
      const f = card.fields ?? {};
      if (card.kind === "copy") return `<pre tabindex="0">${escapeHtml(f.text)}</pre>`;
      if (card.kind === "link") return cardUrl(f.url, f.label);
      if (card.kind === "links") return `<ul>${(f.items ?? []).map((item) => `<li>${cardUrl(item.url, item.label)}</li>`).join("")}</ul>`;
      if (card.kind === "progress") return `<ol>${(f.steps ?? []).map((item, index) => `<li><span aria-hidden="true">${item.status === "done" ? "✓" : item.status === "current" || f.current === index + 1 ? "→" : "○"}</span> ${escapeHtml(item.label)} <small>${escapeHtml(item.status === "current" || f.current === index + 1 ? "current" : item.status)}</small></li>`).join("")}</ol>`;
      if (card.kind === "checklist") return `<ul>${(f.items ?? []).map((item) => `<li><span aria-hidden="true">${item.done ? "☑" : "☐"}</span> ${escapeHtml(item.label)} <small>${item.done ? "done" : "open"}</small></li>`).join("")}</ul>`;
      if (card.kind === "commits") return `<ul>${(f.commits ?? []).map((item) => `<li><code>${escapeHtml(item.hash)}</code> ${item.url ? cardUrl(item.url, item.subject) : escapeHtml(item.subject)}</li>`).join("")}</ul>`;
      return `<ul>${(f.items ?? []).map((item) => `<li>${cardUrl(item.url, `${item.id} · ${item.title}`)} <small>${escapeHtml(item.state)}</small></li>`).join("")}</ul>`;
    };
    return `<section class="goal-reader-detail" aria-label="Goal details">
      <div class="goal-reader-facts">
        <span><small>State</small><strong>${escapeHtml(goal.status === "deferred" ? "parked" : goal.status || "open")}</strong></span>
        <span><small>Done when</small><strong>${escapeHtml(goal.doneWhen || goal.done_when || "Not recorded")}</strong></span>
        ${detail.current?.session ? `<span><small>Current agent</small><strong>${escapeHtml(detail.current.session)}</strong></span>` : ""}
      </div>
      <div class="goal-reader-sections">
        <section><h2>Dependencies</h2>${references.length ? `<ul>${references.map((item) => `<li><span>${escapeHtml(item.relation)}</span><strong>${escapeHtml(item.title || item.file || item.slug)}</strong><small>${escapeHtml(item.status || "open")}</small></li>`).join("")}</ul>` : `<p>None.</p>`}</section>
        <section><h2>Related Documents</h2>${relatedDocuments.length ? `<ul>${relatedDocuments.map((item) => { const record = typeof item === "string" ? { file: item, title: item } : item; const presented = record.presentedBy?.session ? `Presented by ${record.presentedBy.session}` : ""; return `<li><button type="button" data-open-document="${escapeHtml(record.file)}">${escapeHtml(record.title || record.file)}</button>${presented ? `<small>${escapeHtml(presented)}</small>` : ""}</li>`; }).join("")}</ul>` : `<p>None.</p>`}</section>
        ${cards.length || relatedDocuments.some((item) => item?.presentedBy) ? `<section><h2 id="presented" tabindex="-1">Presented</h2>${cards.map((card) => `<article class="presented-card-detail" aria-label="${escapeHtml(`${card.kind}: ${card.title}, presented by ${card.presentedBy?.session || "brain"}`)}"><h3>${escapeHtml(card.title)}</h3><small>${escapeHtml(card.kind)} · Presented by ${escapeHtml(card.presentedBy?.session || "brain")}</small>${cardBody(card)}</article>`).join("")}</section>` : ""}
        <section><h2>Job</h2>${runOptions ? `<label>Run <select data-job-run data-job-goal="${escapeHtml(goal.file)}">${runOptions}</select></label>` : ""}${assignments.length ? `<ol>${assignments.map((item, index) => `<li><span>${escapeHtml(String(item.index ?? index + 1))}</span><strong>${escapeHtml(item.instruction || item.label || "Assignment")}</strong><small>${escapeHtml([item.status, goalLaunchLabel(item)].filter(Boolean).join(" · "))}</small></li>`).join("")}</ol>` : `<p>No Assignments.</p>`}</section>
        <section><h2>Attempt history</h2>${attempts.length ? `<ol>${attempts.map((item) => attemptHistoryRow(item, goal.file)).join("")}</ol>` : `<p>No attempts.</p>`}</section>
      </div>
    </section>`;
  }

  /**
   * Renders one linked Markdown Document in the reading column. The Document
   * and its source file are arguments, because the quick Document layer shows
   * a file the screen is not showing
   * (design-quick-returnable-document-search 6.3).
   */
  function renderDocumentArticle(source = state.document, { readOnly = false } = {}) {
    if (!source) return `<div class="loading">Opening the Document…</div>`;
    readOnly = readOnly || source.readOnly === true;
    return `
      <article class="document-page">
        <header class="document-heading">
          <h1>${escapeHtml(source.title)}</h1>
          ${source.repositoryFile ? `<small>Repository file · comments off</small>` : ""}
        </header>
        ${!readOnly && source.file === state.goalDetail?.goal?.file ? goalDetailPanel() : ""}
        <div class="document-content">${markdownToHtml(source.text, { comments: source.comments ?? [], composer: readOnly ? null : state.commentComposer, readOnly, baseFile: source.file })}</div>
        <p class="document-source">Source: ${escapeHtml(source.file)}</p>
      </article>
      ${readOnly ? "" : `<button class="selection-comment-button" type="button" data-comment-new hidden aria-keyshortcuts="c" title="Comment on the selected words (c)">Comment <kbd>c</kbd></button>`}`;
  }

  /**
   * Renders the quick Document layer: a read-only reading column above the
   * screen or the session Julian was on. Escape closes it, and only
   * `Open full reader` leaves the quick path
   * (design-quick-returnable-document-search 5.2).
   */
  function renderDocumentPeek(peek) {
    const loaded = peek.document;
    const title = loaded?.title || peek.title || "Document";
    const area = loaded?.area ?? peek.area ?? "";
    const canGoBack = peek.trailIndex > 0;
    const canGoForward = peek.trailIndex >= 0 && peek.trailIndex < peek.trail.length - 1;
    const body = peek.error
      ? `<div class="document-peek-error" role="alert">
          <p>${escapeHtml(peek.error)}</p>
          <div class="document-peek-error-actions">
            <button class="primary-button" type="button" data-retry-document-peek data-peek-key="retry">Retry</button>
            <button class="quiet-button" type="button" data-close-document-peek data-peek-key="close-error" aria-keyshortcuts="Escape" title="Close quick reader (Esc)">Close <kbd>esc</kbd></button>
          </div>
        </div>`
      : loaded
        ? `<div class="document-peek-scroll" tabindex="-1" aria-label="Quick Document reading surface">${renderDocumentArticle(loaded, { readOnly: loaded.repositoryFile === true })}</div>`
        : `<div class="loading" role="status">Opening ${escapeHtml(title)}…</div>`;
    return `
      <section class="document-peek-surface" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" tabindex="-1">
        <header class="document-peek-header">
          <div class="document-peek-route">
            <div class="document-history-controls" aria-label="Reading history">
              <button type="button" data-document-peek-history="back" data-peek-key="back" aria-label="Previous Document" aria-keyshortcuts="Shift+H" title="Previous Document (H)" ${canGoBack ? "" : "disabled"}>←</button>
              <button type="button" data-document-peek-history="forward" data-peek-key="forward" aria-label="Next Document" aria-keyshortcuts="Shift+L" title="Next Document (L)" ${canGoForward ? "" : "disabled"}>→</button>
            </div>
            ${areaPath(area)}
            <span class="document-route-separator" aria-hidden="true">/</span>
            <strong class="document-peek-title">${escapeHtml(title)}</strong>
          </div>
          <div class="document-peek-actions">
            ${loaded ? documentCopyButton("quick") : ""}
            ${peekCommentControls(loaded)}
            <button class="quiet-button document-keys-action" type="button" data-document-keys aria-keyshortcuts="Shift+/" title="Document reading keys (?)">Keys <kbd>?</kbd></button>
            <button class="quiet-button" type="button" data-promote-document-peek data-peek-key="promote">Open full reader</button>
            <button class="quiet-button" type="button" data-close-document-peek data-peek-key="close" aria-keyshortcuts="Escape" title="Close quick reader (Esc)">Close <kbd>esc</kbd></button>
          </div>
        </header>
        ${body}
      </section>`;
  }

  /** Renders one calm Document reader with optional navigation at the edge. */
  function renderDocument() {
    if (!state.document) return `<div class="loading">Opening the Document…</div>`;
    const goal = documentGoal();
    return `
      <section class="document-reader">
        ${documentToolbar(goal)}
        <div class="document-reader-scroll" tabindex="-1" aria-label="Document reading surface">
          <div class="document-reader-grid">
            ${renderDocumentArticle()}
            ${documentOutline()}
          </div>
        </div>
      </section>`;
  }

  /** Releases the terminal, socket, and resize observer. */

  return { documentGoal, readerDocuments, documentOutlineItems, documentOutlineLinks, documentCommentControls, documentOutline, documentOutlineMenu, documentPicker, documentToolbar, renderDocumentArticle, renderDocumentPeek, renderDocument };
}
