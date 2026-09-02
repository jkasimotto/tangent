import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "test-fixtures/area-map/near-delivery-standards-crossing.png");
// Set UPDATE_AREA_MAP_GOLDENS=1 only after inspecting an intentional visual change.

const worldFixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <link rel="stylesheet" href="/agent-shell-map.css">
  <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style>
</head>
<body>
<div id="map"></div>
<script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const params = new URLSearchParams(location.search);
const wallFixture = params.get("wall") === "1";
const crossingFixture = params.get("crossing") === "1";
const reflowAnchorFixture = params.get("reflow-anchor") === "1";
const focusedFixture = params.get("focus") === "1";
const deferredTargetFixture = params.get("deferred-target") === "1";
const runtimeFixture = params.get("runtime") === "1";
const scene = () => core.createEmptyScene();
const scenes = new Map();

const standards = scene();
standards.elements.push(...core.createBlockElements({
  id: "standards-proof",
  kind: "goal",
  ref: "neara/delivery/standards/goal-proof.md",
  title: "Standards proof",
  status: "active",
  x: 180,
  y: 180,
  width: 220,
  height: 100,
}));
scenes.set("neara/delivery/standards", standards);

const hackathon = scene();
hackathon.elements.push(...core.createBlockElements({
  id: "hackathon-plan",
  kind: "document",
  ref: "neara/hackathon/design-plan.md",
  title: "Hackathon plan",
  status: "draft",
  x: 90,
  y: 100,
  width: 220,
  height: 100,
}));
scenes.set("neara/hackathon", hackathon);

for (const area of [
  "neara",
  "neara/delivery",
  "neara/delivery/standards/clearance",
  "neara/delivery/standards/clearance/rules",
]) scenes.set(area, scene());

const completeRecords = [
  ["neara", "@root", { x: 80, y: 80, width: 1100, height: 800 }, "ready"],
  ["neara/delivery", "neara", { x: 100, y: 100, width: 900, height: 600 }, "ready"],
  ["neara/delivery/standards", "neara/delivery", { x: 120, y: 120, width: 620, height: 420 }, "ready"],
  ["neara/delivery/standards/clearance", "neara/delivery/standards", { x: 80, y: 80, width: 300, height: 220 }, "ready"],
  ["neara/delivery/standards/clearance/rules", "neara/delivery/standards/clearance", { x: 60, y: 60, width: 300, height: 220 }, "ready"],
  ["neara/hackathon", "neara", reflowAnchorFixture ? { x: 100, y: 100, width: 500, height: 500 } : wallFixture ? { x: 1100, y: 100, width: 500, height: 500 } : { x: 600, y: 1050, width: 400, height: 300 }, "ready"],
  ["neara/essential", "neara", { x: 100, y: 1050, width: 400, height: 300 }, "deferred"],
  ["neara/portland", "neara", { x: 100, y: 1450, width: 400, height: 300 }, "unreadable"],
];
if (deferredTargetFixture) for (const record of completeRecords) {
  if (record[0] === "neara/delivery/standards" || record[0].startsWith("neara/delivery/standards/")) record[3] = "deferred";
}
const records = crossingFixture
  ? completeRecords.slice(0, 3)
  : wallFixture
    ? [...completeRecords.slice(0, 3), completeRecords.find(([key]) => key === "neara/hackathon")]
    : completeRecords;

const nodes = records.map(([key, parent, storedRect, state]) => ({
  key,
  parent,
  children: records.filter((entry) => entry[1] === key).map((entry) => entry[0]),
  depth: key.split("/").length - 1,
  region: {
    key: parent + ">" + key,
    owner: parent,
    child: key,
    sourceId: "region-" + key.replaceAll("/", "-"),
    labelSourceId: "label-" + key.replaceAll("/", "-"),
    source: "stored",
    storedRect,
    ...(reflowAnchorFixture && ["neara/delivery", "neara/hackathon"].includes(key) ? {
      layout: { schema: "area-placement.v1", priority: key === "neara/delivery" ? 2 : 1, overlapWith: [] },
    } : {}),
  },
  shard: {
    owner: key,
    hash: "hash-" + key,
    state,
    elementCount: scenes.get(key)?.elements.length ?? 0,
    blockCount: ["neara/delivery/standards", "neara/hackathon"].includes(key) ? 1 : 0,
    ...(state === "ready" ? { scene: scenes.get(key) ?? scene() } : {}),
    ...(state === "unreadable" ? { errors: ["fixture map file unreadable"] } : {}),
  },
}));

const world = {
  schema: "area-map-world.v1",
  worldId: "complete-neara-world",
  treeRevision: "tree-1",
  worldRevision: "world-1",
  locatedArea: "neara/delivery/standards",
  areas: nodes,
};

let documents = records.map(([area]) => ({
  kind: "area",
  area,
  file: area + "/" + area.split("/").at(-1) + ".md",
  title: area.split("/").at(-1).replace(/^./, (letter) => letter.toUpperCase()),
  status: "active",
  ...(runtimeFixture && area === "neara/delivery/standards" ? { runtime: { working: 3, forYou: 1, problems: 1, stale: true } } : {}),
  ...(runtimeFixture && area === "neara/hackathon" ? { runtime: { ready: true } } : {}),
}));
documents.push(
  { kind: "goal", area: "neara/delivery/standards", file: "neara/delivery/standards/goal-proof.md", title: "Standards proof", status: "active", live: true },
  { kind: "document", area: "neara/hackathon", file: "neara/hackathon/design-plan.md", title: "Hackathon plan", status: "draft", live: false },
);

window.worldEvents = [];
window.mapTelemetry = [];
window.entityVerbs = [];
window.addEventListener("tangent:area-map", (event) => window.mapTelemetry.push(event.detail));
window.loadCalls = [];
window.loadResolvers = new Map();
window.mountCount = 1;
window.nextWorld = null;
window.fixtureFocus = focusedFixture ? { only: true, activeOnly: false, areas: ["neara/essential"] } : { only: false, activeOnly: false, areas: [] };
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: scene(),
  getDocuments: () => documents,
  focus: window.fixtureFocus,
  onWorldChange: (nextWorld, changedAreas, changedOwners) => {
    const sourceOwners = new Set(changedOwners);
    for (const area of changedAreas) sourceOwners.add(nextWorld.areas.find((node) => node.key === area)?.region.owner);
    window.worldEvents.push({
      world: structuredClone(nextWorld),
      areas: [...changedAreas],
      owners: [...changedOwners],
      sourceOwners: [...sourceOwners].filter(Boolean),
    });
  },
  loadShard: async (area) => {
    window.loadCalls.push(area);
    if (deferredTargetFixture) await new Promise((resolve) => window.loadResolvers.set(area, resolve));
    return {
      area,
      worldRevision: world.worldRevision,
      hash: "hash-" + area,
      state: "ready",
      scene: scene(),
    };
  },
  reloadWorld: async () => structuredClone(window.nextWorld ?? world),
  onEntityVerb: (action) => window.entityVerbs.push(structuredClone(action)),
  onBack: () => { window.backCount = (window.backCount ?? 0) + 1; },
});

window.pollFacts = async (selectedArea = "neara/delivery") => {
  documents = documents.map((document) => document.area === "neara/delivery" && document.kind === "area"
    ? { ...document, title: "Delivery polled" }
    : document);
  if (typeof window.editor.refreshFacts === "function") await window.editor.refreshFacts(window.fixtureFocus);
  else if (typeof window.editor.updateFacts === "function") await window.editor.updateFacts(documents, window.fixtureFocus);
  else window.editor.fitArea(selectedArea);
};

window.pollRuntime = async () => {
  documents = documents.map((document) => document.area === "neara/delivery/standards" && document.kind === "area"
    ? { ...document, runtime: { working: 4, forYou: 0, problems: 2, stale: false } }
    : document);
  await window.editor.refreshFacts(window.fixtureFocus);
};

