import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { areaCanvasPath, canvasHash, parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { createBlockElements, createEmptyScene, tangentOf } from "./public/area-board-core.js";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

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

/** Waits until one isolated production server responds or reports its early exit. */
async function waitForServer(base, child, output, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Agent Shell exited before readiness: ${output.join("")}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* startup can race the first connection */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Agent Shell did not start: ${output.join("")}`);
}

/** Stops one isolated server, escalating only to its exact child when needed. */
async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGKILL");
    await once(server.child, "exit");
  }
}

/** Creates a complete temporary Git vault with one child Area. */
async function createFixture({ scene = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resource-http-"));
  const trees = path.join(root, "trees");
  for (const area of ["otto", "otto/tangent"]) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nFixture Area.\n## Resources\n\n`, "utf8");
  }
  if (scene) {
    const source = path.join(trees, areaCanvasPath("otto/tangent"));
    await writeFile(source, serializeAreaCanvas(scene), "utf8");
  }
  await execFileAsync("git", ["-C", trees, "init", "--quiet"]);
  await execFileAsync("git", ["-C", trees, "config", "user.email", "resource-test@tangent.local"]);
  await execFileAsync("git", ["-C", trees, "config", "user.name", "Resource Test"]);
  await execFileAsync("git", ["-C", trees, "add", "."]);
  await execFileAsync("git", ["-C", trees, "commit", "--quiet", "-m", "add: resource fixture"]);
  return { root, trees };
}

/** Returns one source scene with a generic Link Block and bound shared label. */
function genericLinkScene() {
  const scene = createEmptyScene();
  scene.elements.push(...createBlockElements({
    id: "generic-review-link",
    kind: "link",
    ref: "HTTPS://Example.COM/review/17",
    title: "Generic review label",
    x: 90,
    y: 130,
    style: { strokeColor: "#c92a2a" },
  }));
  return scene;
}

/** Reads and validates the exact Area source scene in the temporary vault. */
async function readFixtureScene(fixture) {
  const file = path.join(fixture.trees, areaCanvasPath("otto/tangent"));
  const serialized = await readFile(file, "utf8");
  const parsed = parseAreaCanvas(serialized);
  assert.equal(parsed.ok, true, parsed.errors?.join("; "));
  return { file, serialized, hash: canvasHash(serialized), scene: parsed.scene };
}

/** Writes and commits one later authored source edit inside only the temporary vault. */
async function commitFixtureScene(fixture, scene, message) {
  const file = path.join(fixture.trees, areaCanvasPath("otto/tangent"));
  const serialized = serializeAreaCanvas(scene);
  await writeFile(file, serialized, "utf8");
  await execFileAsync("git", ["-C", fixture.trees, "add", "--", areaCanvasPath("otto/tangent")]);
  await execFileAsync("git", ["-C", fixture.trees, "commit", "--quiet", "-m", message]);
  return { serialized, hash: canvasHash(serialized) };
}

/** Returns the temporary vault's exact current Git revision. */
async function fixtureHead(fixture) {
  const { stdout } = await execFileAsync("git", ["-C", fixture.trees, "rev-parse", "HEAD"]);
  return stdout.trim();
}

/** Proves one operation produced exactly one commit containing every expected target. */
async function assertOneCommit(fixture, before, after, files) {
  const { stdout: count } = await execFileAsync("git", ["-C", fixture.trees, "rev-list", "--count", `${before}..${after}`]);
  assert.equal(Number(count.trim()), 1);
  const { stdout: changed } = await execFileAsync("git", ["-C", fixture.trees, "diff-tree", "--no-commit-id", "--name-only", "-r", after]);
  assert.deepEqual(changed.trim().split("\n").filter(Boolean).sort(), [...files].sort());
}

/** Starts the unmodified production server against only the temporary fixture roots. */
async function startServer(fixture) {
  const port = await freePort();
  assert.notEqual(port, 4321, "the fixture never binds the live Agent Shell port");
  const output = [];
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
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
      TANGENT_SHELL_INSTANCE_ID: `area-resource-http-${process.pid}`,
      CHAT_SESSION: `area-resource-http-${process.pid}`,
      GROQ_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, child, output);
  return { base, child, output };
}

