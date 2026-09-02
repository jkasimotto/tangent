import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTerminalController } from "./public/terminal-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Installs deterministic browser and xterm doubles for one controller test. */
function terminalWorld() {
  const keys = ["window", "Terminal", "FitAddon", "ResizeObserver", "WebSocket", "location", "navigator"];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map();
  const cancelledFrames = [];
  const timeouts = new Map();
  const sockets = [];
  const terminals = [];
  const observers = [];
  const fitState = { measurement: null, calls: 0, probes: 0 };
  let nextFrame = 1;
  let nextTimeout = 1;

  /** Creates the DOM surface used by the terminal-local status. */
  function elementDouble(tagName) {
    const attributes = new Map();
    return {
      tagName: tagName.toUpperCase(), className: "", hidden: false, textContent: "", parentNode: null,
      /** Test helper for setAttribute. */
      setAttribute(name, value) { attributes.set(name, String(value)); },
      /** Test helper for getAttribute. */
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
      /** Test helper for removeAttribute. */
      removeAttribute(name) { attributes.delete(name); },
      /** Test helper for remove. */
      remove() {
        this.parentNode?.elements.delete(this);
        this.parentNode = null;
      },
    };
  }

  class TerminalDouble {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.focusCalls = 0;
      this.writes = [];
      this.disposed = false;
      this.loadAddon = (addon) => addon.activate?.(this);
      this.open = (host) => {
        this.element = elementDouble("div");
        this.element.className = "xterm";
        host.append(this.element);
      };
      this.focus = () => { this.focusCalls += 1; };
      this.onData = () => {};
      this.onSelectionChange = () => ({
        /** Test helper for dispose. */
        dispose() {} });
      this.hasSelection = () => false;
      this.getSelection = () => "";
      this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {};
      this.write = (data, callback) => {
        this.writes.push(data);
        callback?.();
      };
      this.dispose = () => { this.disposed = true; };
      terminals.push(this);
    }
  }

  class FitDouble {
    /** Test helper for activate. */
    activate(terminal) { this.terminal = terminal; }
    /** Test helper for proposeDimensions. */
    proposeDimensions() {
      fitState.probes += 1;
      return fitState.measurement;
    }
    /** Test helper for fit. */
    fit() {
      fitState.calls += 1;
      if (!fitState.measurement) return;
      this.terminal.cols = fitState.measurement.cols;
      this.terminal.rows = fitState.measurement.rows;
    }
  }

  class ResizeObserverDouble {
    constructor(callback) {
      this.callback = callback;
      this.observe = () => {};
      this.disconnect = () => {};
      observers.push(this);
    }
  }

  class WebSocketDouble {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.send = (data) => this.sent.push(data);
      this.close = () => { this.readyState = 3; };
      sockets.push(this);
    }
    /** Test helper for open. */
    open() {
      this.readyState = WebSocketDouble.OPEN;
      this.onopen?.();
    }
    /** Test helper for message. */
    message(data) { this.onmessage?.({ data }); }
    /** Test helper for a server-side close. */
    closeFromServer(code, reason = "") {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }

  const windowDouble = {
    Terminal: TerminalDouble,
    FitAddon: { FitAddon: FitDouble },
    WebglAddon: null,
    /** Test helper for requestAnimationFrame. */
    requestAnimationFrame(callback) {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    /** Test helper for cancelAnimationFrame. */
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
    /** Test helper for setTimeout. */
    setTimeout(callback, delay) {
      const id = nextTimeout;
      nextTimeout += 1;
      timeouts.set(id, { callback, delay });
      return id;
    },
    /** Test helper for clearTimeout. */
    clearTimeout(id) { timeouts.delete(id); },
  };
  const values = {
    window: windowDouble,
    Terminal: TerminalDouble,
    FitAddon: windowDouble.FitAddon,
    ResizeObserver: ResizeObserverDouble,
    WebSocket: WebSocketDouble,
    location: { protocol: "http:", host: "agent-shell.test" },
    navigator: { clipboard: {
      /** Test helper for writeText. */
      async writeText() {} } },
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const ownerDocument = {
    /** Test helper for createElement. */
    createElement: elementDouble,
    /** Test helper for addEventListener. */
    addEventListener() {},
    /** Test helper for removeEventListener. */
    removeEventListener() {} };
  const host = {
    elements: new Set(), ownerDocument,
    /** Test helper for addEventListener. */
    addEventListener() {},
    /** Test helper for removeEventListener. */
    removeEventListener() {},
    /** Test helper for append. */
    append(element) {
      element.parentNode = this;
      this.elements.add(element);
    },
    /** Test helper for contains. */
    contains(element) { return this.elements.has(element); },
  };

  return {
    cancelledFrames, fitState, frames, host, observers, sockets, terminals, timeouts,
    /** Finds the terminal-local transport status. */
    status() {
      return [...host.elements].find((element) => element.getAttribute?.("data-terminal-transport-status") !== null) ?? null;
    },
    /** Test helper for runFrame. */
    runFrame() {
      const entry = frames.entries().next().value;
      assert.ok(entry, "one measurement frame is pending");
      const [id, callback] = entry;
      frames.delete(id);
      callback();
      return id;
    },
    /** Runs the first pending timeout with this exact delay. */
    runTimeout(delay) {
      const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `one ${delay}ms timeout is pending`);
      const [id, timer] = entry;
      timeouts.delete(id);
      timer.callback();
      return id;
    },
    /** Counts pending timeouts with this exact delay. */
    timeoutCount(delay) {
      return [...timeouts.values()].filter((timer) => timer.delay === delay).length;
    },
    /** Test helper for restore. */
    restore() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

/** Mounts one measured terminal and returns its stable UI and transport. */
function mountMeasuredTerminal(world, options = {}) {
  world.fitState.measurement = { cols: 176, rows: 54 };
  const controller = createTerminalController({ state: {}, ...options });
  controller.mountTerminal(world.host, "brain one");
  world.runFrame();
  return { controller, socket: world.sockets[0], status: world.status(), terminal: world.terminals[0] };
}

test("terminal attachment waits for measured cells and reports each later size once", { concurrency: false }, () => {
  const world = terminalWorld();
  try {
    const controller = createTerminalController({ state: {} });
    controller.mountTerminal(world.host, "brain one");

    assert.equal(world.terminals[0].options.convertEol, undefined, "PTY output keeps its original newline behavior");
    assert.equal(world.sockets.length, 0, "no transport opens at xterm's 80 by 24 default");
    assert.equal(world.frames.size, 1);

    world.runFrame();
    assert.equal(world.sockets.length, 0, "an unmeasured frame does not open the transport");
    assert.equal(world.frames.size, 1, "measurement retries on the next animation frame");

    world.fitState.measurement = { cols: 0, rows: 0 };
    world.runFrame();
    assert.equal(world.sockets.length, 0, "an invalid grid does not open the transport");

    world.fitState.measurement = { cols: 176, rows: 54 };
    world.runFrame();
    assert.equal(world.sockets.length, 1);
    assert.equal(world.sockets[0].url, "ws://agent-shell.test/term?session=brain%20one&cols=176&rows=54");
    assert.equal(world.frames.size, 0);

    const socket = world.sockets[0];
    socket.open();
    assert.deepEqual(socket.sent, [], "the attached size is not echoed as a resize");
    world.observers[0].callback();
    world.observers[0].callback();
    assert.deepEqual(socket.sent, [], "unchanged observer measurements are deduplicated");

    world.fitState.measurement = { cols: 160, rows: 48 };
    world.observers[0].callback();
    world.observers[0].callback();
    controller.fit();
    assert.deepEqual(socket.sent, ["\x00resize:160x48"], "one changed size produces one control message");

    world.fitState.measurement = null;
    controller.disposeTerminal();
    controller.mountTerminal(world.host, "brain two");
    const pending = [...world.frames.keys()][0];
    controller.disposeTerminal();
    assert.ok(world.cancelledFrames.includes(pending), "dispose cancels the pending measurement frame");
    assert.equal(world.frames.size, 0);
  } finally {
    world.restore();
  }
});

test("a longer terminal outage waits for replacement data and preserves the xterm and focus", { concurrency: false }, () => {
  const world = terminalWorld();
  const toasts = [];
  try {
    const { controller, socket, status, terminal } = mountMeasuredTerminal(world, {
      /** A legacy caller argument must never receive terminal recovery feedback. */
      showToast(message) { toasts.push(message); },
    });
    assert.ok(status);
    assert.equal(status.hidden, true);
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.getAttribute("aria-atomic"), "true");
    assert.equal(status.getAttribute("tabindex"), null, "the local status cannot take focus");
    socket.open();
    socket.message("last visible frame");
    assert.deepEqual(terminal.writes, ["last visible frame"]);
    assert.equal(terminal.focusCalls, 1);

    socket.closeFromServer(1006, "gateway restarted");
    assert.equal(status.hidden, true, "the delayed status keeps a short interruption quiet");
    assert.equal(world.timeoutCount(250), 1, "the first retry keeps the existing backoff");
    assert.equal(world.timeoutCount(700), 1, "outage feedback is delayed");
    assert.deepEqual(terminal.writes, ["last visible frame"], "the last terminal frame remains untouched");
    assert.equal(terminal.disposed, false);

    world.runTimeout(250);
    world.runFrame();
    const replacement = world.sockets[1];
    replacement.open();
    assert.equal(status.hidden, true, "socket open alone does not claim recovery");
    world.runTimeout(700);
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, "Terminal display disconnected · reconnecting");
    assert.equal(status.getAttribute("data-state"), "reconnecting");
    assert.equal(terminal.focusCalls, 1, "status changes do not move terminal focus");

    replacement.message("replacement data");
    assert.equal(world.terminals.length, 1, "recovery reuses the exact xterm instance");
    assert.deepEqual(terminal.writes, ["last visible frame", "replacement data"]);
    assert.equal(status.textContent, "Terminal display restored");
    assert.equal(status.getAttribute("data-state"), "restored");
    assert.equal(terminal.focusCalls, 1);
    assert.deepEqual(toasts, [], "terminal recovery never uses global toast feedback");

    world.runTimeout(1_200);
    assert.equal(status.hidden, true);
    assert.equal(status.textContent, "");
    assert.equal(status.getAttribute("data-state"), null);
    controller.disposeTerminal();
    assert.equal(world.host.contains(status), false, "disposal removes the local status with its terminal");
  } finally {
    world.restore();
  }
});

