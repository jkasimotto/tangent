import test from "node:test";
import {
  assert, readFile, path, JSDOM, documentComments, shellBundle, here,
  settle, click, submit, peekDocumentViaGoTo, openDocumentViaGoTo, jsonResponse,
} from "./focus-shell-ui-fixture.mjs";

/** Boots two linked Documents with headings and comments for both reader surfaces. */
async function bootReadingShell() {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  const first = { file: "otto/reader/design-first.md", area: "otto/reader", kind: "document", docKind: "page", title: "First reader", searchText: "first reader", goalHistory: [] };
  const second = { file: "otto/reader/design-second.md", area: "otto/reader", kind: "document", docKind: "page", title: "Second reader", searchText: "second reader", goalHistory: [] };
  const texts = {
    [first.file]: "# First reader\n\nOpen [[design-second]]. Alpha {==words one==}{>>Julian: First note.<<}.\n\n## Alpha heading\n\nMiddle words.\n\n### Beta heading\n\nBeta {==words two==}{>>Julian: Second note.<<}.\n",
    [second.file]: "# Second reader\n\nBack to [[design-first]].\n\n## Other heading\n\nOther words.\n",
  };
  const resolveRequests = [];
  const documentWrites = [];
  const resolveControl = { error: "" };
  /** Test helper for served. */
  const served = (record) => ({ ...record, text: texts[record.file], hash: record.file, comments: documentComments.parseComments(texts[record.file]) });
  window.fetch = async (url, options = {}) => {
    const address = new URL(url, window.location.href);
    if (address.pathname === "/api/document/resolve" && options.method === "POST") {
      const body = JSON.parse(options.body);
      resolveRequests.push(body);
      if (resolveControl.error) {
        return { ok: false, status: 409,
          /** Test helper for json. */
          async json() { return { error: resolveControl.error }; } };
      }
      const result = documentComments.resolveComment(texts[body.file], body.prefix);
      if (result.error) return { ok: false, status: result.matches?.length ? 409 : 404,
        /** Test helper for json. */
        async json() { return result; } };
      texts[body.file] = result.text;
      return jsonResponse({ file: body.file, comment: result.comment, remaining: documentComments.parseComments(result.text).length });
    }
    if (address.pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      documentWrites.push(body);
      texts[body.file] = body.text;
      const record = body.file === second.file ? second : first;
      return jsonResponse(served(record));
    }
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (address.pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [], brains: [] });
    if (address.pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (address.pathname === "/api/document") return jsonResponse(served(address.searchParams.get("file") === second.file ? second : first));
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/reader", name: "reader", goals: [], documents: [first, second] }],
      map: [],
      documents: [first, second],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  return { window, first, second, resolveRequests, documentWrites, resolveControl, texts };
}

/** Dispatches one exact cancellable keyboard event from the current owner. */
function press(window, key, code, options = {}) {
  const { target = window.document.activeElement ?? window.document.body, ...init } = options;
  const event = new window.KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Gives a jsdom scroll owner real metrics and two stable heading offsets. */
function setReadingMetrics(surface, offsets = [220, 620]) {
  Object.defineProperties(surface, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1600 },
  });
  surface.getBoundingClientRect = () => ({ top: 0 });
  const headings = [...surface.querySelectorAll(".document-content h2, .document-content h3")];
  headings.forEach((heading, index) => {
    heading.getBoundingClientRect = () => ({ top: offsets[index] - surface.scrollTop });
  });
}

/** Selects visible words inside one reading surface. */
function selectWords(window, surface) {
  const node = surface.querySelector(".document-content p").firstChild;
  const range = window.document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(5, node.textContent.length));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

