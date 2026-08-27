/**
 * Work's object-command registry.
 *
 * Product code renders labels and shortcut teaching from this table. Keyboard
 * code matches the same records, so a pointer label, command palette, and key
 * handler cannot silently assign different keys to one action.
 */
const records = [
  { id: "moveRows", keyDisplay: "j / k", ariaKeyshortcuts: "j k", scope: "work", kind: "navigation", label: "Move between rows", help: "Move to the next or previous Work row.", shortcuts: [{ key: "j" }, { key: "k" }] },
  { id: "firstLast", keyDisplay: "gg / G", ariaKeyshortcuts: null, scope: "work", kind: "navigation", label: "First or last row", help: "Move to the first or last Work row." },
  { id: "previousArea", keyDisplay: "{", ariaKeyshortcuts: "Shift+[", scope: "area", kind: "navigation", palette: true, label: "Previous Area", help: "Jump to the previous real Area header.", shortcuts: [{ key: "{", shiftKey: "any" }] },
  { id: "nextArea", keyDisplay: "}", ariaKeyshortcuts: "Shift+]", scope: "area", kind: "navigation", palette: true, label: "Next Area", help: "Jump to the next real Area header.", shortcuts: [{ key: "}", shiftKey: "any" }] },
  { id: "open", keyDisplay: "↵", ariaKeyshortcuts: "Enter", scope: "work", kind: "action", label: "Open", help: "Open the live session or the Goal reader for this row.", shortcuts: [{ key: "Enter" }] },
  { id: "openBrain", keyDisplay: "b", ariaKeyshortcuts: "b", scope: "area", kind: "action", palette: true, label: "Open brain", help: "Open this Area brain. A message starts an inactive brain.", shortcuts: [{ key: "b" }] },
  { id: "stopBrain", keyDisplay: "s", ariaKeyshortcuts: "s", scope: "area", kind: "action", palette: true, label: "Stop brain", help: "Stop this Area brain without stopping its worker agents.", shortcuts: [{ key: "s" }] },
  { id: "defaults", keyDisplay: "d", ariaKeyshortcuts: "d", scope: "area", kind: "action", palette: true, label: "Defaults", help: "Change this Area's default Work and brain agents.", shortcuts: [{ key: "d" }] },
  { id: "messageBrain", keyDisplay: "a", ariaKeyshortcuts: "a", scope: "area", kind: "action", palette: true, label: "Message brain", help: "Tell this Area's brain what you want. It starts if it is not running.", shortcuts: [{ key: "a" }] },
  { id: "session", keyDisplay: "⌘J", ariaKeyshortcuts: "Meta+J", scope: "work", kind: "navigation", label: "Enter live session", help: "Open or close the live session for the current row.", shortcuts: [{ key: "j", metaKey: true }] },
  { id: "focus", keyDisplay: "f", ariaKeyshortcuts: "f", scope: "area", kind: "action", palette: true, label: "Focus Area", help: "Change the Areas that Work puts first.", shortcuts: [{ key: "f" }] },
  { id: "collapse", keyDisplay: "h", ariaKeyshortcuts: "h", scope: "work", kind: "navigation", palette: true, label: "Collapse or move to parent", help: "Collapse this tree node. From a collapsed node or leaf, move to its parent.", shortcuts: [{ key: "h" }] },
  { id: "expand", keyDisplay: "l", ariaKeyshortcuts: "l", scope: "work", kind: "navigation", palette: true, label: "Expand or move to child", help: "Expand this tree node. From an expanded node, move to its first child.", shortcuts: [{ key: "l" }] },
  { id: "questions", keyDisplay: "r", ariaKeyshortcuts: "r", scope: "area", kind: "action", palette: true, label: "Review questions", help: "Review the open questions from this Area's brains.", shortcuts: [{ key: "r" }] },
  { id: "note", keyDisplay: "n", ariaKeyshortcuts: "n", scope: "area", kind: "action", palette: true, label: "Capture note", help: "Save a Journal note and send it to this Area brain.", shortcuts: [{ key: "n" }] },
  { id: "readGoal", keyDisplay: "o", ariaKeyshortcuts: "o", scope: "goal", kind: "action", palette: true, label: "Read Goal", help: "Read this Goal, its notes, dependencies, queue, and attempts.", shortcuts: [{ key: "o" }] },
  { id: "resumeAttempt", keyDisplay: "r", ariaKeyshortcuts: "r", scope: "goal", kind: "action", palette: true, label: "Resume agent", help: "Attach to this Goal's live agent. When it is gone, open a new session in its folder with the resume command typed, not submitted.", shortcuts: [{ key: "r" }] },
  { id: "changeAgent", keyDisplay: "c", ariaKeyshortcuts: "c", scope: "goal", kind: "surface", palette: true, label: "Change agent", help: "Ask this Area's brain to replace the agent on the current attempt.", shortcuts: [{ key: "c" }] },
  { id: "goalStatus", keyDisplay: "x", ariaKeyshortcuts: "x", scope: "goal", kind: "surface", palette: true, label: "Goal status", help: "Choose Done, Check it myself, Won't do, Park, or Reopen for this Goal.", shortcuts: [{ key: "x" }] },
  { id: "commands", keyDisplay: ":", ariaKeyshortcuts: ":", scope: "work", kind: "surface", label: "Commands", help: "Open the commands for the current Work object.", shortcuts: [{ key: ":", shiftKey: "any" }] },
  { id: "filter", keyDisplay: "/", ariaKeyshortcuts: "/", scope: "work", kind: "action", palette: true, label: "Filter Work", help: "Focus the Work search field.", shortcuts: [{ key: "/" }] },
  { id: "keys", keyDisplay: "?", ariaKeyshortcuts: "?", scope: "work", kind: "surface", palette: true, label: "Keys", help: "Show every Work shortcut as a separate row.", shortcuts: [{ key: "?", shiftKey: "any" }] },
];

