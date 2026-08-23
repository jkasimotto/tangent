import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("comments render as red blocks, save through the base-hash path with re-anchoring, and remove with undo", async () => {
  const [html, script, commentsScript, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
  ]);
  await import("./public/document-comments.js");
  const helper = documentComments;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  let text = "# Map design\n\nA long design with {==clear words==}{>>Julian: Say why.<<} here.\n\n## Part two\n\nMore prose.\n";
  let hash = 1;
  const saves = [];
  let conflictOnce = false;
  /** The document as the server would return it: text, hash, and parsed comments. */
  const served = () => ({ ...doc, text, hash: `map-${hash}`, comments: helper.parseComments(text) });
  /** The server's 409 reply, which carries the current Document for re-anchoring. */
  const conflictResponse = () => ({
    ok: false,
    status: 409,
    /** Returns the conflict body. */
    async json() { return { error: "document changed since it was opened", current: served() }; },
  });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      if (conflictOnce) {
        conflictOnce = false;
        text = text.replace("More prose.", "More prose, edited by an agent.");
        hash += 1;
        return conflictResponse();
      }
      if (body.baseHash !== `map-${hash}`) return conflictResponse();
      saves.push(body);
      text = body.text;
      hash += 1;
      return jsonResponse(served());
    }
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse(served());
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [], documents: [doc] }],
      map: [],
      documents: [doc],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);

  // The existing comment is a red-ruled block under its paragraph, its words are marked, and the toolbar counts it.
  const aside = window.document.querySelector(".document-comment");
  assert.ok(aside, "the comment renders");
  assert.equal(aside.getAttribute("role"), "note");
  assert.match(aside.getAttribute("aria-label"), /Comment from Julian/);
  assert.match(aside.textContent, /Say why\./);
  assert.equal(aside.previousElementSibling.tagName, "P");
  assert.equal(window.document.querySelector(".document-comment-mark").textContent, "clear words");
  assert.doesNotMatch(window.document.querySelector(".document-content").textContent, /\{>>|<<\}|\{==/);
  assert.match(window.document.querySelector(".document-comment-nav").textContent, /1 comment/);
  assert.ok(window.document.querySelector(".document-comment-remove"), "the remove control is always drawn");
  assert.ok(window.document.querySelector("[data-comment-new]"), "the Comment action is visible");

  // Next comment scrolls to and focuses the comment block.
  click(window, "[data-comment-step='1']");
  assert.equal(window.document.querySelector(".document-comment").dataset.scrolledTo, "1");

  // Comment without a selection: the composer opens under the section in view and can switch to the whole Document.
  click(window, ".reader-comment-action");
  await settle(window);
  let composer = window.document.querySelector("[data-comment-composer]");
  assert.ok(composer, "the composer opened");
  assert.equal(window.document.activeElement.id, "comment-text");
  const field = window.document.querySelector("#comment-text");
  field.value = "Overall: shorter.";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-comment-scope='document']");
  await settle(window);
  composer = window.document.querySelector("[data-comment-composer]");
  assert.equal(window.document.querySelector("#comment-text").value, "Overall: shorter.", "the draft survives the scope switch");
  assert.equal(window.document.querySelector("[data-comment-scope='document']").getAttribute("aria-pressed"), "true");
  // An agent edits the file first: the save gets a 409, re-anchors, and saves again without losing the agent's edit.
  conflictOnce = true;
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 1, "one save landed after the conflict");
  assert.match(saves[0].text, /# Map design\n\n\{>>Julian: Overall: shorter\.<<\}\n/);
  assert.match(saves[0].text, /edited by an agent/);
  assert.equal(saves[0].summary, "added a comment");
  assert.equal(window.document.querySelector("[data-comment-composer]"), null, "the composer closed");
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
  assert.match(window.document.querySelector("#toast").textContent, /Comment added/);
  assert.ok(window.document.querySelector("#toast .toast-action"), "the toast offers Undo");

  // Escape cancels a fresh composer and keeps nothing.
  click(window, ".reader-comment-action");
  await settle(window);
  assert.ok(window.document.querySelector("[data-comment-composer]"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]"), null);
  assert.equal(saves.length, 1);

  // Remove goes through the same save with Undo, and Undo puts the words back.
  click(window, "[data-remove-comment='1']");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 2);
  assert.equal(saves[1].summary, "removed a comment");
  assert.doesNotMatch(saves[1].text, /Say why/);
  assert.match(saves[1].text, /A long design with clear words here\./);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 1);
  click(window, "#toast .toast-action");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 3);
  assert.match(saves[2].text, /\{==clear words==\}\{>>Julian: Say why\.<<\}/);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);
});
