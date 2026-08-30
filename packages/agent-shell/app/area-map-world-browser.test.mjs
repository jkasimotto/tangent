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
const focusedFixture = params.get("focus") === "1";
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
  ["neara/hackathon", "neara", wallFixture ? { x: 1100, y: 100, width: 500, height: 500 } : { x: 600, y: 1050, width: 400, height: 300 }, "ready"],
  ["neara/essential", "neara", { x: 100, y: 1050, width: 400, height: 300 }, "deferred"],
  ["neara/portland", "neara", { x: 100, y: 1450, width: 400, height: 300 }, "unreadable"],
];
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
}));
documents.push(
  { kind: "goal", area: "neara/delivery/standards", file: "neara/delivery/standards/goal-proof.md", title: "Standards proof", status: "active", live: true },
  { kind: "document", area: "neara/hackathon", file: "neara/hackathon/design-plan.md", title: "Hackathon plan", status: "draft", live: false },
);

window.worldEvents = [];
window.loadCalls = [];
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
    return {
      area,
      worldRevision: world.worldRevision,
      hash: "hash-" + area,
      state: "ready",
      scene: scene(),
    };
  },
  reloadWorld: async () => structuredClone(window.nextWorld ?? world),
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
  return page;
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

/** Drags one selected Area from visible parent-only interior by one world-space delta. */
async function moveArea(page, area, delta) {
  await page.evaluate((target) => window.editor.fitArea(target, { push: false }), area);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await selectArea(page, area);
  const before = (await regions(page))[area];
  const grip = { x: before.x + before.width - 45, y: before.y + before.height * 0.3 };
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

/** Starts a right-middle resize and leaves the pointer down for same-frame assertions. */
async function beginRightResize(page, area, delta, steps = 4) {
  await selectArea(page, area);
  const before = (await regions(page))[area];
  const start = await viewportPoint(page, before.x + before.width, before.y + before.height / 2);
  const end = await viewportPoint(page, before.x + before.width + delta, before.y + before.height / 2);
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
async function authoredBlock(page, owner) {
  return page.evaluate((expectedOwner) => {
    const element = window.editor.current().elements.find((item) => item.type === "rectangle" && item.customData?.tangentWorld?.owner === expectedOwner && item.customData?.tangent?.ref);
    return element ? { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, deleted: element.isDeleted } : null;
  }, owner);
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
  const drag = await beginRightResize(page, "neara/delivery/standards", 320, 4);
  const preview = await regions(page);
  const sourcePreview = await page.evaluate(() => window.editor.controller().world().areas.find((node) => node.key === "neara/delivery/standards").region.storedRect);
  assert.ok(preview["neara/delivery/standards"].width > before["neara/delivery/standards"].width + 250, `the right-middle handle did not resize Standards: ${JSON.stringify({ before: before["neara/delivery/standards"], preview: preview["neara/delivery/standards"], sourcePreview, drag })}`);
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
  const beforeBlock = await authoredBlock(page, "neara/delivery/standards");
  const blockCenter = await viewportPoint(page, beforeBlock.x + beforeBlock.width / 2, beforeBlock.y + beforeBlock.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(blockCenter.x, blockCenter.y);
  await page.keyboard.up("Shift");
  const selected = await page.evaluate(() => ({ app: window.editor.appState().selectedElementIds, controller: [...window.editor.controller().snapshot().selection] }));
  assert.equal(selected.app[beforeRegion.id], true, `the real Shift-click keeps the Standards region selected: ${JSON.stringify(selected)}`);
  assert.equal(selected.app[beforeBlock.id], true, `the real Shift-click adds the Standards block: ${JSON.stringify(selected)}`);
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
  const movedBlock = await authoredBlock(page, "neara/delivery/standards");
  assert.notDeepEqual({ x: movedRegion.x, y: movedRegion.y }, { x: beforeRegion.x, y: beforeRegion.y });
  assert.notDeepEqual({ x: movedBlock.x, y: movedBlock.y }, { x: beforeBlock.x, y: beforeBlock.y });

  await page.keyboard.press("Meta+z");
  await page.waitForFunction((x) => {
    const element = window.editor.current().elements.find((item) => item.customData?.tangent?.area === "neara/delivery/standards");
    return Math.abs(element.x - x) < 0.01;
  }, beforeRegion.x);
  assert.deepEqual(await authoredBlock(page, "neara/delivery/standards"), beforeBlock);

  await page.keyboard.press("Meta+Shift+z");
  await page.waitForFunction((x) => {
    const element = window.editor.current().elements.find((item) => item.customData?.tangent?.area === "neara/delivery/standards");
    return Math.abs(element.x - x) < 0.01;
  }, movedRegion.x);
  assert.deepEqual(await authoredBlock(page, "neara/delivery/standards"), movedBlock);
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
  const buttons = outline.getByRole("treeitem");
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
  await buttons.first().focus();
  for (let index = 0; index < count; index += 1) {
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
    if (index < count - 1) await page.keyboard.press("ArrowDown");
  }
});

test("Standards never crosses Delivery while Delivery and Neara grow", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?crossing=1");
  const before = await regions(page);
  await beginRightResize(page, "neara/delivery/standards", 320, 4);
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

test("Hackathon is a sibling wall for Delivery growth", { timeout: 90_000 }, async (context) => {
  const page = await openWorld(context, "?wall=1", { width: 1800, height: 1100 });
  const before = await regions(page);
  await beginRightResize(page, "neara/delivery/standards", 500, 8);
  const wallAnnouncement = page.locator(".tangent-map-live", { hasText: "stopped at hackathon" });
  await wallAnnouncement.waitFor();
  assert.equal(await page.locator(".tangent-map-live").count(), 1, "one sibling wall command creates one assistive live message");
  const preview = await regions(page);
  assert.ok(preview["neara/delivery"].x + preview["neara/delivery"].width <= preview["neara/hackathon"].x + 0.01);
  assert.deepEqual(preview["neara/hackathon"], before["neara/hackathon"], "the sibling wall never moves");
  assert.ok(preview["neara/delivery/standards"].width < before["neara/delivery/standards"].width + 500);
  await page.mouse.up();
});
