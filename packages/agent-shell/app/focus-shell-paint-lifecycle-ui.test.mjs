import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("background polls never rebuild the screen under an editing surface or a reader", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  let poll = null;
  window.setInterval = (callback) => { poll = callback; return 0; };
  const goal = {
    mtime: 1,
    area: "otto/dnd",
    slug: "ship-the-map",
    file: "otto/dnd/goal-ship-the-map.md",
    title: "Ship the map",
    status: "open",
    doneWhen: "The map ships.",
    stateText: "",
    currentBrief: "- You wanted: Ship the map.",
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  };
  const doc = { file: "otto/dnd/design-map.md", area: "otto/dnd", kind: "document", title: "Map design", searchText: "map", goalHistory: [] };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") return jsonResponse({ ok: true });
    if (pathname === "/api/sessions") return jsonResponse({ boot: "boot-1", caffeinate: false, sessions: [], pipelines: [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/document") return jsonResponse({ ...doc, text: "# Map design\n\nA long design.\n\n## Part two\n\nMore.", hash: "map-1" });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [{ id: "claude", label: "Claude", command: "claude", models: [{ id: "fable-5", label: "Fable 5", args: "--model claude-fable-5" }], efforts: [] }],
        default: { harness: "claude", model: "fable-5", effort: null, command: "claude --model claude-fable-5", label: "Claude · Fable 5" },
      });
    }
    return jsonResponse({
      areas: [{ path: "otto", name: "otto", goals: [] }, { path: "otto/dnd", name: "dnd", goals: [goal], documents: [doc] }],
      map: [{ path: "otto/dnd", name: "dnd", goals: [goal] }],
      documents: [doc],
    });
  };
  /** Another agent commits to the vault, then the shell polls. */
  const vaultChangesAndPolls = async () => {
    goal.mtime += 1;
    goal.storyText += "\n### Another agent wrote\n\nSomething.";
    await poll();
    await settle(window);
  };
  window.eval(shellBundle);
  await settle(window);
  click(window, "[data-work-filter='inactive']");
  assert.ok(poll, "the shell polls the server");

  // Defining a pipeline: the typed instruction and the popover survive a poll, focused or not.
  click(window, `[data-launch-for='${goal.file}']`);
  await settle(window);
  await settle(window);
  const popover = window.document.querySelector("[data-launch-popover]");
  assert.ok(popover, "the popover opened");
  const instruction = window.document.querySelector("#launch-instruction");
  instruction.value = "/design the map";
  instruction.dispatchEvent(new window.Event("input", { bubbles: true }));
  instruction.blur();
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector("[data-launch-popover]"), popover, "the poll did not rebuild the popover");
  assert.equal(window.document.querySelector("#launch-instruction").value, "/design the map");
  // Julian's own action may repaint, and the typed instruction is still there.
  click(window, "[data-launch-step-add]");
  assert.match(window.document.querySelector("[data-launch-step-select='0']").textContent, /design the map/);
  click(window, "[data-launch-close]");
  await settle(window);
  assert.equal(window.document.querySelector("[data-launch-popover]"), null);
  // With the popover closed, a change to hidden Goal prose does not churn the compact row.
  const deskBefore = window.document.querySelector(`[data-goal-anchor='${goal.file}']`);
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector(`[data-goal-anchor='${goal.file}']`), deskBefore, "hidden prose does not rebuild an unchanged compact row");

  // Reading a Document: the reader survives a poll and a forced repaint keeps the reading position.
  await openDocumentViaGoTo(window, doc.title);
  await settle(window);
  const reader = window.document.querySelector(".document-reader-scroll");
  assert.ok(reader, "the Document opened");
  reader.scrollTop = 320;
  reader.dispatchEvent(new window.Event("scroll"));
  await vaultChangesAndPolls();
  assert.equal(window.document.querySelector(".document-reader-scroll"), reader, "the poll did not rebuild the reader");
  click(window, "#menu-refresh");
  await settle(window);
  await settle(window);
  const repainted = window.document.querySelector(".document-reader-scroll");
  assert.notEqual(repainted, reader, "an explicit refresh repaints the reader");
  assert.equal(repainted.scrollTop, 320, "the reading position survives the repaint");
});
