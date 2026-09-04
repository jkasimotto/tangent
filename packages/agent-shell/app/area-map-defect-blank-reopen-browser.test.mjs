// Regression proof for the audit defect "Reopening the Map can land on a completely blank canvas
// with no way back except Excalidraw's own button".
//
// Over-scrolling is easy: sixty wheel notches carry the camera tens of thousands of scene pixels
// away from every Area. While the page is open that is Excalidraw's business, and its own "Scroll
// back to content" button is there. The defect is what the Map does next: the camera is saved in
// the private view record, and on the next open the Map replays it verbatim, with no check that
// anything would be in frame, so the person opens the Map on an empty grey canvas with no Area, no
// pill and no message.
//
// This suite drives the real wheel over a real Chromium, reloads the same URL so the same private
// view record is replayed, and samples the camera and the Area rectangles in view on every frame
// after the reopen. It requires that the reopened Map shows Areas, that it settles there rather
// than drifting back off, and that the person never has to press Excalidraw's button. It also
// requires that the over-scroll itself still happened, so a Map that simply refused to pan would
// not pass this by accident.
//
// Design: docs/design/area-map-rebuild/code.md.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** How far past the content one over-scroll drives the camera: the audit's sixty notches of 220. */
const WHEEL_NOTCHES = 60;
const WHEEL_DELTA = 220;

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map blank reopen fixture</title>
  <link rel="stylesheet" href="/agent-shell-map.css">
  <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style>
</head>
<body>
<div id="map"></div>
<script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

/** One empty shard scene, so every Area in this fixture is a plain rectangle with a name. */
const scene = () => core.createEmptyScene();

const records = [
  ["otto", "@root", { x: 0, y: 0, width: 1600, height: 1040 }],
  ["otto/tangent", "otto", { x: 120, y: 120, width: 1000, height: 760 }],
  ["otto/tangent/map", "otto/tangent", { x: 200, y: 240, width: 260, height: 220 }],
  ["otto/tangent/usage", "otto/tangent", { x: 520, y: 240, width: 260, height: 220 }],
  ["otto/tangent/eval", "otto/tangent", { x: 200, y: 540, width: 260, height: 220 }],
];

const nodes = records.map(([key, parent, storedRect]) => ({
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
  shard: { owner: key, hash: "hash-" + key, state: "ready", elementCount: 0, blockCount: 0, scene: scene() },
}));

const world = {
  schema: "area-map-world.v1",
  worldId: "blank-reopen-world",
  treeRevision: "tree-1",
  worldRevision: "world-1",
  locatedArea: "otto/tangent",
  areas: nodes,
};

const documents = records.map(([area]) => ({
  kind: "area",
  area,
  file: area + "/" + area.split("/").at(-1) + ".md",
  title: area.split("/").at(-1).replace(/^./, (letter) => letter.toUpperCase()),
  status: "active",
}));

/** Serves only the read routes a Map with no resource Blocks asks for. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: [] };
  if (url.startsWith("/api/areas/map-resources?")) return {
    state: "current",
    viewedFrom: new URL(url, location.origin).searchParams.get("area"),
    catalogs: [],
    counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
    suggestions: [],
    legacyReview: [],
    rows: [],
  };
  throw new Error("Unexpected blank reopen fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: scene(),
  getDocuments: () => documents,
  api,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: () => ({ status: 200, hashes: {}, treeRevision: "tree-2", worldRevision: "world-2" }),
  onEntityVerb: () => {},
  onBack: () => {},
});

/** The scene rectangle the canvas shows now, from Excalidraw's own camera and the host's size. */
function viewRect() {
  const state = window.editor.appState();
  if (!state) return null;
  const zoom = state.zoom?.value ?? state.zoom ?? 1;
  const box = document.querySelector("#map").getBoundingClientRect();
  return { x: -state.scrollX, y: -state.scrollY, width: box.width / zoom, height: box.height / zoom, zoom, scrollX: state.scrollX, scrollY: state.scrollY };
}

/** How many Area rectangles the canvas has any part of in view, which is what "blank" means here. */
function areasInView() {
  const view = viewRect();
  const rects = window.editor.controller?.().snapshot().composition.regionRects;
  if (!view || !rects) return 0;
  let seen = 0;
  for (const rect of rects.values()) {
    const overlaps = rect.x < view.x + view.width && rect.x + rect.width > view.x && rect.y < view.y + view.height && rect.y + rect.height > view.y;
    if (overlaps) seen += 1;
  }
  return seen;
}

window.viewSamples = [];

