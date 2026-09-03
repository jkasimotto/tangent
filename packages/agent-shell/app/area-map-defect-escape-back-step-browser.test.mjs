import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

// The audit defect this suite closes: "Escape closes the whole Resources sheet rather than the
// intended back-step, and strands the Add-back dialog over an inert Map". The proof drives the real
// Map with real clicks and real Escape presses at 800px, where the Resources panel is the narrow
// modal sheet, and asserts only what a person sees: which surface went away, which one stayed, and
// whether the canvas takes input again once every modal is closed.

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const removedTarget = "/private/tmp/tangent-map-escape-fixture/removed";
const mainTarget = "/private/tmp/tangent-map-escape-fixture/main-checkout";

/** Reads everything a person can tell about the Resources surfaces and the canvas in one pass. */
async function surfaceReport(page) {
  return page.evaluate(() => ({
    panel: document.querySelectorAll(".tangent-map-resources").length,
    details: document.querySelectorAll(".tangent-map-resource-details").length,
    rows: document.querySelectorAll(".tangent-map-resource-row").length,
    recovery: document.querySelectorAll(".tangent-map-resource-recovery").length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    backdrops: document.querySelectorAll("[data-tangent-backdrop]").length,
    canvasInert: document.querySelector(".excalidraw")?.inert === true,
    brainInert: document.querySelector("#brain-pane")?.inert === true,
  }));
}

