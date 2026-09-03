// Proof for the reported defect "there is some flickering going on in the UI now", new since the
// Map rebuild.
//
// Flicker is a timing fact, so it is measured the way the rebuild measures every other timing fact:
// a real Chromium page mounting mountAreaBoardEditor over a static server, sampled on every
// animation frame. This suite settles the Map, then records windows of consecutive animation frames
// and counts, per frame, the DOM mutations under the Map host, the area_map_projection diagnostics
// the fence records (one per scene push into Excalidraw), the view states the Map reports to the
// shell, the screen position of every Area name pill and the text of the control row.
//
// Three facts, in three windows.
//
// A Map nobody is touching must be still: no node under it is added, removed or rewritten, no scene
// is pushed into Excalidraw, and it tells the shell nothing.
//
// A fact refresh that changes nothing must be silent as well. The shell calls refreshFacts on every
// pass of its event stream (public/area-map-pane.js update -> controller.refreshFacts), and the
// controller bumps its facts revision unconditionally (public/area-map-world-controller.js
// refreshFacts), so the Map re-renders. Reporting the same view state again is what a person sees:
// the shell's onViewState runs updateHeader, which rebuilds the whole Map context bar from
// innerHTML (public/shell.js), replacing the breadcrumb buttons and the status text with identical
// content. The Map must report its view state when the view state changes, not when it renders.
//
// A drag must move the pills, not replace them: the pill node for the dragged Area is the same DOM
// node before and after, and it is never removed from the layer.
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

/** How many consecutive animation frames one recording window covers. */
const WINDOW_FRAMES = 90;

/** How many fact refreshes the second window makes, each one changing nothing at all. */
const REFRESH_COUNT = 10;

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map idle flicker fixture</title>
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
  ["otto", "@root", { x: 80, y: 80, width: 1200, height: 820 }],
  ["otto/tangent", "otto", { x: 160, y: 160, width: 520, height: 420 }],
  ["otto/house", "otto", { x: 760, y: 200, width: 420, height: 360 }],
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
  worldId: "idle-flicker-world",
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

window.worldEvents = [];
window.viewStates = [];

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
  throw new Error("Unexpected idle flicker fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: scene(),
  getDocuments: () => documents,
  api,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: (nextWorld, changedAreas, changedOwners) => {
    window.worldEvents.push({ areas: [...changedAreas], owners: [...changedOwners] });
    return { status: 200, hashes: {}, treeRevision: "tree-2", worldRevision: "world-2" };
  },
  onEntityVerb: () => {},
  onBack: () => {},
  onViewState: (value) => { window.viewStates.push(JSON.stringify(value)); },
});

/** One short word for the node a mutation record names, so a failure says what moved. */
const describeNode = (node) => {
  if (!(node instanceof Element)) return node?.nodeName === "#text" ? "text(" + String(node.textContent).slice(0, 24) + ")" : String(node?.nodeName ?? "?");
  const label = node.getAttribute("data-area-map-label");
  return (label ? "pill[" + label + "]" : node.tagName.toLowerCase()) + (node.className ? "." + String(node.className).split(" ").join(".") : "");
};

/** One mutation record as plain fields, which is what a failure message prints. */
const describeMutation = (record) => ({
  type: record.type,
  target: describeNode(record.target),
  attribute: record.attributeName ?? null,
  added: [...record.addedNodes].map(describeNode),
  removed: [...record.removedNodes].map(describeNode),
});

/** The screen position of every Area name pill, as one string per frame. */
const pillSignature = () => [...document.querySelectorAll("[data-area-map-label]")]
  .map((pill) => pill.getAttribute("data-area-map-label") + "@" + pill.style.left + "," + pill.style.top)
  .sort()
  .join("|");

