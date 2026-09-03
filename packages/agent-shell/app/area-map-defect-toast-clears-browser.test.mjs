// Audit defect: "the map toast never clears". The old Map kept one visible
// notice node and only ever replaced its text, so the last thing the Map said
// stayed on screen over the canvas until something else was said. This suite
// drives the rebuilt Map with a real press and a real Enter, watches the toast
// appear, and then waits without touching the page. The toast has to go on its
// own once its time to live has passed.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";
import { LAYOUT } from "./map/layout/layout-tokens.ts";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

// The Map names both numbers once, in map/layout/layout-tokens.ts. The test
// reads them from there so it measures the Map's own promise and not a copy.
/** How long a visible announcement stays before the announce store drops it. */
const ANNOUNCE_TTL = LAYOUT.announceTtl;
/** How often the announce timer advances the store's clock. */
const ANNOUNCE_TICK = LAYOUT.announceTick;
/** How long the test waits past the time to live before it calls the toast stuck. */
const CLEAR_GRACE = ANNOUNCE_TICK * 6;
/** The sentence the Map shows after the selected Area is fitted. */
const IN_VIEW = "delivery in view";

const fixture = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Map toast fixture</title>
  <link rel="stylesheet" href="/agent-shell-map.css">
  <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style>
</head>
<body>
<div id="map"></div>
<script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const scene = () => core.createEmptyScene();

const delivery = scene();
delivery.elements.push(...core.createBlockElements({
  id: "delivery-plan",
  kind: "document",
  ref: "neara/delivery/delivery-plan.md",
  title: "Delivery plan",
  status: "draft",
  x: 160,
  y: 160,
  width: 220,
  height: 100,
}));

const scenes = new Map([["neara", scene()], ["neara/delivery", delivery]]);
const records = [
  ["neara", "@root", { x: 80, y: 80, width: 1000, height: 700 }],
  ["neara/delivery", "neara", { x: 120, y: 120, width: 620, height: 420 }],
];

const world = {
  schema: "area-map-world.v1",
  worldId: "toast-clears-world",
  treeRevision: "tree-1",
  worldRevision: "world-1",
  locatedArea: "neara/delivery",
  areas: records.map(([key, parent, storedRect]) => ({
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
    shard: {
      owner: key,
      hash: "hash-" + key,
      state: "ready",
      elementCount: scenes.get(key).elements.length,
      blockCount: scenes.get(key).elements.filter((element) => element.type === "rectangle" && element.customData?.tangent?.ref).length,
      scene: scenes.get(key),
    },
  })),
};

const documents = [
  { kind: "area", area: "neara", file: "neara/neara.md", title: "Neara", status: "active" },
  { kind: "area", area: "neara/delivery", file: "neara/delivery/delivery.md", title: "Delivery", status: "active" },
  { kind: "document", area: "neara/delivery", file: "neara/delivery/delivery-plan.md", title: "Delivery plan", status: "draft", live: false },
];

/** Serves only the read routes this two-Area Map asks for; anything else is a fixture mistake. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url.startsWith("/api/areas/map-resources?")) {
    return { state: "current", viewedFrom: new URL(url, location.origin).searchParams.get("area"), catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  }
  throw new Error("Unexpected toast fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: scene(),
  getDocuments: () => documents,
  api,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: () => {},
  loadShard: async (area) => ({ area, worldRevision: world.worldRevision, hash: "hash-" + area, state: "ready", scene: scene() }),
  reloadWorld: async () => structuredClone(world),
  onEntityVerb: () => {},
  onBack: () => {},
});
</script>
</body>
</html>`;

/** Starts the one-off static server that serves the fixture page and the built Map bundle. */
async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fixture);
      return;
    }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** Waits for the mounted Map to finish its first paint, so a later assertion reads a settled page. */
async function waitForMap(page) {
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => Boolean(window.editor?.controller?.()));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Returns the text of the visible Map toast, or null when no toast is on screen. */
async function toastText(page) {
  return page.evaluate(() => document.querySelector(".tangent-map-location")?.textContent ?? null);
}

/** Returns the text of the polite live region, or null when the Map is saying nothing. */
async function spokenText(page) {
  return page.evaluate(() => document.querySelector(".tangent-map-live")?.textContent ?? null);
}

