import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { areaCanvasPath, parseAreaCanvas } from "../app/area-canvas.mjs";
import { areaResourceCatalogPath, parseAreaResourceCatalog } from "../app/area-resource-catalog.mjs";
import { isolateTmuxTests } from "../app/tmux-test-isolation.mjs";
import { runAreaCli } from "../dist/cli/index.js";

// Every other CLI resource test answers `fetch` with a hand-written server
// shape. This regression drives the built CLI against the unmodified Agent
// Shell server, its real catalog transaction, and a temporary vault, the way a
// Brain does from its own shell process: each command is a fresh, stateless
// client that re-reads the current revisions before it writes.
const here = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.join(here, "..", "app");
const execFileAsync = promisify(execFile);
isolateTmuxTests();

const AREA = "otto/tangent";
const CHILD = "otto/tangent/child";

/** Reserves and releases one non-live loopback port. */
async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

/** Prefers the PATH Node whose ABI matches installed native modules. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Runs one Git command inside a fixture directory and returns trimmed stdout. */
async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

/** Creates a temporary vault with three nested Areas, one repository, and three real Git worktrees. */
async function createFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "cli-area-resource-server-")));
  const trees = path.join(root, "trees");
  for (const area of ["otto", AREA, CHILD]) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nFixture Area.\n## Resources\n\n`, "utf8");
  }
  await git(trees, "init", "--quiet");
  await git(trees, "config", "user.email", "resource-test@tangent.local");
  await git(trees, "config", "user.name", "Resource Test");
  await git(trees, "add", ".");
  await git(trees, "commit", "--quiet", "-m", "add: resource fixture");

  const repo = path.join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "--quiet", "-b", "main");
  await git(repo, "config", "user.email", "resource-test@tangent.local");
  await git(repo, "config", "user.name", "Resource Test");
  await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "--quiet", "-m", "init");
  const worktrees = {};
  for (const name of ["one", "two", "three"]) {
    const directory = path.join(root, "worktrees", name);
    await mkdir(path.dirname(directory), { recursive: true });
    await git(repo, "worktree", "add", "--quiet", "-b", `feature/${name}`, directory);
    worktrees[name] = directory;
  }
  return { root, trees, repo, worktrees };
}

