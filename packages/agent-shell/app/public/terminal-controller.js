import terminalKeys from "./terminal-keys.js";
import terminalSelectionApi from "./terminal-selection.js";

/** Owns terminal construction, transport, fitting, selection, and disposal. */
export function createTerminalController({ state, showToast }) {
  let terminal = null;
  let terminalFit = null;
  let terminalSocket = null;
  let terminalResizeObserver = null;
  let terminalSession = "";
  let terminalSelection = null;
  let terminalReconnectTimer = null;
  let terminalMeasureFrame = null;
  let terminalGeneration = 0;
  let fitTerminal = null;
  let reportedSize = "";

  /** Disposes the mounted terminal and its transport. */
  function disposeTerminal() {
    terminalGeneration += 1;
    window.clearTimeout(terminalReconnectTimer);
    terminalReconnectTimer = null;
    if (terminalMeasureFrame !== null) window.cancelAnimationFrame?.(terminalMeasureFrame);
    terminalMeasureFrame = null;
    terminalSelection?.dispose();
    terminalSelection = null;
    terminalResizeObserver?.disconnect();
    terminalResizeObserver = null;
    if (terminalSocket) {
      terminalSocket.onclose = null;
      terminalSocket.close(1000, "terminal view closed");
    }
    terminalSocket = null;
    terminal?.dispose();
    terminal = null;
    terminalFit = null;
    fitTerminal = null;
    reportedSize = "";
    terminalSession = "";
  }

  /**
   * Renders the terminal on a WebGL canvas instead of xterm's DOM renderer.
   * The DOM renderer left stale glyphs on screen when Safari partially
   * repainted a scrolled terminal; a canvas repaints whole frames, so an
   * earlier frame cannot survive. On WebGL context loss the addon is
   * disposed and xterm falls back to the DOM renderer instead of going blank.
   */
  function loadTerminalWebgl(term) {
    if (!window.WebglAddon) return;
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {}
  }

  /** Mounts one stable xterm instance for the selected tmux session. */
  function mountTerminal(host, sessionName) {
    if (terminal && terminalSession === sessionName && terminal.element && host.contains(terminal.element)) return;
    disposeTerminal();
    if (!window.Terminal || !window.FitAddon) {
      host.textContent = "The terminal did not load.";
      return;
    }
    terminalSession = sessionName;
    const generation = ++terminalGeneration;
    terminal = new Terminal({
      cursorBlink: false,
      fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.32,
      macOptionClickForcesSelection: true,
      scrollback: 8000,
      theme: {
        background: "#080a0d",
        foreground: "#dce1e6",
        cursor: "#dce1e6",
        selectionBackground: "#29415f",
      },
    });
    terminalFit = new FitAddon.FitAddon();
    terminal.loadAddon(terminalFit);
    terminal.open(host);
    loadTerminalWebgl(terminal);
    terminalSelection = terminalSelectionApi?.preserveTerminalSelection({
      terminal,
      host,
      clipboard: navigator.clipboard,
    });
    /** Fits a measured xterm and reports each new size to tmux once. */
    const fit = () => {
      try {
        const proposed = terminalFit.proposeDimensions();
        if (!Number.isInteger(proposed?.cols) || proposed.cols < 1 || !Number.isInteger(proposed?.rows) || proposed.rows < 1) return null;
        terminalFit.fit();
        if (terminal.cols !== proposed.cols || terminal.rows !== proposed.rows) return null;
        const measured = { cols: terminal.cols, rows: terminal.rows };
        const size = `${measured.cols}x${measured.rows}`;
        if (terminalSocket?.readyState === WebSocket.OPEN && size !== reportedSize) {
          terminalSocket.send(`\x00resize:${size}`);
          reportedSize = size;
        }
        return measured;
      } catch {
        return null;
      }
    };
    fitTerminal = fit;
    terminalResizeObserver = new ResizeObserver(fit);
    terminalResizeObserver.observe(host);
    let reconnectAttempt = 0;
    let connectionWasLost = false;
    /** Connects this stable xterm instance to a replaceable transport. */
    const connect = (measured) => {
      if (generation !== terminalGeneration || terminalSession !== sessionName) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const attachedSize = `${measured.cols}x${measured.rows}`;
      const socket = new WebSocket(`${protocol}//${location.host}/term?session=${encodeURIComponent(sessionName)}&cols=${measured.cols}&rows=${measured.rows}`);
      terminalSocket = socket;
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => terminal?.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
      socket.onopen = () => {
        if (terminalSocket !== socket) return;
        reconnectAttempt = 0;
        reportedSize = attachedSize;
        fit();
        if (connectionWasLost) showToast("Terminal reconnected.");
        connectionWasLost = false;
      };
      socket.onclose = (event) => {
        if (generation !== terminalGeneration || terminalSocket !== socket) return;
        terminalSocket = null;
        if (event.code === 4404) {
          showToast("The tmux session ended.");
          return;
        }
        if (!connectionWasLost) showToast("Terminal connection lost. Reconnecting…");
        connectionWasLost = true;
        const delay = Math.min(5_000, 250 * (2 ** Math.min(reconnectAttempt, 5)));
        reconnectAttempt += 1;
        terminalReconnectTimer = window.setTimeout(connectWhenMeasured, delay);
      };
    };
    /** Opens the transport only after FitAddon can measure real cell dimensions. */
    function connectWhenMeasured() {
      terminalReconnectTimer = null;
      if (generation !== terminalGeneration || terminalSession !== sessionName || terminalSocket || terminalMeasureFrame !== null) return;
      /** Measures terminal cells until FitAddon can propose valid dimensions. */
      const measure = () => {
        terminalMeasureFrame = null;
        if (generation !== terminalGeneration || terminalSession !== sessionName || terminalSocket) return;
        const measured = fit();
        if (measured) {
          connect(measured);
          return;
        }
        terminalMeasureFrame = window.requestAnimationFrame?.(measure) ?? null;
      };
      terminalMeasureFrame = window.requestAnimationFrame?.(measure) ?? null;
    }
    connectWhenMeasured();
    terminal.onData((data) => {
      terminalSelection?.noteInput();
      if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(data);
    });
    // xterm holds one custom key handler. Agent Shell's own key translations
    // come first, then the selection module gets the keys it owns.
    terminal.attachCustomKeyEventHandler((event) => {
      const keys = terminalKeys?.terminalKeySequence(event) ?? "";
      if (!keys) return terminalSelection?.handleKeyEvent(event) ?? true;
      terminalSelection?.noteInput();
      if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(keys);
      event.preventDefault();
      return false;
    });
    terminal.focus();
  }

  return {
    disposeTerminal,
    mountTerminal,
    /** Fits the terminal to its host. */
    fit: () => fitTerminal?.(),
  };
}
