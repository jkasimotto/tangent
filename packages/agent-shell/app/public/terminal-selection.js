
  /** Keeps a completed xterm selection stable across terminal repaints. */
  function preserveTerminalSelection({ terminal, host, clipboard, defer = (callback) => setTimeout(callback, 0) }) {
    let selecting = false;
    let restoring = false;
    let saved = null;
    let restorePending = false;

    /** Records the exact selected text and its buffer coordinates. */
    function rememberSelection() {
      const text = terminal.getSelection();
      const range = terminal.getSelectionPosition();
      if (!text || !range) return;
      saved = { text, range };
    }

    /** Restores a repaint-cleared highlight without replacing the saved text. */
    function restoreSelection() {
      restorePending = false;
      if (selecting || restoring || !saved || terminal.hasSelection()) return;
      const { start, end } = saved.range;
      const length = Math.max(0, (end.y - start.y) * terminal.cols + end.x - start.x);
      if (!length) return;
      restoring = true;
      terminal.select(start.x, start.y, length);
      restoring = false;
    }

    const selectionDisposable = terminal.onSelectionChange(() => {
      if (restoring) return;
      if (terminal.hasSelection()) {
        rememberSelection();
        return;
      }
      if (!selecting && saved && !restorePending) {
        restorePending = true;
        defer(restoreSelection);
      }
    });

    /** Starts a drag selection, and presents it to xterm as a forced selection. */
    const beginSelection = (event) => {
      selecting = true;
      saved = null;
      // Full-screen agent TUIs enable terminal mouse reporting, which makes
      // xterm require Option for selection on macOS. Agent Shell owns drag as
      // selection, so present an ordinary primary-button drag to xterm as the
      // force-selection gesture before xterm's target listener sees it.
      if (event.button === 0 && !event.altKey) {
        try { Object.defineProperty(event, "altKey", { configurable: true, value: true }); } catch {}
      }
    };
    /** Remembers the selection when the drag ends. */
    const finishSelection = () => {
      if (!selecting) return;
      selecting = false;
      rememberSelection();
    };
    host.addEventListener("mousedown", beginSelection, true);
    host.ownerDocument.addEventListener("mouseup", finishSelection, true);

    /**
     * Copies the remembered selection on Command-C. xterm holds one custom
     * key handler, and shell.js owns it, so it calls this for the keys it
     * does not translate itself.
     */
    function handleKeyEvent(event) {
      if (event.type !== "keydown" || !event.metaKey || event.key.toLowerCase() !== "c") return true;
      const text = saved?.text || (terminal.hasSelection() ? terminal.getSelection() : "");
      if (text) void clipboard?.writeText(text);
      event.preventDefault();
      return false;
    }

    return {
      handleKeyEvent,
      /** Clears the durable selection when the user intentionally types into the agent. */
      noteInput() {
        if (!saved) return;
        saved = null;
        terminal.clearSelection();
      },
      /** Stops listening to the terminal and the document. */
      dispose() {
        selectionDisposable?.dispose();
        host.removeEventListener("mousedown", beginSelection, true);
        host.ownerDocument.removeEventListener("mouseup", finishSelection, true);
      },
    };
  }

export default { preserveTerminalSelection };
