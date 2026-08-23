// HTTP tests for the Area map facts (design contract: otto/tangent/design-area-map):
// the enriched vault index, Area status on Julian's word, and stored map state.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

/** Reserves and releases one local port for the HTTP test. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Polls until the child server accepts HTTP requests. */
async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start at ${url}`);
}

/** Prefers the nvm Node on PATH so node-pty loads against the same ABI as the shell. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

test("the vault index carries kinds, git times, degrees, and Area children and status; Areas fold on Julian's word; map state persists", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-map-http-"));
  const trees = path.join(root, "trees");
  const hackathon = path.join(trees, "neara", "hackathon");
  const liveEdit = path.join(hackathon, "live-edit");
  await mkdir(liveEdit, { recursive: true });
  await writeFile(path.join(hackathon, "hackathon.md"), "---\ntype: area\nstatus: active\n---\n\n# Hackathon\n\n## Purpose\n\nHackathon work.\n\n## Current\n\nLive Edit is the focus.\n\nSecond paragraph.\n", "utf8");
  await writeFile(path.join(liveEdit, "live-edit.md"), "---\ntype: area\nstatus: active\n---\n\n# Live Edit\n\n## Purpose\n\nReal-time collaboration.\n\n## Goals\n\n1. [[goal-old]]\n2. [[goal-new]]\n", "utf8");
  await writeFile(path.join(liveEdit, "design-live-edit-collaboration.md"), "---\ntype: document\nstatus: draft\n---\n\n# Live Edit collaboration\n\nSee [[design-session-relay]] and [[goal-new]].\n", "utf8");
  await writeFile(path.join(liveEdit, "design-session-relay.md"), "# Session relay\n\nBuilds on [[design-live-edit-collaboration]].\n", "utf8");
  await writeFile(path.join(liveEdit, "world-viewer-consistency.md"), "# World viewer\n\nA one-off page that links [[design-live-edit-collaboration]].\n", "utf8");
  await writeFile(path.join(liveEdit, "goal-old.md"), "---\ntype: goal\nstatus: open\ndone_when: Old work lands\nsession:\n---\n\n# Old goal\n\n## State\n\nOpen.\n", "utf8");
  await writeFile(path.join(liveEdit, "goal-new.md"), "---\ntype: goal\nstatus: open\ndone_when: New work lands\nsession:\n---\n\n# New goal\n\nUses [[design-live-edit-collaboration]].\n\n## State\n\nOpen.\n", "utf8");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: everything"]);
  await new Promise((resolve) => setTimeout(resolve, 1100)); // git times have second precision
  await writeFile(path.join(liveEdit, "goal-new.md"), "---\ntype: goal\nstatus: open\ndone_when: New work lands\nsession:\n---\n\n# New goal\n\nUses [[design-live-edit-collaboration]].\n\n## State\n\nProgress.\n", "utf8");
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "update: goal-new"]);
  const commitTimes = (await execFileAsync("git", ["-C", trees, "log", "--format=%ct"])).stdout.trim().split("\n").map((line) => Number(line) * 1000);
  const [second, first] = commitTimes;

  const port = await freePort();
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `area-map-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const byFile = new Map(vault.documents.map((record) => [record.file, record]));
  const collaboration = byFile.get("neara/hackathon/live-edit/design-live-edit-collaboration.md");
  assert.equal(collaboration.docKind, "design");
  assert.equal(collaboration.inDegree, 3, "relay, world viewer, and goal-new link it");
  assert.equal(collaboration.outDegree, 2);
  assert.equal(byFile.get("neara/hackathon/live-edit/world-viewer-consistency.md").docKind, "page", "a one-off prefix is a page");
  assert.equal(byFile.get("neara/hackathon/live-edit/live-edit.md").docKind, "note");
  assert.equal(byFile.get("neara/hackathon/live-edit/goal-new.md").docKind, "goal");
  assert.equal(collaboration.createdAt, first);
  assert.equal(collaboration.changedAt, first);
  const newGoal = byFile.get("neara/hackathon/live-edit/goal-new.md");
  assert.equal(newGoal.createdAt, first);
  assert.equal(newGoal.changedAt, second, "the last commit that touched the file");
  assert.ok(second > first);
  const hackathonArea = vault.areas.find((area) => area.path === "neara/hackathon");
  assert.deepEqual(hackathonArea.children, ["neara/hackathon/live-edit"]);
  assert.equal(hackathonArea.parent, "neara");
  assert.equal(hackathonArea.status, "active");
  assert.equal(hackathonArea.current, "Live Edit is the focus.");
  const liveEditArea = vault.areas.find((area) => area.path === "neara/hackathon/live-edit");
  assert.equal(liveEditArea.goals.find((goal) => goal.slug === "new").changedAt, second, "Goals carry the same times");
  assert.equal(vault.documents.find((record) => record.file === "neara/neara.md").missing, true, "an Area without a note is marked");

  // Area done on Julian's word: frontmatter, provenance commit, Goals untouched.
  const done = await fetch(`${base}/api/areas/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "neara/hackathon", status: "done" }) }).then((response) => response.json());
  assert.equal(done.status, "done");
  assert.equal(done.openGoals, 2, "the two open Goals stay open and hidden");
  assert.match(await readFile(path.join(hackathon, "hackathon.md"), "utf8"), /^status: done$/m);
  assert.match(await readFile(path.join(liveEdit, "goal-old.md"), "utf8"), /^status: open$/m);
  const { stdout: log } = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s%n%b"]);
  assert.match(log, /update: neara\/hackathon area done/);
  assert.match(log, /Tangent-Area: neara\/hackathon/);
  const afterDone = await fetch(`${base}/api/vault`).then((response) => response.json());
  assert.equal(afterDone.areas.find((area) => area.path === "neara/hackathon").status, "done");
  const reopened = await fetch(`${base}/api/areas/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "neara/hackathon", status: "active" }) }).then((response) => response.json());
  assert.equal(reopened.status, "active");
  const bad = await fetch(`${base}/api/areas/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "neara/hackathon", status: "paused" }) });
  assert.equal(bad.status, 400);
  const unknown = await fetch(`${base}/api/areas/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "neara/nowhere", status: "done" }) });
  assert.equal(unknown.status, 404);

  // Map state lives outside the vault and round-trips per Area.
  const empty = await fetch(`${base}/api/map-state?area=neara/hackathon`).then((response) => response.json());
  assert.deepEqual(empty.state, {});
  const saved = await fetch(`${base}/api/map-state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "neara/hackathon", state: { positions: { "neara/hackathon/live-edit/live-edit.md": { x: 10, y: -4, pinned: true } }, kindsOff: ["goal"], showDone: false, collapsed: [] } }) });
  assert.equal(saved.status, 200);
  const stored = await fetch(`${base}/api/map-state?area=neara/hackathon`).then((response) => response.json());
  assert.deepEqual(stored.state.kindsOff, ["goal"]);
  assert.equal(stored.state.positions["neara/hackathon/live-edit/live-edit.md"].pinned, true);
  assert.equal(existsSync(path.join(root, "map-state", "neara__hackathon.json")), true);
  const { stdout: status } = await execFileAsync("git", ["-C", trees, "status", "--porcelain"]);
  assert.equal(status.trim(), "", "reading and map state never touch the vault");
  const rejected = await fetch(`${base}/api/map-state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "../etc", state: {} }) });
  assert.equal(rejected.status, 400);
});
