import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serializeAreaCanvas } from "./area-canvas.mjs";
import { createAreaCanvasRepository } from "./area-canvas-repository.mjs";
import { createAreaMapTransactionRepository } from "./area-map-transaction-repository.mjs";
import { createVaultRepository } from "./vault-repository.mjs";
import { createBlockElements, createEmptyScene, createRegionElements } from "./public/area-board-core.js";
import { composeAreaMapWorld } from "./public/area-map-world-core.js";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const enabled = process.env.TANGENT_LIVE_SERVICE_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

/** Runs one Git command against a fixture repository. */
function runGit(args, options = {}) {
  return execFileAsync("git", args, { encoding: "utf8", ...options });
}

/** Reserves one local port and releases the reservation. */
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

/** Waits until one production server returns its shell page. */
async function waitForServer(base, child, output, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Agent Shell exited before readiness: ${output.join("")}`);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Agent Shell did not start at ${base}: ${output.join("")}`);
}

/** Starts the unmodified production server against one isolated vault. */
async function startServer(fixture, suffix) {
  const port = await freePort();
  const output = [];
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: fixture.trees,
      WORKSPACE: path.join(fixture.root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_SHELL_INSTANCE_ID: `area-map-live-${process.pid}-${suffix}`,
      TANGENT_LOOPS_ROOT: path.join(fixture.root, "loops"),
      TANGENT_PIPELINES_ROOT: path.join(fixture.root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(fixture.root, "brains"),
      TANGENT_SESSION_OWNERS_ROOT: path.join(fixture.root, "session-owners"),
      TANGENT_CONTINUATIONS_ROOT: path.join(fixture.root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(fixture.root, "goal-cleanups"),
      TANGENT_ARMED_ROOT: path.join(fixture.root, "armed"),
      TANGENT_MAP_STATE_ROOT: fixture.mapState,
      TANGENT_PRESENTATIONS_ROOT: path.join(fixture.root, "presented"),
      AGENT_MESSAGE_LOG: path.join(fixture.root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `area-map-live-${process.pid}-${suffix}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, child, output);
  return { base, child, output };
}

/** Reports whether one fixture server process has stopped for any reason. */
function childStopped(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Waits up to two seconds for one fixture server process to stop. */
async function waitForChildStop(child) {
  for (let attempt = 0; attempt < 80 && !childStopped(child); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Stops one fixture server without involving the live port 4321 service. */
async function stopServer(server) {
  if (!server || childStopped(server.child)) return;
  server.child.kill("SIGTERM");
  await waitForChildStop(server.child);
  if (!childStopped(server.child)) {
    server.child.kill("SIGKILL");
    await waitForChildStop(server.child);
  }
}

/** Writes one source Area scene at its canonical rollback-compatible path. */
async function writeScene(trees, owner, scene) {
  const directory = path.join(trees, ...owner.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${owner.split("/").at(-1)}.excalidraw`), serializeAreaCanvas(scene));
}

/** Adds one stored direct-child region and its source label. */
function addRegion(scene, options) {
  scene.elements.push(...createRegionElements({
    ...options,
    layout: options.layout ?? { schema: "area-placement.v1", priority: 0, overlapWith: [] },
  }));
}

/** Creates a sibling-rich 41-Area tree with one four-level branch. */
async function createMigrationVault(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `area-map-live-${name}-`));
  const trees = path.join(root, "trees");
  const mapState = path.join(root, "map-state");
  const coreAreas = [
    "neara", "neara/delivery", "neara/delivery/operations", "neara/delivery/standards",
    "neara/delivery/standards/controls", "neara/delivery/standards/guides",
    "neara/hackathon", "neara/hackathon/proof", "otto", "otto/tangent",
  ];
  const areas = [...coreAreas, ...Array.from({ length: 31 }, (_, index) => `otto/area-${String(index + 1).padStart(2, "0")}`)].sort();
  for (const area of areas) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nFixture Area.\n`);
  }

  const rootScene = createEmptyScene();
  addRegion(rootScene, { id: "root-neara", ref: "neara/neara.md", title: "Neara", x: 80, y: 80, width: 2300, height: 1200 });
  addRegion(rootScene, { id: "root-otto", ref: "otto/otto.md", title: "Otto", x: 2440, y: 80, width: 1100, height: 900 });
  const near = createEmptyScene();
  addRegion(near, { id: "delivery-region", ref: "neara/delivery/delivery.md", title: "Delivery", x: 100, y: 100, width: 1580, height: 900 });
  addRegion(near, { id: "hackathon-region", ref: "neara/hackathon/hackathon.md", title: "Hackathon", x: 1740, y: 100, width: 500, height: 700 });
  const delivery = createEmptyScene();
  addRegion(delivery, { id: "standards-region", ref: "neara/delivery/standards/standards.md", title: "Standards", x: 120, y: 120, width: 940, height: 600 });
  addRegion(delivery, { id: "operations-region", ref: "neara/delivery/operations/operations.md", title: "Operations", x: 1120, y: 120, width: 400, height: 500 });
  const standards = createEmptyScene();
  addRegion(standards, { id: "controls-region", ref: "neara/delivery/standards/controls/controls.md", title: "Controls", x: 100, y: 100, width: 420, height: 300 });
  addRegion(standards, { id: "guides-region", ref: "neara/delivery/standards/guides/guides.md", title: "Guides", x: 580, y: 100, width: 300, height: 260 });
  const controls = createEmptyScene();
  controls.elements.push(...createBlockElements({ id: "controls-document", kind: "document", ref: "neara/delivery/standards/controls/design-proof.md", title: "Proof", x: 80, y: 80, width: 180, height: 100 }));
  const guides = createEmptyScene();
  const operations = createEmptyScene();
  const hackathon = createEmptyScene();
  addRegion(hackathon, { id: "proof-region", ref: "neara/hackathon/proof/proof.md", title: "Proof", x: 80, y: 80, width: 340, height: 260 });
  const proof = createEmptyScene();
  const otto = createEmptyScene();
  addRegion(otto, { id: "tangent-region", ref: "otto/tangent/tangent.md", title: "Tangent", x: 80, y: 80, width: 680, height: 460 });
  const tangent = createEmptyScene();
  await writeScene(trees, "@root", rootScene);
  await writeScene(trees, "neara", near);
  await writeScene(trees, "neara/delivery", delivery);
  await writeScene(trees, "neara/delivery/operations", operations);
  await writeScene(trees, "neara/delivery/standards", standards);
  await writeScene(trees, "neara/delivery/standards/controls", controls);
  await writeScene(trees, "neara/delivery/standards/guides", guides);
  await writeScene(trees, "neara/hackathon", hackathon);
  await writeScene(trees, "neara/hackathon/proof", proof);
  await writeScene(trees, "otto", otto);
  await writeScene(trees, "otto/tangent", tangent);

  await runGit(["-C", trees, "init", "--quiet"]);
  await runGit(["-C", trees, "config", "user.email", "test@tangent.local"]);
  await runGit(["-C", trees, "config", "user.name", "Tangent Test"]);
  await runGit(["-C", trees, "add", "."]);
  await runGit(["-C", trees, "commit", "--quiet", "-m", "add: sibling-rich Area map fixture"]);
  return { root, trees, mapState, areas };
}

/** Fetches one JSON response and preserves useful errors. */
async function json(base, resource, options) {
  const response = await fetch(`${base}${resource}`, options);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${value.error ?? JSON.stringify(value)}`);
  return value;
}

