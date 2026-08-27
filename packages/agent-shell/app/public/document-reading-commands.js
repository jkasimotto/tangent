/** Stable action ids returned by the pure Document reading matcher. */
export const documentReadingCommands = Object.freeze({
  lineDown: "line-down",
  lineUp: "line-up",
  halfPageDown: "half-page-down",
  halfPageUp: "half-page-up",
  stageTop: "stage-top",
  top: "top",
  bottom: "bottom",
  previousHeading: "previous-heading",
  nextHeading: "next-heading",
  historyBack: "history-back",
  historyForward: "history-forward",
  previousComment: "previous-comment",
  nextComment: "next-comment",
  createComment: "create-comment",
  editComment: "edit-comment",
  replyComment: "reply-comment",
  resolveComment: "resolve-comment",
  help: "help",
  clearSelection: "clear-selection",
  clearComment: "clear-comment",
  closeReader: "close-reader",
});

/** True when a target owns typed text and Document reading must stand down. */
export function isDocumentTextEntry(target) {
  const element = target?.nodeType === 3 ? target.parentElement : target;
  if (!element) return false;
  const owner = element.closest?.("input, textarea, select, [contenteditable], [role='textbox'], [role='searchbox'], [role='combobox']") ?? element;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(owner.tagName)) return true;
  if (["textbox", "searchbox", "combobox"].includes(owner.getAttribute?.("role"))) return true;
  const editable = owner.getAttribute?.("contenteditable");
  return owner.isContentEditable || (editable !== null && editable !== "false");
}

/** True when the event has exactly the requested modifier state. */
function exactModifiers(event, { shift = false, ctrl = false } = {}) {
  return Boolean(event.shiftKey) === shift
    && Boolean(event.ctrlKey) === ctrl
    && !event.metaKey
    && !event.altKey;
}

/**
 * Matches one key in normal Document reading mode. The caller owns the short
 * `g` timeout and passes `pendingG` back for the second key. Text entry, IME,
 * and already-owned events return null without changing that caller state.
 */
export function matchDocumentReadingCommand(event, {
  pendingG = false,
  commentNavigation = true,
  commentCreation = true,
  commentLifecycle = true,
  hasSelection = false,
  activeComment = false,
} = {}) {
  const imeKey = ["Dead", "Process", "Unidentified"].includes(String(event?.key ?? ""));
  if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229 || imeKey || isDocumentTextEntry(event.target)) return null;
  const code = String(event.code ?? "");
  if (code === "KeyD" && exactModifiers(event, { ctrl: true })) return documentReadingCommands.halfPageDown;
  if (code === "KeyU" && exactModifiers(event, { ctrl: true })) return documentReadingCommands.halfPageUp;
  if (!exactModifiers(event)) {
    if (code === "KeyG" && exactModifiers(event, { shift: true })) return documentReadingCommands.bottom;
    if (code === "BracketLeft" && exactModifiers(event, { shift: true })) return documentReadingCommands.previousHeading;
    if (code === "BracketRight" && exactModifiers(event, { shift: true })) return documentReadingCommands.nextHeading;
    if (code === "KeyH" && exactModifiers(event, { shift: true })) return documentReadingCommands.historyBack;
    if (code === "KeyL" && exactModifiers(event, { shift: true })) return documentReadingCommands.historyForward;
    if (commentNavigation && code === "KeyN" && exactModifiers(event, { shift: true })) return documentReadingCommands.previousComment;
    if (code === "Slash" && exactModifiers(event, { shift: true })) return documentReadingCommands.help;
    return null;
  }
  if (code === "KeyJ") return documentReadingCommands.lineDown;
  if (code === "KeyK") return documentReadingCommands.lineUp;
  if (code === "KeyG") return pendingG ? documentReadingCommands.top : documentReadingCommands.stageTop;
  if (commentNavigation && code === "KeyN") return documentReadingCommands.nextComment;
  if (commentCreation && code === "KeyC") return documentReadingCommands.createComment;
  if (commentLifecycle && activeComment && code === "KeyE") return documentReadingCommands.editComment;
  if (commentLifecycle && activeComment && code === "KeyR") return documentReadingCommands.replyComment;
  if (commentLifecycle && activeComment && code === "KeyX") return documentReadingCommands.resolveComment;
  if (code === "Escape") {
    if (hasSelection) return documentReadingCommands.clearSelection;
    return activeComment ? documentReadingCommands.clearComment : documentReadingCommands.closeReader;
  }
  return null;
}

/** Clamps one proposed scroll position to the readable range. */
function clampScroll(value, maximum) {
  return Math.min(Math.max(Number(value) || 0, 0), maximum);
}

/**
 * Returns the absolute scrollTop for one movement command, or null when the
 * command is not a scroll operation or there is no heading in that direction.
 * `headingOffsets` are absolute offsets inside the same scroll container.
 */
export function documentReadingScrollTarget(command, {
  scrollTop = 0,
  clientHeight = 0,
  scrollHeight = 0,
  lineStep = 48,
  headingOffsets = [],
} = {}) {
  const top = Math.max(Number(scrollTop) || 0, 0);
  const viewport = Math.max(Number(clientHeight) || 0, 0);
  const maximum = Math.max((Number(scrollHeight) || 0) - viewport, 0);
  if (command === documentReadingCommands.lineDown) return clampScroll(top + lineStep, maximum);
  if (command === documentReadingCommands.lineUp) return clampScroll(top - lineStep, maximum);
  if (command === documentReadingCommands.halfPageDown) return clampScroll(top + viewport / 2, maximum);
  if (command === documentReadingCommands.halfPageUp) return clampScroll(top - viewport / 2, maximum);
  if (command === documentReadingCommands.top) return 0;
  if (command === documentReadingCommands.bottom) return maximum;
  const headings = [...headingOffsets].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (command === documentReadingCommands.nextHeading) {
    const next = headings.find((offset) => offset > top + 1);
    if (next === undefined) return null;
    const target = clampScroll(next, maximum);
    return Math.abs(target - top) <= 1 ? null : target;
  }
  if (command === documentReadingCommands.previousHeading) {
    const previous = headings.findLast((offset) => offset < top - 1);
    if (previous === undefined) return null;
    const target = clampScroll(previous, maximum);
    return Math.abs(target - top) <= 1 ? null : target;
  }
  return null;
}
