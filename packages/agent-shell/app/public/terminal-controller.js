import terminalKeys from "./terminal-keys.js";
import terminalSelectionApi from "./terminal-selection.js";

/** Owns terminal construction, transport, fitting, selection, and disposal. */
export function createTerminalController({ state, showToast, record = null }) {
  let terminal = null;
  /**
   * Writes one timing record for the open path, so a slow or black terminal
   * names the phase that took the time: measuring cells, opening the socket,
   * or waiting for tmux's first bytes (investigation of slow brain opens,
   * 2026-08-28). Never throws and never blocks the terminal.
   */
  function trace(action, detail) {
    try {
      // The telemetry envelope keeps a fixed set of fields, so the phases
      // travel inside the action string and the total in durationMs.
      const phases = Object.entries(detail).filter(([key, value]) => key !== "at" && value !== null && value !== undefined && value !== "").map(([key, value]) => `${key}=${value}`).join(" ");
      const total = detail.firstDataMs ?? detail.closedMs ?? detail.stalledMs;
      record?.("terminal", `${action} ${phases}`, Number.isFinite(total) ? { durationMs: total } : {});
    } catch {}
  }
  let terminalFit = null;
  let terminalSocket = null;
  let terminalResizeObserver = null;
  let terminalSession = "";
  let terminalSelection = null;
  let terminalReconnectTimer = null;
  let terminalMeasureFrame = null;
  let stalledTimer = null;
  let terminalGeneration = 0;
  let fitTerminal = null;
  let reportedSize = "";

  /** Disposes the mounted terminal and its transport. */
  function disposeTerminal() {
    if (terminal && terminalSession) state.terminalScrolls?.set?.(terminalSession, terminal.buffer?.active?.viewportY ?? 0);
    terminalGeneration += 1;
    window.clearTimeout(terminalReconnectTimer);
    terminalReconnectTimer = null;
    window.clearTimeout(stalledTimer);
    stalledTimer = null;
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
    const opened = { at: performance.now(), frames: 0, measuredMs: null, socketMs: null, firstDataMs: null, connects: 0 };
    const restoredViewport = state.terminalScrolls?.get?.(sessionName);
    let viewportRestored = !Number.isFinite(restoredViewport);
    /** Milliseconds since this mount began, rounded. */
    const sinceMount = () => Math.round(performance.now() - opened.at);
    // A screen still black after two seconds is reported once with the phase
    // it is stuck in, because the measure loop and a silent socket show
    // nothing on their own.
    stalledTimer = window.setTimeout(() => {
      if (generation !== terminalGeneration || opened.firstDataMs !== null) return;
      trace("stalled", { session: sessionName, ...opened, hostWidth: host.clientWidth, hostHeight: host.clientHeight, socketState: terminalSocket?.readyState ?? null, stalledMs: sinceMount() });
    }, 2_000);
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
      opened.connects += 1;
      const connectedAt = sinceMount();
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => {
        if (opened.firstDataMs === null) {
          opened.firstDataMs = sinceMount();
          trace("open", { session: sessionName, ...opened });
        }
        const data = typeof event.data === "string" ? event.data : new Uint8Array(event.data);
        terminal?.write(data, () => {
          if (viewportRestored || generation !== terminalGeneration) return;
          viewportRestored = true;
          terminal?.scrollToLine?.(restoredViewport);
        });
      };
      socket.onopen = () => {
        if (terminalSocket !== socket) return;
        opened.socketMs ??= sinceMount();
        reconnectAttempt = 0;
        reportedSize = attachedSize;
        fit();
        if (connectionWasLost) showToast("Terminal reconnected.");
        connectionWasLost = false;
      };
      socket.onclose = (event) => {
        if (generation !== terminalGeneration || terminalSocket !== socket) return;
        terminalSocket = null;
        trace("close", { session: sessionName, code: event.code, reason: event.reason || "", connectedAt, closedMs: sinceMount(), hadData: opened.firstDataMs !== null, attempt: reconnectAttempt });
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
        opened.frames += 1;
        const measured = fit();
        if (measured) {
          opened.measuredMs ??= sinceMount();
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
    /** Returns keyboard focus to the mounted xterm instance. */
    focus: () => terminal?.focus?.(),
    /** Fits the terminal to its host. */
    fit: () => fitTerminal?.(),
  };
}
