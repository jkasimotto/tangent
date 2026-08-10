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
// cmd+d (kill) is "any", not "session", on purpose: an unbound chord in the
// orchestrator view would fall through to the browser (Safari's Add Bookmark)
// and give no answer at all. The action refuses the orchestrator out loud
// instead.
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "cmd+d", when: "any", action: "kill-session" },
  { keys: "cmd+/", when: "any", action: "find" },
  { keys: "cmd+arrowleft", when: "any", action: "focus-tree" },
  { keys: "cmd+arrowright", when: "any", action: "focus-work" },
  { keys: "cmd+.", when: "any", action: "active-only" },
  { keys: "cmd+k", when: "any", action: "talk" },
];
