// Regression proof for the audit defect "Only the first Block-picker result is reachable by
// keyboard; the Outline opens without focus and is sixteen tab stops away".
//
// The proof drives the Map with real keyboard and pointer input only. It never focuses an element
// from script, because the defect is exactly that a person using the keyboard cannot get to the
// places a mouse reaches. The Outline half is asserted first, so a failure localises to one half of
// the defect without reading the other half's assertions.
//
// At the time this proof was written the Outline half passes and the picker half fails. The picker
// binds Tab to the whole-vault toggle, and `ui/key-bindings.ts` consumes a bound key with both
// preventDefault and stopPropagation, so Tab neither moves focus nor reaches the tab trap in
// `ui/Surface.tsx`. No other key moves focus from the query field into the picker's Listbox, whose
// roving tabindex therefore never receives the keyboard. Every result stays out of reach.

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
  <link rel="stylesheet" href="/agent-shell-map.css">
  <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style>
</head>
<body>
<div id="map"></div>
<script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
/** Builds one stored Area region record for the fixture world. */
const region = (parent, key, rect) => ({
  key: parent + ">" + key, owner: parent, child: key,
  sourceId: "region-" + key.replaceAll("/", "-"), labelSourceId: "label-" + key.replaceAll("/", "-"),
  source: "stored", storedRect: rect,
});
/** Builds one ready Area node with an empty shard scene. */
const node = (key, parent, children, rect) => ({
  key, parent, children, depth: key.split("/").length - 1, region: region(parent, key, rect),
  shard: { owner: key, hash: "hash-" + key, state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
});

const world = {
  schema: "area-map-world.v1", worldId: "picker-outline-keys-world",
  treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "atlas/harbour",
  areas: [
    node("atlas", "@root", ["atlas/harbour", "atlas/quarry"], { x: 80, y: 80, width: 1100, height: 760 }),
    node("atlas/harbour", "atlas", [], { x: 120, y: 120, width: 620, height: 420 }),
    node("atlas/quarry", "atlas", [], { x: 800, y: 120, width: 300, height: 260 }),
  ],
};

// Four Goals in one Area, named so their alphabetical order is the order the picker lists them.
const documents = [
  { kind: "area", area: "atlas", file: "atlas/atlas.md", title: "Atlas", status: "active" },
  { kind: "area", area: "atlas/harbour", file: "atlas/harbour/harbour.md", title: "Harbour", status: "active" },
  { kind: "area", area: "atlas/quarry", file: "atlas/quarry/quarry.md", title: "Quarry", status: "active" },
  { kind: "goal", area: "atlas/harbour", file: "atlas/harbour/goal-beacon-alpha.md", title: "Beacon alpha", status: "active" },
  { kind: "goal", area: "atlas/harbour", file: "atlas/harbour/goal-beacon-bravo.md", title: "Beacon bravo", status: "active" },
  { kind: "goal", area: "atlas/harbour", file: "atlas/harbour/goal-beacon-charlie.md", title: "Beacon charlie", status: "active" },
  { kind: "goal", area: "atlas/harbour", file: "atlas/harbour/goal-beacon-delta.md", title: "Beacon delta", status: "active" },
];

/** Serves only the read routes the composed Map asks for; this fixture holds no resources. */
const api = async (url) => {
  if (url === "/api/areas/map-kinds") return { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] };
  if (url.startsWith("/api/areas/map-resources?")) return {
    state: "current", viewedFrom: new URL(url, location.origin).searchParams.get("area"), catalogs: [],
    counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 },
    suggestions: [], legacyReview: [], rows: [],
  };
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: [] };
  throw new Error("Unexpected picker and Outline fixture route: " + url);
};

