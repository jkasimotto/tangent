// Audit defect: "After panning or zooming without moving the mouse, B and paste place into an
// off-screen Area." The old component remembered the last pointer point in scene coordinates and
// placed there whatever the camera had done since, so a Block created with B after a pan landed
// in the Area the mouse had hovered before the pan, off screen and often invisible.
//
// This suite drives that exact sequence through real input: the mouse hovers one Area, the camera
// pans through the controller without the mouse moving, and B places a Block. It asserts the two
// things a person sees: the Block is inside the visible viewport, and it belongs to the Area under
// the viewport centre rather than the Area the mouse last hovered.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const HOVERED_AREA = "otto/near";
const CENTRED_AREA = "otto/far";
const PLACED_REF = "https://example.com/placed-after-the-pan";

// Two sibling Areas far apart on one root, so fitting the far one puts the near one off screen.
const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Placement in viewport fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

/** Builds one empty Excalidraw scene in the normal form a shard holds. */
const empty = () => core.createEmptyScene();
const nearScene = empty();
nearScene.elements.push(...core.createBlockElements({ id: "near-note", kind: "document", ref: "otto/near/near-note.md", title: "Near note", status: "draft", x: 60, y: 60, width: 220, height: 100 }));
const farScene = empty();
farScene.elements.push(...core.createBlockElements({ id: "far-note", kind: "document", ref: "otto/far/far-note.md", title: "Far note", status: "draft", x: 60, y: 60, width: 220, height: 100 }));

/** Builds one fixture Area node in the shape the composed world reads. */
const node = (key, parent, children, storedRect, scene) => ({
  key, parent, children, depth: key.split("/").length - 1,
  region: { key: parent + ">" + key, owner: parent, child: key, sourceId: "region-" + key.replaceAll("/", "-"), labelSourceId: "label-" + key.replaceAll("/", "-"), source: "stored", storedRect },
  shard: { owner: key, hash: "hash-" + key, state: "ready", elementCount: scene.elements.length, blockCount: scene.elements.filter((element) => element.type === "rectangle").length, scene },
});

const world = {
  schema: "area-map-world.v1", worldId: "placement-viewport-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    node("otto", "@root", ["otto/near", "otto/far"], { x: 80, y: 80, width: 2200, height: 700 }, empty()),
    node("otto/near", "otto", [], { x: 100, y: 100, width: 600, height: 500 }, nearScene),
    node("otto/far", "otto", [], { x: 1500, y: 100, width: 600, height: 500 }, farScene),
  ],
};

const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/near", file: "otto/near/near.md", title: "Near", status: "active" },
  { kind: "area", area: "otto/far", file: "otto/far/far.md", title: "Far", status: "active" },
  { kind: "document", area: "otto/near", file: "otto/near/near-note.md", title: "Near note", status: "draft" },
  { kind: "document", area: "otto/far", file: "otto/far/far-note.md", title: "Far note", status: "draft" },
];

