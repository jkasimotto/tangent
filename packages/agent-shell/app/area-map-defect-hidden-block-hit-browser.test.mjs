import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

// Regression proof for the audit defect "Blocks the Map has hidden still block Area drags, creating
// invisible dead zones". The Map hides a Block without removing it: fold, the Only restriction, the
// zoom detail level and Focus all leave the Block in the composed world and take it off the canvas
// through the projected scene. The old component measured a press against the composition, so a
// Block nobody could see still claimed the press, the Area under it was never selected, and the drag
// moved nothing. This fixture hides one Block with the Focus setting "only active work", presses
// exactly where that Block used to be, and requires the Area under the press to follow the drag.
//
// The suggested reproduction was the X key. X does not reproduce the defect, because hiding a Block
// with X deletes it from its shard, and the composition drops deleted elements, so no dead zone is
// left behind. Focus is the hide that keeps the Block in the composition, which is the hide the
// audit describes.

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

// One parent Area, one child Area inside it, and one Block in the middle of the child. The Block sits
// far from every region edge, so a press on it can only ever mean the Block or the child Area, and
// never a resize of either.
const BLOCK = { x: 280, y: 210, width: 200, height: 100 };
const CHILD_RECT = { x: 100, y: 100, width: 760, height: 520 };
const PARENT_RECT = { x: 80, y: 80, width: 1100, height: 760 };
const DRAG = { x: 150, y: 90 };
const BLOCK_REF = "otto/tangent/goal-proof.md";

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Map hidden Block fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const parentScene = empty();
const childScene = empty();
childScene.elements.push(...core.createBlockElements({
  id: "tangent-proof",
  kind: "goal",
  ref: ${JSON.stringify(BLOCK_REF)},
  title: "Hidden Block proof",
  status: "active",
  x: ${BLOCK.x},
  y: ${BLOCK.y},
  width: ${BLOCK.width},
  height: ${BLOCK.height},
}));
const world = {
  schema: "area-map-world.v1", worldId: "hidden-block-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: ${JSON.stringify(PARENT_RECT)} }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: parentScene } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: ${JSON.stringify(CHILD_RECT)} }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: childScene.elements.length, blockCount: 1, scene: childScene } },
  ],
};
// The Goal is not live, so the Focus setting "only active work" is what takes its Block off the
// canvas. Nothing about the Areas changes.
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
  { kind: "goal", area: "otto/tangent", file: ${JSON.stringify(BLOCK_REF)}, title: "Hidden Block proof", status: "done", live: false },
];
window.worldChanges = [];
/** Answers the few read routes the Map calls on mount. This fixture holds no resource Blocks. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url.startsWith("/api/areas/map-resources?")) return { state: "current", viewedFrom: new URL(url, location.origin).searchParams.get("area"), catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: [] };
  throw new Error("Unexpected hidden Block fixture route: " + url);
};
/** Accepts every save the Map makes and mints the receipt the save path expects. */
const onWorldChange = async (next, areas, owners) => {
  const index = window.worldChanges.length + 1;
  window.worldChanges.push({ next: structuredClone(next), areas: [...areas], owners: [...owners] });
  return { status: 200, hashes: Object.fromEntries([...owners].filter(Boolean).map((owner) => [owner, "save-" + index])), treeRevision: "tree-save-" + index, worldRevision: "world-save-" + index };
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api, focus: { only: false, activeOnly: true, areas: [] },
  onWorldChange, onEntityVerb: () => {}, onBack: () => {},
});
/** Reports one Block as the composed world still records it, by the document reference it carries. */
window.composedBlock = (reference) => {
  const element = window.editor.controller().snapshot().composition.scene.elements.find((candidate) => candidate.customData?.tangent?.ref === reference);
  return element && { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, deleted: Boolean(element.isDeleted) };
};
/** Reports the composed rectangle of one Area region, which is the rectangle a drag has to change. */
window.regionRect = (area) => {
  const element = window.editor.controller().snapshot().composition.scene.elements.find((candidate) => candidate.customData?.tangent?.role === "area-region" && candidate.customData.tangent.area === area);
  return element && { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height };
};
/** True while the named element is painted on the canvas Excalidraw holds. */
window.paintedOnCanvas = (id) => (window.editor.rendered?.() ?? []).some((element) => element.id === id && !element.isDeleted);
/** Lists everything but the Area outlines that is painted over one scene point, which is what a person sees there. */
window.paintedOver = (point) => (window.editor.rendered?.() ?? [])
  .filter((element) => !element.isDeleted && element.customData?.tangent?.role !== "area-region"
    && point.x >= element.x && point.y >= element.y && point.x <= element.x + element.width && point.y <= element.y + element.height)
  .map((element) => element.id);