window.worldEvents = [];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: (nextWorld) => { window.worldEvents.push(structuredClone(nextWorld)); },
  onEntityVerb: () => {}, onBack: () => {},
});
</script>
</body>
</html>`;

/** Describes the focused element well enough to read a failure without opening a browser. */
function activeElementFacts() {
  const active = document.activeElement;
  const option = active?.closest('[role="option"]');
  const treeitem = active?.closest('[role="treeitem"]');
  const list = document.querySelector('[role="listbox"]');
  const tree = document.querySelector('[role="tree"]');
  return {
    tag: active?.tagName ?? null,
    role: active?.getAttribute("role") ?? null,
    text: active?.textContent ?? null,
    inHierarchy: Boolean(active?.closest('[role="region"][aria-label="Area hierarchy"]')),
    optionPosition: option && list ? [...list.querySelectorAll('[role="option"]')].indexOf(option) : null,
    treeitemPosition: treeitem && tree ? [...tree.querySelectorAll('[role="treeitem"]')].indexOf(treeitem) : null,
  };
}

/** Waits for the frame after React commits, so focus scheduled for the next frame has landed. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Reads where the keyboard is now, as a plain record the assertions compare against. */
async function focusFacts(page) {
  return page.evaluate(activeElementFacts);
}

/** Opens the fixture Map, clears the opening restriction, and fits the camera to the target Area. */
async function openMap(page, baseUrl) {
  await page.goto(baseUrl + "/picker-outline-keys-fixture", { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(() => window.editor.controller().setRestriction(null));
  await settled(page);
  await page.evaluate(() => window.editor.fitArea("atlas/harbour", { push: false }));
  await settled(page);
}

test("every Block-picker result is reachable by keyboard and the Outline opens with a row focused", { skip: !enabled, timeout: 90_000 }, async (context) => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/picker-outline-keys-fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fixture);
      return;
    }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
    headless: true,
  });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", colorScheme: "dark" });
  await openMap(page, `http://127.0.0.1:${server.address().port}`);

  // The Outline half of the defect: opening it from the toolbar leaves the keyboard on a tree row,
  // not sixteen tab stops behind it, and the arrow keys walk the rows from there.
  await page.getByRole("button", { name: "Outline" }).click();
  const outline = page.getByRole("region", { name: "Area hierarchy" });
  await outline.waitFor();
  await settled(page);
  const openedOutline = await focusFacts(page);
  assert.deepEqual(
    { role: openedOutline.role, inHierarchy: openedOutline.inHierarchy, treeitemPosition: openedOutline.treeitemPosition },
    { role: "treeitem", inHierarchy: true, treeitemPosition: 0 },
    `the Outline opens with its first row focused, with no Tab press: ${JSON.stringify(openedOutline)}`,
  );
  await page.keyboard.press("ArrowDown");
  const secondRow = await focusFacts(page);
  assert.deepEqual(
    { role: secondRow.role, treeitemPosition: secondRow.treeitemPosition },
    { role: "treeitem", treeitemPosition: 1 },
    `ArrowDown moves the keyboard to the next Outline row: ${JSON.stringify(secondRow)}`,
  );
  await page.keyboard.press("Escape");
  await outline.waitFor({ state: "detached" });

  // The picker half of the defect: a query with several results, and the keyboard reaches results
  // past the first one.
  await page.locator(".excalidraw canvas.interactive").focus();
  await page.keyboard.press("b");
  const picker = page.getByRole("dialog", { name: "Place a Tangent block" });
  await picker.waitFor();
  await settled(page);
  const openedPicker = await focusFacts(page);
  assert.equal(openedPicker.tag, "INPUT", `the picker opens with the query field focused so a person can type: ${JSON.stringify(openedPicker)}`);
  await page.keyboard.type("Beacon");
  await settled(page);
  assert.deepEqual(
    (await picker.getByRole("option").allTextContents()).map((value) => value.replace(/^goal/, "").replace(/active$/, "")),
    ["Beacon alpha", "Beacon bravo", "Beacon charlie", "Beacon delta"],
    "the query leaves four results, so a keyboard that reaches only the first reaches a quarter of them",
  );

  await page.keyboard.press("ArrowDown");
  const firstResult = await focusFacts(page);
  assert.deepEqual(
    { role: firstResult.role, optionPosition: firstResult.optionPosition },
    { role: "option", optionPosition: 0 },
    `ArrowDown moves the keyboard out of the query and onto the first result: ${JSON.stringify(firstResult)}`,
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const thirdResult = await focusFacts(page);
  assert.deepEqual(
    { role: thirdResult.role, optionPosition: thirdResult.optionPosition, text: thirdResult.text },
    { role: "option", optionPosition: 2, text: "goalBeacon charlieactive" },
    `two more ArrowDown presses reach the third result: ${JSON.stringify(thirdResult)}`,
  );

  // Reaching a result is only half of reaching it: Enter must place the result the keyboard is on,
  // not the first one the query matched.
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.editor.current().elements.some((element) => element.customData?.tangent?.ref === "atlas/harbour/goal-beacon-charlie.md"), null, { timeout: 5_000 });
  const placedRefs = await page.evaluate(() => window.editor.current().elements
    .map((element) => element.customData?.tangent?.ref)
    .filter((ref) => typeof ref === "string" && ref.includes("goal-beacon")));
  assert.deepEqual(placedRefs, ["atlas/harbour/goal-beacon-charlie.md"], "Enter places the result the keyboard reached, and only that one");
});
