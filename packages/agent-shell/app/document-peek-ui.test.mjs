import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, peekDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Creates one compact Goal fixture with a live worker session. */
function goal(area, slug, title) {
  return {
    mtime: 1, area, slug, file: `${area}/goal-${slug}.md`, title, status: "active", session: `${slug}-agent`,
    doneWhen: "Done.", stateText: "In progress.", currentBrief: "", storyText: "", documents: [], depth: 0,
    why: [], subgoalItems: [], subgoals: [],
  };
}

/** Creates one vault Document record. */
function record(file, area, title) {
  return { file, area, kind: "document", docKind: "page", title, searchText: title.toLowerCase(), mtime: 1, goalHistory: [], links: [] };
}

/**
 * Boots one Agent Shell page with a live session, two Documents, and a
 * controllable Document read. Every quick-layer case in
 * design-quick-returnable-document-search section 11 needs this same world.
 */
async function bootShell() {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const deadlines = [];
  const realSetTimeout = window.setTimeout.bind(window);
  /**
   * Holds the browser API client's 20-second response deadline instead of
   * arming it, so the timeout case runs without waiting.
   */
  window.setTimeout = (callback, ms) => {
    // A real timer id would collide with jsdom's, and clearTimeout would then
    // cancel a live timer; these ids can never be one of jsdom's.
    if (ms === 20_000) return 1_000_000 + deadlines.push(callback);
    return realSetTimeout(callback, ms);
  };
  const terminals = [];
  window.Terminal = class {
    constructor() {
      this.cols = 80; this.rows = 24; this.loadAddon = () => {};
      /** Mounts one stand-in terminal element and records its identity. */
      this.open = (host) => {
        this.element = host.appendChild(window.document.createElement("textarea"));
        terminals.push(this.element);
      };
      this.focus = () => this.element.focus();
      this.onData = () => {};
      this.onSelectionChange = () => ({
        /** Ends the fixture subscription. */
        dispose() {},
      });
      this.hasSelection = () => false; this.getSelection = () => ""; this.getSelectionPosition = () => null;
      this.attachCustomKeyEventHandler = () => {}; this.write = () => {}; this.dispose = () => {};
    }
  };
  window.FitAddon = { FitAddon: class { constructor() { this.fit = () => {}; } } };
  window.ResizeObserver = class { constructor() { this.observe = () => {}; this.disconnect = () => {}; } };
  window.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 0; this.close = () => {}; this.send = () => {}; } };

  const work = goal("otto/tangent", "ship-search", "Ship the finder");
  const design = record("otto/tangent/design-search.md", "otto/tangent", "Search design");
  const notes = record("otto/tangent/notes-search.md", "otto/tangent", "Search notes");
  const texts = {
    [design.file]: "# Search design\n\nOpens [[notes-search]] and jumps to [Part two](#part-two).\n\n## Part two\n\nMore words.",
    [notes.file]: "# Search notes\n\nNothing here yet.",
  };
  const pending = [];
  const control = { mode: "immediate", failure: "" };
  window.fetch = async (url, options = {}) => {
    const address = new URL(url, window.location.href);
    const pathname = address.pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1", caffeinate: false, pipelines: [], brains: [],
        sessions: [{ name: work.session, goal: work.file, state: "working", command: "codex" }],
      });
    }
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") {
      const file = address.searchParams.get("file");
      if (control.failure === "transport") throw new Error("Failed to fetch");
      if (control.failure === "missing") {
        return {
          ok: false, status: 404,
          /** Returns the route's error body. */
          async json() { return { error: "document not found" }; },
        };
      }
      const reply = jsonResponse({ ...(file === design.file ? design : notes), text: texts[file], hash: file });
      if (control.mode !== "defer") return reply;
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        pending.push({
          file,
          /** Answers this held read. */
          send: () => resolve(reply),
        });
      });
    }
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/tangent", name: "tangent", goals: [work], documents: [design, notes] },
      ],
      map: [{ path: "otto/tangent", name: "tangent", goals: [work] }],
      documents: [design, notes],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  return { window, work, design, notes, pending, control, deadlines, terminals };
}

/** Sends one keystroke to the page. */
function key(window, init) {
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, ...init }));
}

/** Puts the Work cursor on one Goal row and enters its live session with ⌘J. */
async function openSession(window, file) {
  click(window, `[data-work-cursor='goal:${file}']`);
  await settle(window);
  key(window, { key: "j", metaKey: true });
  await settle(window);
}

