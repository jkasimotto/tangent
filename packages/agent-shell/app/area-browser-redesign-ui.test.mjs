import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, click, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("the Area browser focuses search and leads with ready work and filterable Documents", async () => {
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
  const posts = [];
  let sessions = [];
  let holdSessionRefresh = false;
  let releaseSessionRefresh;
  let brain = { area: "otto/tangent", foundingInstruction: { text: "Run this Area." }, status: "active", generation: 1, session: "missing-brain", live: true, state: "working" };
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/launch/options") return jsonResponse({
      area: "otto/tangent",
      harnesses: [
        { id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol", efforts: [{ id: "high", label: "High", args: "--effort high" }] }] },
        { id: "claude", label: "Claude", command: "claude", models: [] },
      ],
      workDefault: { harness: "codex", model: "sol", effort: "high", command: "codex --model sol --effort high", label: "Codex · Sol · High", source: "otto" },
      brainDefault: { harness: "codex", model: "sol", effort: "high", command: "codex --model sol --effort high", label: "Codex · Sol · High", source: "otto/tangent", workSource: "otto", via: "work" },
      declarations: { work: { mode: "inherit" }, brain: { mode: "work" } },
    });
    if (options.method === "POST" && pathname === "/api/launch/default") {
      const body = JSON.parse(options.body);
      posts.push({ path: pathname, body });
      return jsonResponse({ label: body.mode === "launch" ? "Claude" : "Codex · Sol · High", command: body.mode === "launch" ? "claude" : "codex --model sol --effort high" });
    }
    if (options.method === "POST" && pathname === "/api/brains/start") {
      const body = JSON.parse(options.body);
      posts.push({ path: pathname, body });
      sessions = [{ name: "tangent-brain-g2", area: "otto/tangent", kind: "brain", state: "working" }];
      brain = { ...brain, generation: 2, session: "tangent-brain-g2", live: true };
      return jsonResponse({ session: "tangent-brain-g2", generation: 2, brain });
    }
    if (pathname === "/api/sessions") {
      if (holdSessionRefresh) await new Promise((resolve) => { releaseSessionRefresh = resolve; });
      return jsonResponse({ boot: "boot-1", caffeinate: false, sessions, pipelines: [], brains: [brain] });
    }
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
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
  assert.match(window.document.querySelector("#area-work-heading").closest(".area-workspace-section").textContent, /Build the Area browser/);
  assert.doesNotMatch(window.document.querySelector("#area-work-heading").closest(".area-workspace-section").textContent, /Not started/);
  assert.ok(window.document.querySelector("[data-brain-area='otto/tangent']"));
  assert.equal(window.document.querySelector("[data-default-agents-area='otto/tangent']").textContent.trim(), "Default agents");
  assert.equal(window.document.querySelectorAll(".area-documents .document-row").length, 2);

  click(window, "[data-default-agents-area='otto/tangent']");
  await settle(window);
  const defaultRows = window.document.querySelectorAll("[data-default-agent-row]");
  assert.equal(defaultRows.length, 2);
  assert.match(defaultRows[0].textContent, /Work.*Codex · Sol · High.*Inherited from Otto/s);
  assert.match(defaultRows[1].textContent, /Brain.*Codex · Sol · High.*Follows Work on this Area/s);
  assert.equal(window.document.querySelector("[data-launch-start]"), null, "the settings editor cannot start an agent");

  click(window, "[data-default-agent-edit='work']");
  click(window, "[data-launch-harness='claude']");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(posts.filter((item) => item.path === "/api/launch/default").length, 0, "Escape keeps both declarations unchanged");
  assert.ok(window.document.querySelector("[data-launch-popover]"), "the first Escape returns from the draft to the defaults summary");
  assert.equal(window.document.activeElement, window.document.querySelector("[data-default-agent-edit='work']"), "the summary receives focus after cancelling its draft");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(window.document.querySelector("[data-launch-popover]"), null);
  click(window, "[data-default-agents-area='otto/tangent']");
  await settle(window);

  click(window, "[data-default-agent-edit='work']");
  click(window, "[data-launch-harness='claude']");
  assert.equal(posts.filter((item) => item.path === "/api/launch/default").length, 0, "a choice stays local until Save");
  click(window, "[data-launch-save]");
  await settle(window);
  assert.deepEqual(posts.at(-1).body, { area: "otto/tangent", kind: "work", mode: "launch", launch: { harness: "claude" } });

  click(window, "[data-default-agent-edit='work']");
  click(window, "[data-launch-harness='codex']");
  click(window, "[data-launch-effort='high']");
  click(window, "[data-launch-save]");
  await settle(window);
  assert.deepEqual(posts.at(-1).body, { area: "otto/tangent", kind: "work", mode: "launch", launch: { harness: "codex", model: "sol", effort: "high" } });

  click(window, "[data-default-agent-mode='work']");
  assert.equal(posts.filter((item) => item.path === "/api/launch/default").length, 2);
  click(window, "[data-launch-save]");
  await settle(window);
  assert.deepEqual(posts.at(-1).body, { area: "otto/tangent", kind: "brain", mode: "work" });

  click(window, "[data-default-agent-mode='inherit'][data-default-agent-kind='brain']");
  click(window, "[data-launch-save]");
  await settle(window);
  assert.deepEqual(posts.at(-1).body, { area: "otto/tangent", kind: "brain", mode: "inherit" });
  assert.equal(posts.some((item) => item.path === "/api/brains/start"), false);
  click(window, "[data-launch-close]");

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
  click(window, "[data-area-kind-toggle='design']");
  assert.equal(window.document.querySelectorAll(".area-documents .document-row").length, 1);
  assert.match(window.document.querySelector(".area-documents .document-row").textContent, /Browser notes/);

  const search = window.document.querySelector("#area-search");
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(window, "[data-toggle-area='otto']");
  assert.equal(window.document.querySelector("[data-select-area='otto/tangent']"), null, "a manual collapse stays collapsed");

  holdSessionRefresh = true;
  click(window, "[data-open-area-brain='otto/tangent']");
  click(window, "[data-open-area-brain='otto/tangent']");
  await settle(window);
  assert.equal(posts.at(-1).body.resume, true, "a stale live brain resumes instead of showing an error");
  assert.equal(posts.filter((item) => item.path === "/api/brains/start").length, 1, "a second click cannot start a duplicate generation");
  assert.equal(window.document.querySelector("#session-layer-terminal").dataset.session, "tangent-brain-g2");
  releaseSessionRefresh();
  await settle(window);
  dom.window.close();
});