/** Converts one Excalidraw scene point to browser viewport coordinates. */
async function viewportPoint(page, scenePoint) {
  const box = await page.locator(".excalidraw canvas.interactive").boundingBox();
  assert.ok(box, "the Map canvas has a box to aim at");
  const appState = await page.evaluate(() => window.editor.appState());
  return {
    x: box.x + (scenePoint.x + appState.scrollX) * appState.zoom.value,
    y: box.y + (scenePoint.y + appState.scrollY) * appState.zoom.value,
  };
}

/** Returns a scene point inside one Area's region that no authored Block sits under. */
async function emptyPointInside(page, area) {
  const found = await page.evaluate((target) => {
    const elements = (window.editor.rendered?.() ?? []).filter((element) => !element.isDeleted);
    const region = elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === target);
    if (!region) return null;
    const authored = elements.filter((element) => element.customData?.tangent?.role !== "area-region");
    const candidates = [[0.8, 0.8], [0.2, 0.8], [0.8, 0.5], [0.5, 0.8], [0.8, 0.2]]
      .map(([across, down]) => ({ x: region.x + region.width * across, y: region.y + region.height * down }));
    return candidates.find((point) => !authored.some((element) => point.x >= element.x - 16 && point.x <= element.x + element.width + 16
      && point.y >= element.y - 16 && point.y <= element.y + element.height + 16)) ?? null;
  }, area);
  assert.ok(found, `${area} has a point no Block covers`);
  return found;
}

/** Clicks inside one Area's region on the canvas and waits for Excalidraw to hold that region selected. */
async function selectAreaByPointer(page, area) {
  const at = await viewportPoint(page, await emptyPointInside(page, area));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction((target) => {
    const selected = window.editor.appState().selectedElementIds;
    return window.editor.current().elements.some((element) => selected[element.id] && element.customData?.tangent?.area === target);
  }, area);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("the map toast clears itself after its time to live instead of staying on the canvas", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = await startFixtureServer();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", colorScheme: "dark" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("crash", () => pageErrors.push("the fixture page crashed"));
    browser.on("disconnected", () => pageErrors.push("the browser disconnected"));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await waitForMap(page);
    assert.equal(await toastText(page), null, "a Map that has said nothing shows no toast");

    // A real press inside the Area selects it, and a real Enter on the selected
    // Area fits it, which is one of the moments the Map speaks.
    await selectAreaByPointer(page, "neara/delivery");
    const raisedAt = Date.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction((text) => document.querySelector(".tangent-map-location")?.textContent === text, IN_VIEW);
    assert.equal(await spokenText(page), IN_VIEW, "the Map also speaks what it shows");

    // The toast is a message a person has to be able to read, so it stays for
    // most of its time to live before anything drops it.
    await page.waitForTimeout(ANNOUNCE_TTL / 2);
    assert.equal(await toastText(page), IN_VIEW, "the toast stays on screen long enough to read");

    // Nothing below touches the page. The toast has to clear on its own.
    await page.waitForFunction(() => document.querySelector(".tangent-map-location") === null, undefined, { timeout: ANNOUNCE_TTL + CLEAR_GRACE, polling: ANNOUNCE_TICK });
    const clearedAfter = Date.now() - raisedAt;
    assert.ok(clearedAfter >= ANNOUNCE_TTL, `the toast is not dropped before its time to live: cleared after ${clearedAfter}ms of ${ANNOUNCE_TTL}ms`);
    assert.equal(await spokenText(page), null, "the live region empties with the toast, so nothing is re-read");

    // The Map is still working after the toast went: the same gesture says the
    // same sentence again, which proves the clear removed a message and not the
    // whole announcement surface.
    await page.keyboard.press("Enter");
    await page.waitForFunction((text) => document.querySelector(".tangent-map-location")?.textContent === text, IN_VIEW);
    await page.waitForFunction(() => document.querySelector(".tangent-map-location") === null, undefined, { timeout: ANNOUNCE_TTL + CLEAR_GRACE, polling: ANNOUNCE_TICK });

    assert.deepEqual(pageErrors, [], "the Map raised no page error while the toast came and went");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
