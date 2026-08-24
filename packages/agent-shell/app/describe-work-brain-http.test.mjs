import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { endBrain, newBrain, writeBrain } from "./brain-record.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Posts one Describe work request. */
function describe(base, body) {
  return fetch(`${base}/api/work/describe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ launch: false, ...body }),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("Describe work reaches a stopped or live Area brain and never opens a work-definition session", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "describe-work-brain-"));
  const trees = path.join(root, "trees");
  const brains = path.join(root, "brains");
  const workspace = path.join(root, "workspace");
  for (const area of ["otto/tangent/child", "otto/plain"]) await mkdir(path.join(trees, area), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "tangent.md"), `---\ntype: area\n---\n\n# Tangent\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "child", "child.md"), "---\ntype: area\n---\n\n# Child\n", "utf8");
  await writeFile(path.join(trees, "otto", "plain", "plain.md"), `---\ntype: area\n---\n\n# Plain\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "otto", "tangent", "design-context.md"), "---\ntype: document\n---\n\n# Context\n", "utf8");
  const record = endBrain(newBrain({
    area: "otto/tangent",
    instruction: "Run Tangent work.",
    command: "claude",
    planFile: "otto/tangent/plan-tangent.md",
  }), "stopped");
  await writeBrain(brains, record);

  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  const resumed = await describe(base, {
    area: "otto/tangent/child",
    description: "Route this exact description to the controlling brain.",
    sources: ["otto/tangent/design-context.md"],
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.route, "brain-resumed");
  assert.equal(resumed.body.brainArea, "otto/tangent");
  openedSessions.push(resumed.body.session);

  const sessionsAfterResume = (await fetch(`${base}/api/sessions`).then((response) => response.json())).sessions;
  assert.equal(sessionsAfterResume.find((session) => session.name === resumed.body.session)?.kind, "brain");
  assert.equal(sessionsAfterResume.some((session) => session.kind === "work-definition" && session.area === "otto/tangent/child"), false);
  const inbox = JSON.parse(await readFile(path.join(brains, "otto", "tangent", "child", "inbox.json"), "utf8"));
  assert.match(inbox.notices[0].text, /Route this exact description to the controlling brain\./);
  assert.match(inbox.notices[0].text, /otto\/tangent\/design-context\.md/);

  const live = await describe(base, { area: "otto/tangent", description: "Deliver this while the brain is live." });
  assert.equal(live.status, 200);
  assert.equal(live.body.route, "brain-opened");
  assert.equal(live.body.session, resumed.body.session);

  const plain = await describe(base, { area: "otto/plain", description: "Keep the existing behavior here." });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.route, "work-definition-opened");
  openedSessions.push(plain.body.session);
  const sessionsAfterPlain = (await fetch(`${base}/api/sessions`).then((response) => response.json())).sessions;
  assert.equal(sessionsAfterPlain.find((session) => session.name === plain.body.session)?.kind, "work-definition");
});
