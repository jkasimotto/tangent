// Factory-default keyboard shortcuts for agent shell.
//
// Edit shortcuts in the app: the ⌘ button in the header opens the editor.
// Changes save to localStorage and override these defaults per browser.
// This file only sets what a fresh browser starts with.
//
// keys:   modifiers and a key joined with "+". Modifiers: cmd, ctrl, alt, shift.
// when:   "session" = a tmux session fills the view, "chat" = the chat view,
//         "any" = both.
// action: a name from the ACTION_META table in index.html.
//
// Browser-reserved chords (cmd+w, cmd+t, cmd+n) only reach the page in
// fullscreen, where the Keyboard Lock API captures them. The editor marks
// such chords "fullscreen only".
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "cmd+d", when: "session", action: "kill-session" },
  { keys: "cmd+b", when: "any", action: "toggle-sidebar" },
];