test("the quick reader owns navigation, read-only comments, help, and staged Escape", async () => {
  const { window, first, second } = await bootReadingShell();
  await peekDocumentViaGoTo(window, first.title);
  const layer = window.document.querySelector("#document-peek-layer");
  let surface = layer.querySelector(".document-peek-scroll");

  assert.ok(layer.querySelector("[data-document-keys]"), "Keys ? is a visible pointer action");
  assert.equal(layer.querySelector(".document-peek-comment-disabled").disabled, true, "quick comments visibly require the full reader");
  assert.equal(layer.querySelector("[data-document-peek-comment-step='1']").getAttribute("aria-keyshortcuts"), "n");
  assert.equal(layer.querySelector("[data-document-peek-history='back']").getAttribute("aria-keyshortcuts"), "Shift+H");
  assert.equal(layer.querySelector("[data-close-document-peek]").getAttribute("aria-keyshortcuts"), "Escape");
  assert.equal(layer.querySelector("[data-edit-comment], [data-reply-comment], [data-resolve-comment]"), null, "quick comments expose no mutation actions");

  setReadingMetrics(surface);
  const lineDown = press(window, "j", "KeyJ");
  assert.equal(lineDown.defaultPrevented, true, "the quick reader owns j");
  assert.equal(surface.scrollTop, 48, "j moves one reading line");
  press(window, "d", "KeyD", { ctrlKey: true });
  assert.equal(surface.scrollTop, 248, "Ctrl-D moves half a page");
  press(window, "G", "KeyG", { shiftKey: true });
  assert.equal(surface.scrollTop, 1200, "G moves to the bottom");
  press(window, "g", "KeyG");
  press(window, "g", "KeyG");
  assert.equal(surface.scrollTop, 0, "gg moves to the top");
  press(window, "}", "BracketRight", { shiftKey: true });
  assert.equal(surface.scrollTop, 220, "} moves to the next heading");
  surface.scrollTop = 700;
  press(window, "{", "BracketLeft", { shiftKey: true });
  assert.equal(surface.scrollTop, 620, "{ moves to the previous heading");

  click(window, "#document-peek-layer [data-open-vault-link='design-second']");
  await settle(window);
  assert.match(layer.querySelector(".document-peek-title").textContent, /Second reader/);
  press(window, "H", "KeyH", { shiftKey: true });
  await settle(window);
  assert.match(layer.querySelector(".document-peek-title").textContent, /First reader/, "H moves back in Document history");
  press(window, "L", "KeyL", { shiftKey: true });
  await settle(window);
  assert.match(layer.querySelector(".document-peek-title").textContent, /Second reader/, "L moves forward in Document history");
  press(window, "H", "KeyH", { shiftKey: true });
  await settle(window);
  surface = layer.querySelector(".document-peek-scroll");

  press(window, "c", "KeyC");
  assert.equal(layer.hidden, false, "c cannot mutate or promote the quick reader");
  assert.equal(window.document.querySelector("#screen .document-reader"), null);

  press(window, "]", "BracketRight");
  press(window, "c", "KeyC");
  const comments = [...layer.querySelectorAll(".document-comment")];
  assert.equal(window.document.activeElement, comments[0], "]c focuses the first read-only comment");
  press(window, "[", "BracketLeft");
  press(window, "c", "KeyC");
  assert.equal(window.document.activeElement, comments.at(-1), "[c wraps to the previous comment");

  click(window, "#document-peek-layer [data-document-keys]");
  await settle(window);
  assert.equal(window.document.querySelector("#modal-title").textContent, "Read without the mouse");
  const beforeHelpKey = surface.scrollTop;
  press(window, "j", "KeyJ");
  assert.equal(surface.scrollTop, beforeHelpKey, "the modal owns reading keys");
  press(window, "Escape", "Escape");
  assert.equal(window.document.querySelector("#modal-layer").hidden, true);
  assert.equal(layer.hidden, false, "modal Escape closes help, not the reader below it");

  const selection = selectWords(window, surface);
  press(window, "Escape", "Escape");
  assert.equal(selection.rangeCount, 0, "first Escape clears native selection");
  assert.equal(layer.hidden, false);
  press(window, "Escape", "Escape");
  assert.equal(layer.hidden, false, "second Escape clears the active comment");
  press(window, "Escape", "Escape");
  assert.equal(layer.hidden, true, "third Escape closes the quick reader");
  window.close();
});