/** Mounts the actual production Area-board persistence adapter in one page. */
async function mountLiveWorld(page, base, { navigate = true } = {}) {
  if (navigate) await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="live-map" style="position:fixed;inset:0"></div>';
    /** Calls one production JSON route from the browser fixture. */
    const api = async (resource, options = {}) => {
      const response = await fetch(resource, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.error ?? `HTTP ${response.status}`), { status: response.status, ...value });
      return value;
    };
    const world = await api("/api/areas/map-world?located=neara");
    const documents = world.areas.map((node) => ({ kind: "area", area: node.key, title: node.key.split("/").at(-1).replace(/^./, (letter) => letter.toUpperCase()), status: "active" }));
    const { mountWorld } = await import("/area-board.js");
    window.liveWorld = world;
    /** Returns the current fixture facts to the mounted editor. */
    const getDocuments = () => documents;
    /** Keeps the isolated fixture on its current page. */
    const onBack = () => {};
    window.liveEvents = [];
    /** Captures the public production diagnostics for pointer assertions. */
    const onEvent = (event) => window.liveEvents.push(event);
    window.liveEditor = mountWorld(document.querySelector("#live-map"), { world, getDocuments, api, onBack, onEvent, focus: { only: false, activeOnly: false, areas: [] } });
  });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.liveEditor?.current?.()?.elements?.length);
  await page.waitForFunction(() => window.liveEditor?.rendered?.()?.length);
  await page.evaluate(() => window.liveEditor.toggleRestriction("neara"));
  await page.waitForFunction(() => window.liveEditor.rendered()?.some((element) => element.customData?.tangent?.area === "otto"));
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}