/** Waits for the frame after React commits, so an assertion never reads the state before the paint. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Map escape fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#app,#screen,.split-workspace,[data-split-pane="map"],#map{width:100%;height:100%;margin:0;overflow:hidden}.split-workspace,[data-split-pane="map"]{position:relative}#global-controls,#brain-pane,#splitter{position:absolute;left:-9999px}</style></head><body><div id="app"><header id="global-controls"><button>Global route</button></header><main id="screen"><div class="split-workspace"><section id="brain-pane" data-split-pane="brain"><button>Brain control</button></section><div id="splitter" role="separator"></div><section data-split-pane="map"><div id="map"></div></section></div></main></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const childScene = empty();
childScene.elements.push(...core.createBlockElements({ id: "main-resource", kind: "resource", ref: "worktree-main", title: "Main checkout", status: "", x: 160, y: 160, width: 240, height: 110 }));
childScene.elements.push(...core.createBlockElements({ id: "gone-resource", kind: "resource", ref: "gone-old", title: "Removed checkout", status: "", x: 160, y: 340, width: 240, height: 110 }));
const world = {
  schema: "area-map-world.v1", worldId: "escape-back-step-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 100, y: 100, width: 760, height: 520 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: childScene.elements.length, blockCount: 2, scene: childScene } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
];
const main = {
  locator: { owner: "otto/tangent", id: "worktree-main" }, label: "Main checkout", target: { kind: "worktree", path: ${JSON.stringify(mainTarget)} },
  local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-rebuild" }, repositoryPath: ${JSON.stringify(mainTarget)} }, checkedAt: "2026-09-03T01:00:00.000Z" },
  link: null, representation: { state: "current", value: "on-map" }, origin: null, warnings: [],
};
const gone = {
  locator: { owner: "otto/tangent", id: "gone-old" }, reason: "removed",
  lastKnown: { label: "Removed checkout", target: { kind: "worktree", path: ${JSON.stringify(removedTarget)} } },
  representation: { state: "current", value: "on-map" }, warnings: [],
};
const projection = {
  state: "current", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "cat-1" }],
  counts: { state: "current", confirmedAssociations: 2, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [],
  rows: [
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: main },
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: gone },
  ],
};
const byKey = new Map([["otto/tangent worktree-main", main], ["otto/tangent gone-old", gone]]);
window.apiCalls = [];
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  window.apiCalls.push({ url, body });
  if (url.startsWith("/api/areas/map-resources?")) return structuredClone(projection);
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") {
    return { resolutions: body.resources.map((locator) => { const value = structuredClone(byKey.get(locator.owner + " " + locator.id)); return { state: value?.reason ? "gone" : "current", value }; }) };
  }
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  throw new Error("Unexpected fixture resource route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api: resourceApi, focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: async () => ({ status: 200, hashes: {}, treeRevision: "tree-2", worldRevision: "world-2" }), onEntityVerb: () => {}, onBack: () => {},
});
</script></body></html>`;

test("Escape steps back from Details to the Resources sheet and never strands the Add-back dialog over an inert Map", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 720 }, reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.controller?.() && window.apiCalls.some((call) => call.url === "/api/areas/map-resources/resolve"));
    const beforeAnything = await surfaceReport(page);
    assert.equal(beforeAnything.canvasInert, false, "the Map takes input before any surface opens");

    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Map resources" }).waitFor();
    await page.getByText("Main checkout", { exact: true }).first().waitFor();
    const sheetOpen = await surfaceReport(page);
    assert.equal(sheetOpen.panel, 1, "the Resources sheet is open at 800px");
    assert.equal(sheetOpen.canvasInert, true, "the narrow sheet owns the screen, so the canvas behind it is inert");
    assert.equal(sheetOpen.brainInert, true, "the shell around the Map is inert too while the sheet owns the screen");
    assert.equal(sheetOpen.dialogs, 1, "the narrow sheet is the one dialog on the screen");
    assert.equal(sheetOpen.backdrops, 1, "the sheet brings one backdrop with it");

    const mainRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Main checkout" });
    await mainRow.getByRole("button", { name: "Details" }).click();
    const details = page.locator(".tangent-map-resource-details");
    await details.getByRole("heading", { name: "Main checkout" }).waitFor();
    assert.equal((await surfaceReport(page)).details, 1, "the Details view is open over the sheet");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".tangent-map-resource-details").length === 0);
    await settled(page);
    const afterDetailsEscape = await surfaceReport(page);
    assert.equal(afterDetailsEscape.details, 0, "Escape removes the Details view");
    assert.equal(afterDetailsEscape.panel, 1, "Escape leaves the Resources sheet open, because leaving Details is a back step and not a close");
    assert.ok(afterDetailsEscape.rows >= 2, "the inventory the person came from is under them again");
    assert.equal(afterDetailsEscape.canvasInert, true, "the sheet still owns the screen, so the back step did not half lift the guard over the canvas");
    assert.equal(afterDetailsEscape.brainInert, true, "the shell stays inert as well, because a sheet is still open");
    await page.getByRole("heading", { name: "Map resources" }).waitFor();

    const goneRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Removed checkout" });
    await goneRow.getByRole("button", { name: "Add back to Area" }).click();
    const addBack = page.getByRole("dialog", { name: "Add Removed checkout back to Area?" });
    await addBack.waitFor();
    const dialogOpen = await surfaceReport(page);
    assert.equal(dialogOpen.recovery, 1, "the Add-back confirmation is open");
    assert.equal(dialogOpen.panel, 1, "the sheet the dialog was opened from is still behind it");
    assert.equal(dialogOpen.backdrops, 2, "the dialog lays its own backdrop over the sheet's");
    assert.equal(dialogOpen.canvasInert, true, "the Map is inert under the dialog, which is the state the person must be able to escape from");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".tangent-map-resource-recovery").length === 0);
    await settled(page);
    const afterDialogEscape = await surfaceReport(page);
    assert.equal(afterDialogEscape.recovery, 0, "Escape removes the Add-back dialog rather than the sheet under it");
    assert.equal(afterDialogEscape.panel, 1, "the Resources sheet survives the dialog it opened, so no dialog is left stranded over an inert Map");
    assert.ok(afterDialogEscape.rows >= 2, "the person is returned to the inventory row they asked from");
    assert.equal(afterDialogEscape.backdrops, 1, "only the dialog's backdrop went away, and the sheet keeps its own");
    assert.equal(afterDialogEscape.canvasInert, true, "the Map is still inert, because the sheet the person is reading still owns the screen");
    await goneRow.getByRole("button", { name: "Add back to Area" }).waitFor();
    assert.equal(await page.evaluate(() => window.apiCalls.some((call) => call.url === "/api/areas/map-resources/apply")), false, "a cancelled confirmation writes nothing");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll(".tangent-map-resources").length === 0);
    await settled(page);
    const afterSheetEscape = await surfaceReport(page);
    assert.equal(afterSheetEscape.panel, 0, "the third Escape is the one that closes the sheet itself");
    assert.equal(afterSheetEscape.rows, 0, "the inventory leaves with the sheet it was in");
    assert.equal(afterSheetEscape.dialogs, 0, "no dialog is left over the Map");
    assert.equal(afterSheetEscape.backdrops, 0, "no backdrop is left over the Map");
    assert.equal(afterSheetEscape.canvasInert, false, "the Map takes input again once every modal surface is closed");
    assert.equal(afterSheetEscape.brainInert, false, "the shell around the Map takes input again too");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
