/**
 * The one Vim motion grammar (design agent-shell-keymap 5.1 to 5.3).
 *
 * `resolveMotion` turns one keyboard event into a motion id, or null. Every
 * surface maps the id to its own movement: Work moves the cursor, the reader
 * scrolls, a list changes its selection. The function reads facts, not DOM,
 * so the grammar can be proved without a browser.
 *
 * `textOwned` is true while a text field has focus. Letters then type, and
 * only arrows and `Ctrl-N` / `Ctrl-P` move. `pendingChord` is the first key
 * of a two-key chord (`g` for `gg`, `]` or `[` for `]c` / `[c`), staged by
 * the caller through `chordStart`. `pendingCount` is the digits typed so far
 * of a Vim count (`100j`, `1G`), staged through `countDigit`; a leading `0`
 * is never a count so it stays free for other bindings.
 */
export const motions = Object.freeze({
  next: "next",
  previous: "previous",
  first: "first",
  last: "last",
  sectionNext: "section-next",
  sectionPrevious: "section-previous",
  child: "child",
  parent: "parent",
  halfDown: "half-down",
  halfUp: "half-up",
  commentNext: "comment-next",
  commentPrevious: "comment-previous",
  chordStart: "chord-start",
  countDigit: "count-digit",
});

/** Keys that open a two-key chord, and the second keys each one accepts. */
const CHORDS = Object.freeze({
  g: Object.freeze({ g: motions.first }),
  "]": Object.freeze({ c: motions.commentNext }),
  "[": Object.freeze({ c: motions.commentPrevious }),
});

/** True when the event carries no Command, Option, or Control modifier. */
function bare(event) {
  return !event.metaKey && !event.altKey && !event.ctrlKey;
}

/** Resolves one keydown to a motion id for the given surface facts. */
export function resolveMotion(event, { textOwned = false, pendingChord = "", pendingCount = "" } = {}) {
  if (!event || event.isComposing) return null;
  const key = String(event.key ?? "");
  if (event.metaKey || event.altKey) return null;
  if (event.ctrlKey) {
    const lower = key.toLowerCase();
    if (lower === "n") return motions.next;
    if (lower === "p") return motions.previous;
    if (textOwned) return null;
    if (lower === "d") return motions.halfDown;
    if (lower === "u") return motions.halfUp;
    return null;
  }
  if (key === "ArrowDown") return motions.next;
  if (key === "ArrowUp") return motions.previous;
  if (textOwned) return null;
  if (key === "Home") return motions.first;
  if (key === "End") return motions.last;
  if (key === "PageDown") return motions.halfDown;
  if (key === "PageUp") return motions.halfUp;
  if (key === "ArrowRight") return motions.child;
  if (key === "ArrowLeft") return motions.parent;
  if (/^[0-9]$/.test(key) && bare(event) && !pendingChord && (key !== "0" || pendingCount)) return motions.countDigit;
  if (pendingChord && CHORDS[pendingChord]?.[key]) return CHORDS[pendingChord][key];
  if (Object.hasOwn(CHORDS, key) && bare(event)) return motions.chordStart;
  if (key === "j") return motions.next;
  if (key === "k") return motions.previous;
  if (key === "G") return motions.last;
  if (key === "}") return motions.sectionNext;
  if (key === "{") return motions.sectionPrevious;
  if (key === "l") return motions.child;
  if (key === "h") return motions.parent;
  return null;
}

/**
 * The row a counted motion lands on, Vim style: `100j` moves a hundred rows,
 * `1G` and `5gg` go to that row, `3^D` moves three half pages. Without a
 * count every motion moves once and `gg` / `G` go to the ends. Returns null
 * for motions that do not address a row (sections, parent, child).
 */
export function countedRowIndex(motion, { index, count = 0, length, pageRows = 1 }) {
  if (length <= 0) return null;
  const last = length - 1;
  /** Keeps a row index inside the list. */
  const clamp = (value) => Math.max(0, Math.min(last, value));
  const times = Math.max(1, count);
  if (motion === motions.next) return index < 0 ? 0 : clamp(index + times);
  if (motion === motions.previous) return index < 0 ? 0 : clamp(index - times);
  if (motion === motions.first || motion === motions.last) return count ? clamp(count - 1) : (motion === motions.first ? 0 : last);
  if (motion === motions.halfDown) return clamp(Math.max(0, index) + pageRows * times);
  if (motion === motions.halfUp) return clamp(index - pageRows * times);
  return null;
}

/** Milliseconds the second key of a chord may take. */
export const CHORD_WINDOW_MS = 650;

/**
 * One chord engine for every surface. A chord is staged for one surface
 * name, so a `g` pressed in the key sheet cannot complete a `gg` in Work.
 * A count (`100j`) waits for its motion without a chord timeout. A chord key
 * after digits keeps them (`5gg`), and any other key forgets everything.
 */
export function createChordEngine(setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout) {
  /** Nothing staged for any surface. */
  const empty = () => ({ surface: "", key: "", count: "" });
  let pending = empty();
  let timer = null;
  /** Forgets the staged key and count, unless a different surface staged them. */
  function clear(surface = "") {
    if (surface && pending.surface !== surface) return;
    pending = empty();
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  /** Restarts the window in which the next key of the sequence may arrive. */
  function arm(surface) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      if (pending.surface === surface) pending = empty();
      timer = null;
    }, CHORD_WINDOW_MS);
  }
  /** Stages the first key of a chord for one surface, keeping its count. */
  function stage(surface, key) {
    const count = pending.surface === surface ? pending.count : "";
    pending = { surface, key, count };
    arm(surface);
  }
  /** Appends one digit to the count staged for one surface. */
  function stageCount(surface, digit) {
    const count = pending.surface === surface ? pending.count : "";
    pending = { surface, key: "", count: `${count}${digit}` };
  }
  /** The staged chord key for one surface, or an empty string. */
  function pendingFor(surface) {
    return pending.surface === surface ? pending.key : "";
  }
  /** The staged count digits for one surface, or an empty string. */
  function countFor(surface) {
    return pending.surface === surface ? pending.count : "";
  }
  return { stage, stageCount, clear, pendingFor, countFor };
}