window.pollTree = async () => {
  const next = structuredClone(window.editor.controller().world());
  next.treeRevision = "tree-2";
  next.worldRevision = "world-2";
  next.areas.find((node) => node.key === "neara").children.push("neara/field");
  next.areas.push({
    key: "neara/field",
    parent: "neara",
    children: [],
    depth: 1,
    region: { key: "neara>neara/field", owner: "neara", child: "neara/field", sourceId: "region-neara-field", labelSourceId: "label-neara-field", source: "stored", storedRect: { x: 600, y: 1450, width: 400, height: 300 } },
    shard: { owner: "neara/field", hash: "hash-neara-field", state: "ready", elementCount: 0, blockCount: 0, scene: scene() },
  });
  documents = [...documents, { kind: "area", area: "neara/field", file: "neara/field/field.md", title: "Field", status: "active" }];
  window.nextWorld = next;
  await window.editor.refreshFacts(window.fixtureFocus);
};
</script>
</body>
</html>`;

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/world-fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(worldFixture);
      return;
    }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Opens one isolated complete-world browser fixture and registers cleanup. */
async function openWorld(context, query = "", viewport = { width: 1440, height: 1000 }) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
    headless: true,
  });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(`${baseUrl}/world-fixture${query}`, { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (!new URLSearchParams(query.replace(/^\?/, "")).has("opening")) {
    await page.evaluate(() => window.editor.controller().setRestriction(null));
    await page.waitForFunction(() => window.editor.controller().snapshot().restrictionArea === null);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))));
  }
  return page;
}

/** Requires one exact Area region center to equal the real canvas center. */
async function assertAreaCentered(page, area) {
  const result = await page.evaluate((target) => {
    const box = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    const region = window.editor.controller().snapshot().composition.regionRects.get(target);
    const app = window.editor.appState();
    return {
      expected: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      actual: {
        x: box.left + (region.x + region.width / 2 + app.scrollX) * app.zoom.value,
        y: box.top + (region.y + region.height / 2 + app.scrollY) * app.zoom.value,
      },
    };
  }, area);
  assert.ok(Math.abs(result.actual.x - result.expected.x) < 2 && Math.abs(result.actual.y - result.expected.y) < 2, `${area} is exactly centered: ${JSON.stringify(result)}`);
}

/** Escapes one string for use inside a regular expression. */
function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the exact parent-aware accessible name for one fixture Area. */
function labelName(area, { title = null, state = null, folded = false } = {}) {
  const parts = area.split("/");
  /** Capitalizes one fixture path segment for display. */
  const display = (value) => value.replace(/^./, (letter) => letter.toUpperCase());
  const name = title ?? display(parts.at(-1));
  const parent = parts.length === 1 ? "map root" : parts.slice(0, -1).map(display).join(" / ");
  const load = state ?? ({ "neara/essential": "deferred", "neara/portland": "unreadable" }[area] ?? "ready");
  const blocks = ["neara/delivery/standards", "neara/hackathon"].includes(area) ? 1 : 0;
  return `${name}, child of ${parent}, depth ${parts.length}, ${folded ? "folded" : "unfolded"}, ${load}, ${blocks} ${blocks === 1 ? "block" : "blocks"}`;
}

/** Returns an anchored accessible-name pattern for one fixture Area. */
function labelPattern(area, options) {
  return new RegExp(`^${regexEscape(labelName(area, options))}$`);
}

/** Returns all canonical world-region rectangles keyed by Area. */
async function regions(page) {
  return page.evaluate(() => Object.fromEntries(window.editor.current().elements
    .filter((element) => element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, {
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      locked: element.locked,
      deleted: element.isDeleted,
    }])));
}

/** Returns all Area rectangles from the actual mounted Excalidraw scene. */
async function renderedRegions(page) {
  return page.evaluate(() => Object.fromEntries((window.editor.rendered?.() ?? [])
    .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, {
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      locked: element.locked,
      deleted: element.isDeleted,
    }])));
}

/** Returns one Area rectangle from the actual mounted Excalidraw scene. */
async function renderedRegion(page, area) {
  return page.evaluate((target) => {
    const element = (window.editor.rendered?.() ?? []).find((candidate) => !candidate.isDeleted && candidate.customData?.tangent?.area === target);
    return element && { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height };
  }, area);
}

/** Returns the currently selected Area key, when one region is selected. */
async function selectedArea(page) {
  return page.evaluate(() => {
    const selected = window.editor.appState().selectedElementIds;
    return window.editor.current().elements.find((element) => selected[element.id] && element.customData?.tangent?.role === "area-region")?.customData?.tangent?.area ?? null;
  });
}

/** Clicks one HTML Area label and waits for its Excalidraw region selection. */
async function selectArea(page, area) {
  const label = page.getByRole("button", { name: labelPattern(area) });
  await label.waitFor();
  await label.evaluate((button) => button.click());
  try {
    await page.waitForFunction((expected) => {
      const selected = window.editor.appState().selectedElementIds;
      return window.editor.current().elements.some((element) => selected[element.id] && element.customData?.tangent?.area === expected);
    }, area, { timeout: 5_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      appSelection: window.editor.appState().selectedElementIds,
      controllerSelection: [...window.editor.controller().snapshot().selection],
      currentRegions: window.editor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region").map((element) => [element.customData.tangent.area, element.id]),
    }));
    throw new Error(`Area selection did not reach Excalidraw for ${area}: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Converts one Excalidraw world point to browser viewport coordinates. */
async function viewportPoint(page, x, y) {
  const canvas = page.locator(".excalidraw canvas.interactive");
  const [box, appState] = await Promise.all([canvas.boundingBox(), page.evaluate(() => window.editor.appState())]);
  assert.ok(box);
  return {
    x: box.x + (x + appState.scrollX) * appState.zoom.value,
    y: box.y + (y + appState.scrollY) * appState.zoom.value,
  };
}

