// Regression proof for the audit defect "Wheel zoom and wheel pan stop dead over an Area name
// label, and the name pills swallow pointer-down, so an Area cannot be dragged by its name".
//
// The old component gave every pill `pointer-events: auto`, so the pill was the topmost element
// under its own rectangle. A wheel over a name stopped on the pill instead of reaching the canvas,
// and a press on a name never became a Map gesture, so the Area under the name could not be
// dragged. The rebuilt Map renders pills through the kit's CanvasLabel with `pointer-events: none`
// and keeps them real buttons, so the pointer falls through to the canvas while the keyboard still
// reaches the name. This suite drives real wheel, pointer and key input over one pill and requires
// all four of those facts at once.
//
// Design: docs/design/area-map-rebuild/code.md, "The eleven open defects", item 5.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map label pointer fixture</title>
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
  ["otto/tangent", "otto", { x: 160, y: 160, width: 760, height: 540 }],
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
  worldId: "label-pointer-world",
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
  throw new Error("Unexpected label pointer fixture route: " + url);
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
});
</script>
</body>
</html>`;

/** Waits for the frame after React commits, so a geometry reading never describes the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Reads the Map camera: the scroll offsets and the zoom Excalidraw currently holds. */
async function camera(page) {
  return page.evaluate(() => {
    const state = window.editor.appState();
    return { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom?.value ?? state.zoom };
  });
}

/** Reads one Area's composed region rectangle, which is the geometry a drag must change. */
async function regionRect(page, area) {
  return page.evaluate((target) => {
    const rect = window.editor.controller().snapshot().composition.regionRects.get(target);
    return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, area);
}

/** The viewport centre of one Area's name pill, which is the point every gesture here starts at. */
async function pillCentre(page, area) {
  const box = await page.locator(`[data-area-map-label="${area}"]`).boundingBox();
  assert.ok(box, `the ${area} name pill is on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Describes what the browser finds under a point, so a failure names the element that swallowed the pointer. */
async function elementUnder(page, point) {
  return page.evaluate((at) => {
    const element = document.elementFromPoint(at.x, at.y);
    return {
      tag: element?.tagName ?? "",
      className: String(element?.className ?? ""),
      insidePill: Boolean(element?.closest?.("[data-area-map-label]")),
    };
  }, point);
}

/** Clears the Map selection, so a press is judged as a first press on an Area nobody holds. */
async function clearSelection(page) {
  await page.evaluate(() => window.editor.controller().setSelection([]));
  await settled(page);
}

test("a wheel and a drag over an Area name pill reach the Map, and the pill still answers the keyboard", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/label-pointer-fixture") {
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
    await page.goto(`http://127.0.0.1:${server.address().port}/label-pointer-fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
    await page.evaluate(() => window.editor.controller().setRestriction(null));
    await page.waitForFunction(() => window.editor.controller().snapshot().restrictionArea === null);
    await settled(page);

    const pill = page.locator('[data-area-map-label="otto/tangent"]');
    await pill.waitFor();

    // The pill is transparent to the pointer, and the browser agrees: the canvas, not the name, is
    // the element under the middle of the name.
    assert.equal(await pill.evaluate((element) => getComputedStyle(element).pointerEvents), "none", "the Area name pill is transparent to the pointer");
    const centre = await pillCentre(page, "otto/tangent");
    const under = await elementUnder(page, centre);
    assert.equal(under.insidePill, false, `the middle of the name pill is not the pill itself: ${JSON.stringify(under)}`);
    assert.equal(under.tag, "CANVAS", `the middle of the name pill is the Map canvas: ${JSON.stringify(under)}`);
    assert.match(under.className, /interactive/, `the middle of the name pill is the interactive canvas: ${JSON.stringify(under)}`);

    // A drag that starts on the name moves the Area the name belongs to, and publishes it.
    await clearSelection(page);
    const beforeDrag = await regionRect(page, "otto/tangent");
    const zoom = (await camera(page)).zoom;
    const dragStart = await pillCentre(page, "otto/tangent");
    const dragged = { x: 140, y: 90 };
    const priorEvents = await page.evaluate(() => window.worldEvents.length);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + dragged.x, dragStart.y + dragged.y, { steps: 8 });
    await page.mouse.up();
    try {
      await page.waitForFunction((count) => window.worldEvents.length > count, priorEvents, { timeout: 10_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        selection: [...window.editor.controller().snapshot().selection],
        appSelection: window.editor.appState().selectedElementIds,
        region: window.editor.controller().world().areas.find((node) => node.key === "otto/tangent")?.region.storedRect,
      }));
      throw new Error(`a drag started on the Area name pill did not move the Area: ${JSON.stringify({ state, beforeDrag, dragStart, dragged })}`, { cause: error });
    }
    const afterDrag = await regionRect(page, "otto/tangent");
    const expected = { x: dragged.x / zoom, y: dragged.y / zoom };
    assert.ok(Math.abs(afterDrag.x - beforeDrag.x - expected.x) < 12, `the Area follows the drag on its name in x: ${JSON.stringify({ beforeDrag, afterDrag, expected })}`);
    assert.ok(Math.abs(afterDrag.y - beforeDrag.y - expected.y) < 12, `the Area follows the drag on its name in y: ${JSON.stringify({ beforeDrag, afterDrag, expected })}`);
    assert.equal(afterDrag.width, beforeDrag.width, "a drag on the name moves the Area rather than resizing it");
    assert.equal(afterDrag.height, beforeDrag.height, "a drag on the name moves the Area rather than resizing it");

    // A wheel over the name moves the camera, because the wheel reaches the canvas under the pill.
    const wheelPoint = await pillCentre(page, "otto/tangent");
    assert.ok(wheelPoint.x > 0 && wheelPoint.y > 0, `the Area name pill is inside the viewport before the wheel: ${JSON.stringify(wheelPoint)}`);
    const beforeWheel = await camera(page);
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.wheel(0, 260);
    await page.waitForFunction((before) => {
      const state = window.editor.appState();
      const level = state.zoom?.value ?? state.zoom;
      return Math.abs(state.scrollY - before.scrollY) > 1 || Math.abs(state.scrollX - before.scrollX) > 1 || Math.abs(level - before.zoom) > 0.001;
    }, beforeWheel, { timeout: 10_000 });
    assert.notDeepEqual(await camera(page), beforeWheel, "a wheel over the Area name pans or zooms the Map");
    await settled(page);

    // The pill stays a real button: it is in the tab order, it takes focus, and Enter on it acts.
    await clearSelection(page);
    assert.ok(await pill.evaluate((element) => element.tabIndex >= 0 && element.closest("[inert]") === null), "the Area name pill stays in the tab order");
    await pill.evaluate((element) => element.focus());
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-area-map-label") ?? null), "otto/tangent", "the Area name pill takes keyboard focus");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const selected = window.editor.appState().selectedElementIds;
      return window.editor.current().elements.some((element) => selected[element.id] && element.customData?.tangent?.area === "otto/tangent");
    }, undefined, { timeout: 10_000 });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
