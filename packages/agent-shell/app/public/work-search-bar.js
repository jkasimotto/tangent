import { matchPosition, searchTarget, workSearchMatches } from "./work-search-core.js";
import { motions, resolveMotion } from "./motion-keys.js";

/**
 * The Work search line (design agent-shell-work-search). `/` opens it at the
 * bottom of the shell. Typing moves the Work cursor to the first match after
 * the row where `/` was pressed. Enter keeps the pattern for `n` and `N`.
 * Escape while typing restores the origin. Escape in Work clears the pattern.
 *
 * The bar lives outside `#screen`, so a repaint never replaces its input.
 * Matches are painted as a row class after every Work render.
 */
export function createWorkSearchBar({
  state, document, bar, input, count, keys, screen, isWorkVisible = () => state.view === "work",
  isWorkTop = isWorkVisible,
  paint, setWorkCursor, revealCursor, closeRevealedFold, announce,
}) {
  /** Returns the Work root whether it is the legacy screen or the Map lens. */
  const root = () => typeof screen === "function" ? screen() : screen;
  /** Every Work row, hidden ones included, as matcher input. */
  function searchRows() {
    return [...root().querySelectorAll("[data-work-cursor]")].map((row) => ({
      cursor: row.dataset.workCursor,
      text: row.dataset.searchText ?? row.textContent,
    }));
  }

  /** The cursor ids of the rows that match the current pattern, in order. */
  function matches() {
    return workSearchMatches(searchRows(), state.searchPattern);
  }

  /** True while the input owns the keyboard. */
  function isOpen() {
    return state.searchOrigin !== null;
  }

  /** The Work row for one cursor id, or null. */
  function rowFor(cursor) {
    return [...root().querySelectorAll("[data-work-cursor]")].find((row) => row.dataset.workCursor === cursor) ?? null;
  }

  /** Moves the cursor to one match, opening folds on the way, without stealing focus from the input. */
  function land(cursor, { focus = false } = {}) {
    if (!cursor) return false;
    revealCursor(cursor);
    const row = rowFor(cursor);
    if (!row) return false;
    setWorkCursor(row, focus);
    // setWorkCursor repaints, so the row that scrolls is the freshly painted one.
    rowFor(cursor)?.scrollIntoView?.({ block: "center" });
    return true;
  }

  /** Paints the bar and the row highlights from state. Safe to call after any render. */
  function paintBar() {
    const pattern = state.searchPattern;
    const open = isOpen();
    const found = pattern ? matches() : [];
    for (const row of root().querySelectorAll("[data-work-cursor]")) {
      row.classList.toggle("search-match", found.includes(row.dataset.workCursor));
    }
    const visible = isWorkTop() && (open || Boolean(pattern));
    bar.hidden = !visible;
    bar.toggleAttribute("inert", !visible);
    document.body.classList.toggle("work-search-open", visible);
    bar.classList.toggle("quiet", !open);
    if (!visible) return;
    if (input.value !== pattern) input.value = pattern;
    input.readOnly = !open;
    const position = matchPosition(found, state.workCursor);
    const notice = state.searchNotice;
    const text = !pattern ? "" : !found.length ? "no match" : notice ? `${notice} ${position || "–"}/${found.length}` : `${position || "–"}/${found.length}`;
    count.textContent = text;
    count.classList.toggle("miss", Boolean(pattern) && !found.length);
    keys.innerHTML = open
      ? `<button type="button" data-search-key="confirm"><kbd>↵</kbd>jump</button><button type="button" data-search-key="next"><kbd>↓</kbd>next</button><button type="button" data-search-key="previous"><kbd>↑</kbd>previous</button><button type="button" data-search-key="cancel"><kbd>esc</kbd>cancel</button>`
      : `<button type="button" data-search-key="next"><kbd>n</kbd>next</button><button type="button" data-search-key="previous"><kbd>N</kbd>previous</button><button type="button" data-search-key="clear"><kbd>esc</kbd>clear</button>`;
  }

  /** Says the match position through the polite live region. */
  function say() {
    const found = matches();
    if (!state.searchPattern) return announce("");
    if (!found.length) return announce(`No row matches ${state.searchPattern}`);
    announce(`Match ${matchPosition(found, state.workCursor) || 0} of ${found.length}`);
  }

  /** Opens the bar and remembers where `/` was pressed. */
  function open() {
    if (!isWorkVisible()) return false;
    state.searchOrigin = {
      workCursor: state.workCursor,
      scrollTop: root().scrollTop,
      openedFolds: [],
    };
    state.searchNotice = "";
    state.searchPattern = "";
    paintBar();
    input.value = "";
    input.focus();
    return true;
  }

  /** Follows the typed pattern from the origin row forward. */
  function applyTyped(pattern) {
    state.searchPattern = pattern;
    state.searchNotice = "";
    const found = matches();
    const rowOrder = searchRows().map((row) => row.cursor);
    const target = searchTarget(found, rowOrder, { from: state.searchOrigin?.workCursor ?? "", direction: 1, inclusive: true });
    if (target) land(target);
    else if (state.searchOrigin?.workCursor) {
      // Vim incsearch: no match shows the cursor where the search began.
      const origin = rowFor(state.searchOrigin.workCursor);
      if (origin) setWorkCursor(origin, false);
    }
    paintBar();
    say();
  }

  /** Keeps the pattern and gives the row the keyboard. */
  function confirm() {
    const origin = state.searchOrigin;
    state.searchOrigin = null;
    if (!state.searchPattern) {
      paintBar();
      return restoreFocus(origin?.workCursor);
    }
    paintBar();
    const row = rowFor(state.workCursor);
    row?.querySelector("[data-work-row-title], [data-work-cursor-control]")?.focus({ preventScroll: true });
  }

  /** Gives the keyboard back to the Work row under the cursor. */
  function restoreFocus(cursor = state.workCursor) {
    const row = rowFor(cursor) ?? rowFor(state.workCursor);
    row?.querySelector("[data-work-row-title], [data-work-cursor-control]")?.focus({ preventScroll: true });
  }

  /** Drops the typed pattern and returns to the origin row, scroll, and folds. */
  function cancel() {
    const origin = state.searchOrigin;
    state.searchOrigin = null;
    state.searchPattern = "";
    state.searchNotice = "";
    for (const fold of origin?.openedFolds ?? []) closeRevealedFold(fold);
    paintBar();
    if (origin?.workCursor) {
      const row = rowFor(origin.workCursor);
      if (row) setWorkCursor(row, false);
    }
    paint(true);
    if (origin) root().scrollTop = origin.scrollTop;
    restoreFocus(origin?.workCursor);
    announce("");
  }

  /** Clears a kept pattern and its highlights. Returns false when there was none. */
  function clear() {
    if (isOpen()) { cancel(); return true; }
    if (!state.searchPattern) return false;
    state.searchPattern = "";
    state.searchNotice = "";
    paintBar();
    restoreFocus();
    announce("");
    return true;
  }

  /** `n` (+1) or `N` (-1): the next match from the cursor, wrapping. */
  function step(direction) {
    const found = matches();
    const rowOrder = searchRows().map((row) => row.cursor);
    if (!state.searchPattern) return false;
    if (!found.length) { paintBar(); say(); return true; }
    const target = searchTarget(found, rowOrder, { from: state.workCursor, direction });
    const from = rowOrder.indexOf(state.workCursor);
    const to = rowOrder.indexOf(target);
    state.searchNotice = (direction > 0 && to <= from) || (direction < 0 && to >= from) ? "wrapped" : "";
    land(target, { focus: !isOpen() });
    paintBar();
    say();
    return true;
  }

  /** Owns Enter, Escape, and list motion while the input has focus. */
  function handleInputKey(event) {
    if (!isOpen() || event.target !== input) return false;
    if (event.key === "Enter") { event.preventDefault(); confirm(); return true; }
    if (event.key === "Escape") { event.preventDefault(); cancel(); return true; }
    const motion = resolveMotion(event, { textOwned: true });
    if (motion === motions.next || motion === motions.previous) {
      event.preventDefault();
      step(motion === motions.next ? 1 : -1);
      return true;
    }
    return false;
  }

  // Keys reach the bar through the shell's capture-phase dispatcher, which
  // calls handleInputKey for the text-entry context. Only typing binds here.
  input.addEventListener("input", () => { if (isOpen()) applyTyped(input.value); });
  bar.addEventListener("submit", (event) => event.preventDefault());
  keys.addEventListener("click", (event) => {
    const key = event.target.closest?.("[data-search-key]")?.dataset.searchKey;
    if (key === "confirm") return confirm();
    if (key === "cancel") return cancel();
    if (key === "clear") return void clear();
    if (key === "next") return void step(1);
    if (key === "previous") return void step(-1);
    return undefined;
  });

  return { open, confirm, cancel, clear, step, isOpen, paintBar, handleInputKey, matches };
}