test("Area runtime facts route to Work without changing Map geometry, and B stays Block", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?runtime=1");
  const before = await regions(page);
  const standards = page.locator('[data-area-runtime-facts="neara/delivery/standards"]');
  const ready = page.locator('[data-area-runtime-facts="neara/hackathon"]');

  await standards.getByRole("button", { name: "Open Work for Standards: 3 working" }).click();
  await standards.getByRole("button", { name: "Open For you for Standards: 1 for you" }).click();
  await standards.getByRole("button", { name: "Open Problems for Standards: 1 problem" }).click();
  await standards.getByText("Last known", { exact: true }).waitFor();
  await ready.getByText("Ready", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.entityVerbs), [
    { kind: "area", area: "neara/delivery/standards", ref: "neara/delivery/standards/standards.md", verb: "work" },
    { kind: "area", area: "neara/delivery/standards", ref: "neara/delivery/standards/standards.md", verb: "for-you" },
    { kind: "area", area: "neara/delivery/standards", ref: "neara/delivery/standards/standards.md", verb: "problems" },
  ]);

  await page.evaluate(() => window.pollRuntime());
  await standards.getByRole("button", { name: "Open Work for Standards: 4 working" }).waitFor();
  await standards.getByRole("button", { name: "Open Problems for Standards: 2 problems" }).waitFor();
  assert.equal(await standards.getByRole("button", { name: /For you/ }).count(), 0);
  assert.equal(await standards.getByText("Last known", { exact: true }).count(), 0);
  assert.deepEqual(await regions(page), before, "published runtime facts do not change authored or computed Area geometry");
  assert.equal(await page.evaluate(() => window.mountCount), 1, "runtime facts repaint the stable map island");

  await page.locator(".excalidraw canvas.interactive").focus();
  await page.keyboard.press("b");
  const picker = page.getByRole("dialog", { name: "Place a Tangent block" });
  await picker.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await picker.count(), 0);
  assert.equal(await page.evaluate(() => window.backCount ?? 0), 0, "Escape closes the Block picker before leaving Map");

  await page.getByTitle("Map keys (?)").click();
  const help = page.getByRole("dialog", { name: "Map keys" });
  assert.match(await help.textContent(), /B block/);
  assert.doesNotMatch(await help.textContent(), /b brain beside/i);
  assert.match(await help.textContent(), /named Brain control/);
  await help.getByRole("button", { name: "Close" }).click();
  await help.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.classList.contains("excalidraw"));

  await page.keyboard.press("b");
  await picker.waitFor();
  await page.keyboard.press("Tab");
  await picker.getByRole("heading", { name: "Place from the whole vault" }).waitFor();
  await picker.getByRole("textbox").fill("Standards proof");
  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'), null, { timeout: 5_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      active: { tag: document.activeElement?.tagName, type: document.activeElement?.getAttribute("data-type") },
      appState: window.editor.appState(),
      semanticBlocks: window.editor.current().elements.filter((element) => element.customData?.tangent && element.customData.tangent.role !== "area-region").map((element) => ({ id: element.id, ref: element.customData.tangent.ref, x: element.x, y: element.y, boundElements: element.boundElements })),
      entityVerbs: window.entityVerbs,
    }));
    throw new Error(`B-created Block did not focus its bound text: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  const placedEdit = await page.evaluate(() => {
    const editing = window.editor.appState().editingTextElement;
    const block = window.editor.current().elements.find((element) => element.boundElements?.some((binding) => binding.id === editing?.id));
    return { editingId: editing?.id, containerId: editing?.containerId, blockId: block?.id, activeType: document.activeElement?.getAttribute("data-type") };
  });
  assert.ok(placedEdit.editingId && placedEdit.blockId, `B-created Block exposes its bound text identity: ${JSON.stringify(placedEdit)}`);
  assert.deepEqual({ containerId: placedEdit.containerId, activeType: placedEdit.activeType }, { containerId: placedEdit.blockId, activeType: "wysiwyg" }, `B-created Block immediately focuses its bound text: ${JSON.stringify(placedEdit)}`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !window.editor.appState().editingTextElement);
  assert.equal(await page.getByRole("dialog", { name: "Place a Tangent block" }).count(), 0);
  assert.equal(await page.evaluate(() => window.backCount ?? 0), 0, "finishing Block text stays on Map");
});

test("an existing semantic Document block opens in one direct keyboard action from Map", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const documentBlock = await page.evaluate(() => {
    window.editor.fitArea("neara/hackathon", { push: false, select: false });
    const controller = window.editor.controller();
    const element = controller.snapshot().composition.scene.elements.find((candidate) => (
      !candidate.isDeleted
      && candidate.customData?.tangent?.kind === "document"
      && candidate.customData.tangent.ref === "neara/hackathon/design-plan.md"
    ));
    if (!element) return null;
    controller.setSelection([element.id]);
    return {
      id: element.id,
      tangent: structuredClone(element.customData.tangent),
      owner: element.customData?.tangentWorld?.owner,
    };
  });
  assert.deepEqual(documentBlock && { tangent: documentBlock.tangent, owner: documentBlock.owner }, {
    tangent: { kind: "document", ref: "neara/hackathon/design-plan.md" },
    owner: "neara/hackathon",
  }, "the selected map object is the existing source-owned Document block");
  await page.waitForFunction((id) => (
    window.editor.appState().selectedElementIds[id]
    && window.editor.controller().snapshot().selection.has(id)
  ), documentBlock.id);
  assert.deepEqual(await page.evaluate(() => window.entityVerbs), [], "selecting a Document block does not open it");

  await page.locator(".excalidraw canvas.interactive").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.entityVerbs.length === 1);

  assert.deepEqual(await page.evaluate(() => window.entityVerbs), [{
    verb: "open",
    kind: "document",
    ref: "neara/hackathon/design-plan.md",
  }], "one Enter from Map emits exactly one direct Document open action");
  assert.equal(await page.evaluate(() => window.worldEvents.length), 0, "opening a Document does not edit Map authority");
});

test("a deferred restricted Area centers before content loads", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?opening=1&deferred-target=1");
  await page.waitForFunction(() => window.loadCalls.length === 3);
  assert.equal(await page.evaluate(() => window.editor.controller().snapshot().restrictionArea), "neara/delivery/standards");
  assert.deepEqual(await page.locator(".tangent-map-ancestry > button strong").allTextContents(), ["Neara", "Delivery", "Standards", "Clearance", "Rules"]);
  await assertAreaCentered(page, "neara/delivery/standards");
  assert.deepEqual(await page.evaluate(() => window.loadCalls), [
    "neara/delivery/standards",
    "neara/delivery/standards/clearance",
    "neara/delivery/standards/clearance/rules",
  ]);
  assert.equal(await page.getByRole("button", { name: labelPattern("neara/hackathon") }).count(), 0, "an unrelated sibling has no HTML label");

  await page.keyboard.press("Meta+Shift+o");
  const outline = page.getByRole("region", { name: "Area hierarchy" });
  assert.equal(await outline.getByRole("treeitem").count(), 5, "the accessible outline contains only the exact scope");
  assert.equal(await outline.getByRole("treeitem", { name: labelPattern("neara/hackathon") }).count(), 0);
  await page.keyboard.press("Meta+Shift+o");

  await page.evaluate(() => { for (const resolve of window.loadResolvers.values()) resolve(); });
  await page.waitForFunction(() => window.editor.controller().world().areas.filter((node) => node.key === "neara/delivery/standards" || node.key.startsWith("neara/delivery/standards/")).every((node) => node.shard.state === "ready"));
});

/** Drags one selected Area from visible parent-only interior by one world-space delta. */
async function moveArea(page, area, delta) {
  await page.evaluate((target) => window.editor.fitArea(target, { push: false }), area);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await selectArea(page, area);
  const before = (await regions(page))[area];
  const rendered = await renderedRegion(page, area);
  const grip = { x: rendered.x + rendered.width - 45, y: rendered.y + rendered.height * 0.3 };
  const start = await viewportPoint(page, grip.x, grip.y);
  const end = await viewportPoint(page, grip.x + delta.x, grip.y + delta.y);
  const pointerDiagnostic = await page.evaluate(({ start, end }) => {
    const hit = document.elementFromPoint(start.x, start.y);
    const canvas = document.querySelector(".excalidraw canvas.interactive")?.getBoundingClientRect();
    const state = window.editor.appState();
    return { start, end, hit: { tag: hit?.tagName, className: String(hit?.className ?? "") }, canvas: canvas && { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height }, camera: { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom?.value } };
  }, { start, end });
  assert.equal(pointerDiagnostic.hit.tag, "CANVAS", `the Area drag grip must be visible on the canvas: ${JSON.stringify(pointerDiagnostic)}`);
  assert.match(pointerDiagnostic.hit.className, /interactive/, `the Area drag grip must target the interactive canvas: ${JSON.stringify(pointerDiagnostic)}`);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  try {
    await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents, { timeout: 5_000 });
  } catch (error) {
    const diagnostics = await page.evaluate((target) => ({
      events: window.worldEvents,
      appSelection: window.editor.appState().selectedElementIds,
      controllerSelection: [...window.editor.controller().snapshot().selection],
      sourceRect: window.editor.controller().world().areas.find((node) => node.key === target)?.region.storedRect,
    }), area);
    throw new Error(`Area pointer drag did not publish ${area}: ${JSON.stringify({ ...diagnostics, before, pointerDiagnostic })}`, { cause: error });
  }
  return {
    before,
    after: (await regions(page))[area],
    event: await page.evaluate(() => window.worldEvents.at(-1)),
    notice: await page.evaluate(() => document.querySelector(".tangent-map-location")?.textContent ?? ""),
  };
}

/** Drags an already selected Area without changing the current Only scope. */
async function moveAreaInPlace(page, area, delta) {
  await selectArea(page, area);
  const before = (await regions(page))[area];
  const rendered = await renderedRegion(page, area);
  const grip = { x: rendered.x + rendered.width - 45, y: rendered.y + rendered.height * 0.3 };
  const start = await viewportPoint(page, grip.x, grip.y);
  const end = await viewportPoint(page, grip.x + delta.x, grip.y + delta.y);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents);
  return { before, after: (await regions(page))[area] };
}

/** Performs the first authored gesture directly on an initially unselected Area. */
async function moveUnselectedArea(page, area, delta, { clearSelection = true, selectedBefore = null, fitTarget = true } = {}) {
  if (fitTarget) await page.evaluate((target) => window.editor.fitArea(target, { push: false, select: false }), area);
  if (clearSelection) {
    await page.evaluate(() => {
      window.editor.controller().setSelection([]);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await selectedArea(page), null, `${area} starts without an Excalidraw selection`);
  } else {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await selectedArea(page), selectedBefore, `${selectedBefore} remains selected before the direct ${area} hit`);
  }
  const before = (await regions(page))[area];
  const hitData = await page.evaluate((target) => {
    const elements = window.editor.rendered?.() ?? [];
    const region = elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === target);
    const authored = elements.filter((element) => element.customData?.tangent?.role !== "area-region" && !element.customData?.tangentWorldEphemeral);
    const candidates = [
      [0.8, 0.2], [0.5, 0.2], [0.2, 0.2], [0.8, 0.8], [0.2, 0.8], [0.8, 0.5], [0.5, 0.8], [0.2, 0.5], [0.5, 0.5],
    ].map(([x, y]) => ({ x: region.x + region.width * x, y: region.y + region.height * y }));
    return {
      point: candidates.find((point) => !authored.some((element) => point.x >= element.x - 12 && point.x <= element.x + element.width + 12
        && point.y >= element.y - 12 && point.y <= element.y + element.height + 12)),
      region: { x: region.x, y: region.y, width: region.width, height: region.height },
      authored: authored.map((element) => ({ x: element.x, y: element.y, width: element.width, height: element.height, owner: element.customData?.tangentWorld?.owner })),
    };
  }, area);
  const grip = hitData.point;
  assert.ok(grip, `${area} has an authored-content-free drag point: ${JSON.stringify(hitData)}`);
  const start = await viewportPoint(page, grip.x, grip.y);
  const end = await viewportPoint(page, grip.x + delta.x, grip.y + delta.y);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  const samples = [];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(start.x + (end.x - start.x) * step / 6, start.y + (end.y - start.y) * step / 6);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    samples.push(await renderedRegion(page, area));
  }
  await page.mouse.up();
  try {
    await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents, { timeout: 5_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      appSelection: window.editor.appState().selectedElementIds,
      controllerSelection: [...window.editor.controller().snapshot().selection],
      selectedElements: (window.editor.rendered?.() ?? []).filter((element) => window.editor.appState().selectedElementIds[element.id]).map((element) => ({
        id: element.id, type: element.type, role: element.customData?.tangent?.role ?? null, area: element.customData?.tangent?.area ?? null,
        sourceId: element.customData?.tangentWorld?.sourceId ?? null,
      })),
      pointer: window.mapTelemetry.filter((event) => event.name === "area_map_pointer_down").at(-1),
      projections: window.mapTelemetry.filter((event) => event.name === "area_map_projection").slice(-4),
    }));
    assert.fail(`the direct Area drag did not persist: ${JSON.stringify(diagnostic)} (${error.message})`);
  }
  return { before, after: (await regions(page))[area], samples, priorEvents };
}

/** Starts a literal south-east corner resize and leaves the pointer down. */
async function beginSouthEastResize(page, area, delta, steps = 4) {
  await selectArea(page, area);
  const before = (await regions(page))[area];
  const rendered = await renderedRegion(page, area);
  const start = await viewportPoint(page, rendered.x + rendered.width, rendered.y + rendered.height);
  const end = await viewportPoint(page, rendered.x + rendered.width + delta, rendered.y + rendered.height);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(80);
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return { tag: element?.tagName, className: String(element?.className ?? "") };
  }, start);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return { before, start, end, hit };
}

/** Returns one canonical authored block by its source owner. */
async function authoredBlock(page, owner, { rendered = false } = {}) {
  return page.evaluate(({ expectedOwner, fromRendered }) => {
    const elements = fromRendered ? window.editor.rendered?.() ?? [] : window.editor.current().elements;
    const element = elements.find((item) => !item.isDeleted && item.type === "rectangle" && item.customData?.tangentWorld?.owner === expectedOwner && item.customData?.tangent?.ref);
    return element ? { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, deleted: element.isDeleted } : null;
  }, { expectedOwner: owner, fromRendered: rendered });
}

/** Returns every canonical authored block for one source owner. */
async function authoredBlocks(page, owner, { rendered = false } = {}) {
  return page.evaluate(({ expectedOwner, fromRendered }) => {
    const elements = fromRendered ? window.editor.rendered?.() ?? [] : window.editor.current().elements;
    return elements.filter((item) => !item.isDeleted && item.type === "rectangle" && item.customData?.tangentWorld?.owner === expectedOwner && item.customData?.tangent?.ref)
      .map((element) => ({ id: element.id, sourceId: element.customData.tangentWorld.sourceId, ref: element.customData.tangent.ref, x: element.x, y: element.y, width: element.width, height: element.height, deleted: element.isDeleted }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  }, { expectedOwner: owner, fromRendered: rendered });
}

/** Returns source authority while normalizing private shard load state. */
async function sourceAuthority(page) {
  return page.evaluate(() => {
    const world = window.editor.controller().world();
    return {
      schema: world.schema,
      worldId: world.worldId,
      treeRevision: world.treeRevision,
      worldRevision: world.worldRevision,
      locatedArea: world.locatedArea,
      root: world.rootShard && { owner: world.rootShard.owner, hash: world.rootShard.hash, elements: world.rootShard.scene?.elements ?? [] },
      areas: world.areas.map((node) => ({
        key: node.key,
        parent: node.parent,
        children: [...node.children],
        depth: node.depth,
        region: node.region,
        shard: { owner: node.shard.owner, hash: node.shard.hash, elements: node.shard.scene?.elements ?? [] },
      })),
    };
  });
}

/** Computes a stable digest for a screenshot buffer. */
function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Reads the fixed-size PNG header without introducing a second image codec. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("visible descendants move and resize without changing the opening Only scope", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?opening=1");
  const restriction = "neara/delivery/standards";
  assert.equal(await page.evaluate(() => window.editor.controller().snapshot().restrictionArea), restriction);

  const labelBeforeMove = await page.locator('[data-area-map-label="neara/delivery/standards/clearance"]').evaluate((label) => ({ left: label.style.left, top: label.style.top }));
  const moved = await moveAreaInPlace(page, "neara/delivery/standards/clearance", { x: 35, y: 25 });
  assert.ok(moved.after.x > moved.before.x + 25 && moved.after.y > moved.before.y + 15);
  const labelAfterMove = await page.locator('[data-area-map-label="neara/delivery/standards/clearance"]').evaluate((label) => ({ left: label.style.left, top: label.style.top }));
  assert.notDeepEqual(labelAfterMove, labelBeforeMove, "the structural label follows its moved region");
  assert.equal(await page.evaluate(() => window.editor.controller().snapshot().restrictionArea), restriction, "direct manipulation does not retarget Only");

  const beforeResize = await renderedRegions(page);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  await beginSouthEastResize(page, "neara/delivery/standards/clearance", 180, 4);
  const preview = await renderedRegions(page);
  assert.ok(preview["neara/delivery/standards/clearance"].width > beforeResize["neara/delivery/standards/clearance"].width + 140);
  assert.ok(preview["neara/delivery/standards"].width > beforeResize["neara/delivery/standards"].width, "the first preview frame expands the direct ancestor");
  assert.ok(preview["neara/delivery"].width > beforeResize["neara/delivery"].width, "the first preview frame expands every ancestor");
  const currentPreview = await regions(page);
  for (const area of ["neara/delivery/standards/clearance", "neara/delivery/standards", "neara/delivery", "neara"]) assert.deepEqual(currentPreview[area], preview[area], `${area} has one controller and rendered Only-scope geometry`);
  await page.mouse.up();
  await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents);
  assert.equal(await page.evaluate(() => window.editor.controller().snapshot().restrictionArea), restriction);

  const beforeParentResize = await renderedRegions(page);
  const childSourceBefore = await page.evaluate(() => structuredClone(window.editor.controller().world().areas.find((node) => node.key === "neara/delivery/standards/clearance").region.storedRect));
  const parentEvent = await page.evaluate(() => window.worldEvents.length);
  await beginSouthEastResize(page, "neara/delivery/standards", 100, 4);
  const parentPreview = await renderedRegions(page);
  assert.ok(parentPreview["neara/delivery/standards"].width > beforeParentResize["neara/delivery/standards"].width + 90, "the expanded parent starts at its visible handle");
  assert.ok(parentPreview["neara/delivery/standards"].x + parentPreview["neara/delivery/standards"].width + 60 <= parentPreview["neara/delivery"].x + parentPreview["neara/delivery"].width + 0.01);
  assert.ok(parentPreview["neara/delivery"].x + parentPreview["neara/delivery"].width + 60 <= parentPreview.neara.x + parentPreview.neara.width + 0.01);
  await page.mouse.up();
  await page.waitForFunction((count) => window.worldEvents.length > count, parentEvent);
  assert.deepEqual(await page.evaluate(() => window.editor.controller().world().areas.find((node) => node.key === "neara/delivery/standards/clearance").region.storedRect), childSourceBefore, "parent resize leaves descendant source geometry unchanged");

  const durable = await regions(page);
  await page.evaluate(async () => {
    window.nextWorld = structuredClone(window.worldEvents.at(-1).world);
    await window.editor.controller().reload();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const reloaded = await regions(page);
  for (const area of ["neara/delivery/standards", "neara/delivery/standards/clearance"]) assert.deepEqual(reloaded[area], durable[area], `${area} survives authoritative reload`);
  await page.evaluate(() => window.editor.controller().setRestriction(null));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const unscoped = await regions(page);
  for (const area of ["neara/delivery/standards", "neara/delivery/standards/clearance"]) assert.deepEqual(unscoped[area], durable[area], `${area} keeps the same authoritative geometry after clearing Only`);
});

test("the first direct drag of an unselected Area persists without jitter or snapback", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  await page.evaluate(() => { window.worldEvents.length = 0; });

  const moved = await moveUnselectedArea(page, "neara/hackathon", { x: 72, y: 48 });

  assert.equal(moved.priorEvents, 0);
  assert.ok(moved.after.x > moved.before.x + 60 && moved.after.y > moved.before.y + 35, `the direct hit keeps the complete first drag: ${JSON.stringify(moved)}`);
  for (let index = 1; index < moved.samples.length; index += 1) {
    assert.ok(moved.samples[index].x >= moved.samples[index - 1].x - 0.01, `x never snaps backward: ${JSON.stringify(moved.samples)}`);
    assert.ok(moved.samples[index].y >= moved.samples[index - 1].y - 0.01, `y never snaps backward: ${JSON.stringify(moved.samples)}`);
  }
  assert.deepEqual(
    Object.fromEntries(["x", "y", "width", "height"].map((field) => [field, moved.samples.at(-1)[field]])),
    Object.fromEntries(["x", "y", "width", "height"].map((field) => [field, moved.after[field]])),
    "the release keeps the final rendered preview",
  );
  assert.equal(await page.evaluate(() => window.worldEvents.length), 1, "the first direct drag persists exactly once");
  const projectionTelemetry = await page.evaluate(() => window.mapTelemetry.filter((event) => event.name === "area_map_projection"));
  const consumedProjectionIds = new Set(projectionTelemetry.filter((event) => event.phase === "consumed").map((event) => event.projectionId));
  assert.ok(projectionTelemetry.some((event) => event.phase === "request" && consumedProjectionIds.has(event.projectionId)), "one projection request is correlated with its consumed callback");
  assert.ok(projectionTelemetry.filter((event) => event.phase === "consumed").every((event) => event.duration >= 0));
  for (const event of projectionTelemetry) {
    assert.deepEqual(
      Object.keys(event).filter((key) => ["fingerprint", "selection", "selectedIds", "area", "owner", "coordinates", "elements"].includes(key)),
      [],
      `projection telemetry contains no authored content fields: ${JSON.stringify(event)}`,
    );
  }
});

test("an unmodified direct drag switches from the selected Area to the hit Area", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const selected = "neara/delivery/standards/clearance";
  const target = "neara/hackathon";
  await page.evaluate((area) => window.editor.fitArea(area, { push: false, select: false }), target);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await selectArea(page, selected);
  await page.evaluate(() => { window.worldEvents.length = 0; });
  const selectedBefore = (await regions(page))[selected];

  const moved = await moveUnselectedArea(page, target, { x: 68, y: 44 }, { clearSelection: false, selectedBefore: selected, fitTarget: false });

  assert.ok(moved.after.x > moved.before.x + 55 && moved.after.y > moved.before.y + 30, "the newly hit Area receives the complete drag");
  assert.deepEqual((await regions(page))[selected], selectedBefore, "the previously selected Area does not move additively");
  assert.equal(await page.evaluate(() => window.worldEvents.length), 1, "switching the direct target persists one gesture");
  const durable = await regions(page);
  await page.evaluate(async () => {
    window.nextWorld = structuredClone(window.worldEvents[0].world);
    await window.editor.controller().reload();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const reloaded = await regions(page);
  assert.deepEqual(reloaded[target], durable[target], "the switched target survives authoritative reload");
  assert.deepEqual(reloaded[selected], durable[selected], "reload keeps the prior Area unchanged");
});

test("flush and teardown inside the pointer release fence persist exactly once", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const area = "neara/hackathon";
  await page.evaluate((target) => window.editor.fitArea(target, { push: false, select: false }), area);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await selectArea(page, area);
  const sourceBefore = await page.evaluate((target) => structuredClone(window.editor.controller().world().areas.find((node) => node.key === target).region.storedRect), area);
  const rendered = await renderedRegion(page, area);
  const grip = { x: rendered.x + rendered.width - 45, y: rendered.y + rendered.height * 0.3 };
  const start = await viewportPoint(page, grip.x, grip.y);
  const end = await viewportPoint(page, grip.x + 64, grip.y + 36);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  const sourcePreview = await page.evaluate((target) => structuredClone(window.editor.controller().world().areas.find((node) => node.key === target).region.storedRect), area);
  await page.evaluate(() => {
    const controller = window.editor.controller();
    const destroy = controller.destroy.bind(controller);
    window.internalControllerDestroyCount = 0;
    controller.destroy = () => { window.internalControllerDestroyCount += 1; return destroy(); };
    window.releaseFenceResult = new Promise((resolve, reject) => {
      document.querySelector(".excalidraw canvas.interactive").addEventListener("pointerup", () => queueMicrotask(async () => {
        try {
          const flushed = window.editor.flush();
          window.editor.destroy();
          await flushed;
          resolve(structuredClone(window.worldEvents));
        } catch (error) { reject(error); }
      }), { capture: true, once: true });
    });
  });
  await page.mouse.up();
  const events = await page.evaluate(() => window.releaseFenceResult);

  assert.equal(events.length, 1, "release, flush, and teardown close one history word");
  const persisted = events[0].world.areas.find((node) => node.key === area).region.storedRect;
  assert.ok(persisted.x > sourceBefore.x + 50 && persisted.y > sourceBefore.y + 25, `teardown persists the pointer delta: ${JSON.stringify({ sourceBefore, persisted })}`);
  assert.deepEqual(persisted, sourcePreview, "teardown persists the final source preview without snapback");
  await page.waitForFunction(() => window.internalControllerDestroyCount === 1);
});

test("every ancestor and descendant is one selectable live region", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.worldEvents), [], "opening the complete hierarchy is a pure read");
  const expected = [
    "neara",
    "neara/delivery",
    "neara/delivery/standards",
    "neara/delivery/standards/clearance",
    "neara/delivery/standards/clearance/rules",
    "neara/hackathon",
    "neara/essential",
    "neara/portland",
  ];
  const current = await regions(page);
  assert.deepEqual(Object.keys(current), expected);
  assert.ok(Object.values(current).every((region) => region.locked === false && region.deleted === false));
  const firstLabel = page.getByRole("button", { name: labelPattern("neara") });
  await firstLabel.focus();
  const focusRing = await firstLabel.evaluate((button) => {
    const style = getComputedStyle(button);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), color: style.outlineColor };
  });
  assert.equal(focusRing.style, "solid", "an Area label uses a solid keyboard focus ring");
  assert.ok(focusRing.width >= 2 && !/rgba\([^)]*,\s*0\s*\)$/.test(focusRing.color), `an Area label keeps a visible keyboard focus ring over the canvas: ${JSON.stringify(focusRing)}`);
  for (const area of expected) {
    await selectArea(page, area);
    assert.equal(await selectedArea(page), area);
  }
});

test("moving an ancestor moves its subtree without child writes", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const first = await regions(page);
  const nearMove = await moveArea(page, "neara", { x: 50, y: 30 });
  const afterNear = await regions(page);
  assert.ok(nearMove.after.x > nearMove.before.x + 40 && nearMove.after.y > nearMove.before.y + 20, `Neara did not follow its actual pointer drag: ${JSON.stringify(nearMove)}`);
  for (const area of ["neara/delivery", "neara/delivery/standards", "neara/delivery/standards/clearance"]) {
    assert.ok(Math.abs((afterNear[area].x - first[area].x) - (nearMove.after.x - nearMove.before.x)) < 1);
    assert.ok(Math.abs((afterNear[area].y - first[area].y) - (nearMove.after.y - nearMove.before.y)) < 1);
  }

  const eventAfterNear = await page.evaluate(() => window.worldEvents.at(-1));
  assert.deepEqual(eventAfterNear.areas, ["neara"]);
  assert.deepEqual(eventAfterNear.owners, []);
  assert.deepEqual(eventAfterNear.sourceOwners, ["@root"]);

  const beforeDeliveryEvent = await page.evaluate(() => window.worldEvents.length);
  const deliveryMove = await moveArea(page, "neara/delivery", { x: 45, y: 70 });
  assert.ok(deliveryMove.after.x > deliveryMove.before.x + 35 && deliveryMove.after.y > deliveryMove.before.y + 60);
  const eventAfterDelivery = await page.evaluate((index) => window.worldEvents[index], beforeDeliveryEvent);
  const deliveryNode = eventAfterDelivery.world.areas.find((node) => node.key === "neara/delivery");
  const standardsNode = eventAfterDelivery.world.areas.find((node) => node.key === "neara/delivery/standards");
  assert.notDeepEqual(deliveryNode.region.storedRect, { x: 100, y: 100, width: 900, height: 600 });
  assert.deepEqual(standardsNode.region.storedRect, { x: 120, y: 120, width: 620, height: 420 });
  assert.deepEqual(eventAfterDelivery.areas, ["neara/delivery"]);
  assert.deepEqual(eventAfterDelivery.owners, []);
  assert.deepEqual(eventAfterDelivery.sourceOwners, ["neara"]);
  const proof = standardsNode.shard.scene.elements.find((element) => element.id === "standards-proof");
  assert.deepEqual({ x: proof.x, y: proof.y }, { x: 180, y: 180 }, "the descendant shard keeps local ownership coordinates");
});

test("resizing a child grows every ancestor in the same frame", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const before = await regions(page);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  const drag = await beginSouthEastResize(page, "neara/delivery/standards", 320, 4);
  const preview = await regions(page);
  const sourcePreview = await page.evaluate(() => window.editor.controller().world().areas.find((node) => node.key === "neara/delivery/standards").region.storedRect);
  assert.ok(preview["neara/delivery/standards"].width > before["neara/delivery/standards"].width + 250, `the south-east handle did not resize Standards: ${JSON.stringify({ before: before["neara/delivery/standards"], preview: preview["neara/delivery/standards"], sourcePreview, drag })}`);
  assert.ok(preview["neara/delivery"].width > before["neara/delivery"].width);
  assert.ok(preview.neara.width > before.neara.width);
  assert.ok(preview["neara/delivery/standards"].x + preview["neara/delivery/standards"].width + 60 <= preview["neara/delivery"].x + preview["neara/delivery"].width + 0.01);
  assert.ok(preview["neara/delivery"].x + preview["neara/delivery"].width + 60 <= preview.neara.x + preview.neara.width + 0.01);
  await page.mouse.up();
  await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents);
  const gesture = await page.evaluate((index) => window.worldEvents[index], priorEvents);
  assert.deepEqual(gesture.areas, ["neara/delivery/standards"]);
  assert.deepEqual(gesture.owners, []);
  assert.deepEqual(gesture.sourceOwners, ["neara/delivery"], "resizing Standards writes only its region owner");
  assert.deepEqual(gesture.world.areas.find((node) => node.key === "neara/delivery").region.storedRect, { x: 100, y: 100, width: 900, height: 600 }, "computed Delivery growth does not write its stored extent");
  assert.deepEqual(gesture.world.areas.find((node) => node.key === "neara").region.storedRect, { x: 80, y: 80, width: 1100, height: 800 }, "computed Neara growth does not write its stored extent");
});

test("Focus and camera changes never remove or lock an outline", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?focus=1");
  const before = await regions(page);
  const authorityBefore = await sourceAuthority(page);
  const eventsBefore = await page.evaluate(() => window.worldEvents.length);
  const block = await authoredBlock(page, "neara/hackathon");
  assert.ok(block && block.deleted === false, "Focus leaves the canonical block authoritative");
  assert.equal(await page.evaluate((id) => {
    const projected = window.editor.controller().snapshot();
    return projected.hiddenIds.has(id) && projected.scene.elements.find((element) => element.id === id)?.isDeleted === true;
  }, block.id), true, "Focus hides the unmatched block only in the render plan");
  await page.evaluate(() => window.editor.fitArea("neara"));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const blockPoint = await viewportPoint(page, block.x + block.width / 2, block.y + block.height / 2);
  const canvasBox = await page.locator(".excalidraw canvas.interactive").boundingBox();
  assert.ok(canvasBox && blockPoint.x >= canvasBox.x && blockPoint.x <= canvasBox.x + canvasBox.width && blockPoint.y >= canvasBox.y && blockPoint.y <= canvasBox.y + canvasBox.height, "the Focus proof clicks the fitted block location inside the canvas");
  await page.mouse.click(blockPoint.x, blockPoint.y);
  const selectedIds = await page.evaluate(() => window.editor.appState().selectedElementIds);
  assert.equal(selectedIds[block.id], undefined, "Focus removes the unmatched block from the render plan");
  for (const area of ["neara", "neara/delivery/standards/clearance/rules", "neara/portland"]) await selectArea(page, area);
  const after = await regions(page);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.ok(Object.values(after).every((region) => region.locked === false && region.deleted === false));
  assert.deepEqual(await sourceAuthority(page), authorityBefore, "Focus and camera operations never change source authority");
  assert.equal(await page.evaluate(() => window.worldEvents.length), eventsBefore, "Focus and camera operations do not publish authored map changes");
  for (const area of Object.keys(before)) {
    const options = area === "neara/essential" ? { state: "ready" } : undefined;
    await page.getByRole("button", { name: labelPattern(area, options) }).waitFor();
  }
});

test("fold is the only view action that hides descendant structure", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const count = await page.locator(".tangent-map-ancestry > button").count();
  await selectArea(page, "neara/delivery");
  await page.keyboard.press("Space");
  await page.getByText("folded · Space", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: labelPattern("neara/delivery", { folded: true }) }).count(), 1);
  assert.equal(await page.getByRole("button", { name: labelPattern("neara/delivery/standards") }).count(), 0);
  assert.equal(await page.locator(".tangent-map-ancestry > button").count(), count - 3);
  const canonical = await regions(page);
  assert.ok(["neara/delivery/standards", "neara/delivery/standards/clearance", "neara/delivery/standards/clearance/rules"].every((area) => canonical[area].deleted === false));
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: labelPattern("neara/delivery/standards") }).waitFor();
  assert.equal(await page.locator(".tangent-map-ancestry > button").count(), count);
});

test("fact polling does not remount Excalidraw or clear selection", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  await selectArea(page, "neara/delivery");
  const authorityBefore = await page.evaluate(() => window.editor.controller().world());
  const eventsBefore = await page.evaluate(() => window.worldEvents.length);
  await page.evaluate(() => { window.canvasBeforePoll = document.querySelector(".excalidraw canvas.interactive"); });
  await page.evaluate(() => window.pollFacts("neara/delivery"));
  await page.getByRole("button", { name: labelPattern("neara/delivery", { title: "Delivery polled" }) }).waitFor();
  assert.equal(await page.evaluate(() => window.mountCount), 1);
  assert.equal(await page.evaluate(() => window.canvasBeforePoll === document.querySelector(".excalidraw canvas.interactive")), true);
  assert.equal(await selectedArea(page), "neara/delivery");
  assert.deepEqual(await page.evaluate(() => window.editor.controller().world()), authorityBefore, "fact polling changes presentation without changing source authority");
  assert.equal(await page.evaluate(() => window.worldEvents.length), eventsBefore, "fact polling does not publish an authored map change");

  const viewBeforeTreePoll = await page.evaluate(() => {
    const app = window.editor.appState();
    const state = window.editor.controller().snapshot();
    return { camera: { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value }, cameraTarget: state.cameraTarget, cameraTrail: [...state.cameraTrail] };
  });
  await page.evaluate(() => window.pollTree());
  await page.getByRole("button", { name: labelPattern("neara/field") }).waitFor();
  assert.equal(await page.evaluate(() => window.mountCount), 1);
  assert.equal(await page.evaluate(() => window.canvasBeforePoll === document.querySelector(".excalidraw canvas.interactive")), true, "a changed tree keeps the same Excalidraw island and canvas");
  assert.equal(await selectedArea(page), "neara/delivery", "a valid selected region survives tree reconciliation");
  assert.deepEqual(await page.evaluate(() => {
    const app = window.editor.appState();
    const state = window.editor.controller().snapshot();
    return { camera: { scrollX: app.scrollX, scrollY: app.scrollY, zoom: app.zoom.value }, cameraTarget: state.cameraTarget, cameraTrail: [...state.cameraTrail] };
  }), viewBeforeTreePoll, "a valid camera target and trail survive tree reconciliation");
  assert.equal(await page.evaluate(() => window.editor.controller().world().treeRevision), "tree-2");
  assert.equal(await page.evaluate(() => window.worldEvents.length), eventsBefore, "tree reconciliation does not publish an authored map change");
});

test("undo and redo cross-shard gestures through world history", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  await selectArea(page, "neara/delivery/standards");
  const beforeRegion = (await regions(page))["neara/delivery/standards"];
  const beforeBlock = await authoredBlock(page, "neara/delivery/standards", { rendered: true });
  const blockCenter = await viewportPoint(page, beforeBlock.x + beforeBlock.width / 2, beforeBlock.y + beforeBlock.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(blockCenter.x, blockCenter.y);
  await page.keyboard.up("Shift");
  const selected = await page.evaluate(() => {
    const app = window.editor.appState().selectedElementIds;
    return {
      app,
      controller: [...window.editor.controller().snapshot().selection],
      elements: (window.editor.rendered?.() ?? []).filter((element) => app[element.id]).map((element) => ({ id: element.id, type: element.type, containerId: element.containerId, sourceId: element.customData?.tangentWorld?.sourceId })),
    };
  });
  const selectionDiagnostic = { selected, beforeRegion, beforeBlock };
  assert.equal(selected.app[beforeRegion.id], true, `the real Shift-click keeps the Standards region selected: ${JSON.stringify(selectionDiagnostic)}`);
  assert.equal(selected.app[beforeBlock.id], true, `the real Shift-click adds the Standards block: ${JSON.stringify(selectionDiagnostic)}`);
  const end = await viewportPoint(page, beforeBlock.x + beforeBlock.width / 2 + 45, beforeBlock.y + beforeBlock.height / 2 + 35);
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  await page.mouse.move(blockCenter.x, blockCenter.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents);
  const gesture = await page.evaluate(() => window.worldEvents.at(-1));
  assert.deepEqual(gesture.areas, ["neara/delivery/standards"]);
  assert.deepEqual(gesture.owners, ["neara/delivery/standards"]);
  assert.deepEqual(gesture.sourceOwners.sort(), ["neara/delivery", "neara/delivery/standards"]);
  const movedRegion = (await regions(page))["neara/delivery/standards"];
  const movedBlock = await authoredBlock(page, "neara/delivery/standards", { rendered: true });
  assert.notDeepEqual({ x: movedRegion.x, y: movedRegion.y }, { x: beforeRegion.x, y: beforeRegion.y });
  assert.notDeepEqual({ x: movedBlock.x, y: movedBlock.y }, { x: beforeBlock.x, y: beforeBlock.y });

  await page.keyboard.press("Meta+z");
  await page.waitForFunction((x) => {
    const element = window.editor.current().elements.find((item) => item.customData?.tangent?.area === "neara/delivery/standards");
    return Math.abs(element.x - x) < 0.01;
  }, beforeRegion.x);
  assert.deepEqual(await authoredBlock(page, "neara/delivery/standards", { rendered: true }), beforeBlock);

  await page.keyboard.press("Meta+Shift+z");
  await page.waitForFunction((x) => {
    const element = window.editor.current().elements.find((item) => item.customData?.tangent?.area === "neara/delivery/standards");
    return Math.abs(element.x - x) < 0.01;
  }, movedRegion.x);
  assert.deepEqual(await authoredBlock(page, "neara/delivery/standards", { rendered: true }), movedBlock);
});

test("unreadable and deferred shards keep interactive boundaries", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  const before = await regions(page);
  for (const area of ["neara/essential", "neara/portland"]) {
    assert.equal(before[area].locked, false);
    assert.equal(before[area].deleted, false);
    await page.getByRole("button", { name: labelPattern(area) }).waitFor();
    await selectArea(page, area);
    assert.equal(await selectedArea(page), area);
  }
  assert.deepEqual(await page.evaluate(() => window.loadCalls), ["neara/essential"]);
  assert.match(await page.getByRole("button", { name: labelPattern("neara/portland") }).textContent(), /unreadable/);
  const after = await regions(page);
  assert.ok(after["neara/essential"] && after["neara/portland"]);
});

test("keyboard outline selects and fits every Area", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context);
  await page.keyboard.press("Meta+Shift+o");
  const outline = page.getByRole("region", { name: "Area hierarchy" });
  await outline.waitFor();
  const buttons = outline.locator("[role='treeitem'][data-outline-area]");
  const count = await buttons.count();
  assert.equal(count, 8);
  const areas = [
    "neara",
    "neara/delivery",
    "neara/delivery/standards",
    "neara/delivery/standards/clearance",
    "neara/delivery/standards/clearance/rules",
    "neara/essential",
    "neara/hackathon",
    "neara/portland",
  ];
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).focus();
    const expected = areas[index];
    const expectedName = labelName(expected, expected === "neara/essential" ? { state: "ready" } : undefined);
    assert.equal(await buttons.nth(index).getAttribute("aria-label"), expectedName);
    assert.equal(await buttons.nth(index).evaluate((button) => document.activeElement === button), true);
    const cameraBefore = await page.evaluate(() => {
      const state = window.editor.appState();
      return { x: state.scrollX, y: state.scrollY, zoom: state.zoom.value };
    });
    await page.keyboard.press("Enter");
    try {
      await page.waitForFunction((area) => {
        const selected = window.editor.appState().selectedElementIds;
        return window.editor.current().elements.some((element) => selected[element.id] && element.customData?.tangent?.area === area);
      }, expected, { timeout: 5_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        active: document.activeElement?.textContent,
        appSelection: window.editor.appState().selectedElementIds,
        controllerSelection: [...window.editor.controller().snapshot().selection],
        cameraTarget: window.editor.controller().snapshot().cameraTarget,
      }));
      throw new Error(`outline Enter did not select and fit index ${index} (${expected}): ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    if (index > 0) {
      const cameraAfter = await page.evaluate(() => {
        const state = window.editor.appState();
        return { x: state.scrollX, y: state.scrollY, zoom: state.zoom.value };
      });
      assert.notDeepEqual(cameraAfter, cameraBefore);
    }
  }
});

