// Regression proof for the polish finding "One click on a colour swatch permanently paints an Area
// solid green, and undo does not take it back".
//
// An Area outline is drawn from the Area tree, not authored on the canvas, so nothing about its
// presentation belongs to the person: the controller re-derives its stroke, its near-transparent
// fill and its opacity on every composition. Excalidraw does not know that. It shows its ordinary
// shape-properties island for whatever is selected, and one click on a Background swatch writes
// that colour straight into the outline element. The Map read the change back, found nothing for
// the world to record, and let the paint stand: inside the hundred-millisecond projection fence the
// change was absorbed as settling, so the Area stayed solid green through seconds of work, a wheel
// pan and an undo, while the save pill still read Saved.
//
// This suite drives the reported click with real pointer input and samples the outline's fill on
// every animation frame afterwards, because the defect is a timing one: the paint survives only
// while the fence is open, and a reading taken once, late, misses it. It requires two facts at
// once: the outline's fill is never anything but the composed fill on any frame, and Excalidraw's
// shape-properties island is not offered for an outline the Area tree owns.
//
// Finding: the polish audit of the Map as a person uses it, "probe-green.mjs" and
// "probe-islandacts.mjs". Design: docs/design/area-map-rebuild/code.md.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** The fill the controller derives for every Area outline, which is the only fill an outline may hold. */
const COMPOSED_FILL = "#ffffff01";

/** The Background swatch this suite clicks, which is the green the finding names. */
const SWATCH = "#b2f2bb";

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map Area outline restyle fixture</title>
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
  ["otto/tangent", "otto", { x: 120, y: 120, width: 820, height: 560 }],
  ["otto/tangent/records", "otto/tangent", { x: 80, y: 80, width: 360, height: 240 }],
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
  worldId: "outline-restyle-world",
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
  throw new Error("Unexpected outline restyle fixture route: " + url);
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

/** The fill Excalidraw currently draws one Area's outline with, read from the elements it holds. */
async function outlineFill(page, area) {
  return page.evaluate((target) => {
    const rendered = window.editor.rendered() ?? [];
    const outline = rendered.find((element) => element.customData?.tangent?.role === "area-region" && element.customData?.tangent?.area === target);
    return outline === undefined ? null : outline.backgroundColor;
  }, area);
}

/** The viewport rectangle one Area's outline occupies now, which is where a press on that Area lands. */
async function outlineBox(page, area) {
  return page.evaluate((target) => {
    const rect = window.editor.controller().snapshot().composition.regionRects.get(target);
    const state = window.editor.appState();
    const zoom = state.zoom?.value ?? state.zoom;
    return rect === undefined ? null : { x: (rect.x + state.scrollX) * zoom, y: (rect.y + state.scrollY) * zoom, width: rect.width * zoom, height: rect.height * zoom };
  }, area);
}

/** True while the Map's controller holds exactly that Area's outline selected. */
async function holdsOutline(page, area) {
  return page.evaluate((target) => {
    const snapshot = window.editor.controller().snapshot();
    const held = [...snapshot.selection];
    if (held.length !== 1) return false;
    const outline = snapshot.composition.scene.elements.find((element) => element.id === held[0]);
    return outline?.customData?.tangent?.role === "area-region" && outline?.customData?.tangent?.area === target;
  }, area);
}