test("the quick layer reads a Document above a live session and reveals that exact session again", async () => {
  const { window, work, design, terminals } = await bootShell();
  await openSession(window, work.file);
  const terminal = terminals.at(-1);
  assert.ok(terminal, "the session layer mounted a terminal");
  terminal.value = "a selected line";
  assert.equal(window.document.querySelector("#session-layer").hidden, false);

  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");
  assert.equal(layer.hidden, false, "the quick layer opened");
  assert.match(layer.textContent, /Search design/);
  // Case 1 and 11: the session below is untouched and the screen is not a reader.
  assert.equal(terminals.at(-1), terminal, "no terminal was mounted or replaced");
  assert.equal(terminal.value, "a selected line", "the terminal kept its content and selection");
  assert.equal(window.document.querySelector("#session-layer").hidden, false);
  assert.equal(window.document.querySelector("#screen .document-reader"), null, "Enter never moved the screen to the reader");
  assert.ok(window.document.querySelector("#screen").hasAttribute("inert"), "the screen below is inert");
  assert.ok(window.document.querySelector("#session-layer").hasAttribute("inert"), "the session below is inert");

  // Case 9 and 12: a command for a lower layer cannot reach past the Document.
  key(window, { key: "j", metaKey: true });
  await settle(window);
  assert.equal(layer.hidden, false, "Command-J did not close the quick Document");
  assert.equal(window.document.querySelector("#session-layer").hidden, false, "Command-J did not close the session below");

  // Case 2: Escape reveals the same session layer and the same terminal.
  key(window, { key: "Escape" });
  await settle(window);
  assert.equal(layer.hidden, true, "Escape closed the quick layer");
  assert.equal(window.document.querySelector("#session-layer").hidden, false);
  assert.equal(terminals.at(-1), terminal, "the same terminal is still mounted");
  assert.equal(window.document.querySelector("#screen").hasAttribute("inert"), false);
});

test("the finder above a session keeps that session, and the quick layer returns Work exactly", async () => {
  const { window, work, design, terminals } = await bootShell();
  await openSession(window, work.file);
  const terminal = terminals.at(-1);

  // Case 14: while the finder holds the keyboard no lower command runs.
  click(window, "#go-to-button");
  key(window, { key: "j", metaKey: true });
  await settle(window);
  assert.equal(window.document.querySelector("#go-to-layer").hidden, false, "the finder is still open");
  assert.equal(window.document.querySelector("#session-layer").hidden, false, "Command-J did not close the session");
  assert.equal(terminals.at(-1), terminal, "the terminal was not disposed");
  // The finder owns Escape on its own input, which is where its focus lives.
  window.document.querySelector("#go-to-input").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  key(window, { key: "j", metaKey: true });
  await settle(window);
  assert.equal(window.document.querySelector("#session-layer").hidden, true, "Command-J closed the session once the finder was gone");

  // Case 3: over a filtered Work desk, nothing about that desk changes.
  window.document.querySelector("#work-search").value = "ship";
  window.document.querySelector("#work-search").dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  const search = window.document.querySelector("#work-search");
  const page = window.document.querySelector(".work-page");
  search.focus();
  await peekDocumentViaGoTo(window, design.title);
  assert.equal(window.document.querySelector(".work-page"), page, "the Work desk was never rebuilt");
  assert.equal(window.document.querySelector("#work-search").value, "ship");
  key(window, { key: "Escape" });
  await settle(window);
  assert.equal(window.document.querySelector(".work-page"), page, "closing the layer rebuilt nothing");
  assert.equal(window.document.querySelector("#work-search").value, "ship");
  assert.equal(window.document.activeElement, search, "focus returned to the control the finder opened from");
});

test("only the newest read may change the quick layer, and a closed layer applies nothing", async () => {
  const { window, design, notes, pending, control } = await bootShell();
  control.mode = "defer";
  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");
  assert.match(layer.textContent, /Opening Search design…/, "the layer opens with its indexed title");
  assert.ok(layer.querySelector('[role="status"]'), "the loading line is a status region");

  // Case 4: a second open supersedes the first, whatever order the replies land in.
  click(window, "#go-to-button");
  const input = window.document.querySelector("#go-to-input");
  input.value = notes.title;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  click(window, "[data-go-to-row='0']");
  await settle(window);
  const second = pending.find((item) => item.file === notes.file);
  const first = pending.find((item) => item.file === design.file);
  second.send();
  await settle(window);
  first.send();
  await settle(window);
  assert.match(layer.textContent, /Search notes/);
  assert.doesNotMatch(layer.textContent, /Nothing here yet\.[\s\S]*Opens/, "the older reply did not replace the newer Document");
  assert.match(layer.querySelector(".document-content").textContent, /Nothing here yet/);

  // Case 5: a reply that lands after the close does nothing at all.
  pending.length = 0;
  click(window, "#go-to-button");
  input.value = design.title;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  click(window, "[data-go-to-row='0']");
  await settle(window);
  key(window, { key: "Escape" });
  await settle(window);
  assert.equal(layer.hidden, true);
  pending.at(-1)?.send();
  await settle(window);
  assert.equal(layer.hidden, true, "a late reply did not reopen the layer");
  assert.equal(window.document.querySelector("#toast").textContent, "", "cancellation is silent");
});

