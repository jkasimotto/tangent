// Prompt staging and submission receipts for typePromptWhenReady in server.mjs.
// The server types a prompt into a harness in two steps (a short probe, then
// the remainder) and reads the pane back; this module decides whether what the
// pane shows proves the whole prompt reached the composer. Kept apart from
// tmux so the rules are unit-testable against captured pane text.
//
// Two shapes count as proof:
// - The prompt's tail is visible. A composer holding a short prompt shows all
//   of it; one holding a long prompt has scrolled its start away, so the far
//   end proves the remainder arrived.
// - The probe is visible with a pasted-text marker right after it. Claude Code
//   collapses a large input into "[Pasted text #N]" or
//   "[Pasted text #N +M lines]", codex into "[Pasted Content N chars]". The
//   text itself is then never on screen, so its tail cannot be, but a marker
//   glued to this attempt's probe shows the composer holds the probe plus one
//   pasted blob, which is exactly what was typed. A marker elsewhere on the
//   pane (an earlier paste, an old attempt) does not count.

/** Opening characters typed alone as a probe: short enough that no composer collapses them. */
export const PROBE_CHARS = 24;
export const TYPE_CHUNK_CHARS = 4_000;
const TAIL_CHARS = 40;

/** Whitespace-free comparison form, so wrapping and stripped newlines cannot hide a match. */
export function squash(text) {
  return String(text ?? "").replace(/\s+/g, "");
}

/**
 * Pasted-text markers as they appear after squash(). Claude Code shows the
 * line count only when the pasted text had more than one line.
 */
const PASTED_MARKERS = [
  /^\[Pastedtext#\d+(?:\+\d+lines)?\]/, // Claude Code
  /^\[PastedContent\d+chars\]/, // codex
];

const PROMPT_LINES = [/^\s*❯(?:\s|$)/, /^\s*›(?:\s|$)/, /^\s*>(?:\s|$)/];
const FRAME_LINE = /^\s*─{10,}\s*$/;
const SUBMISSION_MARKER = /(?:\bSUBMITTED\b|esc to interrupt|Working(?:\.\.\.|…)|queued message|will be processed next)/gi;

/** Splits a prompt into the probe typed first and the remainder typed after it. */
export function splitPrompt(prompt) {
  return { probe: prompt.slice(0, PROBE_CHARS), rest: prompt.slice(PROBE_CHARS) };
}

/** Splits literal terminal input below tmux's command-size ceiling. */
export function typeChunks(text) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += TYPE_CHUNK_CHARS) chunks.push(text.slice(offset, offset + TYPE_CHUNK_CHARS));
  return chunks;
}

/** True when the visible pane shows the whole prompt was taken into the composer. */
export function promptArrived(paneText, prompt) {
  const pane = squash(paneText);
  const tail = squash(prompt.slice(-TAIL_CHARS));
  if (tail && pane.includes(tail)) return true;
  return pastedAfterProbe(pane, squash(splitPrompt(prompt).probe));
}

/**
 * Returns only the active editor around the cursor. Old matching output above
 * the editor must never prove that a new attempt was staged. Prompt editors
 * start at their nearest prompt line. Pi's editor is the framed row that owns
 * the cursor. A wrapped editor with its prompt scrolled away is bounded to the
 * visible rows ending at the cursor.
 */
export function activeComposer({ text, cursorY = 0 }) {
  const lines = String(text ?? "").split("\n");
  const end = Math.max(0, Math.min(lines.length - 1, Number(cursorY) || 0));
  if (end > 0 && end + 1 < lines.length && FRAME_LINE.test(lines[end - 1]) && FRAME_LINE.test(lines[end + 1])) {
    return { text: lines[end], start: end, end };
  }
  let start = end;
  for (let index = end; index >= 0; index -= 1) {
    if (PROMPT_LINES.some((pattern) => pattern.test(lines[index]))) {
      start = index;
      break;
    }
    // A composer can wrap, but it cannot own an arbitrary pane of output.
    if (end - index >= 12) break;
    start = index;
  }
  return { text: lines.slice(start, end + 1).join("\n"), start, end };
}

/** True only when this exact prompt is in the active editor. */
export function promptStaged(sample, prompt) {
  // A long draft can wrap until its prompt marker scrolls off the cursor row.
  // That makes the generic composer classifier return null, but the bounded
  // rows ending at the cursor still prove the exact tail. A positively empty
  // editor remains a hard refusal, so old output above it cannot pass.
  return sample?.composer !== "idle" && promptArrived(activeComposer(sample ?? {}).text, prompt);
}

/** Removes the active editor so a clear composer alone is not a receipt. */
export function paneOutsideComposer(sample) {
  return squash(paneOutsideComposerText(sample));
}

/** Returns pane output with the active editor replaced by one stable token. */
function paneOutsideComposerText(sample) {
  const lines = String(sample?.text ?? "").split("\n");
  const composer = activeComposer(sample ?? {});
  lines.splice(composer.start, composer.end - composer.start + 1, "<composer>");
  return lines.join("\n");
}

/**
 * Classifies the observation after a submission key. Success requires both
 * the exact draft to leave the editor and positive pane output. An empty
 * editor by itself is ambiguous because a redraw can erase staged text.
 */
export function submissionReceipt(before, after, prompt) {
  if (promptStaged(after, prompt)) return "staged";
  if (after?.composer === "draft") return "partial";
  const beforeOutput = paneOutsideComposerText(before);
  const afterOutput = paneOutsideComposerText(after);
  // A marker that was already present, or an unrelated timer/redraw outside
  // the editor, cannot prove this key submitted this prompt. Require either a
  // newly added harness submission marker or this attempt's exact prompt to
  // newly appear in transcript output.
  const markerAdded = submissionMarkerCount(afterOutput) > submissionMarkerCount(beforeOutput);
  const promptMovedToOutput = promptArrived(afterOutput, prompt) && !promptArrived(beforeOutput, prompt);
  return markerAdded || promptMovedToOutput ? "submitted" : "ambiguous";
}

/** Counts submit-specific status markers without treating changing timer text as new proof. */
function submissionMarkerCount(text) {
  return [...String(text ?? "").matchAll(SUBMISSION_MARKER)].length;
}

/** True when a pasted-text marker follows the probe somewhere on the (squashed) pane. */
function pastedAfterProbe(pane, probe) {
  if (!probe) return false;
  let from = 0;
  while (true) {
    const at = pane.indexOf(probe, from);
    if (at < 0) return false;
    const after = pane.slice(at + probe.length);
    if (PASTED_MARKERS.some((marker) => marker.test(after))) return true;
    from = at + 1;
  }
}

/**
 * Whether a live pane may be typed into right now, for the path that does not
 * wait for a harness to boot (a target already mid-turn).
 *
 * The server asks this again immediately before it types, with a pane command
 * and composer read fresh from tmux. The delivery decision that chose this
 * target read an observer sample that can be a second or more old, which is
 * long enough for Julian to have started typing. The settling path has its own
 * proof that nobody typed, because it waits for a screen that stops changing;
 * this path has none, so it asks for the composer directly.
 *
 * True only for a pane running an agent whose composer is empty. A bare shell
 * would execute the text as a command, a "draft" composer holds words that
 * would be typed over, and null means no composer this shell recognizes.
 */
export function readyForText({ command, composer, shellCommands }) {
  if (!command || shellCommands.has(command)) return false;
  return composer === "idle";
}