/** Starts recording the outline's fill on every animation frame, so no painted frame goes unseen. */
async function recordFrames(page, area) {
  await page.evaluate((target) => {
    window.outlineFrames = [];
    /** Records one frame's fill and asks for the next. */
    const step = () => {
      const rendered = window.editor.rendered() ?? [];
      const outline = rendered.find((element) => element.customData?.tangent?.role === "area-region" && element.customData?.tangent?.area === target);
      window.outlineFrames.push(outline === undefined ? "missing" : outline.backgroundColor);
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }, area);
}

/** Every distinct fill the recorder saw, with how many frames held it. */
async function frameFills(page) {
  return page.evaluate(() => {
    const counts = {};
    for (const fill of window.outlineFrames ?? []) counts[fill] = (counts[fill] ?? 0) + 1;
    return counts;
  });
}

/**
 * Clicks the Background swatch the shape-properties island offers. While Excalidraw still shows the
 * island over an Area outline the click is real pointer input on the swatch; once the Map suppresses
 * the island for an outline the swatch is still in the page, so the click runs Excalidraw's own
 * background action on the held outline. Either way the same Excalidraw action writes the colour,
 * which is what a selection that catches an outline beside a Block reaches by pointer anyway.
 */
async function clickBackgroundSwatch(page) {
  const swatch = page.locator(`[data-testid="color-top-pick-${SWATCH}"]`);
  const box = await swatch.isVisible() ? await swatch.boundingBox() : null;
  if (box !== null) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return "pointer";
  }
  await swatch.evaluate((element) => element.click());
  return "action";
}

/** The Map's own record of whether anything was saved, which the finding says never moved off Saved. */
async function saveState(page) {
  return page.evaluate(() => window.editor.controller().snapshot().save.state);
}

test("a Background swatch cannot paint an Area outline, and the island is not offered for one", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/outline-restyle-fixture") {
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
    await page.goto(`http://127.0.0.1:${server.address().port}/outline-restyle-fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
    await page.evaluate(() => window.editor.controller().setRestriction(null));
    await page.waitForFunction(() => window.editor.controller().snapshot().restrictionArea === null);
    await settled(page);

    // A press inside the Area selects the outline the Area tree draws for it.
    const box = await outlineBox(page, "otto/tangent/records");
    assert.ok(box, "the records Area has a composed outline on screen");
    const inside = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(inside.x, inside.y);
    await settled(page);
    assert.equal(await holdsOutline(page, "otto/tangent/records"), true, "a press inside the Area selects that Area's outline");
    assert.equal(await outlineFill(page, "otto/tangent/records"), COMPOSED_FILL, "the outline starts with the composed fill");

    // The reported click. It is taken as fast as a person takes it, which is what puts it inside the
    // projection fence the Map opens when it pushes the scene after a selection.
    await recordFrames(page, "otto/tangent/records");
    await page.mouse.click(inside.x, inside.y);
    const how = await clickBackgroundSwatch(page);

    // Every frame of the next two and a half seconds, then a wheel pan, then an undo.
    await page.waitForTimeout(2_500);
    const duringWork = await frameFills(page);
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(400);
    const afterWheel = await outlineFill(page, "otto/tangent/records");
    await page.evaluate(() => window.editor.controller().undo());
    await page.waitForTimeout(400);
    const afterUndo = await outlineFill(page, "otto/tangent/records");

    assert.deepEqual(
      Object.keys(duringWork),
      [COMPOSED_FILL],
      `a click on the ${SWATCH} Background swatch (${how}) painted the Area outline on ${JSON.stringify(duringWork)}`,
    );
    assert.equal(afterWheel, COMPOSED_FILL, "the Area outline keeps the composed fill through a wheel pan");
    assert.equal(afterUndo, COMPOSED_FILL, "the Area outline keeps the composed fill through an undo");
    assert.equal(await saveState(page), "saved", "nothing about the Area outline is a change the Map saves");
    assert.deepEqual(await page.evaluate(() => window.worldEvents), [], "nothing about the Area outline is written to the vault");

    // And the island is not offered at all for an outline the Area tree owns: every control on it,
    // from the swatches to Duplicate and Delete, would edit something no person authored.
    assert.equal(await holdsOutline(page, "otto/tangent/records"), true, "the Area outline is still the whole selection");
    assert.equal(await page.locator(".excalidraw .App-menu__left").isVisible(), false, "Excalidraw's shape properties are not offered for an Area outline");
    assert.equal(await page.locator(`[data-testid="color-top-pick-${SWATCH}"]`).isVisible(), false, "no Background swatch is reachable while an Area outline is the selection");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
