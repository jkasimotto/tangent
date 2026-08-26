import test from "node:test";
import { assert, readFile, path, JSDOM, shellBundle, here, settle, jsonResponse } from "./focus-shell-ui-fixture.mjs";

/** Builds the vault response for a Work desk and Area card that carry stale assignee data. */
function vaultResponse(goals) {
  return {
    areas: [{ path: "otto/team", name: "team", rosterArea: "otto/team", roster: ["Julian", "Troy", "Dan"], goals, documents: [] }],
    map: [{ path: "otto/team", name: "team", goals }], documents: [],
  };
}

/** Creates one projected Goal that still carries the removed assignee fields. */
function staleGoal(file, title) {
  return {
    file, title, area: "otto/team", slug: file.slice(5, -3), status: "open", depth: 0,
    doneWhen: `${title} is complete.`, stateText: "Not started.", subgoals: [], documents: [], why: [],
    assignees: ["Troy"], assigneeKeys: ["otto/team::troy"], unassigned: false, rosterArea: "otto/team",
  };
}

/** Boots the shell against the fixture vault at one URL. */
async function shell(url, goals, sessions = []) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url });
  const { window } = dom;
  window.setInterval = () => 0;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.fetch = async (address) => {
    const pathname = new URL(address, window.location.href).pathname;
    if (pathname === "/api/sessions") return jsonResponse({ sessions, pipelines: [], brains: [] });
    if (pathname === "/api/operations") return jsonResponse({ programs: [], errors: [], areas: [], liveCount: 0 });
    if (pathname === "/api/map-state") return jsonResponse({ state: {} });
    return jsonResponse(vaultResponse(goals));
  };
  window.eval(shellBundle);
  await settle(window);
  return dom;
}

// Vault data written before the removal still carries assignees and a roster.
// No surface may read either one back into the page.
test("the Work desk shows no person control and no assignee text", async () => {
  const goal = staleGoal("goal-work.md", "Ship the table");
  const dom = await shell("http://agent-shell.test/?view=work", [goal], [{ name: "team-worker", goal: goal.file, kind: "goal", state: "working", live: true }]);
  const { window } = dom;
  const page = window.document.querySelector(".work-page");
  assert.ok(page, "the Work page renders");
  assert.equal(window.document.querySelector("[data-person-menu]"), null, "no Person menu");
  assert.equal(window.document.querySelector("#work-person-filter"), null, "no Work person filter");
  assert.doesNotMatch(page.textContent, /Unassigned|Troy/, "no assignee label survives");
  assert.match(page.textContent, /Ship the table/, "the Goal itself still shows");
  dom.window.close();
});

test("the selected Area shows no person control, People roster form, or assignee text", async () => {
  const dom = await shell("http://agent-shell.test/?view=areas&area=otto/team", [staleGoal("goal-area.md", "Land the change")]);
  const { window } = dom;
  const screen = window.document.querySelector("#screen");
  assert.equal(window.document.querySelector("[data-person-menu]"), null, "no Person menu");
  assert.equal(window.document.querySelector("#area-person-filter"), null, "no Area person filter");
  assert.equal(window.document.querySelector("[data-area-people-form]"), null, "no People roster form");
  assert.doesNotMatch(screen.textContent, /Unassigned|Troy/, "no assignee label survives");
  assert.match(screen.textContent, /Land the change/, "the Goal itself still shows");
  dom.window.close();
});
