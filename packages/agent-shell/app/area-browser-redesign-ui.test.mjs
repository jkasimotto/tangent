import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("the Area browser focuses search and leads with planned work and filterable Documents", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/?view=areas&area=otto/tangent" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const now = Date.now();
  const goal = { mtime: now, area: "otto/tangent", slug: "new-browser", file: "otto/tangent/goal-new-browser.md", title: "Build the Area browser", status: "open", doneWhen: "The browser works.", stateText: "Not started.", currentBrief: "", storyText: "", documents: [], why: [], subgoalItems: [], subgoals: [], depth: 0 };
  const documents = [
    { file: "otto/tangent/design-browser.md", area: "otto/tangent", kind: "document", docKind: "design", title: "Browser design", changedAt: now },
    { file: "otto/tangent/note-browser.md", area: "otto/tangent", kind: "document", docKind: "note", title: "Browser notes", changedAt: now - 10 * 86_400_000 },
  ];
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [], brains: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [] }, { path: "otto/tangent", name: "tangent", goals: [goal], documents }],
      map: [{ path: "otto/tangent", name: "tangent", goals: [goal] }],
      documents,
    });
  };
  window.eval(shellBundle);
  await settle(window);

  assert.equal(window.document.querySelector(".surface-heading"), null);
  assert.equal(window.document.activeElement.id, "area-search");
  assert.match(window.document.querySelector("#area-not-started").closest(".area-workspace-section").textContent, /Build the Area browser/);
  assert.ok(window.document.querySelector("[data-brain-area='otto/tangent']"));
  assert.equal(window.document.querySelectorAll(".area-documents .document-row").length, 2);

  let areaSearch = window.document.querySelector("#area-search");
  areaSearch.value = "dnd";
  areaSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.ok(window.document.querySelector("[data-select-area='otto/dnd']"));
  assert.equal(window.document.querySelector("[data-select-area='otto/tangent']"), null);

  areaSearch = window.document.querySelector("#area-search");
  areaSearch.value = "tangent";
  areaSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-select-area='otto/tangent']");
  click(window, "[data-area-kind-only='design']");
  assert.equal(window.document.querySelectorAll(".area-documents .document-row").length, 1);
  assert.match(window.document.querySelector(".area-documents .document-row").textContent, /Browser design/);
  click(window, "[data-area-kind-reset]");
  click(window, "[data-area-kind-exclude='design']");
  assert.equal(window.document.querySelectorAll(".area-documents .document-row").length, 1);
  assert.match(window.document.querySelector(".area-documents .document-row").textContent, /Browser notes/);
  dom.window.close();
});
