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
  let terminalGeneration = 0;
  let fitTerminal = null;

  /** Disposes the mounted terminal and its transport. */
  function disposeTerminal() {
    terminalGeneration += 1;
    window.clearTimeout(terminalReconnectTimer);
    terminalReconnectTimer = null;
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
      convertEol: true,
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
    /** Fits xterm and reports its current dimensions to tmux. */
    const fit = () => {
      try {
        terminalFit.fit();
        if (terminalSocket?.readyState === WebSocket.OPEN) terminalSocket.send(`\x00resize:${terminal.cols}x${terminal.rows}`);
      } catch {}
    };
    fitTerminal = fit;
    terminalResizeObserver = new ResizeObserver(fit);
    terminalResizeObserver.observe(host);
    let reconnectAttempt = 0;
    let connectionWasLost = false;
    /** Connects this stable xterm instance to a replaceable transport. */
    const connect = () => {
      if (generation !== terminalGeneration || terminalSession !== sessionName) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/term?session=${encodeURIComponent(sessionName)}&cols=${terminal.cols}&rows=${terminal.rows}`);
      terminalSocket = socket;
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => terminal?.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
      socket.onopen = () => {
        if (terminalSocket !== socket) return;
        reconnectAttempt = 0;
        fit();
        if (connectionWasLost) terminal?.write("\r\n\x1b[90m[terminal reconnected]\x1b[0m\r\n");
        connectionWasLost = false;
      };
      socket.onclose = (event) => {
        if (generation !== terminalGeneration || terminalSocket !== socket) return;
        terminalSocket = null;
        if (event.code === 4404) {
          terminal?.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
          return;
        }
        if (!connectionWasLost) terminal?.write("\r\n\x1b[90m[terminal connection lost; reconnecting]\x1b[0m\r\n");
        connectionWasLost = true;
        const delay = Math.min(5_000, 250 * (2 ** Math.min(reconnectAttempt, 5)));
        reconnectAttempt += 1;
        terminalReconnectTimer = window.setTimeout(connect, delay);
      };
    };
    // The overlay becomes visible in the same paint that mounts xterm. Wait
    // for layout before the first connection, so tmux never receives xterm's
    // 80x24 construction default as the browser client size.
    window.setTimeout(() => {
      if (generation !== terminalGeneration || terminalSession !== sessionName) return;
      fit();
      connect();
    }, 0);
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
