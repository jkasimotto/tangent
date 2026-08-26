import { markdownHeadingAnchor } from "./markdown-structure.js";

/** Creates the Document controller from shell, rendering, Work, and navigation ports. */
export function createDocumentReaderController({ shell, rendering, work, navigation }) {
  const { state, api, post, paint, showToast, screen, paintPeek, documentPeekLayer } = shell;
  const { documentComments, markdownHeadings, documentOutlineItems, documentGoal, renderDocumentArticle } = rendering;
  const { goalByFile, currentGoal, sessionsForGoal, humanName, areaLabel, agentReference } = work;
  const {
    decodeLink, vaultLinkRecord, revealArea, captureReturnPoint, restoreReturnPoint, selectGoal, showWorkAt,
    openGoalAgent, closeSessionLayer,
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

  // ---- The quick Document layer (design-quick-returnable-document-search) ----
  // Go to opens a Document above the screen or the session Julian is on, so
  // nothing below it repaints, unmounts, or loses its selection. The layer is
  // read-only: comments, agent actions, and writing need the full reader, and
  // `Open full reader` is the one control that leaves the quick path.

  // The request owner stays outside serializable state. Only the newest serial
  // may change the layer, so an out-of-order or late reply does nothing.
  let peekRequest = null;
  let peekSerial = 0;

  /** True while this read still owns the open layer and its file. */
  function peekOwnsResult(serial, file) {
    return Boolean(state.documentPeek) && state.documentPeek.requestSerial === serial && state.documentPeek.file === file;
  }

  /** The indexed title and Area for one vault file, for the layer's loading header. */
  function indexedDocument(file) {
    return (state.vault?.documents ?? []).find((record) => record.file === file) ?? null;
  }

  /** The scrolling reading column inside the quick layer. */
  function peekScroll() {
    return documentPeekLayer?.querySelector(".document-peek-scroll") ?? null;
  }

  /** Stores the quick layer's reading position for its private trail. */
  function rememberPeekPosition() {
    const scroll = peekScroll();
    if (state.documentPeek && scroll) state.documentPeek.positions.set(state.documentPeek.file, scroll.scrollTop);
  }

  /**
   * Restores a heading target or the saved position inside the quick layer.
   * Heading ids are looked up inside the layer: the reader below it can hold
   * the same ids, and it comes first in document order.
   */
  function restorePeekPosition(heading = "") {
    window.setTimeout(() => {
      const peek = state.documentPeek;
      const scroll = peekScroll();
      if (!scroll || !peek?.document) return;
      if (heading) return openPeekHeading(markdownHeadingAnchor(decodeLink(heading.split("#").at(-1)), new Map()));
      scroll.scrollTop = peek.positions.get(peek.file) || 0;
    }, 0);
  }

  /** Moves the quick layer to one of its own headings. */
  function openPeekHeading(id) {
    const selector = String(id).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    documentPeekLayer?.querySelector(`[id="${selector}"]`)?.scrollIntoView?.({ block: "start" });
  }

  /** Records one Document change in the quick layer's private trail. */
  function updatePeekTrail(file, mode, index) {
    const peek = state.documentPeek;
    if (mode === "jump") {
      peek.trailIndex = index;
      return;
    }
    if (peek.trail[peek.trailIndex] === file) return;
    peek.trail = peek.trail.slice(0, peek.trailIndex + 1);
    peek.trail.push(file);
    peek.trailIndex = peek.trail.length - 1;
  }

  /**
   * Opens one Document above the current surface. It never changes
   * `state.view`, never touches the terminal, and never stores a screen return
   * point, because everything below it stays mounted.
   */
  async function openDocumentPeek(file, { heading = "", trail = "push", trailIndex = -1, origin = null } = {}) {
    if (!file) return;
    const opening = !state.documentPeek;
    if (!opening) rememberPeekPosition();
    const record = indexedDocument(file);
    peekSerial += 1;
    const serial = peekSerial;
    peekRequest?.abort();
    const request = new AbortController();
    peekRequest = request;
    if (opening) {
      const focus = origin ?? (document.activeElement === document.body ? null : document.activeElement);
      state.documentPeek = {
        file, document: null, trail: [], trailIndex: -1, positions: new Map(),
        returnFocus: focus, returnFocusKey: focus?.dataset?.focusKey ?? "",
        requestSerial: serial, error: "", title: record?.title ?? "", area: record?.area ?? "",
      };
    } else {
      Object.assign(state.documentPeek, {
        file, document: null, requestSerial: serial, error: "",
        title: record?.title ?? "", area: record?.area ?? "",
      });
    }
    updatePeekTrail(file, trail, trailIndex);
    paintPeek();
    try {
      const loaded = await api(`/api/document?file=${encodeURIComponent(file)}`, { signal: request.signal });
      if (!peekOwnsResult(serial, file)) return;
      state.documentPeek.document = loaded;
      state.documentPeek.error = "";
      paintPeek();
      restorePeekPosition(heading);
    } catch (error) {
      // Cancellation is silent, and so is a late reply for a read the layer no
      // longer owns. Neither may replace what Julian is looking at.
      if (error?.kind === "abort") return;
      if (!peekOwnsResult(serial, file)) return;
      state.documentPeek.error = error.message;
      paintPeek();
    } finally {
      if (peekRequest === request) peekRequest = null;
    }
  }

  /** Reads the open Document again after a failed read. */
  function retryDocumentPeek() {
    const peek = state.documentPeek;
    if (!peek) return;
    return openDocumentPeek(peek.file, { trail: "jump", trailIndex: peek.trailIndex });
  }

  /** Moves backward or forward through the quick layer's private trail. */
  function navigateDocumentPeekHistory(direction) {
    const peek = state.documentPeek;
    if (!peek) return;
    const nextIndex = peek.trailIndex + (direction === "back" ? -1 : 1);
    const file = peek.trail[nextIndex];
    if (!file) return;
    return openDocumentPeek(file, { trail: "jump", trailIndex: nextIndex });
  }

  /**
   * Closes the quick layer and gives the keyboard back to the surface below.
   * The screen and the session layer were never changed, so there is nothing
   * to rebuild: focus is the only thing to put back.
   */
  function closeDocumentPeek() {
    const peek = state.documentPeek;
    if (!peek) return;
    peekRequest?.abort();
    peekRequest = null;
    peekSerial += 1;
    state.documentPeek = null;
    paintPeek();
    restorePeekFocus(peek);
  }

  /** Focuses the element the layer opened from, or the surface that replaced it. */
  function restorePeekFocus(peek) {
    const origin = peek.returnFocus;
    if (origin && origin !== document.body && origin.isConnected) {
      try { origin.focus({ preventScroll: true }); return; } catch {}
    }
    if (peek.returnFocusKey) {
      const selector = String(peek.returnFocusKey).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const target = screen.querySelector(`[data-focus-key="${selector}"]`);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    const terminal = state.sessionPeek ? document.querySelector("#session-layer-terminal .xterm-helper-textarea, #session-layer-terminal textarea") : null;
    try { (terminal ?? screen).focus({ preventScroll: true }); } catch {}
  }

  /**
   * Leaves the quick path for the full reader, with the same file and reading
   * position. Promotion means Julian chose Document work, so it also closes a
   * session presentation below: the reader is a screen, not a layer.
   */
  function promoteDocumentPeek() {
    const peek = state.documentPeek;
    if (!peek) return;
    rememberPeekPosition();
    const file = peek.file;
    const top = peek.positions.get(file) ?? 0;
    closeDocumentPeek();
    if (state.sessionPeek) closeSessionLayer();
    state.documentPositions.set(file, top);
    return openDocument(file);
  }

  /** Leaves the quick path for one explicit Goal or Area route. */
  function leaveQuickPath() {
    closeDocumentPeek();
    if (state.sessionPeek) closeSessionLayer();
  }

  /**
   * Opens one link from inside the quick layer. Documents, Area notes, and
   * headings stay in the layer; a Goal or an Area is explicit navigation and
   * leaves it.
   */
  function openPeekLink(target) {
    const peek = state.documentPeek;
    if (!peek) return;
    const parts = String(target ?? "").split("#");
    const path = parts.shift() || "";
    const heading = parts.at(-1) || "";
    if (!path && heading) return openPeekHeading(markdownHeadingAnchor(decodeLink(heading), new Map()));
    const record = vaultLinkRecord(target, peek.file);
    if (!record) return showToast(`Agent Shell cannot find “${target}”.`);
    if (record.kind === "goal") {
      leaveQuickPath();
      return selectGoal(record.file);
    }
    if (record.kind === "note") {
      // An Area note is a vault file like any other Document, so it stays in
      // the quick layer instead of switching Julian to the Areas screen.
      return openDocumentPeek(record.file, { heading });
    }
    return openDocumentPeek(record.file, { heading });
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

  return { rememberDocumentPosition, restoreDocumentPosition, updateDocumentTrail, openDocument, openDocumentPeek, leaveQuickPath, retryDocumentPeek, navigateDocumentPeekHistory, closeDocumentPeek, promoteDocumentPeek, openPeekLink, openPeekHeading, navigateDocumentHistory, openVaultLink, openDocumentHeading, bindDocumentReader, refreshDocument, commentComposerKey, readerBlockOf, readerSelection, updateSelectionCommentButton, hideSelectionCommentButton, readerSectionInView, documentTitleLine, openCommentComposer, setCommentScope, editComment, syncCommentDraft, cancelCommentComposer, noteInComposer, composerResult, saveDocumentText, adoptSavedDocument, restoreDocumentText, submitCommentComposer, removeComment, stepComment, saveVisibleIdea, notifyDocumentComments };
}
