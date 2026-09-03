import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

// The regression test for the audit defect "a Block placed while an Area is folded lands in a
// hidden Area and vanishes".
//
// One Area with a nested child, and one Goal the picker can place. A fold takes the child off the
// canvas but leaves its rectangle in the composition, which is the shape the defect needs: a person
// points at what is now open Area body, and the Map must not read a structure it stopped drawing
// there. The Block must belong to the folded Area the person can see, and it must come back on the
// canvas the moment the fold opens, because fold hides an Area's own Blocks as well as its
// descendants. A Block written into the hidden child would never come back and would be saved to a
// shard the person is not looking at.
const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const scene = () => core.createEmptyScene();
const records = [
  ["otto", "@root", { x: 80, y: 80, width: 1200, height: 900 }],
  ["otto/tangent", "otto", { x: 120, y: 120, width: 360, height: 260 }],
  ["otto/tangent/map", "otto/tangent", { x: 40, y: 40, width: 200, height: 150 }],
];
const world = {
  schema: "area-map-world.v1", worldId: "folded-placement-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  areas: records.map(([key, parent, storedRect]) => ({
    key, parent,
    children: records.filter((entry) => entry[1] === key).map((entry) => entry[0]),
    depth: key.split("/").length - 1,
    region: { key: parent + ">" + key, owner: parent, child: key, sourceId: "region-" + key.replaceAll("/", "-"), labelSourceId: "label-" + key.replaceAll("/", "-"), source: "stored", storedRect },
    shard: { owner: key, hash: "hash-" + key, state: "ready", elementCount: 0, blockCount: 0, scene: scene() },
  })),
};
const documents = [
  ...records.map(([area]) => ({ kind: "area", area, file: area + "/" + area.split("/").at(-1) + ".md", title: area.split("/").at(-1).replace(/^./, (letter) => letter.toUpperCase()), status: "active" })),
  { kind: "goal", area: "otto/tangent", file: "otto/tangent/goal-prove-placement.md", title: "Prove placement", status: "active", live: true },
];
/** Serves the read routes the composed Map calls while this fixture runs. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url.startsWith("/api/areas/map-resources?")) return { state: "current", viewedFrom: new URL(url, location.origin).searchParams.get("area"), catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: [] };
  throw new Error("Unexpected fixture route: " + url);
};
window.worldEvents = [];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: scene(), getDocuments: () => documents, api, focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: (nextWorld, changedAreas, changedOwners) => { window.worldEvents.push({ areas: [...changedAreas], owners: [...changedOwners] }); },
  loadShard: async (area) => ({ area, worldRevision: world.worldRevision, hash: "hash-" + area, state: "ready", scene: scene() }),
  reloadWorld: async () => structuredClone(world),
  onEntityVerb: () => {}, onBack: () => {},
});
</script></body></html>`;

/** The reference of the one Goal this fixture can place, which names the placed Block everywhere. */
const GOAL_REF = "otto/tangent/goal-prove-placement.md";

/** Every Block the world stores, with the Area whose shard holds it. This is what a save would write to the vault. */
async function storedBlocks(page) {
  return page.evaluate(() => window.editor.controller().world().areas.flatMap((node) => (node.shard.scene?.elements ?? [])
    .filter((element) => element.customData?.tangent?.ref && element.customData.tangent.role !== "area-region")
    .map((element) => ({ area: node.key, ref: element.customData.tangent.ref }))));
}

/** The Block the Map actually draws for one reference, with its owner and rectangle, or null when nothing is drawn. */
async function drawnBlock(page, ref) {
  return page.evaluate((value) => {
    const element = (window.editor.rendered?.() ?? []).find((candidate) => !candidate.isDeleted && candidate.customData?.tangent?.ref === value);
    return element ? { owner: element.customData?.tangentWorld?.owner ?? null, x: element.x, y: element.y, width: element.width, height: element.height } : null;
  }, ref);
}

/** The composed rectangle of every Area, which Areas the canvas draws, and the scene point at the middle of the viewport. */
async function areaGeometry(page) {
  return page.evaluate(() => {
    const drawn = (window.editor.rendered?.() ?? []).filter((element) => !element.isDeleted && element.customData?.tangent?.role === "area-region").map((element) => element.customData.tangent.area);
    const appState = window.editor.appState();
    const canvas = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    return {
      drawn,
      rects: Object.fromEntries([...window.editor.controller().snapshot().composition.regionRects]),
      viewportCentre: { x: canvas.width / (2 * appState.zoom.value) - appState.scrollX, y: canvas.height / (2 * appState.zoom.value) - appState.scrollY },
    };
  });
}

