import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

// The audit finding this suite holds shut: "Place on Map, the placement preview, and Fit and centre
// all land behind the open Resources panel." At wide widths the panel is retained beside the canvas
// rather than over it, so the Map a person can still see is the strip the panel leaves. Everything
// the Map centres has to be centred in that strip: the placement bar and the toast under the
// pointer, and equally the Area the camera fits and the point a placement starts at. The four are
// one finding because they have one cause, the width of the panel not being subtracted from the
// space the Map treats as visible, so they are measured together in one run.

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Map panel inset fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const world = {
  schema: "area-map-world.v1", worldId: "panel-inset-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 140, y: 140, width: 760, height: 520 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
];
const checkout = {
  locator: { owner: "otto/tangent", id: "worktree-main" }, label: "Main checkout", target: { kind: "worktree", path: "/private/tmp/tangent-panel-inset/main" },
  local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-rebuild" }, repositoryPath: "/private/tmp/tangent-panel-inset/main" }, checkedAt: "2026-09-03T01:00:00.000Z" },
  link: null, representation: { state: "current", value: "never-placed" }, origin: null, warnings: [],
};
const projection = {
  state: "current", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "cat-child" }],
  counts: { state: "current", confirmedAssociations: 1, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [],
  rows: [{ viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: checkout }],
};
window.apiCalls = [];
/** Serves the read routes the Resources panel and its placement need, and refuses every other route. */
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  window.apiCalls.push({ url, body });
  if (url.startsWith("/api/areas/map-resources?")) return structuredClone(projection);
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") {
    return { resolutions: body.resources.map(() => ({ state: "current", value: structuredClone(checkout) })) };
  }
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  throw new Error("Unexpected panel inset fixture route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api: resourceApi,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: () => undefined,
  loadShard: async (area) => ({ area, worldRevision: world.worldRevision, hash: "hash-" + area, state: "ready", scene: empty() }),
  reloadWorld: async () => structuredClone(world),
});
</script></body></html>`;

/** Waits for the frame after React commits, so a geometry read never measures the layout of the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * True when one HTML Map surface is on screen, ends before the panel starts, and does not have the
 * panel at its own centre. A surface that fails any of the three is one a person cannot read.
 */
async function htmlSurfaceIsClear(page, selector) {
  return page.evaluate((value) => {
    const box = document.querySelector(value).getBoundingClientRect();
    const panel = document.querySelector(".tangent-map-resources").getBoundingClientRect();
    const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.left >= 0 && box.right <= panel.left && !middle?.closest(".tangent-map-resources");
  }, selector);
}

/**
 * Where one Area's region and the resource preview Block sit on screen, and where the panel starts.
 * Both are scene elements, so each is carried through the live camera into screen pixels the same
 * way Excalidraw draws it.
 */
async function canvasSpans(page, area) {
  return page.evaluate((target) => {
    const canvas = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    const panel = document.querySelector(".tangent-map-resources").getBoundingClientRect();
    const appState = window.editor.appState();
    const zoom = appState.zoom.value;
    /** Carries one scene element's horizontal span into screen pixels. */
    const span = (element) => element && { left: canvas.left + (element.x + appState.scrollX) * zoom, right: canvas.left + (element.x + element.width + appState.scrollX) * zoom };
    const region = window.editor.controller().snapshot().composition.regionRects.get(target);
    const preview = (window.editor.rendered() ?? []).find((element) => element.customData?.tangentWorldEphemeral && element.customData?.tangent?.ref === "worktree-main");
    return { panelLeft: panel.left, region: span(region), preview: span(preview) };
  }, area);
}

/** True when one screen span starts inside the Map and ends before the panel starts. */
function spanIsClear(span, panelLeft) {
  return span !== null && span !== undefined && span.left >= 0 && span.right <= panelLeft;
}

// One run of the whole finding. Every step is input a person gives: a mouse click on the Resources
// button, a mouse click on the row's Place on Map, the pointer moving over the canvas, and the
// Escape key. What is measured after each step is only what a person can see: where the bar, the
// preview Block, the fitted Area and the toast sit against the panel's left edge.
test("Place on Map, its preview and the Area it fits all stay clear of the open Resources panel", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.editor?.controller?.() && window.editor.appState()?.zoom?.value);

    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("region", { name: "Map resources · Tangent" }).waitFor();
    await page.locator(".TangentAreaMap.resources-panel-open").waitFor();
    const panelWidth = await page.locator(".tangent-map-resources").evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(panelWidth > 300, `the wide panel is retained beside the canvas rather than over it: ${panelWidth}px`);

    const row = page.locator(".tangent-map-resource-row").filter({ hasText: "Main checkout" });
    await row.getByRole("button", { name: "Place on Map" }).click();
    await page.getByRole("status", { name: "Place Main checkout on the Map" }).waitFor();
    await settled(page);
    const spans = await canvasSpans(page, "otto/tangent");
    const seen = {
      placementBar: await htmlSurfaceIsClear(page, ".tangent-map-resource-placement"),
      preview: spanIsClear(spans.preview, spans.panelLeft),
      fittedArea: spanIsClear(spans.region, spans.panelLeft),
      toast: null,
    };

    await page.keyboard.press("Escape");
    await page.getByRole("status", { name: "Place Main checkout on the Map" }).waitFor({ state: "detached" });
    await page.locator(".tangent-map-location").waitFor();
    await settled(page);
    seen.toast = await htmlSurfaceIsClear(page, ".tangent-map-location");

    assert.deepEqual(
      seen,
      { placementBar: true, preview: true, fittedArea: true, toast: true },
      `Place on Map centres its bar, its preview Block, the Area it fits and its toast in the strip beside the panel: ${JSON.stringify(spans)}`,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