/** Immutable command records, in the order used by the Work key sheet. */
export const WORK_COMMANDS = Object.freeze(records.map((record) => Object.freeze({
  ...record,
  shortcuts: record.shortcuts ? Object.freeze(record.shortcuts.map((shortcut) => Object.freeze({ ...shortcut }))) : Object.freeze([]),
})));

const commandsById = new Map(WORK_COMMANDS.map((command) => [command.id, command]));

/** Returns one registered Work command, or null for an unknown id. */
export function workCommand(id) {
  return commandsById.get(id) ?? null;
}

/** Returns commands for one consumer without exposing mutable registry state. */
export function workCommandsFor({ scope = "", palette = false } = {}) {
  return WORK_COMMANDS.filter((command) => (!scope || command.scope === scope) && (!palette || command.palette));
}

/**
 * The keys each Work row prints in the caption line, by row kind. Every entry
 * names registered command ids, so the caption and the `?` sheet read one
 * table and cannot drift. A glyph-only control, like the fold triangle, has
 * no verb to print its key beside, so this line is where its key is taught.
 */
const captionKeysByRow = Object.freeze({
  area: [
    { ids: ["openBrain"], word: "brain" },
    { ids: ["messageBrain"], word: "message" },
    { ids: ["collapse", "expand"], word: "fold" },
    { ids: ["questions"], word: "questions" },
    { ids: ["commands"], word: "more" },
    { ids: ["keys"], word: "all" },
  ],
  goal: [
    { ids: ["open"], word: "open" },
    { ids: ["readGoal"], word: "read" },
    { ids: ["goalStatus"], word: "status" },
    { ids: ["changeAgent"], word: "agent" },
    { ids: ["resumeAttempt"], word: "resume" },
    { ids: ["collapse", "expand"], word: "fold" },
    { ids: ["commands"], word: "more" },
    { ids: ["keys"], word: "all" },
  ],
  definition: [
    { ids: ["open"], word: "open" },
    { ids: ["moveRows"], word: "rows" },
    { ids: ["keys"], word: "all" },
  ],
  none: [
    { ids: ["moveRows"], word: "rows" },
    { ids: ["session"], word: "session" },
    { ids: ["keys"], word: "all" },
  ],
});

/** Returns the row kind (`area`, `goal`, `definition`) named by one cursor id, or `none`. */
export function workRowKind(cursor = "") {
  const kind = String(cursor ?? "").split(":")[0];
  return Object.hasOwn(captionKeysByRow, kind) ? kind : "none";
}

/**
 * Caption entries for one row kind: `{ ids, keyDisplay, word }`. `keyDisplay`
 * joins the registered keys with `/`, so fold prints `h/l`.
 */
export function workCaptionKeys(kind = "none") {
  const entries = captionKeysByRow[workRowKind(`${kind}:`)] ?? captionKeysByRow.none;
  return entries.map(({ ids, word }) => ({ ids: [...ids], keyDisplay: ids.map((id) => workCommand(id).keyDisplay).join("/"), word }));
}

/** Rows for the `?` sheet. Each row stays separate; consumers never parse prose. */
export function workCommandHelpRows() {
  return WORK_COMMANDS.map(({ id, keyDisplay, ariaKeyshortcuts, scope, label, help, kind }) => ({ id, keyDisplay, ariaKeyshortcuts, scope, label, help, kind }));
}

/** True when one keyboard event is the registered shortcut for `id`. */
export function workCommandMatches(event, id) {
  const command = workCommand(id);
  if (!command || !event) return false;
  return command.shortcuts.some((shortcut) => {
    if (String(event.key ?? "") !== shortcut.key) return false;
    if (Boolean(event.metaKey) !== Boolean(shortcut.metaKey)) return false;
    if (Boolean(event.ctrlKey) !== Boolean(shortcut.ctrlKey)) return false;
    if (Boolean(event.altKey) !== Boolean(shortcut.altKey)) return false;
    if (shortcut.shiftKey !== "any" && Boolean(event.shiftKey) !== Boolean(shortcut.shiftKey)) return false;
    return true;
  });
}

export default WORK_COMMANDS;
