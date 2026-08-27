import test from "node:test";
import { assert, readFile, path, JSDOM, documentComments, areaMapView, shellBundle, here, goToCore, goalCardCore, askCore, settle, click, submit, openDocumentViaGoTo, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("Work starts one Goal without transient checkbox co-assignment", async () => {
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
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/launch/options") {
      return jsonResponse({
        harnesses: [{ id: "codex", label: "Codex", command: "codex", models: [{ id: "sol", label: "Sol", args: "--model sol", efforts: [{ id: "low", label: "Low", args: "-c effort=low" }] }] }],
        default: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol -c effort=low" },
      });
    }
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

  assert.equal(window.document.querySelector("[data-check-goal], [data-start-selected], .work-col-select"), null);
  assert.equal(posts.length, 0);

  click(window, `[data-launch-for='${second.file}']`);
  await settle(window);
  click(window, "[data-launch-start]");
  await settle(window);
  const start = posts.find((entry) => entry.path === "/api/goals/agent");
  assert.equal(start.body.file, second.file);
  assert.equal(Object.hasOwn(start.body, "extraFiles"), false, "the browser does not derive co-assignment from transient UI state");
  assert.equal(start.body.launch, true);
  // Start agent never opens the picker, so the client fills the harness from
  // the Area's declared default: the server supplies none and refuses a start
  // that carries none.
  assert.deepEqual(start.body.choice, { harness: "codex", model: "sol", effort: "low" });

  click(window, "#work-tab");
  await settle(window);
  assert.equal(window.document.querySelector("[data-check-goal], [data-start-selected]"), null);

  dom.window.close();
});
