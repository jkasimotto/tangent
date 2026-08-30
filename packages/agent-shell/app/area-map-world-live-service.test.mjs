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

/** Stops one fixture server without involving the live port 4321 service. */
async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

/** Writes one source Area scene at its canonical rollback-compatible path. */
async function writeScene(trees, owner, scene) {
  const directory = path.join(trees, ...owner.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${owner.split("/").at(-1)}.excalidraw`), serializeAreaCanvas(scene));
}

/** Adds one stored direct-child region and its source label. */
function addRegion(scene, options) {
  scene.elements.push(...createRegionElements(options));
}

/** Creates the representative 41-Area tree and six legacy source scenes. */
async function createMigrationVault(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `area-map-live-${name}-`));
  const trees = path.join(root, "trees");
  const mapState = path.join(root, "map-state");
  const coreAreas = ["neara", "neara/delivery", "neara/delivery/standards", "neara/hackathon", "neara/hackathon/proof", "otto", "otto/tangent"];
  const areas = [...coreAreas, ...Array.from({ length: 34 }, (_, index) => `otto/area-${String(index + 1).padStart(2, "0")}`)].sort();
  for (const area of areas) {
    const directory = path.join(trees, ...area.split("/"));
    const leaf = area.split("/").at(-1);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${leaf}.md`), `---\ntype: area\nstatus: active\n---\n# ${leaf}\n## Purpose\nFixture Area.\n`);
  }

  const rootScene = createEmptyScene();
  addRegion(rootScene, { id: "root-neara", ref: "neara/neara.md", title: "Neara", x: 80, y: 80, width: 1100, height: 800 });
  addRegion(rootScene, { id: "root-otto", ref: "otto/otto.md", title: "Otto", x: 5000, y: 80, width: 1100, height: 800 });
  const near = createEmptyScene();
  addRegion(near, { id: "delivery-region", ref: "neara/delivery/delivery.md", title: "Delivery", x: 100, y: 100, width: 900, height: 600 });
  addRegion(near, { id: "hackathon-region", ref: "neara/hackathon/hackathon.md", title: "Hackathon", x: 100, y: 1050, width: 500, height: 400 });
  const delivery = createEmptyScene();
  addRegion(delivery, { id: "standards-region", ref: "neara/delivery/standards/standards.md", title: "Standards", x: 120, y: 120, width: 620, height: 420 });
  const standards = createEmptyScene();
  standards.elements.push(...createBlockElements({ id: "standards-document", kind: "document", ref: "neara/delivery/standards/design-proof.md", title: "Proof", x: 140, y: 160, width: 220, height: 100 }));
  const otto = createEmptyScene();
  addRegion(otto, { id: "tangent-region", ref: "otto/tangent/tangent.md", title: "Tangent", x: 80, y: 80, width: 680, height: 460 });
  const tangent = createEmptyScene();
  await writeScene(trees, "@root", rootScene);
  await writeScene(trees, "neara", near);
  await writeScene(trees, "neara/delivery", delivery);
  await writeScene(trees, "neara/delivery/standards", standards);
  await writeScene(trees, "otto", otto);
  await writeScene(trees, "otto/tangent", tangent);

  await runGit(["-C", trees, "init", "--quiet"]);
  await runGit(["-C", trees, "config", "user.email", "test@tangent.local"]);
  await runGit(["-C", trees, "config", "user.name", "Tangent Test"]);
  await runGit(["-C", trees, "add", "."]);
  await runGit(["-C", trees, "commit", "--quiet", "-m", "add: six-scene migration fixture"]);
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
async function mountLiveWorld(page, base) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="live-map" style="position:fixed;inset:0"></div>';
    /** Calls one production JSON route from the browser fixture. */
    const api = async (resource, options = {}) => {
      const response = await fetch(resource, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.error ?? `HTTP ${response.status}`), { status: response.status, ...value });
      return value;
    };
    const world = await api("/api/areas/map-world?located=neara%2Fdelivery%2Fstandards");
    const documents = world.areas.map((node) => ({ kind: "area", area: node.key, title: node.key.split("/").at(-1).replace(/^./, (letter) => letter.toUpperCase()), status: "active" }));
    const { mountWorld } = await import("/area-board.js");
    window.liveWorld = world;
    /** Returns the current fixture facts to the mounted editor. */
    const getDocuments = () => documents;
    /** Keeps the isolated fixture on its current page. */
    const onBack = () => {};
    window.liveEditor = mountWorld(document.querySelector("#live-map"), { world, getDocuments, api, onBack, focus: { only: false, activeOnly: false, areas: [] } });
  });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.liveEditor?.current?.()?.elements?.length);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}