/** Starts the unmodified production server against only the temporary fixture roots. */
async function startServer(fixture) {
  const port = await freePort();
  assert.notEqual(port, 4321, "the fixture never binds the live Agent Shell port");
  const output = [];
  const env = {
    ...process.env,
    HOME: fixture.root,
    PORT: String(port),
    HOST: "127.0.0.1",
    TREES_ROOT: fixture.trees,
    WORKSPACE: path.join(fixture.root, "workspace"),
    TANGENT_LOOPS_ROOT: path.join(fixture.root, "loops"),
    TANGENT_PIPELINES_ROOT: path.join(fixture.root, "pipelines"),
    TANGENT_BRAINS_ROOT: path.join(fixture.root, "brains"),
    TANGENT_SESSION_OWNERS_ROOT: path.join(fixture.root, "session-owners"),
    TANGENT_CONTINUATIONS_ROOT: path.join(fixture.root, "continuations"),
    TANGENT_GOAL_CLEANUPS_ROOT: path.join(fixture.root, "goal-cleanups"),
    TANGENT_ARMED_ROOT: path.join(fixture.root, "armed"),
    TANGENT_MAP_STATE_ROOT: path.join(fixture.root, "map-state"),
    TANGENT_PRESENTATIONS_ROOT: path.join(fixture.root, "presented"),
    TANGENT_HARNESS_LOG_ROOT: path.join(fixture.root, "harness-logs"),
    AGENT_MESSAGE_LOG: path.join(fixture.root, "messages.jsonl"),
    AGENT_SHELL_ACTION_LOG: path.join(fixture.root, "actions.jsonl"),
    AGENT_SHELL_REBUILD_STATE: path.join(fixture.root, "rebuild.json"),
    AGENT_SHELL_REBUILD_LOG: path.join(fixture.root, "rebuild.log"),
    AGENT_SHELL_NO_OPEN: "1",
    AGENT_SHELL_TEST_NO_LAUNCH: "1",
    TANGENT_AREA_MAP_WORLD: "1",
    TANGENT_SHELL_INSTANCE_ID: `cli-area-resource-server-${process.pid}`,
    CHAT_SESSION: `cli-area-resource-server-${process.pid}`,
    GROQ_API_KEY: "",
  };
  delete env.TMUX;
  const child = spawn(nodeExecutable(), ["server.mjs"], { cwd: appDirectory, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Agent Shell exited before readiness: ${output.join("")}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { base, child, output };
    } catch { /* startup can race the first connection */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Agent Shell did not start: ${output.join("")}`);
}

/** Stops the isolated server, escalating only to its exact child when needed. */
async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGKILL");
    await once(server.child, "exit");
  }
}

/** Runs one `tangent area resource` command in-process as a fresh stateless client of the fixture server. */
async function cli(server, ...argv) {
  const previousLog = console.log;
  const previousExitCode = process.exitCode;
  const previousTmux = process.env.TMUX;
  const printed = [];
  delete process.env.TMUX;
  process.exitCode = undefined;
  console.log = (...parts) => printed.push(parts.join(" "));
  let thrown = null;
  try { await runAreaCli(["resource", ...argv, "--server", server.base]); }
  catch (error) { thrown = error; }
  finally {
    console.log = previousLog;
    if (previousTmux !== undefined) process.env.TMUX = previousTmux;
  }
  const exitCode = thrown ? 1 : process.exitCode ?? 0;
  process.exitCode = previousExitCode;
  const text = printed.join("\n");
  const json = argv.includes("--json") && text ? JSON.parse(text) : null;
  return { text, json, exitCode, error: thrown };
}

/** Returns the number of commits in the fixture vault. */
async function vaultCommits(fixture) {
  return Number(await git(fixture.trees, "rev-list", "--count", "HEAD"));
}

/** Reads the parsed catalog of one fixture Area. */
async function catalog(fixture, area) {
  const parsed = parseAreaResourceCatalog(await readFile(path.join(fixture.trees, areaResourceCatalogPath(area))));
  assert.equal(parsed.ok, true);
  return parsed.catalog;
}

/** Reads the parsed source scene of one fixture Area. */
async function scene(fixture, area) {
  const parsed = parseAreaCanvas(await readFile(path.join(fixture.trees, areaCanvasPath(area)), "utf8"));
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

/** Returns the visible or retained root Block for one resource ID in a scene. */
function resourceRoot(source, id) {
  return source.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === id) ?? null;
}

test("tangent area resource manages real worktrees, a link, and an inherited repository through the production server", { timeout: 120_000 }, async () => {
  const fixture = await createFixture();
  let server = null;
  try {
    server = await startServer(fixture);
    const baseline = await vaultCommits(fixture);

    const empty = await cli(server, "list", AREA);
    assert.equal(empty.exitCode, 0);
    assert.match(empty.text, /^Map resources · otto\/tangent \[current\]$/m);
    assert.match(empty.text, /No confirmed Map resources\./);

    // Add with an explicit operation ID, then repeat the exact command the way a Brain retries a lost response.
    const added = await cli(server, "add", AREA, "--kind", "worktree", "--path", fixture.worktrees.one, "--label", "One", "--operation-id", "brain-add-one", "--json");
    assert.equal(added.exitCode, 0, added.text);
    const oneId = added.json.resource.locator.id;
    assert.match(oneId, /^[0-9a-f-]{36}$/);
    assert.equal(added.json.resource.target.path, fixture.worktrees.one);
    assert.equal(added.json.undo.state, "available");
    const afterAdd = await vaultCommits(fixture);
    assert.equal(afterAdd, baseline + 1);
    const retried = await cli(server, "add", AREA, "--kind", "worktree", "--path", fixture.worktrees.one, "--label", "One", "--operation-id", "brain-add-one", "--json");
    assert.equal(retried.exitCode, 0, retried.text);
    assert.equal(retried.json.resource.locator.id, oneId, "the exact retry returns the committed record");
    assert.equal(retried.json.undo.token, added.json.undo.token);
    assert.equal(await vaultCommits(fixture), afterAdd, "the exact retry commits nothing");
    const reused = await cli(server, "add", AREA, "--kind", "worktree", "--path", fixture.worktrees.two, "--label", "Two", "--operation-id", "brain-add-one", "--json");
    assert.equal(reused.exitCode, 1);
    assert.equal(reused.json.code, "operation-id-reused");
    assert.equal(reused.json.status, 409);
    assert.equal(reused.json.operationId, "brain-add-one");
    const duplicate = await cli(server, "add", AREA, "--kind", "worktree", "--path", `${fixture.worktrees.one}/`, "--label", "One again", "--json");
    assert.equal(duplicate.json.code, "duplicate-resource-target");
    assert.equal(duplicate.json.recovery.existing.id, oneId);
    const unsafe = await cli(server, "add", AREA, "--kind", "link", "--url", "javascript:alert(1)", "--json");
    assert.equal(unsafe.json.code, "invalid-resource-target");
    const missing = await cli(server, "add", AREA, "--kind", "worktree", "--path", path.join(fixture.root, "not-there"), "--json");
    assert.equal(missing.exitCode, 1);
    assert.match(missing.json.error, /is missing.*--allow-missing/);
    assert.equal(await vaultCommits(fixture), afterAdd, "refused adds never write the vault");
    assert.equal((await catalog(fixture, AREA)).resources.length, 1);

    const two = await cli(server, "add", AREA, "--kind", "worktree", "--path", fixture.worktrees.two, "--label", "Two", "--json");
    const three = await cli(server, "add", AREA, "--kind", "worktree", "--path", fixture.worktrees.three, "--json");
    const link = await cli(server, "add", AREA, "--kind", "link", "--url", "https://github.com/example/repo/pull/1", "--label", "PR 1", "--json");
    const repository = await cli(server, "add", "otto", "--kind", "repository", "--path", fixture.repo, "--label", "Repo", "--json");
    for (const result of [two, three, link, repository]) assert.equal(result.exitCode, 0, result.text);
    const twoId = two.json.resource.locator.id;
    const threeId = three.json.resource.locator.id;
    const linkId = link.json.resource.locator.id;
    const repositoryId = repository.json.resource.locator.id;
    assert.equal(three.json.resource.label, null, "an unlabelled worktree keeps a null authored label");

    const listed = await cli(server, "list", CHILD);
    assert.equal(listed.exitCode, 0);
    assert.match(listed.text, new RegExp(`^  ${oneId.slice(0, 12)}  worktree  One  \\[from otto/tangent; never-placed; not-checked\\]$`, "m"), "list never starts Git work");
    assert.match(listed.text, new RegExp(`^  ${repositoryId.slice(0, 12)}  repository  Repo  \\[from otto; never-placed; not-checked\\]$`, "m"));
    assert.match(listed.text, new RegExp(`^  ${linkId.slice(0, 12)}  link  PR 1  \\[from otto/tangent; never-placed`, "m"));
    assert.ok(listed.text.includes(`    ${fixture.worktrees.one}`), "list prints the exact absolute path under each row");
    const shown = await cli(server, "show", AREA, oneId.slice(0, 8));
    assert.equal(shown.exitCode, 0);
    assert.match(shown.text, new RegExp(`^otto/tangent:${oneId}$`, "m"));
    assert.match(shown.text, /^  kind: worktree$/m);
    assert.ok(shown.text.includes(`  target: ${fixture.worktrees.one}`));
    assert.match(shown.text, /^  source: direct$/m);
    assert.match(shown.text, /^  Map: never-placed$/m);
    const ambiguous = await cli(server, "show", AREA, "");
    assert.equal(ambiguous.exitCode, 1);

    // Place through the shared world pipeline, retry, then Hide and Restore idempotently.
    const placed = await cli(server, "place", AREA, oneId, "--operation-id", "brain-place-one", "--json");
    assert.equal(placed.exitCode, 0, placed.text);
    assert.equal(placed.json.representation, "on-map");
    assert.equal(placed.json.idempotent, false);
    const afterPlace = await vaultCommits(fixture);
    const placeRetry = await cli(server, "place", AREA, oneId, "--operation-id", "brain-place-one", "--json");
    assert.equal(placeRetry.exitCode, 0, placeRetry.text);
    assert.equal(placeRetry.json.idempotent, true);
    assert.deepEqual(placeRetry.json.sourceUpdates, placed.json.sourceUpdates, "the exact Place retry returns the committed source receipt");
    assert.equal(await vaultCommits(fixture), afterPlace);
    const placeAgain = await cli(server, "place", AREA, oneId, "--json");
    assert.equal(placeAgain.json.idempotent, true, "a second Place with a new operation is a no-op, never a second Block");
    assert.equal(await vaultCommits(fixture), afterPlace);
    for (const id of [twoId, threeId, linkId]) assert.equal((await cli(server, "place", AREA, id)).exitCode, 0);
    const placedFromChild = await cli(server, "place", CHILD, repositoryId, "--json");
    assert.equal(placedFromChild.exitCode, 0, placedFromChild.text);
    assert.deepEqual(placedFromChild.json.resource, { owner: "otto", id: repositoryId }, "an inherited resource is placed in its source Area");
    assert.ok(resourceRoot(await scene(fixture, "otto"), repositoryId), "the repository Block lives in the otto source scene");
    const tangentScene = await scene(fixture, AREA);
    for (const id of [oneId, twoId, threeId, linkId]) {
      const root = resourceRoot(tangentScene, id);
      assert.ok(root && root.isDeleted === false, `${id} has one visible Block`);
      assert.equal(root.id, `tangent-resource-${id}`);
    }
    const roots = [oneId, twoId, threeId, linkId].map((id) => resourceRoot(tangentScene, id));
    for (const [index, root] of roots.entries()) for (const other of roots.slice(index + 1)) {
      const apart = root.x + root.width <= other.x || other.x + other.width <= root.x || root.y + root.height <= other.y || other.y + other.height <= root.y;
      assert.ok(apart, `placed Blocks never overlap: ${JSON.stringify([root, other])}`);
    }

    const hidden = await cli(server, "hide", AREA, twoId, "--json");
    assert.equal(hidden.json.representation, "hidden");
    assert.equal(resourceRoot(await scene(fixture, AREA), twoId).isDeleted, true, "Hide retains the Block as deleted");
    const afterHide = await vaultCommits(fixture);
    assert.equal((await cli(server, "hide", AREA, twoId, "--json")).json.idempotent, true);
    assert.equal(await vaultCommits(fixture), afterHide);
    const restored = await cli(server, "restore", AREA, twoId, "--json");
    assert.equal(restored.json.representation, "on-map");
    assert.equal(resourceRoot(await scene(fixture, AREA), twoId).isDeleted, false);
    assert.equal((await cli(server, "restore", AREA, twoId, "--json")).json.idempotent, true);
    assert.equal((await cli(server, "check", AREA, twoId)).exitCode, 0);
    assert.match((await cli(server, "list", AREA)).text, new RegExp(`^  ${twoId.slice(0, 12)}  worktree  Two  \\[direct; on-map; available\\]$`, "m"));

    // Edit keeps identity; inherited rows refuse edits before any write; duplicates are refused by the catalog.
    const edited = await cli(server, "edit", AREA, oneId, "--label", "One renamed", "--json");
    assert.equal(edited.exitCode, 0, edited.text);
    assert.equal(edited.json.resource.locator.id, oneId);
    assert.equal(edited.json.resource.label, "One renamed");
    const beforeRefusals = await vaultCommits(fixture);
    const inheritedEdit = await cli(server, "edit", CHILD, repositoryId, "--label", "Nope", "--json");
    assert.equal(inheritedEdit.exitCode, 1);
    assert.match(inheritedEdit.json.error, /cannot edit inherited resource .*change it in otto/);
    const inheritedRemove = await cli(server, "remove", CHILD, repositoryId, "--json");
    assert.match(inheritedRemove.json.error, /cannot remove inherited resource/);
    const clash = await cli(server, "edit", AREA, oneId, "--path", fixture.worktrees.two, "--json");
    assert.equal(clash.json.code, "duplicate-resource-target");
    assert.equal(await vaultCommits(fixture), beforeRefusals, "refused edits never write the vault");

    // Check reports the observed local state of real worktrees and the missing provider reader for a link.
    const checked = await cli(server, "check", AREA, oneId, linkId);
    assert.equal(checked.exitCode, 0, checked.text);
    assert.match(checked.text, /^Checked 2 Map resources for otto\/tangent\.$/m);
    assert.match(checked.text, new RegExp(`^  ${oneId.slice(0, 12)}  worktree  One renamed  available$`, "m"));
    assert.match(checked.text, new RegExp(`^  ${linkId.slice(0, 12)}  link  PR 1  unavailable$`, "m"), "a link without a trusted reader is Status unavailable by design");
    const refreshed = await cli(server, "refresh", AREA, "--json");
    assert.equal(refreshed.json.resolutions.length, 5);
    assert.equal(refreshed.json.resolutions.find((item) => item.value.locator.id === oneId).value.local.value.checkout.branchRef, "refs/heads/feature/one");
    assert.equal(await vaultCommits(fixture), beforeRefusals, "checks never write the vault");

    // Remove tombstones the association, Undo restores it, and the Block never leaves the scene.
    const removed = await cli(server, "remove", AREA, threeId, "--json");
    assert.equal(removed.exitCode, 0, removed.text);
    assert.equal(removed.json.undo.state, "available");
    assert.equal((await catalog(fixture, AREA)).resources.find((record) => record.id === threeId).membership.state, "removed");
    assert.match((await cli(server, "list", AREA)).text, new RegExp(`^  ${threeId.slice(0, 12)}  worktree  \\S+  \\[direct; on-map; gone: removed\\]$`, "m"));
    assert.equal(resourceRoot(await scene(fixture, AREA), threeId).isDeleted, false, "Remove keeps the gone Block in place");
    const undone = await cli(server, "undo", AREA, removed.json.undo.token);
    assert.equal(undone.exitCode, 0, undone.text);
    assert.equal((await catalog(fixture, AREA)).resources.find((record) => record.id === threeId).membership.state, "active");
    assert.equal((await cli(server, "undo", AREA, removed.json.undo.token, "--json")).json.code, "undo-unavailable", "one Undo token applies once");

    // Every vault write is one exact transaction on a catalog or a Map source; no Area note ever changes.
    const touched = (await git(fixture.trees, "log", "--name-only", "--format=", `HEAD~${await vaultCommits(fixture) - baseline}..HEAD`)).split("\n").filter(Boolean);
    assert.ok(touched.length > 0);
    assert.ok(touched.every((file) => file.endsWith("/map-resources.json") || file.endsWith(".excalidraw")), `only catalogs and Map sources change: ${touched.join(", ")}`);
    assert.equal(await git(fixture.trees, "status", "--porcelain"), "", "the vault has no uncommitted resource bytes");
    assert.equal((await readFile(path.join(fixture.trees, "otto/tangent/tangent.md"), "utf8")).includes("## Resources\n\n"), true, "the Area note keeps its empty Resources section");
  } finally {
    await stopServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
