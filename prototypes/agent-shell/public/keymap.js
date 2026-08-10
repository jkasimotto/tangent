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
// when:   "session" = a tmux session fills the view, "chat" = the chat view,
//         "any" = both.
// action: a name from the ACTION_META table in index.html.
//
// Browser-reserved chords (cmd+w, cmd+t, cmd+n) only reach the page in
// fullscreen, where the Keyboard Lock API captures them. The editor marks
// such chords "fullscreen only".
//
// The Mac Delete key reports itself to the browser as Backspace. Kill is
// "any", not "session", so the shell can explain when there is no killable
// session in front of the user instead of silently doing nothing.
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "backspace", when: "any", action: "kill-session" },
  { keys: "cmd+/", when: "any", action: "find" },
  { keys: "cmd+k", when: "any", action: "talk" },
];
