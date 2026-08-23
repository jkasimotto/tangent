import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("checked Goals start one shared agent that owns them in checked order", async () => {
  const [html, script, mapCore] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  /** One startable root Goal for the selection desk. */
  const makeGoal = (slug, title, mtime) => ({
    mtime,
    area: "otto/dnd",
    slug,
    file: `otto/dnd/goal-${slug}.md`,
    title,
    status: "open",
    doneWhen: `${title} is done.`,
    stateText: "",
    currentBrief: `- You wanted: ${title}.`,
    storyText: "",
    documents: [],
    why: [],
    subgoalItems: [],
    subgoals: [],
    depth: 0,
  });
  const first = makeGoal("fix-the-flicker", "Fix the flicker", 1);
  const second = makeGoal("name-the-panes", "Name the panes", 2);
  const posts = [];
  let started = false;
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (options.method === "POST") {
      posts.push({ path: pathname, body: options.body ? JSON.parse(options.body) : {} });
      if (pathname === "/api/goals/agent") started = true;
      return jsonResponse({ ok: true, session: "dnd--name-the-panes" });
    }
    if (pathname === "/api/sessions") {
      return jsonResponse({
        boot: "boot-1",
        caffeinate: false,
        sessions: started ? [{ name: "dnd--name-the-panes", goal: second.file, state: "waiting", phase: "collaborate", command: "codex" }] : [],
      });
    }
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    return jsonResponse({
      areas: [
        { path: "otto", name: "otto", goals: [] },
        { path: "otto/dnd", name: "dnd", goals: [first, second], documents: [] },
      ],
      map: [{ path: "otto/dnd", name: "dnd", goals: [first, second] }],
      documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);
  assert.ok(window.document.querySelector(".work-page"), "the desk shows the Work page");

  // Both startable rows carry a checkbox; nothing is checked, so no action bar.
  assert.equal(window.document.querySelectorAll("[data-check-goal]").length, 2);
  assert.equal(window.document.querySelector("[data-start-selected]"), null);

  // Checking is free: the bar appears, nothing starts.
  click(window, `[data-check-goal='${second.file}']`);
  assert.match(window.document.querySelector("[data-start-selected]").textContent, /Start agent on 1 Goal/);
  click(window, `[data-check-goal='${first.file}']`);
  assert.match(window.document.querySelector("[data-start-selected]").textContent, /Start agent on 2 Goals/);
  assert.equal(posts.length, 0);

  // Escape clears the selection.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(window.document.querySelector("[data-start-selected]"), null);
  assert.equal(window.document.querySelectorAll("[data-check-goal]:checked").length, 0);

  // Checked order decides the primary: the first checked Goal leads the session.
  click(window, `[data-check-goal='${second.file}']`);
  click(window, `[data-check-goal='${first.file}']`);
  click(window, "[data-start-selected]");
  await settle(window);
  const start = posts.find((entry) => entry.path === "/api/goals/agent");
  assert.equal(start.body.file, second.file);
  assert.deepEqual(start.body.extraFiles, [first.file]);
  assert.equal(start.body.launch, true);

  // The selection is spent: returning to the desk shows clean checkboxes.
  click(window, "#work-tab");
  await settle(window);
  assert.equal(window.document.querySelector("[data-start-selected]"), null);
  assert.equal(window.document.querySelectorAll("[data-check-goal]:checked").length, 0);

  dom.window.close();
});