</script></body></html>`;

/** Waits for the frame after React commits, so a geometry read never reports the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Converts one Excalidraw scene point to browser viewport coordinates. */
async function viewportPoint(page, x, y) {
  const canvas = page.locator(".excalidraw canvas.interactive");
  const [box, appState] = await Promise.all([canvas.boundingBox(), page.evaluate(() => window.editor.appState())]);
  assert.ok(box, "the interactive canvas must have a box");
  return { x: box.x + (x + appState.scrollX) * appState.zoom.value, y: box.y + (y + appState.scrollY) * appState.zoom.value };
}

/** Reports what the browser would deliver a press at one viewport point to. */
async function elementUnder(page, point) {
  return page.evaluate((value) => {
    const hit = document.elementFromPoint(value.x, value.y);
    return { tag: hit?.tagName ?? "", className: String(hit?.className ?? "") };
  }, point);
}

/** True when one point lies inside a rectangle. */
function rectHolds(rectangle, point) {
  return point.x > rectangle.x && point.x < rectangle.x + rectangle.width && point.y > rectangle.y && point.y < rectangle.y + rectangle.height;
}

test("a press where the Map hid a Block drags the Area under it", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);

    // Show the whole parent Area, so the child Area, the press point and the end of the drag are all
    // on the canvas.
    await page.evaluate(() => window.editor.controller().setRestriction(null));
    await page.evaluate(() => window.editor.fitArea("otto", { push: false, select: false }));
    await settled(page);

    // The Map hid the Block: the world still records it where it was, and nothing paints it.
    const block = await page.evaluate((reference) => window.composedBlock(reference), BLOCK_REF);
    assert.ok(block, "the composed world must still record the hidden Block");
    assert.equal(block.deleted, false, "the Map hides a Block without deleting it from the world");
    assert.equal(await page.evaluate((id) => window.paintedOnCanvas(id), block.id), false, "the hidden Block must not be painted");
    const centre = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
    assert.deepEqual(await page.evaluate((point) => window.paintedOver(point), centre), [], "the Map must paint nothing where the hidden Block was");

    // A person sees empty Area where the Block was. Press exactly there and drag.
    const before = await page.evaluate(() => window.regionRect("otto/tangent"));
    assert.ok(before, "the child Area must have a composed region");
    assert.ok(rectHolds(before, centre), `the hidden Block's place must lie inside the child Area: ${JSON.stringify({ centre, before })}`);
    const start = await viewportPoint(page, centre.x, centre.y);
    const end = await viewportPoint(page, centre.x + DRAG.x, centre.y + DRAG.y);
    const under = await elementUnder(page, start);
    assert.match(under.className, /interactive/, `the press must land on the interactive canvas: ${JSON.stringify({ start, under })}`);

    const priorSaves = await page.evaluate(() => window.worldChanges.length);
    await page.mouse.move(start.x, start.y);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    try {
      await page.waitForFunction((count) => window.worldChanges.length > count, priorSaves, { timeout: 5_000 });
    } catch (error) {
      const stalled = await page.evaluate(() => ({ region: window.regionRect("otto/tangent"), selection: [...window.editor.controller().snapshot().selection] }));
      throw new Error(`the drag over the hidden Block's place published nothing: ${JSON.stringify({ before, start, end, stalled })}`, { cause: error });
    }
    await settled(page);

    const after = await page.evaluate(() => window.regionRect("otto/tangent"));
    const moved = { x: after.x - before.x, y: after.y - before.y };
    assert.ok(
      moved.x > DRAG.x / 2 && moved.y > DRAG.y / 2,
      `the Area under the hidden Block must follow the drag: ${JSON.stringify({ before, after, moved, DRAG })}`,
    );
    assert.equal(after.width, before.width, "dragging an Area must not resize it");
    assert.equal(after.height, before.height, "dragging an Area must not resize it");
    assert.ok(
      (await page.evaluate(() => window.worldChanges)).some((change) => change.areas.includes("otto/tangent")),
      "the moved Area must reach the vault",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