/** Fetches one JSON route and preserves both HTTP status and typed payload. */
async function request(server, resource, body = undefined) {
  const response = await fetch(`${server.base}${resource}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, value: await response.json() };
}

/** Selects the exact catalog expectation for one owner from a panel response. */
function expectation(panel, owner) {
  const current = panel.catalogs.find((item) => item.owner === owner);
  assert.ok(current, `projection includes ${owner} revision`);
  return [current];
}

/** Builds one revision-fenced catalog mutation body. */
function mutation(operationId, projection, mutationValue) {
  const owner = mutationValue.owner ?? mutationValue.resource?.owner;
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: "otto/tangent",
    mutation: mutationValue,
    expectedCatalogs: expectation(projection, owner),
  };
}

/** Builds one revision- and scene-fenced source-coupled mutation body. */
function sourceMutation(operationId, projection, mutationValue, sourceHash) {
  const owner = mutationValue.owner ?? mutationValue.oldResource?.owner;
  return {
    schema: "area-map-resource-mutation.v1",
    operationId,
    viewedFrom: "otto/tangent",
    mutation: mutationValue,
    expectedCatalogs: expectation(projection, owner),
    expectedScenes: [{ owner, hash: sourceHash }],
  };
}

test("production routes commit catalog membership, shared Map representations, typed reads, and immediate Undo", async (context) => {
  const fixture = await createFixture();
  let server = null;
  context.after(async () => {
    await stopServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  });
  server = await startServer(fixture);

  const initial = await request(server, "/api/areas/map-resources?area=otto%2Ftangent");
  assert.equal(initial.status, 200);
  assert.equal(initial.value.state, "current");
  assert.deepEqual(initial.value.rows, []);

  const inspected = await request(server, "/api/areas/map-resources/inspect-target", { kind: "worktree", path: fixture.trees });
  assert.equal(inspected.status, 200);
  assert.deepEqual(inspected.value.normalized, { kind: "worktree", path: fixture.trees });
  assert.equal(inspected.value.state, "available");

  const added = await request(server, "/api/areas/map-resources/apply", mutation("http-add-1", initial.value, {
    kind: "add",
    owner: "otto/tangent",
    input: { target: inspected.value.normalized, missingConfirmation: null },
    label: "Feature checkout",
  }));
  assert.equal(added.status, 200, JSON.stringify(added.value));
  assert.equal(added.value.undo.state, "available");
  const locator = added.value.resource.locator;
  assert.deepEqual(locator.owner, "otto/tangent");

  const listed = await request(server, "/api/areas/map-resources?area=otto%2Ftangent");
  assert.equal(listed.value.rows[0].entity.label, "Feature checkout");
  assert.equal(listed.value.rows[0].entity.representation.value, "never-placed");
  assert.equal(listed.value.rows[0].entity.local.state, "not-checked", "GET starts no local Git observation");

  const shown = await request(server, "/api/areas/show?area=otto%2Ftangent");
  assert.deepEqual(shown.value.mapResources, {
    state: "current",
    rows: [{ locator, label: "Feature checkout", target: { kind: "worktree", path: fixture.trees }, source: { kind: "direct" }, origin: null }],
  });
  assert.equal(shown.value.resources, "", "legacy Resources prose is unchanged");
  assert.equal(shown.value.workFolder, null, "legacy launch selection is unchanged");

  const place = await request(server, "/api/areas/map-resources/representation", {
    schema: "area-map-resource-representation.v1",
    operationId: "http-place-1",
    kind: "place",
    viewedFrom: "otto/tangent",
    resource: locator,
  });
  assert.equal(place.status, 200, JSON.stringify(place.value));
  assert.equal(place.value.representation, "on-map");
  assert.equal(place.value.sourceUpdates.length, 1);

  const hide = await request(server, "/api/areas/map-resources/representation", {
    schema: "area-map-resource-representation.v1",
    operationId: "http-hide-1",
    kind: "hide",
    viewedFrom: "otto/tangent",
    resource: locator,
  });
  assert.equal(hide.status, 200, JSON.stringify(hide.value));
  assert.equal(hide.value.representation, "hidden");
  assert.equal((await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value.rows[0].entity.representation.value, "hidden");

  const restore = await request(server, "/api/areas/map-resources/representation", {
    schema: "area-map-resource-representation.v1",
    operationId: "http-restore-1",
    kind: "restore",
    viewedFrom: "otto/tangent",
    resource: locator,
  });
  assert.equal(restore.status, 200, JSON.stringify(restore.value));
  assert.equal(restore.value.sourceId, place.value.sourceId, "Restore retains the canonical Block identity");

  const beforeRemove = (await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value;
  const removed = await request(server, "/api/areas/map-resources/apply", mutation("http-remove-1", beforeRemove, { kind: "remove", resource: locator }));
  assert.equal(removed.status, 200, JSON.stringify(removed.value));
  assert.equal(removed.value.undo.state, "available");
  const gone = (await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value.rows[0].entity;
  assert.equal(gone.reason, "removed");
  assert.equal(gone.representation, "on-map");

  const undone = await request(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId: "http-undo-1",
    viewedFrom: "otto/tangent",
    mutation: { kind: "undo", token: removed.value.undo.token },
  });
  assert.equal(undone.status, 200, JSON.stringify(undone.value));
  assert.equal((await request(server, "/api/areas/map-resources?area=otto%2Ftangent")).value.rows[0].entity.label, "Feature checkout");

  const catalog = JSON.parse(await readFile(path.join(fixture.trees, "otto", "tangent", "map-resources.json"), "utf8"));
  assert.equal(catalog.resources[0].membership.state, "active");
  const { stdout: log } = await execFileAsync("git", ["-C", fixture.trees, "log", "--format=%s"]);
  assert.match(log, /add: otto\/tangent Map resource/);
  assert.match(log, /update: otto\/tangent undo Map resource/);
  assert.match(log, /place Map resource/);
  assert.doesNotMatch(server.output.join(""), /4321/, "the isolated proof never reports the live port");
});

test("production apply atomically associates a generic Link, replays, semantically undoes, and adds back its tombstone", async (context) => {
  const fixture = await createFixture({ scene: genericLinkScene() });
  let server = null;
  context.after(async () => {
    await stopServer(server);
    await rm(fixture.root, { recursive: true, force: true });
  });
  server = await startServer(fixture);

  const initialPanel = await request(server, "/api/areas/map-resources?area=otto%2Ftangent");
  assert.equal(initialPanel.status, 200, JSON.stringify(initialPanel.value));
  const initialSource = await readFixtureScene(fixture);
  const beforeAssociation = await fixtureHead(fixture);
  const associationBody = sourceMutation("http-associate-link-1", initialPanel.value, {
    kind: "associate-generic-link",
    owner: "otto/tangent",
    sourceElementId: "generic-review-link",
    labelForNewRecord: "Review 17",
  }, initialSource.hash);
  const associated = await request(server, "/api/areas/map-resources/apply", associationBody);
  assert.equal(associated.status, 200, JSON.stringify(associated.value));
  assert.equal(associated.value.effect, "associate-generic-link");
  assert.equal(associated.value.undo.state, "available");
  const associatedLocator = associated.value.resource.locator;
  const afterAssociation = await fixtureHead(fixture);
  await assertOneCommit(fixture, beforeAssociation, afterAssociation, [
    "otto/tangent/map-resources.json",
    "otto/tangent/tangent.excalidraw",
  ]);

  const associatedSource = await readFixtureScene(fixture);
  assert.equal(associated.value.sourceUpdates.length, 1);
  assert.equal(associated.value.sourceUpdates[0].serializedSource, associatedSource.serialized);
  assert.equal(associated.value.sourceUpdates[0].hash, associatedSource.hash);
  assert.equal(canvasHash(associated.value.sourceUpdates[0].serializedSource), associated.value.sourceUpdates[0].hash);
  assert.ok(associated.value.sourceUpdates[0].treeRevision);
  assert.ok(associated.value.sourceUpdates[0].worldRevision);
  const associatedWorld = await request(server, "/api/areas/map-world?located=otto%2Ftangent");
  assert.equal(associatedWorld.status, 200, JSON.stringify(associatedWorld.value));
  assert.equal(associated.value.sourceUpdates[0].treeRevision, associatedWorld.value.treeRevision);
  assert.equal(associated.value.sourceUpdates[0].worldRevision, associatedWorld.value.worldRevision);
  const associatedRoot = associatedSource.scene.elements.find((element) => element.id === "generic-review-link");
  assert.deepEqual(tangentOf(associatedRoot), { kind: "resource", ref: associatedLocator.id });
  const associatedCatalog = JSON.parse(await readFile(path.join(fixture.trees, "otto", "tangent", "map-resources.json"), "utf8"));
  assert.equal(associatedCatalog.resources[0].id, associatedLocator.id);
  assert.equal(associatedCatalog.resources[0].label, "Review 17");
  assert.deepEqual(associatedCatalog.resources[0].target, { kind: "link", url: "HTTPS://example.com/review/17" });

  const replayed = await request(server, "/api/areas/map-resources/apply", associationBody);
  assert.equal(replayed.status, 200, JSON.stringify(replayed.value));
  assert.equal(replayed.value.idempotent, true);
  assert.deepEqual(replayed.value.resource.locator, associatedLocator);
  assert.equal(replayed.value.undo.token, associated.value.undo.token);
  assert.equal(replayed.value.sourceUpdates[0].serializedSource, associatedSource.serialized);
  assert.equal(await fixtureHead(fixture), afterAssociation, "a committed replay adds no Git commit");

  const laterScene = structuredClone(associatedSource.scene);
  const laterRoot = laterScene.elements.find((element) => element.id === "generic-review-link");
  laterRoot.x = 713;
  laterRoot.strokeColor = "#1971c2";
  laterRoot.customData.laterAuthoredFact = { retained: true };
  await commitFixtureScene(fixture, laterScene, "update: later resource layout");
  const beforeUndo = await fixtureHead(fixture);
  const undone = await request(server, "/api/areas/map-resources/apply", {
    schema: "area-map-resource-mutation.v1",
    operationId: "http-undo-association-1",
    viewedFrom: "otto/tangent",
    mutation: { kind: "undo", token: associated.value.undo.token },
  });
  assert.equal(undone.status, 200, JSON.stringify(undone.value));
  const afterUndo = await fixtureHead(fixture);
  await assertOneCommit(fixture, beforeUndo, afterUndo, [
    "otto/tangent/map-resources.json",
    "otto/tangent/tangent.excalidraw",
  ]);
  const undoneSource = await readFixtureScene(fixture);
  assert.equal(undone.value.sourceUpdates[0].serializedSource, undoneSource.serialized);
  assert.equal(undone.value.sourceUpdates[0].hash, undoneSource.hash);
  assert.ok(undone.value.sourceUpdates[0].treeRevision);
  assert.ok(undone.value.sourceUpdates[0].worldRevision);
  const undoneRoot = undoneSource.scene.elements.find((element) => element.id === "generic-review-link");
  assert.deepEqual(tangentOf(undoneRoot), { kind: "link", ref: "HTTPS://Example.COM/review/17" });
  assert.equal(undoneRoot.x, 713);
  assert.equal(undoneRoot.strokeColor, "#1971c2");
  assert.deepEqual(undoneRoot.customData.laterAuthoredFact, { retained: true });
  const tombstonedCatalog = JSON.parse(await readFile(path.join(fixture.trees, "otto", "tangent", "map-resources.json"), "utf8"));
  assert.equal(tombstonedCatalog.resources[0].id, associatedLocator.id);
  assert.equal(tombstonedCatalog.resources[0].membership.state, "removed");

  const goneScene = structuredClone(undoneSource.scene);
  const goneRoot = goneScene.elements.find((element) => element.id === "generic-review-link");
  goneRoot.customData = { ...goneRoot.customData, tangent: { kind: "resource", ref: associatedLocator.id } };
  const goneSource = await commitFixtureScene(fixture, goneScene, "update: retain gone resource Block");
  const gonePanel = await request(server, "/api/areas/map-resources?area=otto%2Ftangent");
  assert.equal(gonePanel.status, 200, JSON.stringify(gonePanel.value));
  assert.equal(gonePanel.value.rows.find((row) => row.entity.locator.id === associatedLocator.id).entity.reason, "removed");
  const beforeAddBack = await fixtureHead(fixture);
  const addedBack = await request(server, "/api/areas/map-resources/apply", sourceMutation("http-add-back-1", gonePanel.value, {
    kind: "add-back-gone",
    oldResource: associatedLocator,
    source: { kind: "tombstone" },
  }, goneSource.hash));
  assert.equal(addedBack.status, 200, JSON.stringify(addedBack.value));
  assert.equal(addedBack.value.effect, "add-back-gone");
  assert.notEqual(addedBack.value.resource.locator.id, associatedLocator.id);
  assert.equal(addedBack.value.resource.label, "Review 17");
  const afterAddBack = await fixtureHead(fixture);
  await assertOneCommit(fixture, beforeAddBack, afterAddBack, [
    "otto/tangent/map-resources.json",
    "otto/tangent/tangent.excalidraw",
  ]);
  const addedBackSource = await readFixtureScene(fixture);
  assert.equal(addedBack.value.sourceUpdates[0].serializedSource, addedBackSource.serialized);
  assert.equal(addedBack.value.sourceUpdates[0].hash, addedBackSource.hash);
  assert.ok(addedBack.value.sourceUpdates[0].treeRevision);
  assert.ok(addedBack.value.sourceUpdates[0].worldRevision);
  assert.deepEqual(tangentOf(addedBackSource.scene.elements.find((element) => element.id === "generic-review-link")), {
    kind: "resource",
    ref: addedBack.value.resource.locator.id,
  });
  const addedBackCatalog = JSON.parse(await readFile(path.join(fixture.trees, "otto", "tangent", "map-resources.json"), "utf8"));
  assert.equal(addedBackCatalog.resources.find((record) => record.id === associatedLocator.id).membership.state, "removed");
  assert.equal(addedBackCatalog.resources.find((record) => record.id === addedBack.value.resource.locator.id).membership.state, "active");
  assert.doesNotMatch(server.output.join(""), /4321/, "the isolated proof never reports the live port");
});