test("Standards never crosses Delivery while Delivery and Neara grow", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?crossing=1");
  const before = await regions(page);
  await beginSouthEastResize(page, "neara/delivery/standards", 320, 4);
  const crossing = await regions(page);
  const standards = crossing["neara/delivery/standards"];
  const delivery = crossing["neara/delivery"];
  const near = crossing.neara;
  const selection = await page.evaluate(() => {
    const selected = window.editor.appState().selectedElementIds;
    const element = window.editor.current().elements.find((item) => selected[item.id]);
    const drawn = window.editor.controller().snapshot().composition.regionRects.get("neara/delivery/standards");
    /** Selects the geometry fields used by this assertion. */
    const geometry = (value) => value && ({ x: value.x, y: value.y, width: value.width, height: value.height });
    return { ids: Object.keys(selected).filter((id) => selected[id]), element: geometry(element), drawn: geometry(drawn) };
  });
  assert.deepEqual(selection.ids, [standards.id], "the selection rectangle belongs only to Standards");
  assert.deepEqual(selection.element, selection.drawn, "the Standards selection rectangle equals its current drawn rectangle");
  assert.ok(standards.width > before["neara/delivery/standards"].width + 250, "Standards crosses Delivery's old edge before pointer up");
  assert.ok(delivery.x + delivery.width > before["neara/delivery"].x + before["neara/delivery"].width);
  assert.ok(near.x + near.width > before.neara.x + before.neara.width);
  assert.ok(standards.x + standards.width + 60 <= delivery.x + delivery.width + 0.01);
  assert.ok(delivery.x + delivery.width + 60 <= near.x + near.width + 0.01);
  const standardsOutlines = await page.evaluate(() => window.editor.current().elements
    .filter((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === "neara/delivery/standards")
    .map((element) => ({ x: element.x, y: element.y, width: element.width, height: element.height })));
  assert.deepEqual(standardsOutlines, [{ x: standards.x, y: standards.y, width: standards.width, height: standards.height }], "no old Standards outline survives at its starting size");
  assert.ok(Object.values(crossing).every((region) => region.locked === false && region.deleted === false));
  for (const area of ["neara", "neara/delivery", "neara/delivery/standards"]) await page.getByRole("button", { name: labelPattern(area) }).waitFor();

  const actual = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
  assert.deepEqual(pngSize(actual), { width: 1440, height: 1000 }, "the crossing capture keeps its exact CSS viewport");
  if (process.env.UPDATE_AREA_MAP_GOLDENS === "1") await writeFile(goldenPath, actual);
  const expected = await readFile(goldenPath);
  assert.deepEqual(pngSize(expected), pngSize(actual), "the exact golden keeps the fixed viewport contract");
  const matchesGolden = Buffer.compare(actual, expected) === 0;
  const actualPath = path.join(os.tmpdir(), "tangent-near-delivery-standards-crossing-actual.png");
  if (!matchesGolden) await writeFile(actualPath, actual);
  assert.equal(
    matchesGolden,
    true,
    `crossing golden changed: expected ${digest(expected)}, actual ${digest(actual)}; inspect ${actualPath}, then run UPDATE_AREA_MAP_GOLDENS=1 for an intentional update`,
  );

  await page.mouse.up();
  for (const area of ["neara", "neara/delivery", "neara/delivery/standards"]) {
    await selectArea(page, area);
    assert.equal(await selectedArea(page), area);
  }
});

