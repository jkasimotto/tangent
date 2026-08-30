import { markdownHeadingAnchor } from "./markdown-structure.js";

/** Creates the Document controller from shell, rendering, Work, and navigation ports. */
export function createDocumentReaderController({ shell, rendering, work, navigation }) {
  const { state, api, post, paint, showToast, screen, paintPeek, documentPeekLayer } = shell;
  const { documentComments, markdownHeadings, documentOutlineItems, documentGoal, renderDocumentArticle, documentCopyPayload, markdownToHtml } = rendering;
  const { goalByFile, currentGoal, sessionsForGoal, humanName, areaLabel, agentReference } = work;
  const {
    decodeLink, vaultLinkRecord, revealArea, captureReturnPoint, restoreReturnPoint, selectGoal, showWorkAt,
    openGoalAgent, closeSessionLayer,
  } = navigation;
  let cachedSelectionCommentAnchor = null;
  let selectionCommentPointerArmed = false;
  let commentSaveSerial = 0;

  /** The reader surface that currently owns comment interaction. */
  function commentSurface() {
    return state.commentComposer?.surface === "quick" || (!state.commentComposer && state.documentPeek) ? "quick" : "full";
  }

  /** The Document, DOM root, scroll owner, and repaint for the active reader. */
  function commentReader() {
    const quick = commentSurface() === "quick";
    return {
      quick,
      source: quick ? state.documentPeek?.document : state.document,
      root: quick ? documentPeekLayer : screen,
      scroll: quick ? peekScroll() : screen.querySelector(".document-reader-scroll"),
      repaint: quick ? paintPeek : () => paint(true),
    };
  }
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
    const vaultRecord = vaultLinkRecord(file);
    const goal = goalByFile(file) ?? (vaultRecord?.kind === "goal" ? vaultRecord : null);
    rememberDocumentPosition();
    if (enteringReader) {
      if (state.view !== "document") {
        state.documentReturn = captureReturnPoint();
        state.documentTrail = [];
        state.documentTrailIndex = -1;
      }
      state.view = "document";
      state.document = null;
      state.goalDetail = null;
      paint(true);
    }
    state.commentComposer = null;
    state.commentCursor = -1;
    state.commentCursorIdentity = null;
    cachedSelectionCommentAnchor = null;
    selectionCommentPointerArmed = false;
    try {
      const [documentRecord, goalDetail] = await Promise.all([
        api(documentReadUrl(file)),
        goal
          ? api(`/api/goals/detail?goal=${encodeURIComponent(file)}`).catch((error) => ({ goal, error: error.message }))
          : Promise.resolve(null),
      ]);
      state.document = documentRecord;
      await markPresentationOpened(file, documentRecord.hash);
      state.goalDetail = goalDetail;
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
  // nothing below it repaints, unmounts, or loses its selection. Commenting is
  // owned by the shared reader controller and therefore stays in this layer.

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
    return (state.vault?.documents ?? []).find((record) => record.file === file) ?? presentationForFile(file)?.item ?? null;
  }

  /** Finds the Goal presentation that authorizes one reader file. */
  function presentationForFile(file) {
    for (const area of state.vault?.areas ?? []) for (const goal of area.goals ?? []) {
      const item = (goal.presentations ?? []).find((entry) => entry.file === file);
      if (item) return { goal, item };
    }
    return null;
  }

  /** Clears temporary Work attention after a successful read. */
  async function markPresentationOpened(file, hash) {
    const presentation = presentationForFile(file);
    if (presentation) await post("/api/goals/presented-opened", { goal: presentation.goal.file, file, hash }).catch(() => {});
  }

  /** Selects the vault or repository allow-list read route. */
  function documentReadUrl(file) {
    return presentationForFile(file)?.item?.root === "repository"
      ? `/api/document?repository=${encodeURIComponent(file)}`
      : `/api/document?file=${encodeURIComponent(file)}`;
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
    if (!opening && state.commentComposer?.surface === "quick" && state.commentComposer.file !== file) state.commentComposer = null;
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
      const loaded = await api(documentReadUrl(file), { signal: request.signal });
      if (!peekOwnsResult(serial, file)) return;
      state.documentPeek.document = loaded;
      await markPresentationOpened(file, loaded.hash);
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
    if (state.commentComposer?.surface === "quick") state.commentComposer = null;
    cachedSelectionCommentAnchor = null;
    selectionCommentPointerArmed = false;
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
    screen.querySelector(".selection-comment-button")?.addEventListener("pointerdown", () => cacheSelectionCommentAnchor({ arm: true }));
    update();
    const composerField = screen.querySelector("#comment-text");
    if (composerField && document.activeElement !== composerField) {
      // Plain focus scrolls the field into view, which moves the words Julian is
      // reading. The composer sits at his selection, so it is already on screen.
      composerField.focus({ preventScroll: true });
      composerField.setSelectionRange(composerField.value.length, composerField.value.length);
    }
  }

  /** Restores comment selection behavior and composer focus in the quick reader. */
  function bindDocumentPeekReader() {
    const scroll = peekScroll();
    if (!scroll) return;
    scroll.addEventListener("scroll", hideSelectionCommentButton, { passive: true });
    documentPeekLayer.querySelector(".selection-comment-button")?.addEventListener("pointerdown", () => cacheSelectionCommentAnchor({ arm: true }));
    const composerField = documentPeekLayer.querySelector("#comment-text");
    if (composerField && document.activeElement !== composerField) {
      composerField.focus({ preventScroll: true });
      composerField.setSelectionRange(composerField.value.length, composerField.value.length);
    }
  }

  /** Reloads the visible Document after an agent changes its source file. */
  async function refreshDocument({ announce = false } = {}) {
    if (!state.document) return;
    rememberDocumentPosition();
    try {
      const file = state.document.file;
      const vaultRecord = vaultLinkRecord(file);
      const goal = goalByFile(file) ?? (vaultRecord?.kind === "goal" ? vaultRecord : null);
      const [documentRecord, goalDetail] = await Promise.all([
        api(`/api/document?file=${encodeURIComponent(file)}`),
        goal
          ? api(`/api/goals/detail?goal=${encodeURIComponent(file)}`).catch((error) => ({ goal, error: error.message }))
          : Promise.resolve(null),
      ]);
      state.document = documentRecord;
      state.goalDetail = goalDetail;
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
    return composer ? [composer.anchor?.kind, composer.placeLine, composer.editing?.index ?? -1, composer.replying?.line ?? -1, composer.notice] : null;
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
    const content = commentReader().root?.querySelector(".document-content");
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

  /** Prepares clean Markdown and HTML for the exact visible reader surface. */
  function readerCopyPayload({ quick = false, whole = false, selection = window.getSelection?.() } = {}) {
    const source = quick ? state.documentPeek?.document : state.document;
    const surface = quick ? documentPeekLayer?.querySelector(".document-peek-scroll") : screen.querySelector(".document-reader-scroll");
    const root = surface?.querySelector(".document-content") ?? null;
    if (!source || !root) return null;
    /** Resolves the same visible title that the reader uses for one wiki link. */
    const resolveWikiTitle = (target) => vaultLinkRecord(target, source.file)?.title ?? "";
    return documentCopyPayload({ source, root, selection, markdownToHtml, resolveWikiTitle, whole });
  }

  /**
   * Stores the exact rendered selection anchor before a pointer action can
   * collapse the browser Selection. `arm` makes the next create action consume
   * this snapshot; ordinary selectionchange updates do not arm stale text.
   */
  function cacheSelectionCommentAnchor({ arm = false } = {}) {
    const selection = readerSelection();
    const source = commentReader().source;
    if (!selection || !source?.file) return null;
    cachedSelectionCommentAnchor = { ...selection, file: source.file };
    if (arm) selectionCommentPointerArmed = true;
    return cachedSelectionCommentAnchor;
  }

  /** Shows the floating Comment button beside a live selection, or hides it. */
  function updateSelectionCommentButton() {
    const button = commentReader().root?.querySelector(".selection-comment-button");
    if (!button) return;
    const selection = state.commentComposer ? null : cacheSelectionCommentAnchor();
    if (!selection || !selection.rect.width) {
      button.hidden = true;
      if (!selectionCommentPointerArmed) cachedSelectionCommentAnchor = null;
      return;
    }
    button.hidden = false;
    button.style.top = `${Math.max(8, selection.rect.top - 42)}px`;
    button.style.left = `${Math.max(8, selection.rect.left + selection.rect.width / 2)}px`;
  }

  /** Hides the floating Comment button without touching the selection. */
  function hideSelectionCommentButton() {
    const button = commentReader().root?.querySelector(".selection-comment-button");
    if (button) button.hidden = true;
    cachedSelectionCommentAnchor = null;
    selectionCommentPointerArmed = false;
  }

  /** The outline heading whose section is in view, so a section comment lands there. */
  function readerSectionInView() {
    const { scroll, source, root } = commentReader();
    const items = markdownHeadings(source?.text).filter((heading) => [2, 3].includes(heading.level));
    if (!scroll || !items.length) return null;
    let active = null;
    const top = scroll.getBoundingClientRect().top;
    for (const heading of items) {
      const selector = String(heading.id).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const element = root?.querySelector(`[id="${selector}"]`);
      if (element && element.getBoundingClientRect().top - top <= 150) active = heading;
    }
    return active;
  }

  /** The file line of the Document title, where a whole-Document comment goes. */
  function documentTitleLine() {
    return markdownHeadings(commentReader().source?.text).find((heading) => heading.level === 1)?.line ?? -1;
  }

  /**
   * Opens the composer: on the selected words when there is a selection, else
   * under the section in view with a switch to the whole Document.
   */
  function openCommentComposer({ useCachedSelection = false } = {}) {
    const reader = commentReader();
    if (!reader.source || reader.source.repositoryFile) return;
    const liveSelection = readerSelection();
    const cachedSelection = cachedSelectionCommentAnchor?.file === reader.source.file
      && (useCachedSelection || selectionCommentPointerArmed)
      ? cachedSelectionCommentAnchor
      : null;
    const selection = liveSelection ?? cachedSelection;
    cachedSelectionCommentAnchor = null;
    selectionCommentPointerArmed = false;
    const headings = markdownHeadings(reader.source.text).filter((heading) => [2, 3].includes(heading.level));
    const selectedSection = selection ? [...headings].reverse().find((heading) => heading.line <= selection.line) ?? null : null;
    const section = selectedSection ?? readerSectionInView();
    const composer = {
      surface: reader.quick ? "quick" : "full",
      file: reader.source.file,
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
    reader.repaint();
  }

  /** Switches a new comment between the section in view and the whole Document. */
  function setCommentScope(kind) {
    const composer = state.commentComposer;
    if (!composer || composer.editing || composer.replying) return;
    syncCommentDraft();
    composer.anchor = kind === "section" && composer.section ? { kind: "section", heading: composer.section.title } : { kind: "document" };
    composer.placeLine = composer.anchor.kind === "section" ? composer.section.line : documentTitleLine();
    commentReader().repaint();
  }

  /** The semantic heading/selection anchor of one parsed existing comment. */
  function existingCommentAnchor(document, comment) {
    const heading = [...markdownHeadings(document?.text)].reverse().find((item) => item.line <= comment.line) ?? null;
    if (comment.quote) return { kind: "selection", quote: comment.quote, section: heading?.title ?? null };
    if (heading?.level && heading.level > 1) return { kind: "section", heading: heading.title };
    return { kind: "document" };
  }

  /** Rebuilds the exact insertion anchor for a reply to one parsed comment. */
  function replyInsertionAnchor(document, comment) {
    const semantic = existingCommentAnchor(document, comment);
    if (semantic.kind !== "selection") return semantic;
    const lineText = String(document?.text ?? "").split("\n")[comment.line] ?? "";
    const tokens = documentComments.commentTokensOnLine(document?.comments ?? [], comment.line);
    const visible = documentComments.visibleLine(lineText, tokens);
    const sourceOffset = (comment.pieces?.[0]?.start ?? -1) - (comment.lineStart ?? 0) + 3;
    const offset = visible.offsets.findIndex((item) => item === sourceOffset);
    return {
      kind: "selection",
      quote: comment.quote,
      line: comment.line,
      ...(offset >= 0 ? { offset } : {}),
    };
  }

  /** Finds an unchanged semantic comment in a fresh Document revision. */
  function matchingComment(document, original, expectedAnchor) {
    const candidates = (document?.comments ?? []).filter((comment) => comment.author === original.author
      && comment.markup === original.markup
      && JSON.stringify(existingCommentAnchor(document, comment)) === JSON.stringify(expectedAnchor));
    const exact = candidates.find((comment) => comment.line === original.line);
    return exact ?? (candidates.length === 1 ? candidates[0] : null);
  }

  /** Opens one existing comment in the composer. */
  function editComment(index) {
    const reader = commentReader();
    const comment = (reader.source?.comments ?? [])[index];
    if (!comment) return;
    if (comment.author !== documentComments.AUTHOR) {
      showToast("Only Julian's comments can be edited.");
      return;
    }
    state.commentComposer = {
      surface: reader.quick ? "quick" : "full", file: reader.source.file,
      text: comment.text,
      notice: "",
      editing: comment,
      editingAnchor: existingCommentAnchor(reader.source, comment),
      replying: null,
      returnIdentity: commentIdentity(comment),
      section: null,
      anchor: { kind: "edit" },
      placeLine: comment.line,
    };
    reader.repaint();
  }

  /** Opens a new Julian comment beside one unchanged semantic comment. */
  function replyComment(index) {
    const reader = commentReader();
    const comment = (reader.source?.comments ?? [])[index];
    if (!comment) return;
    state.commentComposer = {
      surface: reader.quick ? "quick" : "full", file: reader.source.file,
      text: "",
      notice: "",
      editing: null,
      replying: comment,
      replyingAnchor: existingCommentAnchor(reader.source, comment),
      returnIdentity: commentIdentity(comment),
      section: null,
      anchor: replyInsertionAnchor(reader.source, comment),
      placeLine: comment.line,
    };
    reader.repaint();
  }

  /** Keeps the typed comment in state, so a repaint cannot lose it. */
  function syncCommentDraft() {
    const field = commentReader().root?.querySelector("#comment-text");
    if (field && state.commentComposer) state.commentComposer.text = field.value;
  }

  /** Closes the composer and drops its draft. */
  function cancelCommentComposer() {
    if (!state.commentComposer) return;
    const returnIdentity = state.commentComposer.returnIdentity;
    state.commentComposer = null;
    const reader = commentReader();
    reader.repaint();
    if (!returnIdentity || !focusCommentIdentity(returnIdentity)) reader.scroll?.focus?.({ preventScroll: true });
  }

  /** Shows one line of trouble inside the composer and keeps the draft. */
  function noteInComposer(message) {
    if (!state.commentComposer) return;
    syncCommentDraft();
    state.commentComposer.notice = message;
    commentReader().repaint();
  }

  /** Applies a comment at its requested anchor; a stale selection must never change scope. */
  function composerResult(document, composer) {
    const helper = documentComments;
    if (composer.editing) {
      const expectedAnchor = composer.editingAnchor ?? existingCommentAnchor(state.document, composer.editing);
      const match = matchingComment(document, composer.editing, expectedAnchor);
      if (!match) return { error: "The original comment changed or disappeared. Your edit is still here." };
      return helper.replaceCommentText(document.text, match, composer.text);
    }
    if (composer.replying) {
      const expectedAnchor = composer.replyingAnchor ?? existingCommentAnchor(state.document, composer.replying);
      const match = matchingComment(document, composer.replying, expectedAnchor);
      if (!match) return { error: "The original comment changed or disappeared. Your reply is still here." };
      if (match.standalone) {
        const lines = String(document.text ?? "").split("\n");
        lines.splice(match.line + 1, 0, helper.commentMarkup(composer.text));
        return { text: lines.join("\n") };
      }
      return helper.insertComment(document.text, replyInsertionAnchor(document, match), composer.text);
    }
    const exact = helper.insertComment(document.text, composer.anchor, composer.text);
    return exact;
  }

  /** One base-hash save of the whole Document text; returns the raw reply so a 409 can be handled. */
  async function saveDocumentText(text, summary, baseHash) {
    const source = commentReader().source;
    const response = await fetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: source.file, text, baseHash: baseHash ?? source.hash, summary }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  /** Replaces the open Document with a saved copy without losing the reading place. */
  function adoptSavedDocument(document) {
    const reader = commentReader();
    if (reader.quick) {
      rememberPeekPosition();
      state.documentPeek.document = document;
      paintPeek();
      restorePeekPosition();
    } else {
      rememberDocumentPosition();
      state.document = document;
      state.renderedKey = "";
      paint(true);
      restoreDocumentPosition();
    }
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
    const reader = commentReader();
    const source = reader.source;
    if (!composer || !source || composer.file !== source.file) return;
    const saveSerial = ++commentSaveSerial;
    syncCommentDraft();
    if (!composer.text.trim()) return noteInComposer("Write the comment first.");
    const summary = composer.editing ? "edited a comment" : composer.replying ? "replied to a comment" : "added a comment";
    let attempt = composerResult(source, composer);
    if (attempt.error) return noteInComposer(attempt.error);
    let placementNotice = attempt.notice ?? "";
    let previous = source.text;
    let result = await saveDocumentText(attempt.text, summary, source.hash);
    if (result.status === 409 && result.data.current) {
      if (reader.quick) state.documentPeek.document = { ...source, ...result.data.current };
      else state.document = { ...source, ...result.data.current };
      const current = commentReader().source;
      attempt = composerResult(current, composer);
      if (attempt.error) return noteInComposer(attempt.error);
      placementNotice = attempt.notice ?? placementNotice;
      previous = current.text;
      result = await saveDocumentText(attempt.text, summary, current.hash);
    }
    if (!result.ok) return noteInComposer(result.data.error || "The comment did not save.");
    const wasEditing = Boolean(composer.editing);
    const wasReplying = Boolean(composer.replying);
    const returnIdentity = composer.returnIdentity;
    // A save that returns after Julian opened another composer must update the
    // Document but must not close or focus through the newer draft.
    const stillOwnsComposer = state.commentComposer === composer && saveSerial === commentSaveSerial;
    if (stillOwnsComposer) state.commentComposer = null;
    adoptSavedDocument(result.data);
    if (!stillOwnsComposer) return showToast(placementNotice || (wasEditing ? "Comment updated." : wasReplying ? "Reply added." : "Comment added."));
    const saved = commentReader();
    const savedDocument = saved.source;
    if (wasEditing) {
      const editedAnchor = composer.editingAnchor;
      const edited = (savedDocument.comments ?? []).find((comment) => comment.author === documentComments.AUTHOR
        && comment.text === composer.text.trim()
        && JSON.stringify(existingCommentAnchor(savedDocument, comment)) === JSON.stringify(editedAnchor));
      if (!focusCommentIdentity(commentIdentity(edited))) saved.scroll?.focus?.({ preventScroll: true });
    } else if (wasReplying) {
      if (!focusCommentIdentity(returnIdentity)) saved.scroll?.focus?.({ preventScroll: true });
    } else {
      const candidates = (savedDocument.comments ?? []).filter((comment) => comment.author === documentComments.AUTHOR && comment.text === composer.text.trim());
      const added = candidates.find((comment) => comment.line === composer.placeLine) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!focusCommentIdentity(commentIdentity(added))) saved.scroll?.focus?.({ preventScroll: true });
    }
    showToast(placementNotice || (wasEditing ? "Comment updated." : wasReplying ? "Reply added." : "Comment added."), {
      label: "Undo",
      /** Puts the text from before this comment change back. */
      run: () => restoreDocumentText(previous, wasEditing ? "undid a comment edit" : wasReplying ? "removed a comment reply" : "removed a comment"),
    });
  }

  /** A comment reference that survives array insertion and removal. */
  function commentIdentity(comment) {
    if (!comment) return null;
    return {
      author: String(comment.author ?? ""),
      text: String(comment.text ?? ""),
      quote: comment.quote ?? null,
      markup: String(comment.markup ?? ""),
      line: Number.isInteger(comment.line) ? comment.line : null,
    };
  }

  /** Finds one semantic comment reference in one revision, allowing a unique line move. */
  function commentIndexInDocument(document, identity) {
    if (!identity) return -1;
    const comments = document?.comments ?? [];
    /** The author, body, markup, and quoted anchor define one comment apart from its line. */
    const sameComment = (comment) => comment.author === identity.author
      && comment.text === identity.text
      && (comment.quote ?? null) === (identity.quote ?? null)
      && comment.markup === identity.markup;
    const candidates = comments.map((comment, index) => ({ comment, index })).filter(({ comment }) => sameComment(comment));
    const exact = candidates.find(({ comment }) => comment.line === identity.line);
    return exact?.index ?? (candidates.length === 1 ? candidates[0].index : -1);
  }

  /** Finds one semantic comment reference in the open revision. */
  function commentIndexForIdentity(identity) {
    return commentIndexInDocument(commentReader().source, identity);
  }

  /** Synchronizes keyboard navigation after pointer focus without trusting an array index. */
  function syncCommentCursor(identity) {
    const index = commentIndexForIdentity(identity);
    if (index < 0) return false;
    state.commentCursor = index;
    state.commentCursorIdentity = commentIdentity(commentReader().source.comments[index]);
    return true;
  }

  /** Returns the active comment without trusting its old array index. */
  function activeCommentRecord(identity = state.commentCursorIdentity) {
    const index = commentIndexForIdentity(identity);
    if (index < 0) return null;
    const comment = commentReader().source.comments[index];
    return { index, comment, identity: commentIdentity(comment) };
  }

  /** Gives focus to one semantic comment after a repaint or mutation. */
  function focusCommentIdentity(identity, { scroll = false } = {}) {
    if (!syncCommentCursor(identity)) return false;
    const element = commentReader().root?.querySelector(`#document-comment-${state.commentCursor}`);
    if (!element) return false;
    if (scroll) element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
    return true;
  }

  /** Starts editing the active semantic comment. */
  function editActiveComment(identity = state.commentCursorIdentity) {
    const active = activeCommentRecord(identity);
    if (!active) return showToast("That comment changed or disappeared.");
    return editComment(active.index);
  }

  /** Starts a reply beside the active semantic comment. */
  function replyToActiveComment(identity = state.commentCursorIdentity) {
    const active = activeCommentRecord(identity);
    if (!active) return showToast("That comment changed or disappeared.");
    return replyComment(active.index);
  }

  /** The exact current identity used when a resolve modal opens. */
  function activeCommentIdentity() {
    return activeCommentRecord()?.identity ?? null;
  }

  /**
   * Resolves one semantic comment through the canonical route. A full-text
   * prefix fails closed when the target is stale or ambiguous; a mutable array
   * index is deliberately never sent.
   */
  async function resolveActiveComment(identity, note) {
    const changeNote = String(note ?? "").trim();
    if (!changeNote) return { ok: false, error: "Write a short change note first." };
    const active = activeCommentRecord(identity);
    if (!active) return { ok: false, error: "That comment changed or disappeared. Your note is still here." };
    const reader = commentReader();
    const file = reader.source.file;
    let latest;
    try {
      latest = await api(`/api/document?file=${encodeURIComponent(file)}`);
    } catch (error) {
      return { ok: false, error: `The current Document could not be checked. Your note is still here: ${error.message}` };
    }
    const latestIndex = commentIndexInDocument(latest, identity);
    if (latestIndex < 0) return { ok: false, error: "That comment changed or disappeared. Your note is still here." };
    const latestComment = latest.comments[latestIndex];
    const neighbor = latest.comments[latestIndex + 1] ?? latest.comments[latestIndex - 1] ?? null;
    const response = await fetch("/api/document/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, prefix: latestComment.text, note: changeNote }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || "The comment was not resolved." };
    try {
      const loaded = await api(`/api/document?file=${encodeURIComponent(file)}`);
      adoptSavedDocument(loaded);
    } catch (error) {
      state.commentCursor = -1;
      state.commentCursorIdentity = null;
      showToast(`Comment resolved. Reload the Document to see it: ${error.message}`);
      return { ok: true, focusIdentity: null };
    }
    const focusIdentity = commentIdentity(neighbor);
    if (focusIdentity) syncCommentCursor(focusIdentity);
    else {
      state.commentCursor = -1;
      state.commentCursorIdentity = null;
    }
    showToast("Comment resolved.");
    return { ok: true, focusIdentity };
  }

  /** Moves to the next or previous comment, wrapping at the ends, and gives it focus. */
  function stepComment(direction) {
    const comments = commentReader().source?.comments ?? [];
    if (!comments.length) return;
    const count = comments.length;
    const semanticIndex = commentIndexForIdentity(state.commentCursorIdentity);
    const current = semanticIndex >= 0 ? semanticIndex : Number.isInteger(state.commentCursor) && state.commentCursor >= 0 && state.commentCursor < count ? state.commentCursor : -1;
    const next = current < 0 ? (direction < 0 ? count - 1 : 0) : ((current + direction) % count + count) % count;
    syncCommentCursor(commentIdentity(comments[next]));
    const element = commentReader().root?.querySelector(`#document-comment-${next}`);
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

  return { rememberDocumentPosition, restoreDocumentPosition, updateDocumentTrail, openDocument, openDocumentPeek, leaveQuickPath, retryDocumentPeek, navigateDocumentPeekHistory, closeDocumentPeek, promoteDocumentPeek, openPeekLink, openPeekHeading, navigateDocumentHistory, openVaultLink, openDocumentHeading, bindDocumentReader, bindDocumentPeekReader, refreshDocument, commentComposerKey, readerBlockOf, readerSelection, readerCopyPayload, cacheSelectionCommentAnchor, updateSelectionCommentButton, hideSelectionCommentButton, readerSectionInView, documentTitleLine, openCommentComposer, setCommentScope, existingCommentAnchor, replyInsertionAnchor, editComment, replyComment, syncCommentDraft, cancelCommentComposer, noteInComposer, composerResult, saveDocumentText, adoptSavedDocument, restoreDocumentText, submitCommentComposer, commentIdentity, commentIndexInDocument, syncCommentCursor, activeCommentRecord, activeCommentIdentity, focusCommentIdentity, editActiveComment, replyToActiveComment, resolveActiveComment, stepComment, saveVisibleIdea, notifyDocumentComments };
}
