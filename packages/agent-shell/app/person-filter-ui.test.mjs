import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, jsonResponse } from "./focus-shell-ui-fixture.mjs";

test("the selected Area reduces a Goal tree to Julian's branch", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/?view=areas&area=otto/team" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  /** Creates one projected Goal for the visible filter fixture. */
  const goal = (file, title, assignees, depth) => ({
    file, title, assignees, depth, area: "otto/team", slug: file.slice(5, -3), status: "open",
    doneWhen: `${title} is complete.`, stateText: "Not started.", subgoals: [], documents: [], why: [],
    assigneeKeys: assignees.map((name) => `otto/team::${name.toLocaleLowerCase("en-US")}`),
  });
  const root = goal("goal-root.md", "Shared result", ["Troy"], 0);
  const mine = goal("goal-mine.md", "Julian branch", ["Julian"], 1);
  const other = goal("goal-other.md", "Dan branch", ["Dan"], 1);
  root.subgoals = [mine.slug, other.slug];
  mine.dependsOn = [{ file: root.file, title: root.title, status: "open" }];
  const goals = [root, mine, other];
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ sessions: [], pipelines: [], brains: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse({
      areas: [{ path: "otto/team", name: "team", rosterArea: "otto/team", roster: ["Julian", "Troy", "Dan"], goals, documents: [] }],
      map: [{ path: "otto/team", name: "team", goals }], documents: [],
    });
  };
  window.eval(shellBundle);
  await settle(window);

  const filter = window.document.querySelector("#area-person-filter");
  filter.value = "mine";
  filter.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle(window);
  const text = window.document.querySelector(".area-work-graph").textContent;
  assert.match(text, /Shared result/);
  assert.match(text, /Julian branch/);
  assert.doesNotMatch(text, /Dan branch/);
  dom.window.close();
});