test("a failed read keeps the prior context and offers Retry and Close", async () => {
  const { window, design, control, pending, deadlines } = await bootShell();
  const page = window.document.querySelector(".work-page");
  control.failure = "missing";
  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");
  // Case 6: the 404 stays in the layer, with both ways out.
  const alert = layer.querySelector('[role="alert"]');
  assert.ok(alert, "the error is an alert region");
  assert.match(alert.textContent, /document not found/);
  assert.ok(layer.querySelector("[data-retry-document-peek]"), "Retry stays available");
  assert.ok(layer.querySelector("[data-close-document-peek]"), "Close stays available");
  assert.equal(window.document.querySelector(".work-page"), page, "the prior context stayed mounted");

  control.failure = "transport";
  click(window, "[data-retry-document-peek]");
  await settle(window);
  assert.match(layer.querySelector('[role="alert"]').textContent, /Failed to fetch/);

  control.failure = "";
  control.mode = "defer";
  click(window, "[data-retry-document-peek]");
  await settle(window);
  deadlines.pop()();
  await settle(window);
  assert.match(layer.querySelector('[role="alert"]').textContent, /response deadline/, "a timeout is classified and shown");
  assert.equal(pending.length, 1);

  control.mode = "immediate";
  click(window, "[data-retry-document-peek]");
  await settle(window);
  assert.equal(layer.querySelector('[role="alert"]'), null, "Retry loaded the Document");
  assert.match(layer.querySelector(".document-content").textContent, /Opens/);
});

test("the private trail moves inside the layer, and one Escape leaves it at any depth", async () => {
  const { window, design } = await bootShell();
  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");
  assert.equal(layer.querySelector("[data-document-peek-history='back']").disabled, true);

  // Case 7: a Document link and a heading link stay inside the layer.
  click(window, "#document-peek-layer [data-open-vault-link='notes-search']");
  await settle(window);
  assert.match(layer.querySelector(".document-peek-title").textContent, /Search notes/);
  assert.equal(window.document.querySelector("#screen .document-reader"), null, "the link never left the quick path");
  const back = layer.querySelector("[data-document-peek-history='back']");
  assert.equal(back.disabled, false, "the private trail recorded the step");
  click(window, "#document-peek-layer [data-document-peek-history='back']");
  await settle(window);
  assert.match(layer.querySelector(".document-peek-title").textContent, /Search design/);
  click(window, "#document-peek-layer [data-open-vault-link='notes-search']");
  await settle(window);

  // Case 13: Escape closes the layer, it does not walk the trail back.
  key(window, { key: "Escape" });
  await settle(window);
  assert.equal(layer.hidden, true);
  assert.ok(window.document.querySelector(".work-page"), "the Work desk is visible again");
});

test("Open full reader keeps the file and the reading position, and the layer is a labelled focus trap", async () => {
  const { window, design } = await bootShell();
  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");

  // Case 15: the dialog names itself, and Tab cannot leave it.
  const surface = layer.querySelector(".document-peek-surface");
  assert.equal(surface.getAttribute("role"), "dialog");
  assert.equal(surface.getAttribute("aria-modal"), "true");
  assert.equal(surface.getAttribute("aria-label"), design.title);
  assert.equal(window.document.activeElement, surface, "the layer takes focus when it opens");
  assert.equal(layer.querySelector("[data-comment-new]"), null, "the quick layer has no write controls");
  const stops = [...layer.querySelectorAll('button:not([disabled]), a[href], [tabindex="-1"].document-peek-surface')];
  stops.at(-1).focus();
  layer.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(window.document.activeElement, surface, "Tab wrapped back into the layer");
  layer.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey: true }));
  assert.equal(window.document.activeElement, stops.at(-1), "Shift-Tab wrapped the other way");

  // Case 8: promotion opens the same file in the full reader.
  const scroll = layer.querySelector(".document-peek-scroll");
  scroll.scrollTop = 210;
  click(window, "[data-promote-document-peek]");
  await settle(window);
  await settle(window);
  assert.equal(layer.hidden, true, "the quick layer closed");
  const reader = window.document.querySelector("#screen .document-reader-scroll");
  assert.ok(reader, "the full reader opened on the screen");
  assert.match(window.document.querySelector(".document-source").textContent, /design-search\.md/);
  assert.equal(reader.scrollTop, 210, "the reading position came with it");
  assert.ok(window.document.querySelector("[data-comment-new]"), "the full reader owns the write controls");
});