test("a short terminal reconnect stays silent", { concurrency: false }, () => {
  const world = terminalWorld();
  const toasts = [];
  try {
    const { socket, status, terminal } = mountMeasuredTerminal(world, {
      /** Records any forbidden global recovery feedback. */
      showToast(message) { toasts.push(message); },
    });
    socket.open();
    socket.message("existing frame");
    socket.closeFromServer(1006);
    world.runTimeout(250);
    world.runFrame();
    world.sockets[1].open();
    world.sockets[1].message("quick replacement");

    assert.equal(status.hidden, true);
    assert.equal(status.textContent, "");
    assert.equal(status.getAttribute("data-state"), null);
    assert.equal(world.timeoutCount(700), 0, "replacement data cancels delayed outage feedback");
    assert.equal(world.timeoutCount(1_200), 0, "a hidden outage does not produce a restored message");
    assert.equal(world.terminals[0], terminal);
    assert.equal(terminal.focusCalls, 1);
    assert.deepEqual(toasts, []);
  } finally {
    world.restore();
  }
});

test("terminal ownership and ended-session closes stay local and never retry", { concurrency: false }, async (context) => {
  for (const expected of [
    { code: 4403, state: "ownership-error", text: "Terminal display unavailable · open in another Agent Shell" },
    { code: 4404, state: "ended", text: "Terminal session ended" },
  ]) {
    await context.test(String(expected.code), () => {
      const world = terminalWorld();
      try {
        const { socket, status, terminal } = mountMeasuredTerminal(world);
        socket.open();
        socket.message("retained frame");
        socket.closeFromServer(expected.code);

        assert.equal(status.hidden, false);
        assert.equal(status.textContent, expected.text);
        assert.equal(status.getAttribute("data-state"), expected.state);
        assert.equal(world.timeoutCount(250), 0, "a final transport code does not schedule a retry");
        assert.equal(world.timeoutCount(700), 0, "a final transport code does not schedule reconnect feedback");
        assert.equal(world.frames.size, 0);
        assert.equal(world.sockets.length, 1);
        assert.deepEqual(terminal.writes, ["retained frame"]);
        assert.equal(terminal.disposed, false);
        assert.equal(terminal.focusCalls, 1);

        world.runTimeout(2_000);
        assert.equal(status.textContent, expected.text, "the local error remains visible");
        assert.equal(world.sockets.length, 1);
      } finally {
        world.restore();
      }
    });
  }
});

test("terminal recovery has no global toast dependency", async () => {
  const source = await readFile(path.join(here, "public", "terminal-controller.js"), "utf8");
  assert.doesNotMatch(source, /\bshowToast\b/);
});

test("window resize calls the controller fit callback directly", async () => {
  const source = await readFile(path.join(here, "public", "shell-event-bindings.js"), "utf8");
  const handler = source.slice(source.indexOf('window.addEventListener("resize"'), source.indexOf('document.addEventListener("selectionchange"'));
  assert.match(handler, /terminalFit\(\);/, "resize invokes the supplied reporting callback");
  assert.doesNotMatch(handler, /terminalFit\(\)\?\.fit/, "resize does not treat the callback result as a FitAddon");
});