/** Reads controller-projected world-space region rectangles. */
async function currentRegions(page) {
  return page.evaluate(() => Object.fromEntries(window.liveEditor.current().elements
    .filter((element) => element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
}

/** Reads the elements held by the actual mounted Excalidraw scene. */
async function renderedRegions(page) {
  return page.evaluate(() => Object.fromEntries((window.liveEditor.rendered() ?? [])
    .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
}

/** Converts one relative Area point to Excalidraw's browser coordinates. */
async function areaScreenPoint(page, area, horizontal, vertical) {
  return page.evaluate(({ target, horizontalRatio, verticalRatio }) => {
    const regions = Object.fromEntries(window.liveEditor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region").map((element) => [element.customData.tangent.area, element]));
    const parent = target.slice(0, target.lastIndexOf("/"));
    const region = regions[target]; const parentRegion = regions[parent];
    const label = document.querySelector(`[data-area-map-label="${target}"]`);
    const parentLabel = document.querySelector(`[data-area-map-label="${parent}"]`);
    const left = Number.parseFloat(label.style.left) - 12; const top = Number.parseFloat(label.style.top) - 10;
    const parentLeft = Number.parseFloat(parentLabel.style.left) - 12; const parentTop = Number.parseFloat(parentLabel.style.top) - 10;
    const zoom = Math.abs(region.x - parentRegion.x) > 0.01
      ? (left - parentLeft) / (region.x - parentRegion.x)
      : (top - parentTop) / (region.y - parentRegion.y);
    const scrollX = left / zoom - region.x;
    const scrollY = top / zoom - region.y;
    const canvas = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    return {
      x: canvas.x + (region.x + region.width * horizontalRatio + scrollX) * zoom,
      y: canvas.y + (region.y + region.height * verticalRatio + scrollY) * zoom,
      zoom,
    };
  }, { target: area, horizontalRatio: horizontal, verticalRatio: vertical });
}

/** Derives the literal south-east Excalidraw corner from rendered labels. */
const southEastHandle = (page, area) => areaScreenPoint(page, area, 1, 1);

/** Captures actual Excalidraw geometry in the first RAF after the next move. */
async function captureFirstPointerFrame(page) {
  await page.evaluate(() => {
    window.firstAreaMapPointerFrame = new Promise((resolve) => {
      document.querySelector(".excalidraw canvas.interactive").addEventListener("pointermove", () => requestAnimationFrame(() => {
        resolve(Object.fromEntries((window.liveEditor.rendered() ?? [])
          .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
          .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
      }), { once: true });
    });
  });
}

/** Waits for and returns the captured first pointer frame. */
async function firstPointerFrame(page) {
  return page.evaluate(() => window.firstAreaMapPointerFrame);
}

/** Asserts the continuous structural containment invariant through the deep branch. */
function assertContainment(regions) {
  for (const [childKey, parentKey] of [
    ["neara/delivery/standards/controls", "neara/delivery/standards"],
    ["neara/delivery/standards", "neara/delivery"],
    ["neara/delivery", "neara"],
  ]) {
    const child = regions[childKey]; const parent = regions[parentKey];
    assert.ok(child && parent, `${childKey} and ${parentKey} are rendered`);
    assert.ok(child.x >= parent.x - 0.01 && child.y >= parent.y - 0.01, `${childKey} starts inside ${parentKey}`);
    assert.ok(child.x + child.width + 60 <= parent.x + parent.width + 0.01, `${parentKey} contains the right edge of ${childKey}`);
    assert.ok(child.y + child.height + 60 <= parent.y + parent.height + 0.01, `${parentKey} contains the bottom edge of ${childKey}`);
  }
}

/** Asserts that two selected geometry snapshots do not differ. */
function assertSameGeometry(actual, expected, areas, message) {
  for (const area of areas) for (const field of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(actual[area][field] - expected[area][field]) <= 0.01, `${message}: ${area} ${field}`);
  }
}

/** Asserts that every structural HTML label uses the resolved Area origin. */
async function assertLabelsMatch(page, regions, areas, message) {
  const labels = await page.evaluate(({ targets, boxes }) => {
    const anchor = targets[0];
    const parent = anchor.slice(0, anchor.lastIndexOf("/"));
    const anchorLabel = document.querySelector(`[data-area-map-label="${anchor}"]`);
    const parentLabel = document.querySelector(`[data-area-map-label="${parent}"]`);
    const left = Number.parseFloat(anchorLabel.style.left) - 12;
    const top = Number.parseFloat(anchorLabel.style.top) - 10;
    const parentLeft = Number.parseFloat(parentLabel.style.left) - 12;
    const parentTop = Number.parseFloat(parentLabel.style.top) - 10;
    const zoom = Math.abs(boxes[anchor].x - boxes[parent].x) > 0.01
      ? (left - parentLeft) / (boxes[anchor].x - boxes[parent].x)
      : (top - parentTop) / (boxes[anchor].y - boxes[parent].y);
    const scrollX = left / zoom - boxes[anchor].x;
    const scrollY = top / zoom - boxes[anchor].y;
    return Object.fromEntries(targets.map((area) => {
      const label = document.querySelector(`[data-area-map-label="${area}"]`);
      return [area, label ? {
        x: (Number.parseFloat(label.style.left) - 12) / zoom - scrollX,
        y: (Number.parseFloat(label.style.top) - 10) / zoom - scrollY,
      } : null];
    }));
  }, { targets: areas, boxes: regions });
  for (const area of areas) {
    assert.ok(labels[area], `${message}: ${area} has a structural label`);
    assert.ok(Math.abs(labels[area].x - regions[area].x) <= 0.01, `${message}: ${area} label x`);
    assert.ok(Math.abs(labels[area].y - regions[area].y) <= 0.01, `${message}: ${area} label y`);
  }
}

/** Returns the exact source intent for structural records touched by reflow. */
async function persistedStructuralIntent(fixture) {
  const repository = createAreaCanvasRepository({
    root: fixture.trees, runGit,
    transactionRoot: path.join(fixture.mapState, "read-only-transactions"),
  });
  const [root, near, delivery, standards] = await Promise.all([
    repository.read("@root"), repository.read("neara"),
    repository.read("neara/delivery"), repository.read("neara/delivery/standards"),
  ]);
  /** Selects persisted geometry and layout without display-only fields. */
  const intent = (scene, id) => {
    const element = scene.elements.find((candidate) => candidate.id === id);
    return {
      x: element.x, y: element.y, width: element.width, height: element.height,
      layout: element.customData?.tangent?.layout ?? null,
    };
  };
  return {
    controls: intent(standards.scene, "controls-region"),
    guides: intent(standards.scene, "guides-region"),
    standards: intent(delivery.scene, "standards-region"),
    operations: intent(delivery.scene, "operations-region"),
    delivery: intent(near.scene, "delivery-region"),
    hackathon: intent(near.scene, "hackathon-region"),
    neara: intent(root.scene, "root-neara"),
    otto: intent(root.scene, "root-otto"),
  };
}

/** Asserts that derived reflow did not leak into unrelated source rectangles. */
function assertDerivedIntentStayedDerived(intent) {
  const layout = { schema: "area-placement.v1", priority: 0, overlapWith: [] };
  assert.deepEqual(intent.guides, { x: 580, y: 100, width: 300, height: 260, layout });
  assert.deepEqual(intent.standards, { x: 120, y: 120, width: 940, height: 600, layout });
  assert.deepEqual(intent.operations, { x: 1120, y: 120, width: 400, height: 500, layout });
  assert.deepEqual(intent.delivery, { x: 100, y: 100, width: 1580, height: 900, layout });
  assert.deepEqual(intent.hackathon, { x: 1740, y: 100, width: 500, height: 700, layout });
  assert.deepEqual(intent.neara, { x: 80, y: 80, width: 2300, height: 1200, layout });
  assert.deepEqual(intent.otto, { x: 2440, y: 80, width: 1100, height: 900, layout });
}

/** Lists the source files in the fixture's most recent command commit. */
async function lastCommitFiles(trees) {
  const result = await runGit(["-C", trees, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
  return String(result.stdout).trim().split("\n").filter(Boolean).sort();
}

/** Reads the sole durable transaction manifest in one fixture. */
async function transactionManifest(transactionRoot) {
  const worlds = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const operations = await readdir(path.join(transactionRoot, worlds[0].name));
  return JSON.parse(await readFile(path.join(transactionRoot, worlds[0].name, operations[0], "manifest.json"), "utf8"));
}

test("deep SE resize, move, and NW resize render hierarchy reflow before they persist", { skip: !enabled, timeout: 120_000 }, async (context) => {
  const fixture = await createMigrationVault("crossing");
  let server = null; let browser = null;
  context.after(async () => { await browser?.close(); await stopServer(server); await rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  server = await startServer(fixture, "crossing-1");
  const beforeCommit = String((await runGit(["-C", fixture.trees, "rev-parse", "HEAD"])).stdout).trim();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await mountLiveWorld(page, server.base);
  const target = "neara/delivery/standards/controls";
  const ancestors = ["neara/delivery/standards", "neara/delivery", "neara"];
  const siblings = ["neara/delivery/standards/guides", "neara/delivery/operations", "neara/hackathon", "otto"];
  const proofAreas = [target, ...ancestors, ...siblings];
  const before = await renderedRegions(page);
  await page.getByRole("button", { name: /^Controls, child of Neara \/ Delivery \/ Standards, depth 4/ }).evaluate((button) => button.click());
  await page.evaluate((area) => window.liveEditor.fitArea(area, { push: false, select: true }), target);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const start = await southEastHandle(page, target);
  await page.mouse.move(start.x, start.y); await page.waitForTimeout(80); await page.mouse.down();
  await captureFirstPointerFrame(page);
  await page.mouse.move(start.x + 300 * start.zoom, start.y + 180 * start.zoom);
  const preview = await firstPointerFrame(page);
  const pointerDown = await page.evaluate(() => window.liveEvents.filter((event) => event.name === "area_map_pointer_down").at(-1));
  assert.equal(pointerDown?.command, "resize", "the production callback recognizes a resize command");
  assert.equal(pointerDown?.handle, "se", "the literal corner reaches Excalidraw's south-east handle");
  assert.ok(preview[target].width > before[target].width + 250, "the selected deep Area expands horizontally in the first frame");
  assert.ok(preview[target].height > before[target].height + 130, "the selected deep Area expands vertically in the first frame");
  for (const area of ancestors) assert.ok(preview[area].width > before[area].width + 250, `${area} expands in the same rendered frame`);
  for (const area of siblings) {
    const travel = Math.abs(preview[area].x - before[area].x) + Math.abs(preview[area].y - before[area].y);
    assert.ok(travel > 250, `${area} reflows instead of clipping the resize`);
  }
  assertContainment(preview);
  assertSameGeometry(await currentRegions(page), preview, proofAreas, "the controller and rendered first frame agree");
  await assertLabelsMatch(page, preview, proofAreas, "the first resize frame keeps labels in the resolved snapshot");
  await page.mouse.up();
  const released = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(Object.fromEntries((window.liveEditor.rendered() ?? [])
      .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
      .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
  }))));
  assertSameGeometry(released, preview, proofAreas, "release does not snap the rendered layout back");
  await page.evaluate(() => window.liveEditor.flush());
  await page.getByText("Saved", { exact: true }).waitFor();
  assertSameGeometry(await renderedRegions(page), preview, proofAreas, "the saved scene keeps the release geometry");
  assert.equal(await page.locator(".tangent-map-save").count(), 1, "the map prints one save word");
  assert.equal(String((await runGit(["-C", fixture.trees, "rev-list", "--count", `${beforeCommit}..HEAD`])).stdout).trim(), "1", "one pointer command makes one Git commit");
  assert.deepEqual(await lastCommitFiles(fixture.trees), ["neara/delivery/standards/standards.excalidraw"], "resize persists only the selected Area's parent shard");
  const resizedIntent = await persistedStructuralIntent(fixture);
  assert.deepEqual(resizedIntent.controls, {
    x: 100, y: 100, width: 720, height: 480,
    layout: { schema: "area-placement.v1", priority: 1, overlapWith: [] },
  }, "resize persists the exact selected region and placement priority");
  assertDerivedIntentStayedDerived(resizedIntent);

  await page.reload({ waitUntil: "networkidle" });
  await mountLiveWorld(page, server.base, { navigate: false });
  const reloaded = await renderedRegions(page);
  assertSameGeometry(reloaded, preview, proofAreas, "browser reload recomputes the same rendered layout");
  assertContainment(reloaded);

  await page.getByRole("button", { name: /^Controls, child of Neara \/ Delivery \/ Standards, depth 4/ }).evaluate((button) => button.click());
  await page.evaluate((area) => window.liveEditor.fitArea(area, { push: false, select: true }), target);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const moveStart = await areaScreenPoint(page, target, 0.5, 0.75);
  await page.mouse.move(moveStart.x, moveStart.y); await page.waitForTimeout(80); await page.mouse.down();
  await captureFirstPointerFrame(page);
  await page.mouse.move(moveStart.x, moveStart.y + 320 * moveStart.zoom);
  const movePreview = await firstPointerFrame(page);
  const movePointerDown = await page.evaluate(() => window.liveEvents.filter((event) => event.name === "area_map_pointer_down").at(-1));
  assert.equal(movePointerDown?.command, "move", "the production callback recognizes the interior Area move");
  assert.equal(movePointerDown?.handle, null, "the Area move has no resize handle");
  assert.ok(movePreview[target].y > reloaded[target].y + 300, "the selected Area follows the exact downward pointer intent");
  for (const area of ancestors) {
    const extentChange = Math.abs(movePreview[area].width - reloaded[area].width) + Math.abs(movePreview[area].height - reloaded[area].height);
    assert.ok(extentChange > 200, `${area} reflows around the moved descendant in the first rendered frame`);
  }
  for (const area of siblings) {
    const travel = Math.abs(movePreview[area].x - reloaded[area].x) + Math.abs(movePreview[area].y - reloaded[area].y);
    assert.ok(travel > 250, `${area} reflows around the moved branch`);
  }
  assertContainment(movePreview);
  assertSameGeometry(await currentRegions(page), movePreview, proofAreas, "the controller and rendered move frame agree");
  await assertLabelsMatch(page, movePreview, proofAreas, "the first move frame keeps labels in the resolved snapshot");
  await page.mouse.up();
  const movedRelease = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(Object.fromEntries((window.liveEditor.rendered() ?? [])
      .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
      .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
  }))));
  assertSameGeometry(movedRelease, movePreview, proofAreas, "Area move release does not snap the rendered layout back");
  await page.evaluate(() => window.liveEditor.flush());
  await page.getByText("Saved", { exact: true }).waitFor();
  assertSameGeometry(await renderedRegions(page), movePreview, proofAreas, "the saved scene keeps the moved geometry");
  assert.equal(String((await runGit(["-C", fixture.trees, "rev-list", "--count", `${beforeCommit}..HEAD`])).stdout).trim(), "2", "resize and move make two command commits");
  assert.deepEqual(await lastCommitFiles(fixture.trees), ["neara/delivery/standards/standards.excalidraw"], "move persists only the moved Area's parent shard");
  const movedIntent = await persistedStructuralIntent(fixture);
  assert.deepEqual(movedIntent.controls, {
    x: 100, y: 420, width: 720, height: 480,
    layout: { schema: "area-placement.v1", priority: 2, overlapWith: [] },
  }, "move persists the exact selected region without baking in reflow");
  assertDerivedIntentStayedDerived(movedIntent);

  await page.reload({ waitUntil: "networkidle" });
  await mountLiveWorld(page, server.base, { navigate: false });
  const movedReload = await renderedRegions(page);
  assertSameGeometry(movedReload, movePreview, proofAreas, "browser reload recomputes the moved layout");
  assertContainment(movedReload);

  await page.getByRole("button", { name: /^Controls, child of Neara \/ Delivery \/ Standards, depth 4/ }).evaluate((button) => button.click());
  await page.evaluate((area) => window.liveEditor.fitArea(area, { push: false, select: true }), target);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const northWest = await areaScreenPoint(page, target, 0, 0);
  await page.mouse.move(northWest.x, northWest.y); await page.waitForTimeout(80); await page.mouse.down();
  await captureFirstPointerFrame(page);
  await page.mouse.move(northWest.x - 160 * northWest.zoom, northWest.y - 100 * northWest.zoom);
  const northWestPreview = await firstPointerFrame(page);
  const northWestPointerDown = await page.evaluate(() => window.liveEvents.filter((event) => event.name === "area_map_pointer_down").at(-1));
  assert.equal(northWestPointerDown?.command, "resize", "the production callback recognizes the north-west resize");
  assert.equal(northWestPointerDown?.handle, "nw", "the literal opposite corner reaches Excalidraw's north-west handle");
  assert.ok(northWestPreview[target].x < movedReload[target].x - 150, "north-west resize moves the selected Area's left edge");
  assert.ok(northWestPreview[target].y < movedReload[target].y - 90, "north-west resize moves the selected Area's top edge");
  assert.ok(northWestPreview[target].width > movedReload[target].width + 150, "north-west resize expands the selected Area's width");
  assert.ok(northWestPreview[target].height > movedReload[target].height + 90, "north-west resize expands the selected Area's height");
  assertContainment(northWestPreview);
  assertSameGeometry(await currentRegions(page), northWestPreview, proofAreas, "the controller and rendered north-west frame agree");
  await assertLabelsMatch(page, northWestPreview, proofAreas, "the first north-west frame keeps labels in the resolved snapshot");
  await page.mouse.up();
  const northWestRelease = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(Object.fromEntries((window.liveEditor.rendered() ?? [])
      .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
      .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
  }))));
  assertSameGeometry(northWestRelease, northWestPreview, proofAreas, "north-west release does not snap the rendered layout back");
  await page.evaluate(() => window.liveEditor.flush());
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.equal(String((await runGit(["-C", fixture.trees, "rev-list", "--count", `${beforeCommit}..HEAD`])).stdout).trim(), "3", "the three pointer commands make three commits");
  assert.deepEqual(await lastCommitFiles(fixture.trees), ["neara/delivery/standards/standards.excalidraw"], "north-west resize persists only the selected Area's parent shard");
  const northWestIntent = await persistedStructuralIntent(fixture);
  assert.deepEqual(northWestIntent.controls, {
    x: -60, y: 320, width: 880, height: 580,
    layout: { schema: "area-placement.v1", priority: 3, overlapWith: [] },
  }, "north-west resize persists its exact source rectangle and priority");
  assertDerivedIntentStayedDerived(northWestIntent);

  const beforeRestart = await json(server.base, "/api/areas/map-world?located=neara");
  await page.reload({ waitUntil: "networkidle" });
  await mountLiveWorld(page, server.base, { navigate: false });
  const northWestReload = await renderedRegions(page);
  assertSameGeometry(northWestReload, northWestPreview, proofAreas, "browser reload recomputes the north-west layout");
  assertContainment(northWestReload);
  await page.evaluate(() => window.liveEditor.destroy());
  await stopServer(server);
  server = await startServer(fixture, "crossing-2");
  const afterRestart = await json(server.base, "/api/areas/map-world?located=neara");
  const { view: _beforeView, ...beforeDurableWorld } = beforeRestart;
  const { view: _afterView, ...afterDurableWorld } = afterRestart;
  assert.deepEqual(afterDurableWorld, beforeDurableWorld, "restart preserves the exact authoritative world apart from private camera state");
  await mountLiveWorld(page, server.base);
  const restarted = await renderedRegions(page);
  assertSameGeometry(restarted, northWestPreview, proofAreas, "server restart recomputes the same rendered layout");
  assertContainment(restarted);
});

test("the first Area detail response recovers a crash after the first target rename", { skip: !enabled, timeout: 90_000 }, async (context) => {
  const fixture = await createMigrationVault("recovery");
  let server = null;
  context.after(async () => { await stopServer(server); await rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const repository = createAreaCanvasRepository({
    root: fixture.trees, runGit,
    transactionRoot: path.join(fixture.mapState, "legacy-transactions"),
    /** Rejects any legacy direct commit path in this transaction proof. */
    async commit() { throw new Error("the transaction authority owns live commits"); },
  });
  const vault = createVaultRepository({ root: fixture.trees, runGit });
  let crashed = false;
  const transactionRoot = path.join(fixture.mapState, "transactions");
  const crashing = createAreaMapTransactionRepository({
    root: fixture.trees, repository, vault, runGit, transactionRoot,
    /** Simulates process death after the first installed target. */
    fault(phase) {
      if (!crashed && phase === "target-installed:0") { crashed = true; throw Object.assign(new Error("fixture process crashed after first target rename"), { simulatedCrash: true }); }
    },
    /** Keeps the expected simulated crash out of unrelated test output. */
    reportError() {},
  });
  const delivery = await repository.read("neara/delivery");
  const standards = await repository.read("neara/delivery/standards");
  const nextDelivery = structuredClone(delivery.scene);
  nextDelivery.elements.find((element) => element.id === "standards-region").width = 1260;
  const nextStandards = structuredClone(standards.scene);
  nextStandards.elements.find((element) => element.id === "guides-region").x = 680;
  await assert.rejects(crashing.saveMany([
    { area: "neara/delivery", baseHash: delivery.hash, canvas: nextDelivery, reason: "Standards extent" },
    { area: "neara/delivery/standards", baseHash: standards.hash, canvas: nextStandards, reason: "Standards content" },
  ], { operationId: "live-crash-after-first-target", worldId: "recovery-world", area: "neara/delivery/standards" }), /crashed after first target rename/);
  assert.equal((await transactionManifest(transactionRoot)).state, "prepared", "the durable journal still owns recovery during target installation");

  server = await startServer(fixture, "recovery");
  const detail = await json(server.base, "/api/areas/show?area=neara%2Fdelivery");
  assert.equal(detail.map.exists, true, "Area detail includes its authoritative map shard");
  assert.equal((await transactionManifest(transactionRoot)).state, "committed", "the first Area detail read waits for complete startup recovery");
  const recovered = await json(server.base, "/api/areas/map-world?located=neara%2Fdelivery%2Fstandards");
  const composed = composeAreaMapWorld(recovered);
  const standardsRegion = composed.scene.elements.find((element) => element.customData?.tangent?.area === "neara/delivery/standards");
  assert.equal(standardsRegion.width, 1260);
  const guides = recovered.areas.find((area) => area.key === "neara/delivery/standards/guides");
  assert.equal(guides.region.storedRect.x, 680, "the same response includes the recovered second target");
});