/** Reads world-space region rectangles from the mounted production adapter. */
async function liveRegions(page) {
  return page.evaluate(() => Object.fromEntries(window.liveEditor.current().elements
    .filter((element) => element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
}

/** Derives Excalidraw's affine camera from two rendered structural labels. */
async function rightMiddleHandle(page, area) {
  return page.evaluate((target) => {
    const regions = Object.fromEntries(window.liveEditor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region").map((element) => [element.customData.tangent.area, element]));
    const labels = [...document.querySelectorAll(".tangent-map-ancestry > button")];
    /** Finds one structural HTML label by its accessible-name prefix. */
    const label = (name) => labels.find((button) => button.getAttribute("aria-label")?.toLowerCase().startsWith(`${name}, child of`));
    const delivery = regions["neara/delivery"];
    const standards = regions["neara/delivery/standards"];
    const deliveryLabel = label("delivery");
    const standardsLabel = label("standards");
    const zoom = (Number.parseFloat(standardsLabel.style.left) - Number.parseFloat(deliveryLabel.style.left)) / (standards.x - delivery.x);
    const scrollX = (Number.parseFloat(standardsLabel.style.left) - 12) / zoom - standards.x;
    const scrollY = (Number.parseFloat(standardsLabel.style.top) - 10) / zoom - standards.y;
    const canvas = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    const region = regions[target];
    return { x: canvas.x + (region.x + region.width + scrollX) * zoom, y: canvas.y + (region.y + region.height / 2 + scrollY) * zoom, zoom };
  }, area);
}

/** Asserts the continuous 60-unit structural containment invariant. */
function assertContainment(regions) {
  const standards = regions["neara/delivery/standards"];
  const delivery = regions["neara/delivery"];
  const near = regions.neara;
  assert.ok(standards.x + standards.width + 60 <= delivery.x + delivery.width + 0.01);
  assert.ok(delivery.x + delivery.width + 60 <= near.x + near.width + 0.01);
}

/** Reads the sole durable transaction manifest in one fixture. */
async function transactionManifest(transactionRoot) {
  const worlds = (await readdir(transactionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const operations = await readdir(path.join(transactionRoot, worlds[0].name));
  return JSON.parse(await readFile(path.join(transactionRoot, worlds[0].name, operations[0], "manifest.json"), "utf8"));
}

test("the live world saves one crossing gesture and survives reload and restart", { skip: !enabled, timeout: 120_000 }, async (context) => {
  const fixture = await createMigrationVault("crossing");
  let server = null; let browser = null;
  context.after(async () => { await browser?.close(); await stopServer(server); await rm(fixture.root, { recursive: true, force: true }); });
  server = await startServer(fixture, "crossing-1");
  const beforeCommit = String((await runGit(["-C", fixture.trees, "rev-parse", "HEAD"])).stdout).trim();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await mountLiveWorld(page, server.base);
  const before = await liveRegions(page);
  await page.getByRole("button", { name: /^Standards, child of Neara \/ Delivery, depth 3/ }).evaluate((button) => button.click());
  await page.waitForTimeout(100);
  const start = await rightMiddleHandle(page, "neara/delivery/standards");
  await page.mouse.move(start.x, start.y); await page.waitForTimeout(80); await page.mouse.down();
  await page.mouse.move(start.x + 320 * start.zoom, start.y, { steps: 4 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const preview = await liveRegions(page);
  assert.ok(preview["neara/delivery/standards"].width > before["neara/delivery/standards"].width + 250);
  assertContainment(preview);
  await page.mouse.up();
  await page.evaluate(() => window.liveEditor.flush());
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.equal(await page.locator(".tangent-map-save").count(), 1, "the map prints one save word");
  assert.equal(String((await runGit(["-C", fixture.trees, "rev-list", "--count", `${beforeCommit}..HEAD`])).stdout).trim(), "1", "one pointer command makes one Git commit");

  const beforeRestart = await json(server.base, "/api/areas/map-world?located=neara%2Fdelivery%2Fstandards");
  await page.reload({ waitUntil: "networkidle" });
  await mountLiveWorld(page, server.base);
  assertContainment(await liveRegions(page));
  await page.evaluate(() => window.liveEditor.destroy());
  await stopServer(server);
  server = await startServer(fixture, "crossing-2");
  const afterRestart = await json(server.base, "/api/areas/map-world?located=neara%2Fdelivery%2Fstandards");
  assert.deepEqual(afterRestart, beforeRestart, "restart preserves the exact authoritative world");
});

test("the first Area detail response recovers a crash after the first target rename", { skip: !enabled, timeout: 90_000 }, async (context) => {
  const fixture = await createMigrationVault("recovery");
  let server = null;
  context.after(async () => { await stopServer(server); await rm(fixture.root, { recursive: true, force: true }); });
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
  nextDelivery.elements.find((element) => element.id === "standards-region").width = 760;
  const nextStandards = structuredClone(standards.scene);
  nextStandards.elements.find((element) => element.id === "standards-document").x = 220;
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
  assert.equal(standardsRegion.width, 760);
  const proof = composed.scene.elements.find((element) => element.customData?.tangentWorld?.owner === "neara/delivery/standards" && element.customData.tangentWorld.sourceId === "standards-document");
  assert.ok(proof && proof.x > standardsRegion.x + 200, "the same response includes the recovered second target");
});
