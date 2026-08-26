// Three Area-brain contracts on the production HTTP path: the exact Request
// effect, the filtered Goal listing, and the message that wakes an inactive
// brain.
//
// The effect allowlist has been complete in code for some time, and no live
// Request has ever carried an effect, so nothing proved that authorizing one
// changes the vault. Each suite drives the real server, and the files on disk
// are what prove the work happened.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

/** Posts one JSON body and returns the parsed response with its status. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Writes the smallest vault that carries one Area, one sibling Area, and one Goal. */
async function buildVault(root) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "test");
  const sibling = path.join(trees, "otto", "other");
  await mkdir(area, { recursive: true });
  await mkdir(sibling, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(trees, "harnesses.md"), "# Harnesses\n\n```tangent.harnesses.v1\n" + JSON.stringify({
    version: 1,
    harnesses: [{ id: "other", label: "Other", command: "other-agent" }],
  }, null, 2) + "\n```\n", "utf8");
  await writeFile(path.join(area, "test.md"), `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-close-me]]\n\n## Resources\n\n- Repository: ${workspace}\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults":{"launch":{"harness":"other"}}}\n\`\`\`\n`, "utf8");
  await writeFile(path.join(sibling, "other.md"), "---\ntype: area\n---\n\n# Other\n", "utf8");
  await writeFile(
    path.join(area, "goal-close-me.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The effect closes it\nsession:\n---\n\n# Close me\n\n## State\n\nNot started.\n",
    "utf8"
  );
  return { trees, workspace };
}

test("an authorized Request effect closes a Goal and routes a Journal on the production path", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-effect-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  const brain = await post(base, "/api/brains/start", { area: "otto/test", instruction: "Own this Area." });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  openedSessions.push(brain.body.session);

  const goals = await fetch(`${base}/api/goals?area=${encodeURIComponent("otto/test")}`).then((response) => response.json());
  const target = goals.goals.find((goal) => goal.slug === "close-me");
  assert.ok(target, "the Goal exists before the effect runs");
  assert.equal(target.status, "open");

  // 1. The brain writes a Request that carries an exact effect.
  const created = await post(base, "/api/brains/requests", {
    session: brain.body.session,
    kind: "decision",
    subject: "Close the Goal",
    question: "The done condition holds. Close it?",
    proposal: "Mark close-me done.",
    effect: { type: "goal-done", goal: target.file },
  });
  assert.equal(created.status, 200);
  const request = created.body.request;
  assert.ok(request.effectRevision, "the effect carries a hashed revision");
  assert.equal(request.effectOperation.status, "idle");

  // 2. A stale revision cannot authorize it. The Goal stays open.
  const stale = await post(base, "/api/brains/requests/answer", {
    area: "otto/test", id: request.id, answer: "authorize", effectRevision: "0".repeat(64),
  });
  assert.equal(stale.status, 400);
  assert.match(await readFile(path.join(trees, target.file), "utf8"), /status: open/);

  // 3. The exact revision authorizes it, and the Goal file on disk is done.
  const authorized = await post(base, "/api/brains/requests/answer", {
    area: "otto/test", id: request.id, answer: "authorize", effectRevision: request.effectRevision,
  });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.request.status, "answered");
  assert.equal(authorized.body.request.effectOperation.status, "succeeded");
  assert.match(await readFile(path.join(trees, target.file), "utf8"), /status: done/);

  // The closure is one material milestone, so the brain's recent view matches
  // what happened rather than only the Goal file.
  const milestones = await fetch(`${base}/api/areas/milestones?area=${encodeURIComponent("otto/test")}`).then((response) => response.json());
  assert.ok(
    milestones.milestones.some((item) => /close me/i.test(item.summary) || item.ref === target.file),
    "the authorized closure recorded a milestone"
  );

  // 4. The effect ran once, and the answered Request cannot run it again.
  assert.equal(authorized.body.request.effectOperation.attempts, 1, "the durable operation record counts one run");
  const again = await post(base, "/api/brains/requests/answer", {
    area: "otto/test", id: request.id, answer: "authorize", effectRevision: request.effectRevision,
  });
  assert.equal(again.status, 400, "an answered Request never runs its effect a second time");

  // 5. A route-journal effect writes the destination Area's Journal.
  const routed = await post(base, "/api/brains/requests", {
    session: brain.body.session,
    kind: "decision",
    subject: "Route the note",
    question: "Send this to Other?",
    proposal: "Route it.",
    effect: { type: "route-journal", area: "otto/other", text: "The ramp faces meet at the dragged width." },
  });
  assert.equal(routed.status, 200);
  const routedAnswer = await post(base, "/api/brains/requests/answer", {
    area: "otto/test", id: routed.body.request.id, answer: "authorize", effectRevision: routed.body.request.effectRevision,
  });
  assert.equal(routedAnswer.status, 200);
  assert.equal(routedAnswer.body.request.effectOperation.status, "succeeded");
  const journal = routedAnswer.body.request.effectOperation.result.journal;
  assert.ok(journal, "the effect result names the Journal it wrote");
  assert.match(await readFile(path.join(trees, journal), "utf8"), /The ramp faces meet at the dragged width\./);

  // 6. The allowlist is closed. An unknown effect never reaches a Request.
  const rejected = await post(base, "/api/brains/requests", {
    session: brain.body.session,
    kind: "decision",
    subject: "Delete it",
    question: "Remove the Area?",
    proposal: "Delete otto/other.",
    effect: { type: "delete-area", area: "otto/other" },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /unsupported Request effect type/);

  // A brain never reaches across Areas with an effect, even a listed one.
  const crossArea = await post(base, "/api/brains/requests", {
    session: brain.body.session,
    kind: "decision",
    subject: "Close their Goal",
    question: "Close it?",
    proposal: "Close the sibling Area's Goal.",
    effect: { type: "goal-done", goal: "otto/other/goal-not-mine.md" },
  });
  assert.equal(crossArea.status, 200, "the Request may be written");
  const refused = await post(base, "/api/brains/requests/answer", {
    area: "otto/test", id: crossArea.body.request.id, answer: "authorize", effectRevision: crossArea.body.request.effectRevision,
  });
  assert.equal(refused.status, 409, "the effect refuses work outside the brain's exact Area");
  assert.match(refused.body.error, /no longer exists|wrong-area/);
});