test("Delivery growth reflows Hackathon instead of clipping the pointer", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?wall=1", { width: 1800, height: 1100 });
  const before = await regions(page);
  await beginSouthEastResize(page, "neara/delivery/standards", 500, 8);
  const preview = await regions(page);
  assert.ok(preview["neara/delivery/standards"].width > before["neara/delivery/standards"].width + 450, "the selected resize keeps the complete pointer delta");
  assert.ok(preview["neara/delivery"].width > before["neara/delivery"].width, "the direct parent expands");
  assert.ok(preview["neara/hackathon"].x > before["neara/hackathon"].x, "the affected sibling branch moves out of the expanded path");
  assert.ok(preview["neara/delivery"].x + preview["neara/delivery"].width <= preview["neara/hackathon"].x + 0.01, "the automatic reflow prevents overlap");
  assert.equal(await page.locator(".tangent-map-live", { hasText: "stopped at hackathon" }).count(), 0, "automatic reflow does not announce a wall");
  await page.mouse.up();
});

test("a structural block insertion anchors its auto-reflowed Area across reload", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?reflow-anchor=1", { width: 1800, height: 1100 });
  await page.evaluate(() => window.editor.fitArea("neara/hackathon", { push: false }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const blocksBefore = await authoredBlocks(page, "neara/hackathon", { rendered: true });
  const before = await page.evaluate(() => {
    const snapshot = window.editor.controller().snapshot();
    const node = snapshot.world.areas.find((entry) => entry.key === "neara/hackathon");
    const delivery = snapshot.composition.geometry.get("neara/delivery");
    const hackathon = snapshot.composition.geometry.get("neara/hackathon");
    const drawn = snapshot.composition.regionRects.get("neara/hackathon");
    return {
      stored: structuredClone(node.region.storedRect),
      resolved: structuredClone(hackathon.resolvedStored),
      deliveryResolved: structuredClone(delivery.resolvedStored),
      drawn: structuredClone(drawn),
    };
  });
  assert.notDeepEqual(before.resolved, before.stored, "Hackathon starts at a lower-priority derived position");

  const insertion = { x: before.drawn.x + before.drawn.width - 2, y: before.drawn.y + before.drawn.height - 2 };
  const insertionViewport = await viewportPoint(page, insertion.x, insertion.y);
  await page.mouse.move(insertionViewport.x, insertionViewport.y);
  await page.waitForTimeout(80);
  await page.keyboard.press("b");
  const picker = page.getByRole("dialog", { name: "Place a Tangent block" });
  await picker.getByRole("textbox").fill("https://example.com/reflow-anchor");
  const priorEvents = await page.evaluate(() => window.worldEvents.length);
  await page.keyboard.press("Enter");
  await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents);

  const blocksAfter = await authoredBlocks(page, "neara/hackathon", { rendered: true });
  const blockAfter = blocksAfter.find((block) => !blocksBefore.some((beforeBlock) => beforeBlock.sourceId === block.sourceId));
  assert.ok(blockAfter, `the picker inserts one source-owned block: ${JSON.stringify({ blocksBefore, blocksAfter })}`);
  const after = await page.evaluate(() => {
    const snapshot = window.editor.controller().snapshot();
    const event = window.worldEvents.at(-1);
    const node = snapshot.world.areas.find((entry) => entry.key === "neara/hackathon");
    return {
      event: structuredClone(event),
      stored: structuredClone(node.region.storedRect),
      layout: structuredClone(node.region.layout),
      resolved: structuredClone(snapshot.composition.geometry.get("neara/hackathon").resolvedStored),
      deliveryResolved: structuredClone(snapshot.composition.geometry.get("neara/delivery").resolvedStored),
      drawn: structuredClone(snapshot.composition.regionRects.get("neara/hackathon")),
    };
  });
  assert.deepEqual(after.event.areas, ["neara/hackathon"]);
  assert.deepEqual(after.event.owners, ["neara/hackathon"]);
  assert.deepEqual(after.stored, before.resolved, "the visible derived position becomes the authored anchor");
  assert.deepEqual(after.resolved, before.resolved, "reprioritizing does not teleport Hackathon");
  assert.equal(after.layout.priority, 3);
  assert.ok(Math.abs(blockAfter.x + blockAfter.width / 2 - insertion.x) < 1 && Math.abs(blockAfter.y + blockAfter.height / 2 - insertion.y) < 1, `the inserted block stays at the real pointer: ${JSON.stringify({ insertion, blockAfter })}`);
  assert.deepEqual({ x: after.drawn.x, y: after.drawn.y }, { x: before.drawn.x, y: before.drawn.y }, "the Area stays under its edited block");
  assert.notDeepEqual(after.deliveryResolved, before.deliveryResolved, "the lower-priority sibling moves instead");

  await page.evaluate(async () => {
    window.nextWorld = structuredClone(window.worldEvents.at(-1).world);
    await window.editor.controller().reload();
  });
  const reloadedBlock = (await authoredBlocks(page, "neara/hackathon", { rendered: true })).find((block) => block.sourceId === blockAfter.sourceId);
  const reloaded = await page.evaluate(() => {
    const snapshot = window.editor.controller().snapshot();
    return {
      resolved: structuredClone(snapshot.composition.geometry.get("neara/hackathon").resolvedStored),
      deliveryResolved: structuredClone(snapshot.composition.geometry.get("neara/delivery").resolvedStored),
      drawn: structuredClone(snapshot.composition.regionRects.get("neara/hackathon")),
    };
  });
  assert.deepEqual(reloaded, { resolved: after.resolved, deliveryResolved: after.deliveryResolved, drawn: after.drawn });
  assert.deepEqual(reloadedBlock, blockAfter, "reload preserves the block and owner coordinates exactly");
});
