import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("a second comment lands on the words Julian selected, and the reader holds its place", async () => {
  const [html, script, commentsScript, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  await import("./public/document-comments.js");
  const helper = documentComments;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { this.dataset.scrolledTo = "1"; };
  // jsdom has no layout, and the floating Comment button reads the selection rectangle.
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 10 });
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  // Two comments already overlap: `first` on "brown fox", `second` crossing it on "fox jumps".
  let text = "# Map design\n\nThe quick {==brown {==fox==}==}{>>Julian: first<<}{== jumps==}{>>Julian: second<<} over the lazy dog.\n\n## Part two\n\nMore prose.\n";
  let hash = 1;
  const saves = [];
  let conflictOnce = false;
  /** The document as the server would return it: text, hash, and parsed comments. */
  const served = () => ({ ...doc, text, hash: `map-${hash}`, comments: helper.parseComments(text) });
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/document" && options.method === "POST") {
      const body = JSON.parse(options.body);
      if (conflictOnce) {
        conflictOnce = false;
        text = text.replace("More prose.", "Different prose.");
        hash += 1;
        return {
          ok: false,
          status: 409,
          /** Returns the server's current Document for re-anchoring. */
          async json() { return { error: "document changed since it was opened", current: served() }; },
        };
      }
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

  // Both comments render: one mark nests inside the other, and no markup leaks into the words.
  const paragraph = window.document.querySelector(".document-content p");
  assert.equal(paragraph.textContent, "The quick brown fox jumps over the lazy dog.");
  const marks = [...paragraph.querySelectorAll(".document-comment-mark")];
  assert.deepEqual(marks.map((mark) => mark.textContent), ["brown fox", "fox", " jumps"]);
  assert.equal(marks[1].parentElement, marks[0], "the second comment's mark nests inside the first");
  assert.deepEqual(marks.map((mark) => mark.dataset.commentIndex), ["0", "1", "1"]);
  assert.equal(window.document.querySelectorAll(".document-comment").length, 2);

  // Julian has read down the page before he comments.
  window.document.querySelector(".document-reader-scroll").scrollTop = 320;
  window.document.querySelector(".document-reader-scroll").dispatchEvent(new window.Event("scroll"));

  // A third selection next to the overlapping pair lands on exactly those words.
  const tail = paragraph.lastChild;
  const range = window.document.createRange();
  range.setStart(tail, tail.textContent.indexOf("over"));
  range.setEnd(tail, tail.textContent.indexOf("over") + "over the".length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  click(window, ".reader-comment-action");
  await settle(window);
  const field = window.document.querySelector("#comment-text");
  assert.ok(field, "the composer opened on the selection");
  field.value = "Third";
  field.dispatchEvent(new window.Event("input", { bubbles: true }));
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  assert.equal(saves.length, 1, "the comment saved without a re-anchor");
  assert.match(saves[0].text, /\{==over the==\}\{>>Julian: Third<<\}/);
  assert.equal(window.document.querySelector(".document-content p").textContent, "The quick brown fox jumps over the lazy dog.");
  assert.equal(window.document.querySelectorAll(".document-comment").length, 3);
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelector(".document-reader-scroll").scrollTop, 320, "the reader keeps its place after the save");

  // A stale selected anchor never blocks the comment. It falls back to the
  // section that contained the selection and saves in the same action.
  const sectionParagraph = [...window.document.querySelectorAll(".document-content p")].find((item) => item.textContent.includes("More prose"));
  const sectionText = sectionParagraph.firstChild;
  const staleRange = window.document.createRange();
  staleRange.setStart(sectionText, 0);
  staleRange.setEnd(sectionText, "More prose".length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(staleRange);
  click(window, ".reader-comment-action");
  await settle(window);
  window.document.querySelector("#comment-text").value = "Keep this comment";
  conflictOnce = true;
  submit(window, "[data-comment-composer]");
  await settle(window);
  await settle(window);
  await settle(window);
  assert.equal(window.document.querySelector("[data-comment-composer]"), null, "the stale-anchor composer closes after saving");
  assert.match(saves.at(-1).text, /## Part two\n\n\{>>Julian: Keep this comment<<\}/);
  assert.match(window.document.querySelector("#toast").textContent, /added to “Part two”/);
});
