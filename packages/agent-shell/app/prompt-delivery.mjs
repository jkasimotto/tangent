// Prompt arrival: the pure decision behind typePromptWhenReady in server.mjs.
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
