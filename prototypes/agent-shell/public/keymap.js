// Keyboard shortcuts for agent shell. Edit this file and reload the page.
//
// keys:   modifiers and a key joined with "+". Modifiers: cmd, ctrl, alt, shift.
// when:   "session" = a tmux session fills the view
//         "chat"    = the chat view is active
//         "any"     = both states
// action: a name from the ACTIONS table in index.html:
//         close-session   leave the session view, back to chat (detach, the
//                         tmux session keeps running)
//         toggle-sidebar  open or close the project tree
//         toggle-filter   toggle the running-sessions filter
//
// Browser-reserved chords (cmd+w, cmd+t, cmd+n) only reach the page in
// fullscreen, where the Keyboard Lock API captures them. Outside fullscreen,
// cmd+w in a session triggers the browser leave-page prompt as a guard; in
// chat it closes the tab as normal.
window.KEYMAP = [
  { keys: "cmd+w", when: "session", action: "close-session" },
  { keys: "cmd+b", when: "any", action: "toggle-sidebar" },
];
