import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Goal dependencies persist, project in both directions, and remain advisory", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-dependencies-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "model");
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "model.md"), "---\ntype: area\n---\n\n# Model\n\n## Goals\n\n1. [[goal-ship]]\n2. [[goal-api]]\n", "utf8");
  for (const [slug, title] of [["ship", "Ship UI"], ["api", "Stabilize API"]]) {
    await writeFile(path.join(area, `goal-${slug}.md`), `---\ntype: goal\nstatus: open\ndone_when: ${title} is done.\nsession:\n---\n\n# ${title}\n\n## State\n\nNot started.\n`, "utf8");
  }
  const base = await startShellServer(context, { here, root, trees, workspace });
  if (!base) return;

  const changed = await fetch(`${base}/api/goals/depend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "ship", on: ["api"] }),
  });
  assert.equal(changed.status, 200);
  assert.match(await readFile(path.join(area, "goal-ship.md"), "utf8"), /## Dependencies\n\n- \[\[goal-api\]\]/);

  const ship = await fetch(`${base}/api/goals/show?slug=ship`).then((response) => response.json());
  const api = await fetch(`${base}/api/goals/show?slug=api`).then((response) => response.json());
  assert.deepEqual(ship.goal.dependsOn.map((goal) => goal.title), ["Stabilize API"]);
  assert.deepEqual(api.goal.requiredBy.map((goal) => goal.title), ["Ship UI"]);

  const brief = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent("otto/model/goal-ship.md")}`).then((response) => response.json());
  assert.match(brief.markdown, /## Dependencies/);
  assert.match(brief.markdown, /These facts are advisory/);

  const completed = await fetch(`${base}/api/goals/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/model/goal-ship.md", status: "done" }),
  });
  assert.equal(completed.status, 200, "an open prerequisite does not block status changes");
  assert.match(await readFile(path.join(area, "goal-ship.md"), "utf8"), /## Dependencies\n\n- \[\[goal-api\]\]/);

  const cycle = await fetch(`${base}/api/goals/depend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "api", on: ["ship"] }),
  });
  assert.equal(cycle.status, 409);
});
