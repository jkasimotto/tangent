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
  const sockets = [];
  const terminals = [];
  const observers = [];
  const fitState = { measurement: null, calls: 0, probes: 0 };
  let nextFrame = 1;

  class TerminalDouble {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.loadAddon = (addon) => addon.activate?.(this);
      this.open = (host) => {
        this.element = {};
        host.elements.add(this.element);
      };
      this.focus = () => {};
      this.onData = () => {};
      this.onSelectionChange = () => ({
        /** Test helper for dispose. */
        dispose() {} });
      this.hasSelection = () => false;
      this.getSelection = () => "";
      this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {};
      this.write = () => {};
      this.dispose = () => {};
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
    setTimeout() { return 1; },
    /** Test helper for clearTimeout. */
    clearTimeout() {},
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
    /** Test helper for contains. */
    contains(element) { return this.elements.has(element); },
  };

  return {
    cancelledFrames, fitState, frames, host, observers, sockets, terminals,
    /** Test helper for runFrame. */
    runFrame() {
      const entry = frames.entries().next().value;
      assert.ok(entry, "one measurement frame is pending");
      const [id, callback] = entry;
      frames.delete(id);
      callback();
      return id;
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

test("terminal attachment waits for measured cells and reports each later size once", { concurrency: false }, () => {
  const world = terminalWorld();
  try {
    const controller = createTerminalController({ state: {},
      /** Test helper for showToast. */
      showToast() {} });
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

test("window resize calls the controller fit callback directly", async () => {
  const source = await readFile(path.join(here, "public", "shell-event-bindings.js"), "utf8");
  const handler = source.slice(source.indexOf('window.addEventListener("resize"'), source.indexOf('document.addEventListener("selectionchange"'));
  assert.match(handler, /terminalFit\(\);/, "resize invokes the supplied reporting callback");
  assert.doesNotMatch(handler, /terminalFit\(\)\?\.fit/, "resize does not treat the callback result as a FitAddon");
});