test("the Area breadcrumb inside the quick layer opens that Area map and clears both layers", async () => {
  const { window, work, design, terminals } = await bootShell();
  await openSession(window, work.file);
  const terminal = terminals.at(-1);
  assert.ok(terminal, "the session layer mounted a terminal");

  await peekDocumentViaGoTo(window, design.title);
  const crumbs = [...window.document.querySelectorAll("#document-peek-layer .area-path [data-open-area]")];
  assert.deepEqual(crumbs.map((button) => button.dataset.openArea), ["otto", "otto/tangent"], "the layer shows one route for each Area level");

  crumbs.at(-1).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);

  // Section 5.3: an Area is explicit navigation, so it leaves the quick path
  // and closes the session presentation below it.
  assert.equal(window.document.querySelector("#document-peek-layer").hidden, true, "the quick layer closed");
  assert.equal(window.document.querySelector("#session-layer").hidden, true, "the session presentation closed");
  assert.equal(window.document.querySelector("#screen").hasAttribute("inert"), false, "the screen accepts input again");
  assert.match(window.document.querySelector(".area-contents-heading").textContent, /tangent/i, "the selected Area map opened");
});

test("Go to above a quick Document holds focus and assistive input on the finder alone", async () => {
  const { window, work, design, terminals } = await bootShell();
  await openSession(window, work.file);
  const terminal = terminals.at(-1);
  assert.ok(terminal, "the session layer mounted a terminal");

  await peekDocumentViaGoTo(window, design.title);
  const layer = window.document.querySelector("#document-peek-layer");
  assert.equal(layer.hidden, false, "the quick Document is open");

  // Section 5.1: the finder opens above the Document, so every surface below
  // it, the Document included, is inert and out of the accessibility tree.
  key(window, { key: "k", metaKey: true });
  await settle(window);
  const finder = window.document.querySelector("#go-to-layer");
  assert.equal(finder.hidden, false, "the finder opened above the Document");
  assert.equal(layer.hidden, false, "the Document stayed mounted below it");
  assert.ok(layer.hasAttribute("inert"), "the quick Document is inert under the finder");
  assert.ok(window.document.querySelector("#screen").hasAttribute("inert"), "the screen is inert");
  assert.ok(window.document.querySelector("#session-layer").hasAttribute("inert"), "the session is inert");
  assert.equal(finder.hasAttribute("inert"), false, "the finder itself takes input");
  const exposedDialogs = [...window.document.querySelectorAll('[role="dialog"]')]
    .filter((dialog) => !dialog.closest("[inert]") && !dialog.closest("[hidden]"));
  assert.deepEqual(exposedDialogs.map((dialog) => dialog.className), ["go-to"], "only the finder is exposed as a dialog");

  // Tab and Shift-Tab cannot leave the finder for the Document behind it.
  const input = window.document.querySelector("#go-to-input");
  input.focus();
  const back = new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  input.dispatchEvent(back);
  assert.equal(back.defaultPrevented, true, "Shift-Tab on the first control was answered by the finder");
  assert.ok(finder.contains(window.document.activeElement), "Shift-Tab stayed inside the finder");
  const forward = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  window.document.activeElement.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, true, "Tab on the last control wrapped");
  assert.equal(window.document.activeElement, input, "the wrap returned to the finder's own input");

  // Closing the finder gives the Document back its input and its focus.
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle(window);
  assert.equal(finder.hidden, true, "the finder closed");
  assert.equal(layer.hidden, false, "the Document is still the top layer");
  assert.equal(layer.hasAttribute("inert"), false, "the Document takes input again");
  assert.ok(layer.contains(window.document.activeElement), "focus returned into the Document");
  assert.ok(window.document.querySelector("#screen").hasAttribute("inert"), "the screen stays inert below the Document");

  // Escape then closes that Document, and the same session comes back.
  key(window, { key: "Escape" });
  await settle(window);
  assert.equal(layer.hidden, true, "one Escape closed the Document");
  assert.equal(window.document.querySelector("#session-layer").hidden, false, "the same session came back");
  assert.equal(terminals.at(-1), terminal, "no terminal was replaced");
});
