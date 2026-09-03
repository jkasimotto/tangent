import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

// Audit defect, "Not fixed" list: "The documented Space-drag pan folds the selected Area and drags
// it instead". Help still promises "Space-drag pans", so the observable contract this file holds
// the Map to is the promise: with an Area selected, a drag on the canvas while Space is held moves
// the camera, leaves every Area rectangle where it was on every frame of the drag, writes nothing
// to the vault, and leaves the Area unfolded.

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Map space pan fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const tangentScene = empty();
tangentScene.elements.push(...core.createBlockElements({ id: "tangent-goal", kind: "goal", ref: "otto/tangent/goal-proof.md", title: "Tangent proof", status: "active", x: 160, y: 160, width: 220, height: 100 }));
const world = {
  schema: "area-map-world.v1", worldId: "space-pan-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent", "otto/side"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 100, y: 100, width: 620, height: 440 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: tangentScene.elements.length, blockCount: 1, scene: tangentScene } },
    { key: "otto/side", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/side", owner: "otto", child: "otto/side", sourceId: "region-side", labelSourceId: "label-side", source: "stored", storedRect: { x: 800, y: 100, width: 240, height: 300 } }, shard: { owner: "otto/side", hash: "side-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
  { kind: "area", area: "otto/side", file: "otto/side/side.md", title: "Side", status: "active" },
  { kind: "goal", area: "otto/tangent", file: "otto/tangent/goal-proof.md", title: "Tangent proof", status: "active", live: true },
];
window.worldEvents = [];
/** Serves only the read routes the composed Map asks for; this fixture has no resources. */
const api = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: (body?.resources ?? []).map(() => ({ state: "gone", value: null })) };
  if (url.startsWith("/api/areas/map-resources?")) return { state: "current", viewedFrom: "otto/tangent", catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  throw new Error("Unexpected space pan fixture route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api, focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: (nextWorld, changedAreas, changedOwners) => {
    window.worldEvents.push({ areas: [...changedAreas], owners: [...changedOwners] });
    return { status: 200, hashes: {}, treeRevision: "tree-2", worldRevision: "world-2" };
  },
  onEntityVerb: () => {}, onBack: () => {},
});
window.settleMap = async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return window.editor.controller().flush();
};
</script></body></html>`;

/** Waits for the frame after React commits, so a geometry reading never reports the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Returns the canonical world rectangle of every Area, the scene-space geometry the vault stores. */
async function canonicalRegions(page) {
  return page.evaluate(() => Object.fromEntries(window.editor.current().elements
    .filter((element) => element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
}

/** Returns the rectangle of every Area as the mounted Excalidraw scene is drawing it right now. */
async function drawnRegions(page) {
  return page.evaluate(() => Object.fromEntries((window.editor.rendered() ?? [])
    .filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region")
    .map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height }])));
}

/** Returns the camera the Map is showing: its scroll in scene units and its zoom. */
async function camera(page) {
  return page.evaluate(() => {
    const state = window.editor.appState();
    return { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value };
  });
}

/** Returns the words the Area's own name pill says about it, which is where a person reads its fold state. */
async function labelWords(page, area) {
  return page.evaluate((target) => document.querySelector(`[data-area-map-label="${target}"]`)?.getAttribute("aria-label") ?? "", area);
}

/** Converts one scene point to a viewport point on the interactive canvas. */
async function viewportPoint(page, point) {
  const box = await page.locator(".excalidraw canvas.interactive").boundingBox();
  assert.ok(box);
  const view = await camera(page);
  return { x: box.x + (point.x + view.scrollX) * view.zoom, y: box.y + (point.y + view.scrollY) * view.zoom };
}

/** Selects one Area by activating its name pill, the way a person picks an Area before working on it. */
async function selectArea(page, area) {
  await page.locator(`[data-area-map-label="${area}"]`).evaluate((pill) => pill.click());
  await page.waitForFunction((target) => {
    const selected = window.editor.appState().selectedElementIds;
    return window.editor.current().elements.some((element) => selected[element.id] && element.customData?.tangent?.area === target);
  }, area, { timeout: 5_000 });
  await settled(page);
}

test("holding Space and dragging pans the Map instead of folding and dragging the selected Area", { skip: !enabled, timeout: 90_000 }, async (context) => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
  context.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(() => window.editor.controller().setRestriction(null));
  await page.waitForFunction(() => window.editor.controller().snapshot().restrictionArea === null);
  await settled(page);

  await selectArea(page, "otto/tangent");
  assert.match(await labelWords(page, "otto/tangent"), /unfolded/, "the Area starts unfolded");

  const before = { canonical: await canonicalRegions(page), drawn: await drawnRegions(page), camera: await camera(page) };
  const region = before.drawn["otto/tangent"];
  assert.ok(region, "the selected Area is drawn on the canvas");
  // The same grip the Map's own drag tests press: inside the selected Area's body, clear of its
  // Block and of its name pill. Without Space held this press moves the Area.
  const grip = { x: region.x + region.width - 45, y: region.y + region.height * 0.3 };
  const start = await viewportPoint(page, grip);
  const travel = { x: 180, y: 120 };
  const hit = await page.evaluate((point) => {
    const element = document.elementFromPoint(point.x, point.y);
    return { tag: element?.tagName ?? "", className: String(element?.className ?? "") };
  }, start);
  assert.equal(hit.tag, "CANVAS", `the grip must land on the canvas: ${JSON.stringify({ hit, start, region })}`);
  assert.match(hit.className, /interactive/, "the grip must land on the interactive canvas");

  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Space");
  await settled(page);
  await page.mouse.down();
  const samples = [];
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + travel.x * step / 8, start.y + travel.y * step / 8);
    samples.push({ step, canonical: await canonicalRegions(page), drawn: await drawnRegions(page) });
  }
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.evaluate(() => window.settleMap());
  await settled(page);

  for (const sample of samples) {
    assert.deepEqual(sample.drawn, before.drawn, `no Area moves on the canvas during the Space drag, frame ${sample.step}`);
    assert.deepEqual(sample.canonical, before.canonical, `no Area rectangle changes in scene space during the Space drag, frame ${sample.step}`);
  }
  assert.deepEqual(await canonicalRegions(page), before.canonical, "every Area rectangle is unchanged in scene space after the Space drag");
  assert.deepEqual(await drawnRegions(page), before.drawn, "every Area is drawn where it was before the Space drag");
  assert.deepEqual(await page.evaluate(() => window.worldEvents), [], "a Space drag writes nothing to the vault");

  assert.match(await labelWords(page, "otto/tangent"), /unfolded/, "the Space drag leaves the selected Area unfolded");
  assert.equal(await page.getByText("folded · Space", { exact: true }).count(), 0, "no Area reads as folded after the Space drag");

  const after = await camera(page);
  assert.equal(after.zoom, before.camera.zoom, "a Space drag pans without zooming");
  const moved = { x: (after.scrollX - before.camera.scrollX) * before.camera.zoom, y: (after.scrollY - before.camera.scrollY) * before.camera.zoom };
  assert.ok(moved.x > travel.x / 2 && moved.y > travel.y / 2, `the camera follows the Space drag: ${JSON.stringify({ moved, travel, before: before.camera, after })}`);

  // Space without a drag keeps its documented meaning, so the pan above is a distinction the Map
  // draws between a tap and a drag, not the fold binding removed.
  await page.keyboard.press("Space");
  await settled(page);
  assert.match(await labelWords(page, "otto/tangent"), /, folded,/, "Space alone still folds the selected Area");
  await page.keyboard.press("Space");
  await settled(page);
  assert.match(await labelWords(page, "otto/tangent"), /unfolded/, "Space alone unfolds it again");
});
