// Proof for the defect Julian named: "sometimes moving one area rapidly jolts or moves another area
// aggressively". A fast drag of one Area throws an Area the drag never grabbed across the board.
//
// The Map keeps sibling Areas apart with a reflow. `arrangeChildren` in
// `app/public/area-map-world-core.js` places each branch in priority order and, when a branch
// collides, moves it to `nearestFreeRectangle`: the nearest free rectangle immediately left of,
// right of, above or below one blocker, chosen by squared distance. The dragged Area takes the
// highest placement priority, so it is placed first and the other Areas are the ones that move.
// Nothing in that choice is continuous. As the dragged child pushes its parent wider, the parent's
// own sibling is pushed along to the right, and at one frame "above the parent" becomes a shorter
// hop than "right of the parent". The untouched Area then teleports in a direction the drag never
// went, by far more than the drag moved.
//
// This suite drives real Chromium pointer input through three fast drags in three directions,
// samples every Area's composed region rectangle and Excalidraw's own region element on every move
// frame, and requires three facts of every frame: an Area the drag does not need to move keeps a
// pixel-identical rectangle; an Area the reflow does move never travels further in one frame than
// the dragged Area did and never reverses direction between frames; and the dragged Area's composed
// rectangle and its Excalidraw element agree, so the region never flickers between two places.
//
// Design: docs/design/area-map-rebuild/code.md. Layout kernel: docs/decisions/ADR-0052.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** Every Area in the fixture, in the order a failure message names them. */
const AREAS = ["otto", "otto/alpha", "otto/beta", "other"];

/** How far inside an Area's bottom edge a press lands when it grabs the Area by its own body. */
const BODY_INSET = 35;

/** The clearance the layout kernel keeps between Areas, which widens the path a drag sweeps. */
const SPACING = 60;

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map fast drag fixture</title>
  <link rel="stylesheet" href="/agent-shell-map.css">
  <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style>
</head>
<body>
<div id="map"></div>
<script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

/** One empty shard scene, for an Area whose file holds nothing. */
const empty = () => core.createEmptyScene();

/** One shard scene holding a single Block, so the dragged Area exercises the block hull path. */
const withBlock = () => {
  const scene = core.createEmptyScene();
  scene.elements.push(...core.createBlockElements({
    id: "alpha-block", kind: "goal", ref: "otto/alpha/goal-one.md", title: "One",
    x: 30, y: 30, width: 180, height: 90,
  }));
  return scene;
};

// A parent with two children side by side, and a sibling of the parent to the right of it. A child
// rectangle is parent-local; the parent's and the parent's sibling's are root-local.
const records = [
  ["otto", "@root", { x: 200, y: 200, width: 900, height: 500 }, empty],
  ["otto/alpha", "otto", { x: 40, y: 20, width: 340, height: 260 }, withBlock],
  ["otto/beta", "otto", { x: 460, y: 20, width: 340, height: 260 }, empty],
  ["other", "@root", { x: 1300, y: 200, width: 400, height: 500 }, empty],
];

const nodes = records.map(([key, parent, storedRect, sceneOf]) => ({
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
  shard: { owner: key, hash: "hash-" + key, state: "ready", elementCount: 0, blockCount: 0, scene: sceneOf() },
}));

