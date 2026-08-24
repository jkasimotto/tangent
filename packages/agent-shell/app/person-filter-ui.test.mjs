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
  assert.equal(filter.getAttribute("aria-haspopup"), "menu");
  filter.click();
  const mineItem = window.document.querySelector("[data-person-value='mine']");
  assert.equal(mineItem.getAttribute("role"), "menuitemradio");
  mineItem.click();
  await settle(window);
  const text = window.document.querySelector(".area-work-columns").textContent;
  assert.match(text, /Shared result/);
  assert.match(text, /Julian branch/);
  assert.doesNotMatch(text, /Dan branch/);
  assert.equal(window.document.activeElement.id, "area-person-filter");
  dom.window.close();
});

test("the shared Person menu obeys keyboard and focus behavior", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ sessions: [], pipelines: [], brains: [] });
    if (pathname === "/api/programs") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse({ areas: [{ path: "one", name: "one", rosterArea: "one", roster: ["Julian", "A person with a very long complete name"], goals: [], documents: [] }], map: [], documents: [] });
  };
  window.eval(shellBundle);
  await settle(window);
  const button = window.document.querySelector("#work-person-filter");
  button.focus();
  button.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(window.document.activeElement.dataset.personValue, "all");
  window.document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(window.document.activeElement.dataset.personValue, "unassigned");
  window.document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(window.document.activeElement, button);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.match(window.document.querySelector("[data-person-value*='a person']").getAttribute("aria-label"), /very long complete name/);
  dom.window.close();
});