/** Reports whether one scene point lies inside one composed Area rectangle. */
function inside(point, box) {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

/** Matches one fixture Area's name pill by its accessible name up to its fold state, because placing a Block changes the block count that follows. */
function areaLabel(area, { folded = false } = {}) {
  const parts = area.split("/");
  /** Capitalizes one fixture path segment the way the Map titles it. */
  const display = (value) => value.replace(/^./, (letter) => letter.toUpperCase());
  const parent = parts.length === 1 ? "map root" : parts.slice(0, -1).map(display).join(" / ");
  return new RegExp(`^${display(parts.at(-1))}, child of ${parent}, depth ${parts.length}, ${folded ? "folded" : "unfolded"}, ready, `);
}

/** Converts one Excalidraw scene point into browser viewport coordinates. */
async function viewportPoint(page, scenePoint) {
  const box = await page.locator(".excalidraw canvas.interactive").boundingBox();
  const appState = await page.evaluate(() => window.editor.appState());
  return { x: box.x + (scenePoint.x + appState.scrollX) * appState.zoom.value, y: box.y + (scenePoint.y + appState.scrollY) * appState.zoom.value };
}

/** Waits for the frame after React commits, so a geometry read never sees the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Selects one Area by clicking its name pill and folds or unfolds it with Space, the way a person does. */
async function toggleFold(page, area, { folded }) {
  const pill = page.getByRole("button", { name: areaLabel(area, { folded: !folded }) });
  await pill.waitFor();
  await pill.evaluate((button) => button.click());
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: areaLabel(area, { folded }) }).waitFor();
  await page.evaluate(() => window.editor.controller().setSelection([]));
  await settled(page);
}

test("a Block placed while an Area is folded lands in the folded Area a person can see, never in the hidden child under the pointer", { skip: !enabled, timeout: 90_000 }, async (context) => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(() => window.editor.controller().setRestriction(null));
  await page.evaluate(() => window.editor.fitArea("otto", { push: false, select: false }));
  await settled(page);

  await toggleFold(page, "otto/tangent", { folded: true });
  const geometry = await areaGeometry(page);
  assert.ok(geometry.drawn.includes("otto/tangent"), "the folded Area is still drawn, so a person can point inside it");
  assert.ok(!geometry.drawn.includes("otto/tangent/map"), "the fold takes the nested child off the canvas");
  const foldedRect = geometry.rects["otto/tangent"];
  const hiddenRect = geometry.rects["otto/tangent/map"];
  assert.ok(hiddenRect, "the hidden child keeps its rectangle in the composition, which is what a stale hit test would read");
  assert.equal(inside(geometry.viewportCentre, foldedRect), false, "the viewport centre is outside the folded Area, so only the pointer can put the Block there");

  // Point at the middle of the rectangle the hidden child still occupies, then place a Block there.
  const hiddenCentre = { x: hiddenRect.x + hiddenRect.width / 2, y: hiddenRect.y + hiddenRect.height / 2 };
  const at = await viewportPoint(page, hiddenCentre);
  await page.mouse.move(at.x, at.y);
  await page.locator(".excalidraw canvas.interactive").focus();
  await page.keyboard.press("b");
  const picker = page.getByRole("dialog", { name: "Place a Tangent block" });
  await picker.waitFor();
  await picker.getByRole("heading", { name: "Place in tangent" }).waitFor();
  assert.equal(await picker.getByRole("heading", { name: "Place in map" }).count(), 0, "the picker never offers to place into the Area the fold has hidden");
  await picker.getByRole("textbox").fill("Prove placement");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.worldEvents.length > 0, null, { timeout: 10_000 });
  // A placed Block opens its own label for typing. Finish that edit before the canvas takes keys again.
  await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'), null, { timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !window.editor.appState().editingTextElement && !document.activeElement?.matches('textarea[data-type="wysiwyg"]'), null, { timeout: 10_000 });
  await settled(page);

  assert.deepEqual(await storedBlocks(page), [{ area: "otto/tangent", ref: GOAL_REF }], "the folded Area a person can see stores the Block, and the hidden child's shard is untouched");
  const events = await page.evaluate(() => window.worldEvents);
  assert.deepEqual(events[0], { areas: ["otto/tangent"], owners: ["otto/tangent"] }, "placing saves the visible Area");
  assert.ok(events.every((event) => !event.areas.includes("otto/tangent/map") && !event.owners.includes("otto/tangent/map")), `the Area the fold has hidden is never written: ${JSON.stringify(events)}`);

  // Opening the fold shows the Block that was placed, inside the Area that stores it. Nothing vanished.
  await toggleFold(page, "otto/tangent", { folded: false });
  await page.waitForFunction((ref) => (window.editor.rendered?.() ?? []).some((element) => !element.isDeleted && element.customData?.tangent?.ref === ref), GOAL_REF, { timeout: 10_000 });
  const block = await drawnBlock(page, GOAL_REF);
  const opened = await areaGeometry(page);
  assert.equal(block.owner, "otto/tangent", "the drawn Block belongs to the Area that was folded");
  const openedRect = opened.rects["otto/tangent"];
  assert.ok(inside({ x: block.x, y: block.y }, openedRect) && inside({ x: block.x + block.width, y: block.y + block.height }, openedRect), `the Block sits inside the Area a person pointed at: ${JSON.stringify({ block, openedRect })}`);
});