const world = {
  schema: "area-map-world.v1",
  worldId: "fast-drag-world",
  treeRevision: "tree-1",
  worldRevision: "world-1",
  locatedArea: "otto",
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
  throw new Error("Unexpected fast drag fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: empty(),
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

/**
 * Reads one frame: every Area's composed region rectangle, its stored rectangle, and the rectangle
 * of Excalidraw's own region element. All three are read in one page call, so they describe the
 * same frame rather than three frames a few milliseconds apart.
 */
async function sampleFrame(page) {
  return page.evaluate((keys) => {
    const composition = window.editor.controller().snapshot().composition;
    /** Copies one rectangle into a plain comparable record, or null when the Area has none. */
    const copy = (value) => (value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null);
    const composed = {};
    const stored = {};
    for (const key of keys) {
      composed[key] = copy(composition.regionRects.get(key));
      stored[key] = copy(composition.storedRegionRects.get(key));
    }
    const drawn = {};
    for (const element of window.editor.current().elements) {
      const area = element.customData?.tangent?.area;
      if (area && element.customData?.tangent?.role === "area-region") drawn[area] = copy(element);
    }
    return { composed, stored, drawn };
  }, AREAS);
}

/** The viewport point one scene point is drawn at, under the camera the Map holds now. */
async function screenPoint(page, at) {
  return page.evaluate((scene) => {
    const state = window.editor.appState();
    const zoom = state.zoom?.value ?? state.zoom;
    return { x: (scene.x + state.scrollX) * zoom, y: (scene.y + state.scrollY) * zoom };
  }, at);
}

/**
 * Where to press to grab one Area by its own body: the middle of the strip along the bottom of its
 * stored rectangle, which is inside the Area and clear of the Block near its top-left corner. A
 * press on the Block would grab the Block, which is a different gesture.
 */
function grabPoint(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height - BODY_INSET };
}

/** How far two rectangles are apart, as the per-axis displacement of their top-left corners. */
function displacement(before, after) {
  return { x: after.x - before.x, y: after.y - before.y };
}

/** The total distance one displacement covers, counted on both axes. */
function travelOf(moved) {
  return Math.abs(moved.x) + Math.abs(moved.y);
}

/** True when two rectangles are the same to the pixel. */
function sameRect(left, right) {
  return left !== null && right !== null && left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

/** The rectangle one Area swept through between two frames, widened by the clearance the layout keeps. */
function sweptPath(before, after) {
  const left = Math.min(before.x, after.x) - SPACING;
  const top = Math.min(before.y, after.y) - SPACING;
  const right = Math.max(before.x + before.width, after.x + after.width) + SPACING;
  const bottom = Math.max(before.y + before.height, after.y + after.height) + SPACING;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** True when two rectangles share any area. */
function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

/** True when one Area is the dragged Area, an ancestor of it, or one of its descendants. */
function relatedTo(dragged, area) {
  return area === dragged || dragged.startsWith(area + "/") || area.startsWith(dragged + "/");
}

/**
 * Drives one fast drag and records a frame after every single pointer move. Every move is one CDP
 * event with no interpolation, so each frame carries the whole step: that is what makes the drag
 * fast, and it is the condition a slow drag never meets.
 */
async function fastDrag(page, { area, steps }) {
  const opening = await sampleFrame(page);
  const start = await screenPoint(page, grabPoint(opening.stored[area]));
  const frames = [opening];
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await settled(page);
  frames.push(await sampleFrame(page));
  let at = { ...start };
  for (const step of steps) {
    at = { x: at.x + step.x, y: at.y + step.y };
    await page.mouse.move(at.x, at.y, { steps: 1 });
    await settled(page);
    frames.push(await sampleFrame(page));
  }
  await page.mouse.up();
  await settled(page);
  await settled(page);
  return { area, frames };
}

/**
 * Names every frame where an Area the drag never grabbed moved although the drag did not push into
 * it: it is not the dragged Area, not an ancestor and not a descendant of it, and its rectangle at
 * the frame before lies clear of the path the dragged Area swept through in that frame.
 */
function strangersMovedIn(run) {
  const found = [];
  for (let index = 1; index < run.frames.length; index += 1) {
    const before = run.frames[index - 1].composed;
    const after = run.frames[index].composed;
    const path = sweptPath(before[run.area], after[run.area]);
    for (const key of AREAS) {
      if (relatedTo(run.area, key)) continue;
      const moved = displacement(before[key], after[key]);
      if (travelOf(moved) === 0 || overlaps(path, before[key])) continue;
      found.push({ frame: index, area: key, moved, before: before[key], after: after[key], path });
    }
  }
  return found;
}

/** Names every frame where an Area the drag did not grab travelled further than the dragged Area did. */
function overtakesIn(run) {
  const found = [];
  for (let index = 1; index < run.frames.length; index += 1) {
    const before = run.frames[index - 1].composed;
    const after = run.frames[index].composed;
    const draggedTravel = travelOf(displacement(before[run.area], after[run.area]));
    for (const key of AREAS) {
      if (key === run.area) continue;
      const moved = displacement(before[key], after[key]);
      if (travelOf(moved) <= draggedTravel) continue;
      found.push({ frame: index, area: key, moved, travel: travelOf(moved), draggedTravel, before: before[key], after: after[key] });
    }
  }
  return found;
}

/** Names every frame where an Area the drag did not grab reversed the direction it was travelling in. */
function reversalsIn(run) {
  const found = [];
  for (let index = 2; index < run.frames.length; index += 1) {
    const first = run.frames[index - 2].composed;
    const middle = run.frames[index - 1].composed;
    const last = run.frames[index].composed;
    for (const key of AREAS) {
      if (key === run.area) continue;
      const earlier = displacement(first[key], middle[key]);
      const later = displacement(middle[key], last[key]);
      for (const axis of ["x", "y"]) {
        if (earlier[axis] * later[axis] < 0) found.push({ frame: index, area: key, axis, earlier: earlier[axis], later: later[axis] });
      }
    }
  }
  return found;
}

/** Loads the fixture into a fresh world, so every drag starts from the same geometry. */
async function loadFixture(page, port) {
  await page.goto(`http://127.0.0.1:${port}/fast-drag-fixture`, { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(() => window.editor.controller().setRestriction(null));
  await page.waitForFunction(() => window.editor.controller().snapshot().restrictionArea === null);
  await page.evaluate(() => window.editor.controller().setSelection([]));
  await settled(page);
}

/** Repeats one pointer step, which is how a drag speed is written here. */
function repeat(times, step) {
  return Array.from({ length: times }, () => step);
}

// Three speeds and three directions of the same child: right across the board, up and out past the
// parent's top edge, and down and right past the parent's corner.
const DRAGS = [
  { name: "fast right in 260px steps", steps: repeat(5, { x: 260, y: 0 }) },
  { name: "very fast right in 500px steps", steps: repeat(3, { x: 500, y: 0 }) },
  { name: "fast up in 240px steps", steps: repeat(4, { x: 0, y: -240 }) },
  { name: "fast down and right in 220x200 steps", steps: repeat(6, { x: 220, y: 200 }) },
];

test("a fast drag of one Area never jolts an Area it did not grab", { skip: !enabled, timeout: 180_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fast-drag-fixture") {
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
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });

    for (const drag of DRAGS) {
      await loadFixture(page, server.address().port);
      const opening = await sampleFrame(page);
      for (const key of AREAS) assert.ok(opening.composed[key], `the fixture composed a rectangle for ${key}: ${JSON.stringify(opening.composed)}`);

      const run = await fastDrag(page, { area: "otto/alpha", steps: drag.steps });

      // The dragged Area actually moved, or the drag proved nothing.
      const first = run.frames[1].composed[run.area];
      const last = run.frames.at(-1).composed[run.area];
      assert.ok(travelOf(displacement(first, last)) > 100, `the ${drag.name} drag moved the Area it grabbed: ${JSON.stringify({ first, last })}`);

      // Excalidraw's own region element and the Map's composed rectangle describe the same place on
      // every frame of the gesture, so the dragged region never flickers between two positions.
      for (let index = 1; index < run.frames.length; index += 1) {
        const frame = run.frames[index];
        assert.ok(sameRect(frame.composed[run.area], frame.drawn[run.area]),
          `on frame ${index} of the ${drag.name} drag the dragged region is in one place: ${JSON.stringify({ composed: frame.composed[run.area], drawn: frame.drawn[run.area] })}`);
      }

      // An Area the drag never pushed into does not move at all.
      assert.deepEqual(strangersMovedIn(run), [],
        `the ${drag.name} drag moved an Area it never touched: ${JSON.stringify(strangersMovedIn(run), null, 2)}`);

      // An Area the reflow does push never overtakes the drag, and never turns around.
      assert.deepEqual(overtakesIn(run), [],
        `the ${drag.name} drag threw an Area further than it moved itself: ${JSON.stringify(overtakesIn(run), null, 2)}`);
      assert.deepEqual(reversalsIn(run), [],
        `the ${drag.name} drag reversed an Area's travel: ${JSON.stringify(reversalsIn(run), null, 2)}`);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