test("a Goal listing narrows by status, recency, and free text on the production path", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-filters-"));
  const { trees, workspace } = await buildVault(root);
  await writeFile(
    path.join(trees, "otto", "test", "goal-rules-241.md"),
    "---\ntype: goal\nstatus: done\ndone_when: Rules 241 ship\nsession:\n---\n\n# Rules 241\n\n## State\n\nDone.\n",
    "utf8"
  );
  await mkdir(path.join(trees, "otto", "test", "child"), { recursive: true });
  await writeFile(path.join(trees, "otto", "test", "child", "child.md"), "---\ntype: area\n---\n\n# Child\n", "utf8");
  await writeFile(
    path.join(trees, "otto", "test", "child", "goal-rules-250.md"),
    "---\ntype: goal\nstatus: open\ndone_when: Rules 250 ship\nsession:\n---\n\n# Rules 250\n\n## State\n\nNot started.\n",
    "utf8"
  );
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  /** Reads one Goal listing with the supplied query string. */
  const list = (query) => fetch(`${base}/api/goals?${query}`).then((response) => response.json());

  const all = await list(`area=${encodeURIComponent("otto/test")}`);
  assert.deepEqual(all.goals.map((goal) => goal.slug).sort(), ["close-me", "rules-241"]);

  const done = await list(`area=${encodeURIComponent("otto/test")}&status=done`);
  assert.deepEqual(done.goals.map((goal) => goal.slug), ["rules-241"]);

  const open = await list(`area=${encodeURIComponent("otto/test")}&status=open`);
  assert.deepEqual(open.goals.map((goal) => goal.slug), ["close-me"]);

  const recent = await list(`area=${encodeURIComponent("otto/test")}&changed-since=30d`);
  assert.equal(recent.goals.length, 2, "everything this test just wrote is recent");
  const ancient = await list(`area=${encodeURIComponent("otto/test")}&changed-since=2000-01-01`);
  assert.equal(ancient.goals.length, 2);

  const text = await list(`area=${encodeURIComponent("otto/test")}&subtree=1&query=${encodeURIComponent("241 250")}`);
  assert.deepEqual(text.goals.map((goal) => goal.slug).sort(), ["rules-241", "rules-250"], "the query words are alternatives");

  // The subtree scent counts what the same filters find, so a filtered listing
  // never sends a brain after work its own filters excluded.
  const scent = await list(`area=${encodeURIComponent("otto/test")}&query=${encodeURIComponent("250")}`);
  assert.equal(scent.goals.length, 0);
  assert.equal(scent.descendantGoals, 1);
  assert.match(scent.subtreeCommand, /--subtree --query "250"/);

  const empty = await list(`area=${encodeURIComponent("otto/test")}&query=${encodeURIComponent("nothing-here")}`);
  assert.equal(empty.goals.length, 0);
  assert.equal(empty.subtreeCommand, undefined, "an empty subtree earns no follow-up command");

  const broken = await fetch(`${base}/api/goals?area=${encodeURIComponent("otto/test")}&changed-since=soon`);
  assert.equal(broken.status, 400, "an unreadable recency window is the caller's mistake, not an empty answer");
});

test("an inactive brain wakes with Julian's message, and the woken attempt reads it", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-wake-"));
  const { trees, workspace } = await buildVault(root);
  const openedSessions = [];
  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions });
  if (!base) return;

  const first = await post(base, "/api/brains/start", { area: "otto/test", instruction: "Own this Area." });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  openedSessions.push(first.body.session);
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${first.body.session}`], () => resolve()));

  const woken = await post(base, "/api/brains/start", { area: "otto/test", resume: true, instruction: "Pick the branch up again." });
  assert.equal(woken.status, 200, JSON.stringify(woken.body));
  openedSessions.push(woken.body.session);

  // The wake reason is a durable notice, so the woken attempt reads why it is
  // awake instead of guessing from its founding instruction alone.
  const prompt = await fetch(`${base}/api/brains/show?area=${encodeURIComponent("otto/test")}`).then((response) => response.json());
  assert.match(JSON.stringify(prompt.brain), /Pick the branch up again\./, "the wake message reaches the brain record");

  // Automatic recovery carries no message and adds no notice.
  const before = JSON.stringify(prompt.brain).match(/Julian woke this brain/g)?.length ?? 0;
  assert.equal(before, 1, "one wake, one notice");
});