window.worldChanges = [];
/** Answers only the read routes the composed Map asks for; this fixture has no resources. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: [] };
  if (url.startsWith("/api/areas/map-resources?")) return { state: "current", viewedFrom: new URL(url, location.origin).searchParams.get("area"), catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  throw new Error("Unexpected placement fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api, focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: (next, areas, owners) => { window.worldChanges.push({ areas: [...areas], owners: [...owners] }); },
  onEntityVerb: () => {}, onBack: () => {},
});

/** Reports the composed rectangle of one Area region in scene coordinates. */
window.regionRect = (area) => {
  const rect = window.editor.controller().snapshot().composition.regionRects.get(area);
  return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

/** Reports the canvas box and the camera together, so a screen conversion reads one consistent frame. */
window.frame = () => {
  const box = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
  const app = window.editor.appState();
  return { box: { left: box.left, top: box.top, width: box.width, height: box.height }, camera: { scrollX: Number(app.scrollX), scrollY: Number(app.scrollY), zoom: Number(app.zoom.value) } };
};

/** Reports the composed rectangle of the one Block carrying the given reference, or null. */
window.blockRect = (ref) => {
  const element = window.editor.current().elements.find((candidate) => !candidate.isDeleted && candidate.customData?.tangent?.ref === ref && candidate.type === "rectangle");
  return element && { x: element.x, y: element.y, width: element.width, height: element.height };
};

/** Reports which Area's shard file now holds the Block carrying the given reference, or null. */
window.blockOwner = (ref) => {
  const holder = window.editor.controller().world().areas.find((entry) => (entry.shard.scene?.elements ?? []).some((element) => element.customData?.tangent?.ref === ref));
  return holder?.key ?? null;
};
</script></body></html>`;

/** Waits for the frame after React commits, so a geometry read never sees the layout of the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Converts one scene rectangle into the browser viewport rectangle a person actually looks at. */
function screenRect(rect, frame) {
  const { box, camera } = frame;
  return {
    left: box.left + (rect.x + camera.scrollX) * camera.zoom,
    top: box.top + (rect.y + camera.scrollY) * camera.zoom,
    right: box.left + (rect.x + rect.width + camera.scrollX) * camera.zoom,
    bottom: box.top + (rect.y + rect.height + camera.scrollY) * camera.zoom,
  };
}

/** True when a screen rectangle lies wholly inside the Map canvas a person can see. */
function insideViewport(rect, frame) {
  const { box } = frame;
  return rect.left >= box.left && rect.top >= box.top && rect.right <= box.left + box.width && rect.bottom <= box.top + box.height;
}

/** True when a screen rectangle shares no pixel with the Map canvas, so a person sees none of it. */
function offScreen(rect, frame) {
  const { box } = frame;
  return rect.right <= box.left || rect.left >= box.left + box.width || rect.bottom <= box.top || rect.top >= box.top + box.height;
}

/** True when one scene point lies inside one scene rectangle. */
function contains(rect, at) {
  return at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height;
}

/** The scene point at the centre of the visible Map canvas. */
function viewportCentreScene(frame) {
  const { box, camera } = frame;
  return { x: box.width / 2 / camera.zoom - camera.scrollX, y: box.height / 2 / camera.zoom - camera.scrollY };
}

test("a Block placed with B after the camera pans lands in the Area on screen, not in the Area the mouse last hovered", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction((area) => window.editor?.appState?.()?.zoom?.value && window.regionRect(area), CENTRED_AREA);
    await page.evaluate(() => window.editor.controller().setRestriction(null));
    await settled(page);

    // The mouse rests over the near Area, which is the last thing it hovers for the rest of the test.
    const before = await page.evaluate(() => window.frame());
    const nearRect = await page.evaluate((area) => window.regionRect(area), HOVERED_AREA);
    const farRect = await page.evaluate((area) => window.regionRect(area), CENTRED_AREA);
    const hoverScene = { x: nearRect.x + nearRect.width / 2, y: nearRect.y + nearRect.height * 0.75 };
    const hoverScreen = screenRect({ ...hoverScene, width: 0, height: 0 }, before);
    assert.ok(insideViewport(hoverScreen, before), `the near Area is on screen before the pan: ${JSON.stringify({ hoverScreen, before })}`);
    assert.ok(contains(nearRect, hoverScene) && !contains(farRect, hoverScene), "the hovered point is inside the near Area and outside the far Area");
    await page.mouse.move(hoverScreen.left, hoverScreen.top);
    await settled(page);

    // The camera pans through the controller. The mouse is never moved again.
    await page.evaluate((area) => window.editor.fitArea(area), CENTRED_AREA);
    await settled(page);
    await settled(page);
    const after = await page.evaluate(() => window.frame());
    const centreScene = viewportCentreScene(after);
    assert.ok(offScreen(screenRect(nearRect, after), after), `the hovered Area is wholly off screen after the pan: ${JSON.stringify({ nearRect, after })}`);
    assert.ok(contains(farRect, centreScene), `the viewport centre is inside the far Area after the pan: ${JSON.stringify({ farRect, centreScene })}`);

    // B places a Block without the mouse moving.
    await page.locator(".excalidraw canvas.interactive").focus();
    await page.keyboard.press("b");
    const picker = page.getByRole("dialog", { name: "Place a Tangent block" });
    await picker.waitFor();
    await picker.getByRole("textbox").fill(PLACED_REF);
    await page.keyboard.press("Enter");
    await page.waitForFunction((ref) => window.blockOwner(ref) !== null && window.blockRect(ref) !== null, PLACED_REF, { timeout: 10_000 });
    await settled(page);
    await settled(page);

    const owner = await page.evaluate((ref) => window.blockOwner(ref), PLACED_REF);
    const placedFrame = await page.evaluate(() => window.frame());
    const placedRect = await page.evaluate((ref) => window.blockRect(ref), PLACED_REF);
    assert.ok(placedRect, "the placed Block is in the composed scene");
    assert.equal(owner, CENTRED_AREA, `the Block belongs to the Area under the viewport centre, not to the Area the mouse last hovered: ${JSON.stringify({ owner, placedRect })}`);
    assert.ok(insideViewport(screenRect(placedRect, placedFrame), placedFrame), `the placed Block is wholly inside the visible viewport: ${JSON.stringify({ placedRect, placedFrame, screen: screenRect(placedRect, placedFrame) })}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
