
  // xterm sends a bare carriage return for Shift+Enter, so an agent harness
  // sends the message and a shell runs the line. Meta+Enter (ESC CR) is the
  // form that arrives unchanged: tmux passes it through whatever the pane
  // program negotiated, Claude Code and Codex put a newline in the composer,
  // and zsh puts a newline in the command line. The CSI u form ESC [ 13 ; 2 u
  // that iTerm2 sends does not work here, because tmux rewrites modified keys
  // for the pane program, and for a program that did not ask for extended
  // keys (a plain shell) it rewrites Shift+Enter down to a carriage return.
  const SHIFT_ENTER = "\x1b\r";

  /**
   * Gives the bytes that Agent Shell sends for a key that xterm delivers
   * wrong, or an empty string to leave the key to xterm.
   */
  function terminalKeySequence(event) {
    if (event.isComposing || ["Dead", "Process", "Unidentified"].includes(event.key)) return "";
    if (event.type !== "keydown" || event.key !== "Enter") return "";
    if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return "";
    return SHIFT_ENTER;
  }

export default { terminalKeySequence };
