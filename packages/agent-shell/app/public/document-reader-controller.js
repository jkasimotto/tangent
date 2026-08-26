import { markdownHeadingAnchor } from "./markdown-structure.js";

/** Creates the Document controller from shell, rendering, Work, and navigation ports. */
export function createDocumentReaderController({ shell, rendering, work, navigation }) {
  const { state, api, post, paint, showToast, screen } = shell;
  const { documentComments, markdownHeadings, documentOutlineItems, documentGoal, renderDocumentArticle } = rendering;
  const { goalByFile, currentGoal, sessionsForGoal, humanName, areaLabel, agentReference } = work;
  const {
    decodeLink, vaultLinkRecord, revealArea, captureReturnPoint, restoreReturnPoint, selectGoal, showWorkAt,
    openGoalAgent,
  } = navigation;
  /** Stores the current reader position for later navigation. */
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
    const headings = documentOutlineItems();
    const selectedSection = selection ? [...headings].reverse().find((heading) => heading.line <= selection.line) ?? null : null;
    const section = selectedSection ?? readerSectionInView();
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

  /** Applies a comment at its requested anchor; a stale selection must never change scope. */
  function composerResult(document, composer) {
    const helper = documentComments;
    if (composer.editing) {
      const match = (document.comments ?? []).find((comment) => comment.markup === composer.editing.markup && comment.line === composer.editing.line)
        ?? (document.comments ?? []).find((comment) => comment.markup === composer.editing.markup);
      if (!match) {
        const fallback = helper.insertComment(document.text, { kind: "document" }, composer.text);
        return { ...fallback, notice: "The original comment changed, so the edited comment was added to the Document." };
      }
      return { text: helper.replaceCommentText(document.text, match, composer.text) };
    }
    const exact = helper.insertComment(document.text, composer.anchor, composer.text);
    return exact;
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
    let placementNotice = attempt.notice ?? "";
    let previous = state.document.text;
    let result = await saveDocumentText(attempt.text, summary);
    if (result.status === 409 && result.data.current) {
      state.document = { ...state.document, ...result.data.current };
      attempt = composerResult(state.document, composer);
      if (attempt.error) return noteInComposer(attempt.error);
      placementNotice = attempt.notice ?? placementNotice;
      previous = state.document.text;
      result = await saveDocumentText(attempt.text, summary);
    }
    if (!result.ok) return noteInComposer(result.data.error || "The comment did not save.");
    const wasEditing = Boolean(composer.editing);
    state.commentComposer = null;
    adoptSavedDocument(result.data);
    showToast(placementNotice || (wasEditing ? "Comment updated." : "Comment added."), {
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

  /** Tells the exact live Area brain that Julian finished commenting. */
  async function notifyDocumentComments() {
    if (!state.document?.file) return;
    try {
      const result = await post("/api/document/notify-comments", { file: state.document.file });
      showToast(`Notified the ${result.brain} brain about ${result.comments} comment${result.comments === 1 ? "" : "s"}.`);
    } catch (error) {
      showToast(error.message);
      await refreshDocument();
    }
  }

  /** Opens the explicit next-step decision page. */

  return { rememberDocumentPosition, restoreDocumentPosition, updateDocumentTrail, openDocument, navigateDocumentHistory, openVaultLink, openDocumentHeading, bindDocumentReader, refreshDocument, commentComposerKey, readerBlockOf, readerSelection, updateSelectionCommentButton, hideSelectionCommentButton, readerSectionInView, documentTitleLine, openCommentComposer, setCommentScope, editComment, syncCommentDraft, cancelCommentComposer, noteInComposer, composerResult, saveDocumentText, adoptSavedDocument, restoreDocumentText, submitCommentComposer, removeComment, stepComment, saveVisibleIdea, notifyDocumentComments };
}