/** Records the camera and what is in view on every frame, so a reading never misses a blank frame. */
function sampleFrame() {
  const view = viewRect();
  if (view) window.viewSamples.push({ at: Math.round(performance.now()), scrollX: Math.round(view.scrollX), scrollY: Math.round(view.scrollY), zoom: view.zoom, areasInView: areasInView() });
  requestAnimationFrame(sampleFrame);
}
requestAnimationFrame(sampleFrame);
</script>
</body>
</html>`;

/** Waits for the frame after React commits, so a geometry reading never describes the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Waits until the Map is mounted, the camera exists and the first frame has been sampled. */
async function mounted(page) {
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value && window.editor.controller?.() && window.viewSamples.length > 0);
  await settled(page);
}

/** Reads the Map camera and how many Area rectangles are in view right now. */
async function view(page) {
  return page.evaluate(() => {
    const state = window.editor.appState();
    return { scrollX: Math.round(state.scrollX), scrollY: Math.round(state.scrollY), zoom: state.zoom?.value ?? state.zoom, areasInView: window.areasInView?.() ?? null };
  });
}

/** How many Area name pills have any part of them inside the browser viewport. */
async function pillsOnScreen(page) {
  const boxes = await page.locator("[data-area-map-label]").all();
  const size = page.viewportSize();
  let seen = 0;
  for (const pill of boxes) {
    const box = await pill.boundingBox();
    if (box && box.x + box.width > 0 && box.x < size.width && box.y + box.height > 0 && box.y < size.height) seen += 1;
  }
  return seen;
}

/** Every frame sampled since the sampler was last cleared. */
async function frames(page) {
  return page.evaluate(() => window.viewSamples.map((sample) => ({ ...sample })));
}

/** Whether Excalidraw is offering its "Scroll back to content" button, which only an empty view shows. */
async function scrollBackOffered(page) {
  return page.locator("button.scroll-back-to-content").isVisible().catch(() => false);
}

test("reopening the Map after an over-scroll shows Areas rather than a blank canvas", { skip: !enabled, timeout: 120_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/blank-reopen-fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fixture);
      return;
    }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
    /** The fixture's own helpers on the page, so a reading in Node can ask the page what is in view. */
    await page.addInitScript(() => { window.areasInView = () => window.viewSamples.at(-1)?.areasInView ?? 0; });
    const address = `http://127.0.0.1:${server.address().port}/blank-reopen-fixture`;
    await page.goto(address, { waitUntil: "networkidle" });
    await mounted(page);
    await page.waitForFunction(() => window.viewSamples.at(-1)?.areasInView > 0, undefined, { timeout: 15_000 });

    // The Map opens on its located Area: Areas are in view and Excalidraw offers no way back.
    const opened = await view(page);
    assert.ok(opened.areasInView > 0, `the first visit shows Areas: ${JSON.stringify(opened)}`);
    assert.ok(await pillsOnScreen(page) > 0, "the first visit shows Area name pills on screen");
    assert.equal(await scrollBackOffered(page), false, "the first visit needs no scroll-back button");

    // Over-scroll the way anyone does, far past every Area.
    await page.mouse.move(720, 500);
    for (let notch = 0; notch < WHEEL_NOTCHES; notch += 1) await page.mouse.wheel(0, WHEEL_DELTA);
    await page.waitForFunction(() => window.viewSamples.at(-1)?.areasInView === 0, undefined, { timeout: 15_000 });
    await settled(page);
    const panned = await view(page);
    assert.equal(panned.areasInView, 0, `the over-scroll leaves nothing in view: ${JSON.stringify(panned)}`);
    assert.equal(await pillsOnScreen(page), 0, "the over-scroll leaves no Area name pill on screen");
    assert.ok(Math.abs(panned.scrollY - opened.scrollY) > 1000, `the over-scroll moved the camera far: ${JSON.stringify({ opened, panned })}`);

    // The private view record now holds that empty camera, which is what the next open replays.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tangent.area-map-view.v2:blank-reopen-world") || "null"));
    assert.ok(stored, "the Map saved its private view record");
    assert.ok(Math.abs(Math.round(stored.pan.y) - panned.scrollY) < 2, `the saved record holds the over-scrolled camera: ${JSON.stringify({ stored: stored.pan, panned })}`);

    // Reopen the same URL. This is the defect: the saved camera comes back verbatim and nothing is
    // drawn. Sample every frame, so a Map that shows content and then drifts away fails too.
    await page.reload({ waitUntil: "networkidle" });
    await mounted(page);
    const firstFrame = (await frames(page))[0];
    await page.waitForFunction(() => window.viewSamples.at(-1)?.areasInView > 0, undefined, { timeout: 15_000 }).catch(() => null);
    await settled(page);

    const reopened = await view(page);
    const samples = await frames(page);
    const detail = JSON.stringify({ firstFrame, reopened, storedPan: stored.pan, frames: samples.length, blankFrames: samples.filter((sample) => sample.areasInView === 0).length });
    assert.ok(reopened.areasInView > 0, `the reopened Map shows Areas rather than a blank canvas: ${detail}`);
    assert.ok(await pillsOnScreen(page) > 0, `the reopened Map shows Area name pills on screen: ${detail}`);
    assert.equal(await scrollBackOffered(page), false, `the reopened Map does not need Excalidraw's scroll-back button: ${detail}`);

    // It settles there: every one of the last twenty frames still has Areas in view.
    const tail = samples.slice(-20);
    assert.ok(tail.length >= 10, `the reopen was sampled across frames: ${detail}`);
    assert.equal(tail.filter((sample) => sample.areasInView === 0).length, 0, `the reopened Map keeps Areas in view on every settled frame: ${JSON.stringify(tail)}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