/** The words the control row shows, as one string per frame. */
const toolbarSignature = () => {
  const bar = document.querySelector(".tangent-map-controls") ?? document.querySelector("#map");
  return String(bar?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
};

/**
 * Records one window of consecutive animation frames while something, or nothing, happens. Every
 * frame carries the running count of DOM mutations under the Map host, of scene pushes into
 * Excalidraw and of view states reported to the shell, plus the pill positions and the control row
 * text as they are at that frame.
 */
window.recordFlicker = (frameCount, during) => new Promise((resolve) => {
  const host = document.querySelector("#map");
  const mutations = [];
  const observer = new MutationObserver((list) => { for (const record of list) mutations.push(describeMutation(record)); });
  observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  const removedPills = [];
  const layerObserver = new MutationObserver((list) => {
    for (const record of list) {
      for (const node of record.removedNodes) if (node instanceof Element && node.matches?.("[data-area-map-label]")) removedPills.push(node.getAttribute("data-area-map-label"));
    }
  });
  const layer = document.querySelector(".tangent-map-ancestry");
  if (layer) layerObserver.observe(layer, { subtree: true, childList: true });
  const projections = [];
  /** Counts one projection diagnostic, which the fence records once per scene push. */
  const onMapEvent = (event) => {
    const detail = event.detail;
    if (detail && detail.name === "area_map_projection") projections.push({ phase: detail.phase ?? null, kind: detail.projectionKind ?? null });
  };
  window.addEventListener("tangent:area-map", onMapEvent);
  const reportsBefore = window.viewStates.length;
  const stopDuring = typeof during === "string" && during ? new Function("return (" + during + ")")()() : null;
  const frames = [];
  let index = 0;
  /** Samples one animation frame and schedules the next, or finishes the window. */
  const tick = () => {
    frames.push({ index, mutations: mutations.length, projections: projections.length, reports: window.viewStates.length - reportsBefore, pills: pillSignature(), toolbar: toolbarSignature() });
    index += 1;
    if (index < frameCount) { requestAnimationFrame(tick); return; }
    if (stopDuring) stopDuring();
    for (const record of observer.takeRecords()) mutations.push(describeMutation(record));
    observer.disconnect();
    layerObserver.disconnect();
    window.removeEventListener("tangent:area-map", onMapEvent);
    const reports = window.viewStates.slice(reportsBefore);
    resolve({ frames, mutations, removedPills, projections, reports, distinctReports: [...new Set([window.viewStates[reportsBefore - 1] ?? "", ...reports])] });
  };
  requestAnimationFrame(tick);
});
</script>
</body>
</html>`;

/** Waits for the frame after React commits, so a reading never describes the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** The viewport centre of one Area's name pill, which is where a drag starts. */
async function pillCentre(page, area) {
  const box = await page.locator(`[data-area-map-label="${area}"]`).boundingBox();
  assert.ok(box, `the ${area} name pill is on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The frames of a recording whose sampled pill positions or control row text differ from the first. */
function changedFrames(frames) {
  const first = frames[0];
  return frames.filter((frame) => frame.pills !== first.pills || frame.toolbar !== first.toolbar).map((frame) => frame.index);
}

/** The first few distinct mutation shapes a recording saw, which is what names the repaint. */
function mutationShapes(mutations) {
  const seen = new Map();
  for (const record of mutations) {
    const key = JSON.stringify(record);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].slice(0, 8).map(([key, times]) => ({ ...JSON.parse(key), times }));
}

test("an idle Map repaints nothing, a fact refresh that changes nothing tells the shell nothing, and a drag moves the pills instead of replacing them", { skip: !enabled, timeout: 120_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/idle-flicker-fixture") {
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
    await page.goto(`http://127.0.0.1:${server.address().port}/idle-flicker-fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
    await page.locator('[data-area-map-label="otto/tangent"]').waitFor();
    await settled(page);
    // The Map has mounted, fitted the Area it opened on and spoken whatever it announces on arrival.
    // Everything after this point is a Map nobody is touching.
    await page.waitForTimeout(2_500);
    await settled(page);

    const idle = await page.evaluate((frames) => window.recordFlicker(frames, null), WINDOW_FRAMES);
    assert.equal(idle.frames.length, WINDOW_FRAMES, "the idle window sampled every frame it asked for");

    assert.deepEqual(
      changedFrames(idle.frames),
      [],
      `an idle Map holds its Area name pills and its control row still across ${WINDOW_FRAMES} frames: ${JSON.stringify({ first: idle.frames[0], changed: idle.frames.filter((frame) => frame.pills !== idle.frames[0].pills || frame.toolbar !== idle.frames[0].toolbar).slice(0, 3) })}`,
    );
    assert.equal(
      idle.projections.length,
      0,
      `an idle Map pushes no scene into Excalidraw across ${WINDOW_FRAMES} frames, but pushed ${idle.projections.length}: ${JSON.stringify(idle.projections.slice(0, 8))}`,
    );
    assert.equal(
      idle.mutations.length,
      0,
      `an idle Map mutates no node under it across ${WINDOW_FRAMES} frames, but mutated ${idle.mutations.length}: ${JSON.stringify(mutationShapes(idle.mutations))}`,
    );
    assert.equal(
      idle.reports.length,
      0,
      `an idle Map tells the shell nothing across ${WINDOW_FRAMES} frames, but reported its view state ${idle.reports.length} times: ${JSON.stringify(idle.reports.slice(0, 4))}`,
    );

    // The same window while the shell does what it does on every pass of its event stream: ask the
    // Map to refresh its facts. Nothing here changes the world, the selection, the restriction or
    // the camera, so nothing the Map reports to the shell changes either. Every report rebuilds the
    // shell's Map context bar from innerHTML, so a report that says nothing new is the flicker.
    const driven = await page.evaluate(
      ([frames, refreshes]) => window.recordFlicker(frames, `() => { let left = ${refreshes}; const timer = setInterval(() => { if (left-- <= 0) { clearInterval(timer); return; } window.editor.refreshFacts(); }, 100); return () => clearInterval(timer); }`),
      [WINDOW_FRAMES, REFRESH_COUNT],
    );

    assert.equal(
      driven.distinctReports.length,
      1,
      `a fact refresh that changes nothing leaves the reported view state identical: ${JSON.stringify(driven.distinctReports)}`,
    );
    assert.equal(
      driven.mutations.length,
      0,
      `a fact refresh that changes nothing mutates no node under the Map, but mutated ${driven.mutations.length}: ${JSON.stringify(mutationShapes(driven.mutations))}`,
    );
    assert.equal(
      driven.projections.length,
      0,
      `a fact refresh that changes nothing pushes no scene into Excalidraw, but pushed ${driven.projections.length}: ${JSON.stringify(driven.projections.slice(0, 8))}`,
    );
    assert.equal(
      driven.reports.length,
      0,
      `a fact refresh that changes nothing does not report the view state again, but the Map reported it ${driven.reports.length} times with the same value ${JSON.stringify(driven.distinctReports[0])}; every report rebuilds the shell's Map context bar from innerHTML`,
    );

    // The last window is one slow drag of an Area. Here the pills must move, because the Area moves
    // under them, but the pill for the dragged Area must be the same DOM node throughout: a pill
    // that is removed and re-added is the flicker a person sees on the canvas.
    const start = await pillCentre(page, "otto/tangent");
    await page.evaluate(() => { window.draggedPill = document.querySelector('[data-area-map-label="otto/tangent"]'); });
    await page.mouse.move(start.x, start.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    const recording = page.evaluate((frames) => window.recordFlicker(frames, null), WINDOW_FRAMES);
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(start.x + step * 4, start.y + step * 2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const drag = await recording;

    assert.deepEqual(drag.removedPills, [], `a drag never removes an Area name pill from the layer: ${JSON.stringify(drag.removedPills)}`);
    assert.equal(
      await page.evaluate(() => window.draggedPill === document.querySelector('[data-area-map-label="otto/tangent"]')),
      true,
      "the dragged Area keeps the same name pill node from the press to the release",
    );
    assert.ok(
      drag.frames.some((frame) => frame.pills !== drag.frames[0].pills),
      "the Area name pills follow the drag",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
