// Factory-default keyboard shortcuts for agent shell.
//
// The vocabulary stays deliberately tiny, and every chord here is printed on
// the control it drives (header buttons, map legend, focus rows) — a shortcut
// that only this file knows about is a bug. cmd+1..9 (switch focus) is
// hardcoded in the engine and printed on the focus rows themselves.
//
// Edit shortcuts in the app: the ⌘ button in the header opens the editor.
// Changes save to localStorage and override these defaults per browser.
//
// keys:   modifiers and a key joined with "+". Modifiers: cmd, ctrl, alt, shift.
// when:   "session" = a tmux session fills the view, "chat" = the chat view,
//         "any" = both.
// action: a name from the ACTION_META table in index.html.
//
// Browser-reserved chords (cmd+w, cmd+t, cmd+n) only reach the page in
// fullscreen, where the Keyboard Lock API captures them. The editor marks
// such chords "fullscreen only".
//
// cmd+d (kill) is "any", not "session", on purpose: an unbound chord in root
// main would fall through to the browser (Safari's Add Bookmark) and give no
// answer at all. The action refuses root main out loud instead.
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "cmd+d", when: "any", action: "kill-session" },
  { keys: "cmd+/", when: "any", action: "map" },
  { keys: "cmd+k", when: "any", action: "talk" },
];