test("the full reader edits, replies, and canonically resolves the semantic active comment", async () => {
  const { window, first, resolveRequests, documentWrites, resolveControl, texts } = await bootReadingShell();
  await openDocumentViaGoTo(window, first.title);
  await settle(window);

  let active = window.document.querySelector("#document-comment-0");
  assert.equal(active.querySelector(".document-comment-body").tagName, "SPAN", "comment words remain readable text, not a large edit button");
  for (const [selector, key, label] of [
    ["[data-edit-comment]", "e", "Edit"],
    ["[data-reply-comment]", "r", "Reply"],
    ["[data-resolve-comment]", "x", "Resolve"],
  ]) {
    const button = active.querySelector(selector);
    assert.ok(button, `${label} is an explicit pointer action`);
    assert.equal(button.getAttribute("aria-keyshortcuts"), key);
    assert.match(button.title, new RegExp(`\\(${key}\\)`));
  }

  click(window, "#document-comment-0");
  press(window, "e", "KeyE");
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]").getAttribute("aria-label"), "Edit comment");
  assert.equal(window.document.querySelector("#comment-text").value, "First note.");
  press(window, "Escape", "Escape", { target: window.document.querySelector("#comment-text") });
  await settle(window);
  assert.equal(window.document.activeElement.id, "document-comment-0", "cancel restores the semantic comment focus");

  press(window, "r", "KeyR");
  await settle(window);
  const reply = window.document.querySelector("#comment-text");
  assert.equal(window.document.querySelector("[data-comment-composer]").getAttribute("aria-label"), "Reply to comment");
  reply.value = "Reply at the same words.";
  reply.dispatchEvent(new window.Event("input", { bubbles: true }));
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  assert.equal(documentWrites.at(-1).summary, "replied to a comment");
  assert.match(texts[first.file], /\{==words one==\}\{>>Julian: First note\.<<\}\{>>Julian: Reply at the same words\.<<\}/);
  assert.equal(window.document.activeElement.id, "document-comment-0", "reply save returns to the original semantic comment");

  press(window, "x", "KeyX");
  await settle(window);
  assert.equal(window.document.querySelector("#modal-title").textContent, "Resolve “First note.”");
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.equal(resolveRequests.length, 0, "a blank note makes no resolve request");
  assert.equal(window.document.querySelector("#modal-layer").hidden, false);
  assert.match(window.document.querySelector(".comment-resolution-error").textContent, /short change note/i);

  const note = window.document.querySelector("[data-modal-input]");
  note.value = "Implemented the requested clarification.";
  resolveControl.error = "2 comments start with those words. Give more of the text.";
  click(window, "[data-modal-confirm]");
  await settle(window);
  assert.equal(window.document.querySelector("#modal-layer").hidden, false, "an ambiguous target keeps the resolve draft open");
  assert.equal(window.document.querySelector("[data-modal-input]").value, "Implemented the requested clarification.");
  assert.match(window.document.querySelector(".comment-resolution-error").textContent, /2 comments/i);

  resolveControl.error = "";
  click(window, "[data-modal-confirm]");
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelector("#modal-layer").hidden, true);
  assert.deepEqual(resolveRequests.at(-1), {
    file: first.file,
    prefix: "First note.",
    note: "Implemented the requested clarification.",
  });
  assert.equal("index" in resolveRequests.at(-1), false);
  assert.equal("session" in resolveRequests.at(-1), false);
  assert.doesNotMatch(texts[first.file], /First note/);
  assert.match(texts[first.file], /Reply at the same words/);
  assert.equal(window.document.activeElement.id, "document-comment-0", "resolve restores focus to the surviving semantic neighbor");
  window.close();
});

test("the full reader moves semantically from pointer comments and lets c write", async () => {
  const { window, first } = await bootReadingShell();
  await openDocumentViaGoTo(window, first.title);
  await settle(window);
  const reader = window.document.querySelector(".document-reader");
  const surface = reader.querySelector(".document-reader-scroll");

  assert.ok(reader.querySelector("[data-document-keys]"));
  assert.equal(reader.querySelector("[data-comment-new]").getAttribute("aria-keyshortcuts"), "c");
  assert.equal(reader.querySelector("[data-comment-step='-1']").getAttribute("aria-keyshortcuts"), "Shift+N");
  assert.equal(reader.querySelector("[data-leave-document]").getAttribute("aria-keyshortcuts"), "Escape");

  const picker = reader.querySelector(".document-picker");
  const pickerSummary = picker.querySelector("summary");
  picker.open = true;
  picker.querySelector("button").focus();
  press(window, "Escape", "Escape");
  assert.equal(picker.open, false, "Escape closes the nearest Document disclosure first");
  assert.equal(window.document.activeElement, pickerSummary);
  assert.ok(window.document.querySelector(".document-reader"), "closing a disclosure does not leave the reader");

  const comments = [...reader.querySelectorAll(".document-comment")];
  comments[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  press(window, "]", "BracketRight");
  press(window, "c", "KeyC");
  assert.equal(window.document.activeElement.id, "document-comment-0", "pointer focus and ]c share the semantic cursor");

  press(window, "c", "KeyC");
  await settle(window);
  assert.ok(window.document.querySelector("[data-comment-composer]"), "c opens the full reader composer");
  assert.equal(window.document.activeElement.id, "comment-text");
  press(window, "Escape", "Escape", { target: window.document.activeElement });
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]"), null, "composer Escape remains owned by the transient surface");

  const liveComments = [...window.document.querySelectorAll(".document-comment")];
  liveComments[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const liveSurface = window.document.querySelector(".document-reader-scroll");
  const selection = selectWords(window, liveSurface);
  press(window, "Escape", "Escape");
  assert.equal(selection.rangeCount, 0);
  assert.ok(window.document.querySelector(".document-reader"), "selection Escape stays in the reader");
  press(window, "Escape", "Escape");
  assert.ok(window.document.querySelector(".document-reader"), "comment Escape stays in the reader");
  press(window, "Escape", "Escape");
  await settle(window);
  assert.equal(window.document.querySelector(".document-reader"), null, "the final Escape leaves the reader");
  window.close();
});
