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
 * the caller through `chordStart`.
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
export function resolveMotion(event, { textOwned = false, pendingChord = "" } = {}) {
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

/** Milliseconds the second key of a chord may take. */
export const CHORD_WINDOW_MS = 650;

/**
 * One chord engine for every surface. A chord is staged for one surface
 * name, so a `g` pressed in the key sheet cannot complete a `gg` in Work.
 */
export function createChordEngine(setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout) {
  let pending = { surface: "", key: "" };
  let timer = null;
  /** Forgets the staged key, unless a different surface staged it. */
  function clear(surface = "") {
    if (surface && pending.surface !== surface) return;
    pending = { surface: "", key: "" };
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  /** Stages the first key of a chord for one surface. */
  function stage(surface, key) {
    clear();
    pending = { surface, key };
    timer = setTimer(() => {
      if (pending.surface === surface) pending = { surface: "", key: "" };
      timer = null;
    }, CHORD_WINDOW_MS);
  }
  /** The staged key for one surface, or an empty string. */
  function pendingFor(surface) {
    return pending.surface === surface ? pending.key : "";
  }
  return { stage, clear, pendingFor };
}
