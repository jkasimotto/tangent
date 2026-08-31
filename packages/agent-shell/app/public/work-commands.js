/**
 * Work's object-command registry.
 *
 * Product code renders labels and shortcut teaching from this table. Keyboard
 * code matches the same records, so a pointer label, the `?` key sheet, and a
 * key handler cannot silently assign different keys to one action. The `?`
 * sheet is the one list of commands: it shows every key and runs the row you
 * pick, so there is no separate command menu.
 */
const records = [
  { id: "moveRows", keyDisplay: "j / k", ariaKeyshortcuts: "j k", scope: "work", kind: "navigation", label: "Move between rows", help: "Move to the next or previous Work row.", shortcuts: [{ key: "j" }, { key: "k" }] },
  { id: "firstLast", keyDisplay: "gg / G", ariaKeyshortcuts: null, scope: "work", kind: "navigation", label: "First or last row", help: "Move to the first or last Work row." },
  { id: "count", keyDisplay: "5j / 12G", ariaKeyshortcuts: null, scope: "work", kind: "navigation", label: "Count a motion", help: "Digits before a motion repeat it: 5j moves five rows, 12G or 12gg goes to row 12." },
  { id: "halfPage", keyDisplay: "^D / ^U", ariaKeyshortcuts: "Control+D Control+U", scope: "work", kind: "navigation", label: "Half a page", help: "Move the cursor half a screen of rows down or up.", shortcuts: [{ key: "d", ctrlKey: true }, { key: "u", ctrlKey: true }] },
  { id: "previousArea", keyDisplay: "{", ariaKeyshortcuts: "Shift+[", scope: "area", kind: "navigation", label: "Previous Area", help: "Jump to the previous Area header that is not folded away, top-level or sub-Area.", shortcuts: [{ key: "{", shiftKey: "any" }] },
  { id: "nextArea", keyDisplay: "}", ariaKeyshortcuts: "Shift+]", scope: "area", kind: "navigation", label: "Next Area", help: "Jump to the next Area header that is not folded away, top-level or sub-Area.", shortcuts: [{ key: "}", shiftKey: "any" }] },
  { id: "open", keyDisplay: "↵", ariaKeyshortcuts: "Enter", scope: "work", kind: "action", label: "Open", help: "Open this Goal to read it, or read this Area's note. Escape comes back.", shortcuts: [{ key: "Enter" }] },
  { id: "stopAgent", keyDisplay: "s", ariaKeyshortcuts: "s", scope: "work", kind: "action", label: "Stop agent", help: "Stop the selected Goal agent or Area brain without stopping unrelated agents.", shortcuts: [{ key: "s" }] },
  { id: "defaults", keyDisplay: "d", ariaKeyshortcuts: "d", scope: "area", kind: "action", label: "Defaults", help: "Change this Area's default Work and brain agents.", shortcuts: [{ key: "d" }] },
  { id: "messageBrain", keyDisplay: "a", ariaKeyshortcuts: "a", scope: "area", kind: "action", label: "Message brain", help: "Tell this Area's brain what you want. It starts if it is not running.", shortcuts: [{ key: "a" }] },
  { id: "session", keyDisplay: "⌘⇧↵", ariaKeyshortcuts: "Meta+Shift+Enter", scope: "work", kind: "navigation", label: "Enter the agent", help: "Enter this row's agent. For an Area, choose the brain agent when it is not live. The same key comes back.", shortcuts: [{ key: "Enter", metaKey: true, shiftKey: true }] },
  { id: "starArea", keyDisplay: "f", ariaKeyshortcuts: "f", scope: "area", kind: "action", label: "Star Area", help: "Star this Area so Work puts it first. Press again to unstar. On a Goal, stars its Area.", shortcuts: [{ key: "f" }] },
  { id: "map", keyDisplay: "m", ariaKeyshortcuts: "m", scope: "area", kind: "surface", label: "Map", help: "Open this Area's living map. Escape comes back to this row.", shortcuts: [{ key: "m" }] },
  { id: "starredOnly", keyDisplay: "F", ariaKeyshortcuts: "Shift+F", scope: "work", kind: "action", label: "Only starred Areas", help: "Show only the starred Areas. Press again to show every Area.", shortcuts: [{ key: "F", shiftKey: true }] },
  { id: "activeOnly", keyDisplay: "A", ariaKeyshortcuts: "Shift+A", scope: "work", kind: "action", label: "Only active work", help: "Show only the Areas with a live brain or a running agent, and only their running Goals. Press again to show every Area.", shortcuts: [{ key: "A", shiftKey: true }] },
  { id: "chooseAreas", keyDisplay: "", ariaKeyshortcuts: null, scope: "area", kind: "action", label: "Choose Areas…", help: "Pick several Areas to star at once." },
  { id: "collapse", keyDisplay: "h", ariaKeyshortcuts: "h", scope: "work", kind: "navigation", label: "Collapse or move to parent", help: "Collapse this tree node. From a collapsed node or leaf, move to its parent.", shortcuts: [{ key: "h" }] },
  { id: "expand", keyDisplay: "l", ariaKeyshortcuts: "l", scope: "work", kind: "navigation", label: "Expand or move to child", help: "Expand this tree node. From an expanded node, move to its first child.", shortcuts: [{ key: "l" }] },
  { id: "questions", keyDisplay: "r", ariaKeyshortcuts: "r", scope: "area", kind: "action", label: "Review questions", help: "Review the open questions from this Area's brains.", shortcuts: [{ key: "r" }] },
  { id: "note", keyDisplay: "", ariaKeyshortcuts: null, scope: "area", kind: "action", label: "Send note", help: "Send a note to this Area brain." },
  { id: "readGoal", keyDisplay: "o", ariaKeyshortcuts: "o", scope: "goal", kind: "action", label: "Read Goal", help: "Read this Goal and its intent. Open its Job for Assignments and Attempts.", shortcuts: [{ key: "o" }] },
  { id: "fullDocument", keyDisplay: "o", ariaKeyshortcuts: "o", scope: "document", kind: "action", label: "Full reader", help: "Open this presented Document in the full reader.", shortcuts: [{ key: "o" }] },
  { id: "dismissPresentation", keyDisplay: "x", ariaKeyshortcuts: "x", scope: "document", kind: "action", label: "Dismiss", help: "Hide this presentation until the agent presents new content.", shortcuts: [{ key: "x" }] },
  { id: "readGoalPresented", keyDisplay: "o", ariaKeyshortcuts: "o", scope: "card", kind: "action", label: "Read Goal", help: "Open the Goal reader at Presented.", shortcuts: [{ key: "o" }] },
  { id: "dismissCard", keyDisplay: "x", ariaKeyshortcuts: "x", scope: "card", kind: "action", label: "Dismiss", help: "Hide this card until the brain changes it.", shortcuts: [{ key: "x" }] },
  { id: "resumeAttempt", keyDisplay: "r", ariaKeyshortcuts: "r", scope: "goal", kind: "action", label: "Resume agent", help: "Attach to this Goal's live agent. When it is gone, open a new session in its folder with the resume command typed, not submitted.", shortcuts: [{ key: "r" }] },
  { id: "changeAgent", keyDisplay: "c", ariaKeyshortcuts: "c", scope: "goal", kind: "surface", label: "Change agent", help: "Ask this Area's brain to replace the agent on the current attempt.", shortcuts: [{ key: "c" }] },
  { id: "goalStatus", keyDisplay: "x", ariaKeyshortcuts: "x", scope: "goal", kind: "surface", label: "Goal status", help: "Choose Done, Check it myself, Won't do, Park, or Reopen for this Goal.", shortcuts: [{ key: "x" }] },
  { id: "search", keyDisplay: "/", ariaKeyshortcuts: "/", scope: "work", kind: "search", label: "Search rows", help: "Type part of a row. The cursor follows the first match. Enter keeps the pattern, Escape returns to where you were.", shortcuts: [{ key: "/" }] },
  { id: "nextMatch", keyDisplay: "n", ariaKeyshortcuts: "n", scope: "work", kind: "search", label: "Next match", help: "Move to the next row that matches the search, wrapping at the end.", shortcuts: [{ key: "n" }] },
  { id: "previousMatch", keyDisplay: "N", ariaKeyshortcuts: "Shift+N", scope: "work", kind: "search", label: "Previous match", help: "Move to the previous row that matches the search, wrapping at the top.", shortcuts: [{ key: "N", shiftKey: "any" }] },
  { id: "keys", keyDisplay: "?", ariaKeyshortcuts: "?", scope: "work", kind: "surface", label: "Keys", help: "Show every key for this row. Pick a row to run it.", shortcuts: [{ key: "?", shiftKey: "any" }] },
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
export function workCommandsFor({ scope = "" } = {}) {
  return WORK_COMMANDS.filter((command) => !scope || command.scope === scope);
}

/**
 * The keys each Work row prints in the caption line, by row kind. Every entry
 * names registered command ids, so the caption and the `?` sheet read one
 * table and cannot drift. A glyph-only control, like the fold triangle, has
 * no verb to print its key beside, so this line is where its key is taught.
 */
const captionKeysByRow = Object.freeze({
  area: [
    { ids: ["stopAgent"], word: "stop" },
    { ids: ["session"], word: "agent" },
    { ids: ["messageBrain"], word: "message" },
    { ids: ["starArea"], word: "star" },
    { ids: ["map"], word: "map" },
    { ids: ["collapse", "expand"], word: "fold" },
    { ids: ["previousArea", "nextArea"], word: "areas", join: " " },
    { ids: ["questions"], word: "questions" },
    { ids: ["search"], word: "search" },
    { ids: ["keys"], word: "all" },
  ],
  goal: [
    { ids: ["open"], word: "open" },
    { ids: ["readGoal"], word: "read" },
    { ids: ["session"], word: "agent" },
    { ids: ["stopAgent"], word: "stop" },
    { ids: ["starArea"], word: "star" },
    { ids: ["map"], word: "map" },
    { ids: ["goalStatus"], word: "status" },
    { ids: ["changeAgent"], word: "agent" },
    { ids: ["resumeAttempt"], word: "resume" },
    { ids: ["collapse", "expand"], word: "fold" },
    { ids: ["search"], word: "search" },
    { ids: ["keys"], word: "all" },
  ],
  document: [
    { ids: ["open"], word: "read" },
    { ids: ["fullDocument"], word: "full" },
    { ids: ["dismissPresentation"], word: "dismiss" },
    { ids: ["search"], word: "search" },
    { ids: ["keys"], word: "all" },
  ],
  card: [
    { ids: ["open"], word: "open" },
    { ids: ["readGoalPresented"], word: "goal" },
    { ids: ["dismissCard"], word: "dismiss" },
    { ids: ["search"], word: "search" },
    { ids: ["keys"], word: "all" },
  ],
  definition: [
    { ids: ["open"], word: "open" },
    { ids: ["session"], word: "agent" },
    { ids: ["moveRows"], word: "rows" },
    { ids: ["search"], word: "search" },
    { ids: ["keys"], word: "all" },
  ],
  none: [
    { ids: ["moveRows"], word: "rows" },
    { ids: ["search"], word: "search" },
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
 * joins the registered keys with `/`, so fold prints `h/l`. An entry names
 * its own `join` when a slash reads wrong, so the Area jumps print `{ }`.
 */
export function workCaptionKeys(kind = "none") {
  const entries = captionKeysByRow[workRowKind(`${kind}:`)] ?? captionKeysByRow.none;
  return entries.map(({ ids, word, join = "/" }) => ({ ids: [...ids], keyDisplay: ids.map((id) => workCommand(id).keyDisplay).filter(Boolean).join(join), word, join }));
}

/** Rows for the `?` sheet, one per registered command; consumers never parse prose. */
export function workCommandHelpRows() {
  return WORK_COMMANDS.map(({ id, keyDisplay, ariaKeyshortcuts, scope, label, help, kind }) => ({ id, keyDisplay, ariaKeyshortcuts, scope, label, help, kind }));
}

/** True when one keyboard event is the registered shortcut for `id`. */
export function workCommandMatches(event, id) {
  const command = workCommand(id);
  if (!command || !event) return false;
  return command.shortcuts.some((shortcut) => {
    const key = String(event.key ?? "");
    if (shortcut.ctrlKey ? key.toLowerCase() !== shortcut.key : key !== shortcut.key) return false;
    if (Boolean(event.metaKey) !== Boolean(shortcut.metaKey)) return false;
    if (Boolean(event.ctrlKey) !== Boolean(shortcut.ctrlKey)) return false;
    if (Boolean(event.altKey) !== Boolean(shortcut.altKey)) return false;
    if (shortcut.shiftKey !== "any" && Boolean(event.shiftKey) !== Boolean(shortcut.shiftKey)) return false;
    return true;
  });
}

export default WORK_COMMANDS;
