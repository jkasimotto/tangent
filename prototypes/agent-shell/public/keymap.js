// Factory-default keyboard shortcuts for agent shell.
//
// The vocabulary stays deliberately tiny, and every chord here is printed on
// the control it drives (header buttons, the find input, the browse legend).
// A shortcut that only this file knows about is a bug.
//
// Edit shortcuts in the app: the ⌘ button in the header opens the editor.
// Changes save to localStorage and override these defaults per browser.
//
// keys:   modifiers and a key joined with "+". Modifiers: cmd, ctrl, alt, shift.
// when:   "session" = a tmux session fills the view, "chat" = the orchestrator view,
//         "any" = both.
// action: a name from the ACTION_META table in index.html.
//
// Browser-reserved chords (cmd+w, cmd+t, cmd+n) only reach the page in
// fullscreen, where the Keyboard Lock API captures them. The editor marks
// such chords "fullscreen only".
//
// A chord with no modifier (⌫ below) fires only while the tree owns the
// keyboard. Everywhere else the key is text: Mac Delete, which reports itself
// to the browser as Backspace, deletes a character in a Claude Code session
// and in the find query. Kill stays "any" rather than "session" so a tree row
// can be killed while the orchestrator fills the work pane.
//
// Voice has no binding of its own: double-tapping the talk chord records, so
// rebinding talk moves speaking with it. Voice deliberately costs a deliberate
// gesture, because a bare modifier (⌥ once did this) records while you edit.
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "backspace", when: "any", action: "kill-session" },
  { keys: "cmd+/", when: "any", action: "find" },
  { keys: "cmd+arrowleft", when: "any", action: "focus-tree" },
  { keys: "cmd+arrowright", when: "any", action: "focus-work" },
  { keys: "cmd+.", when: "any", action: "active-only" },
  { keys: "cmd+k", when: "any", action: "talk" },
];
