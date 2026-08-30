import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { validateAreaCanvas } from "./area-canvas.mjs";
import areaBoardCore from "./public/area-board-core.js";
import { serveStaticAsset } from "./static-assets.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** Sends one JSON response from the browser-path fixture server. */
function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
const documents = [{ file: "otto/goal-map.md", kind: "goal", title: "Map quality", status: "active" }];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { area: "otto", scene, view: null, proposals: [], getDocuments: () => documents, onSceneChange: (next) => { window.lastScene = next; }, onFactScene: () => {}, onEntityVerb: () => {}, onBack: () => {}, onSaveNow: () => {} });
</script></body></html>`;

const failureFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
let fail = true;
mountAreaBoardEditor(document.querySelector("#map"), { area: "otto", scene, view: null, proposals: [], getDocuments: () => { if (fail) throw new Error("fixture render failed"); return []; }, onEditorError: () => { fail = false; }, onSceneChange: () => {}, onFactScene: () => {} });
</script></body></html>`;

const regionFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";
const fresh = core.withBoundary(core.createEmptyScene(), "otto");
fresh.elements.push(...core.createRegionElements({ id: "child-region", ref: "otto/child/child.md", title: "child", status: "active", x: 180, y: 160, width: 420, height: 300 }));
fresh.elements.push(core.createShapeElement({ id: "parent-ink", type: "rectangle", x: 330, y: 330, width: 70, height: 50 }));
const child = core.withBoundary(core.createEmptyScene(), "otto/child");
child.elements.push(core.createTextElement({ id: "child-ink", text: "projected child", x: 80, y: 100 }));
const scene = JSON.parse(sessionStorage.getItem("region-scene") || "null") || fresh;
const documents = [{ file: "otto/child/child.md", kind: "area", area: "otto/child", title: "child", status: "active" }];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { area: "otto", scene, childScenes: new Map([["otto/child", child]]), view: null, proposals: [], getDocuments: () => documents, onSceneChange: (next) => { window.lastScene = next; sessionStorage.setItem("region-scene", JSON.stringify(next)); }, onFactScene: () => {}, onEntityVerb: () => {}, onBack: () => {}, onSaveNow: () => {} });
</script></body></html>`;

const nestedFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";
const neara = core.withBoundary(core.createEmptyScene(), "neara");
neara.elements.push(...core.createRegionElements({ id: "delivery", ref: "neara/delivery/delivery.md", title: "Delivery", x: 100, y: 100, width: 900, height: 600 }));
const delivery = core.withBoundary(core.createEmptyScene(), "neara/delivery");
delivery.elements.push(...core.createRegionElements({ id: "standards", ref: "neara/delivery/standards/standards.md", title: "Standards", x: 120, y: 120, width: 620, height: 420 }));
const standards = core.withBoundary(core.createEmptyScene(), "neara/delivery/standards");
standards.elements.push(...core.createBlockElements({ id: "standard-goal", kind: "goal", ref: "neara/delivery/standards/goal-proof.md", title: "Proof", x: 140, y: 140, width: 220, height: 100 }));
const context = { ancestors: [
  { area: "neara", name: "Neara", hash: "n", boundary: { x: -80, y: -80, width: 1760, height: 1160 }, regionForChild: { x: 100, y: 100, width: 900, height: 600 }, elementId: "delivery", scene: neara, regions: [{ area: "neara/delivery", elementId: "delivery", rect: { x: 100, y: 100, width: 900, height: 600 } }] },
  { area: "neara/delivery", name: "Delivery", hash: "d", boundary: { x: -80, y: -80, width: 1200, height: 800 }, regionForChild: { x: 120, y: 120, width: 620, height: 420 }, elementId: "standards", scene: delivery, regions: [{ area: "neara/delivery/standards", elementId: "standards", rect: { x: 120, y: 120, width: 620, height: 420 } }] },
] };
const documents = [{ file: "neara/neara.md", kind: "area", area: "neara", title: "Neara", status: "active" }, { file: "neara/delivery/delivery.md", kind: "area", area: "neara/delivery", title: "Delivery", status: "active" }, { file: "neara/delivery/standards/standards.md", kind: "area", area: "neara/delivery/standards", title: "Standards", status: "active" }, { file: "neara/delivery/standards/goal-proof.md", kind: "goal", area: "neara/delivery/standards", title: "Proof", status: "active" }];
window.extentWrites = [];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { area: "neara/delivery/standards", scene: standards, context, childScenes: new Map(), view: null, proposals: [], getDocuments: () => documents, backLabel: "Delivery", onSceneChange: (_next, gesture) => { if (gesture?.extentWrite) window.extentWrites.push(gesture.extentWrite); }, onFactScene: () => {}, onEntityVerb: () => {}, onBack: () => {}, onSaveNow: () => {} });
</script></body></html>`;

const worldFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: {}, files: {} });
const nodes = [
  ["neara", "@root", { x: 80, y: 80, width: 1100, height: 800 }],
  ["neara/delivery", "neara", { x: 100, y: 100, width: 900, height: 600 }],
  ["neara/delivery/standards", "neara/delivery", { x: 120, y: 120, width: 620, height: 420 }],
];
const world = { schema: "area-map-world.v1", worldId: "near-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "neara/delivery/standards", areas: nodes.map(([key, parent, storedRect], index) => ({ key, parent, children: nodes.filter((entry) => entry[1] === key).map((entry) => entry[0]), depth: index, region: { key: parent + ">" + key, owner: parent, child: key, sourceId: "region-" + index, labelSourceId: "label-" + index, source: "stored", storedRect }, shard: { owner: key, hash: key, state: "ready", elementCount: 0, scene: empty() } })) };
const documents = nodes.map(([area]) => ({ kind: "area", area, title: area.split("/").at(-1) }));
window.changes = [];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { world, scene: empty(), getDocuments: () => documents, focus: { only: false, activeOnly: false, areas: [] }, onWorldChange: (_world, areas, owners) => window.changes.push({ areas: [...areas], owners: [...owners] }), onBack: () => {} });
</script></body></html>`;

test("an editor render failure explains the problem and retry mounts the canvas", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/failure-fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(failureFixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/failure-fixture`);
    const alert = page.getByRole("alert");
    await alert.getByRole("heading", { name: "The drawing tools did not load." }).waitFor();
    assert.match(await alert.textContent(), /fixture render failed/);
    await alert.getByRole("button", { name: "Retry" }).click();
    await page.locator(".excalidraw canvas.interactive").waitFor();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every ancestor and descendant is one selectable live region", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/world-fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(worldFixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await page.goto(`http://127.0.0.1:${server.address().port}/world-fixture`);
    const canvas = page.locator(".excalidraw canvas.interactive"); await canvas.waitFor();
    await page.getByRole("button", { name: /^standards, depth/ }).click();
    const before = await page.evaluate(() => {
      const regions = window.editor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region");
      return Object.fromEntries(regions.map((element) => [element.customData.tangent.area, { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }]));
    });
    const appState = await page.evaluate(() => window.editor.appState()); const canvasBox = await canvas.boundingBox();
    /** Converts a scene point to the browser viewport. */
    const point = (x, y) => ({ x: canvasBox.x + (x + appState.scrollX) * appState.zoom.value, y: canvasBox.y + (y + appState.scrollY) * appState.zoom.value });
    const standards = before["neara/delivery/standards"];
    const start = point(standards.x + standards.width, standards.y + standards.height);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 320 * appState.zoom.value, start.y, { steps: 4 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const crossing = await page.evaluate(() => {
      const regions = window.editor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region");
      return Object.fromEntries(regions.map((element) => [element.customData.tangent.area, { x: element.x, y: element.y, width: element.width, height: element.height, locked: element.locked, deleted: element.isDeleted }]));
    });
    const delivery = crossing["neara/delivery"]; const near = crossing.neara; const grownStandards = crossing["neara/delivery/standards"];
    assert.ok(grownStandards.width > standards.width + 250, `the pointer grows Standards before pointer-up: ${JSON.stringify({ standards, grownStandards, appState })}`);
    assert.ok(delivery.width > before["neara/delivery"].width, "Delivery grows in the same frame");
    assert.ok(near.width > before.neara.width, "Neara grows in the same frame");
    assert.ok(grownStandards.x + grownStandards.width + 60 <= delivery.x + delivery.width + 0.01);
    assert.ok(delivery.x + delivery.width + 60 <= near.x + near.width + 0.01);
    assert.ok(Object.values(crossing).every((region) => region.locked === false && region.deleted === false));
    const actualGolden = await page.screenshot({ animations: "disabled" });
    const expectedGolden = await readFile(path.join(here, "test-fixtures/area-map/near-delivery-standards-crossing.png"));
    assert.deepEqual(actualGolden, expectedGolden, "the corrected crossing frame matches its deterministic golden");
    await page.mouse.up();
    for (const [name, area] of [["neara", "neara"], ["delivery", "neara/delivery"], ["standards", "neara/delivery/standards"]]) {
      await page.getByRole("button", { name: new RegExp(`^${name}, depth`) }).click({ force: true });
      const selected = await page.evaluate(() => { const ids = window.editor.appState().selectedElementIds; return window.editor.current().elements.find((element) => ids[element.id])?.customData?.tangent?.area; });
      assert.equal(selected, area);
    }
    const regions = await page.evaluate(() => window.editor.current().elements.filter((element) => element.customData?.tangent?.role === "area-region").map((element) => ({ area: element.customData.tangent.area, locked: element.locked, deleted: element.isDeleted })));
    assert.deepEqual(regions.map((region) => region.area), ["neara", "neara/delivery", "neara/delivery/standards"]);
    assert.ok(regions.every((region) => region.locked === false && region.deleted === false));
    await page.keyboard.press("Meta+Shift+o");
    await page.getByRole("region", { name: "Area hierarchy" }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Area hierarchy" }).getByRole("button").count(), 3);
    assert.equal(await page.getByRole("region", { name: "Area hierarchy" }).getByRole("button").count(), 3);
  } finally {
    await browser?.close(); await new Promise((resolve) => server.close(resolve));
  }
});

test("real Excalidraw paths create text, ink, shapes, a Tangent block, manipulation, and a bound arrow", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.locator(".excalidraw canvas.interactive").waitFor();
    for (const name of ["Selection", "Rectangle", "Diamond", "Ellipse", "Arrow", "Draw", "Text"]) await page.getByRole("radio", { name: new RegExp(name, "i") }).first().waitFor();
    await page.getByRole("button", { name: "Block" }).waitFor();

    // Visual structure: Tangent controls sit beside Excalidraw's own islands, never on top of them.
    const structure = await page.evaluate(() => {
      /** Returns one element's box as plain numbers. */
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      return { toolbar: box(".App-toolbar"), controls: box(".tangent-map-top-right"), save: box(".tangent-map-save"), help: box(".help-icon"), library: box(".default-sidebar-trigger"), hint: box(".tangent-map-empty-hint"), theme: document.querySelector(".excalidraw").className, canvas: getComputedStyle(document.querySelector(".TangentAreaMap")).backgroundColor };
    });
    /** Reports whether two boxes overlap. */
    const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    assert.equal(overlaps(structure.toolbar, structure.controls), false, "Tangent controls do not cover the tool bar");
    assert.equal(overlaps(structure.save, structure.help), false, "the save status does not cover Excalidraw's help button");
    assert.equal(structure.library === null || structure.library.right === structure.library.left, true, "the unused library trigger is hidden");
    assert.ok(structure.hint, "an empty map says how to start");
    assert.match(structure.theme, /theme--dark/);
    assert.equal(structure.canvas, "rgb(18, 18, 18)", "the map ground is dark behind a dark-theme editor");

    await page.keyboard.press("b");
    await page.getByRole("dialog", { name: "Place a Tangent block" }).getByRole("textbox").fill("map");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.editor.current().elements.some((element) => element.customData?.tangent?.kind === "goal"));

    const canvas = page.locator(".excalidraw canvas.interactive");
    const box = await canvas.boundingBox();
    assert.ok(box);
    /** Converts fixture-local coordinates to browser coordinates. */
    const point = (x, y) => ({ x: box.x + x, y: box.y + y });
    /** Returns focus to the canvas and selects one keyboard tool. */
    const tool = async (key) => { await page.mouse.click(point(1020, 700).x, point(1020, 700).y); await page.keyboard.press(key); };

    await tool("t");
    await page.mouse.click(point(170, 560).x, point(170, 560).y);
    await page.keyboard.type("plain text");
    await page.keyboard.press("Escape");

    await tool("r");
    await page.mouse.move(point(720, 250).x, point(720, 250).y);
    await page.mouse.down();
    await page.mouse.move(point(900, 390).x, point(900, 390).y, { steps: 8 });
    await page.mouse.up();

    const beforeMove = await page.evaluate(() => window.editor.current().elements.find((element) => element.type === "rectangle" && !element.customData?.tangent)?.x);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((before) => window.editor.current().elements.some((element) => element.type === "rectangle" && !element.customData?.tangent && element.x !== before), beforeMove);

    await tool("p");
    await page.mouse.move(point(120, 150).x, point(120, 150).y);
    await page.mouse.down();
    await page.mouse.move(point(210, 210).x, point(210, 210).y, { steps: 12 });
    await page.mouse.up();

    const block = await page.evaluate(() => window.editor.current().elements.find((element) => element.customData?.tangent));
    const moved = await page.evaluate(() => window.editor.current().elements.find((element) => element.type === "rectangle" && !element.customData?.tangent));
    assert.notEqual(moved.x, beforeMove, "selection drag moves the authored rectangle");

    await tool("a");
    const appState = await page.evaluate(() => window.editor.appState());
    /** Converts scene coordinates through Excalidraw's current viewport. */
    const scenePoint = (x, y) => point((x + appState.scrollX) * appState.zoom.value, (y + appState.scrollY) * appState.zoom.value);
    const start = scenePoint(block.x + block.width - 5, block.y + block.height / 2);
    const end = scenePoint(moved.x + 5, moved.y + moved.height / 2);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(250);
    const summary = await page.evaluate(() => window.editor.current().elements.map((element) => ({ type: element.type, text: element.text, start: element.startBinding?.elementId, end: element.endBinding?.elementId, tangent: element.customData?.tangent?.kind })));
    assert.ok(summary.some((element) => element.type === "text" && element.text === "plain text"));
    assert.ok(summary.some((element) => element.type === "freedraw"));
    assert.ok(summary.some((element) => element.type === "rectangle" && !element.tangent));
    assert.ok(summary.some((element) => element.tangent === "goal"));
    assert.ok(summary.some((element) => element.type === "arrow" && element.start && element.end), `the arrow binds to both connectable endpoints: ${JSON.stringify(summary)}`);

    const inkColor = await page.evaluate(() => window.editor.current().elements.find((element) => element.type === "text" && element.text === "plain text")?.strokeColor);
    assert.equal(inkColor, "#1e1e1e", "typed text uses Excalidraw's default ink, which the dark theme shows light on the dark canvas");

    await page.getByRole("button", { name: "Outline" }).click();
    const blockOutline = page.getByRole("button", { name: /goal: Map quality, active/ });
    await blockOutline.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => window.editor.appState().selectedElementIds[id] === true, block.id);
    await page.keyboard.press("x");
    await page.waitForFunction((id) => window.editor.current().elements.find((element) => element.id === id)?.isDeleted === true, block.id);
    await page.getByRole("button", { name: /Map quality.*Restore/ }).click();
    await page.waitForFunction((id) => window.editor.current().elements.find((element) => element.id === id)?.isDeleted === false, block.id);

    const authored = await page.evaluate(() => window.editor.current());
    assert.deepEqual(validateAreaCanvas(authored).errors, [], "the server accepts the real editor scene");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pointer move and resize keep Area geometry coherent without transforming contained ink", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/region-fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(regionFixture); return; }
    if (url.pathname === "/area-board-core.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(here, "public", "area-board-core.js")))); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/region-fixture`);
    const canvas = page.locator(".excalidraw canvas.interactive");
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    assert.ok(box);
    /** Reads the authored geometry that the mounted editor currently exposes. */
    const geometry = async () => page.evaluate(() => {
      const elements = window.editor.current().elements;
      /** Selects the geometry fields that define one test element. */
      const pick = (id) => { const { x, y, width, height } = elements.find((element) => element.id === id); return { x, y, width, height }; };
      return { region: pick("child-region"), label: pick("child-region-tangent-label"), ink: pick("parent-ink"), boundary: pick("tangent-boundary-501755363") };
    });
    /** Converts one Excalidraw scene point to this browser viewport. */
    const scenePoint = async (x, y) => {
      const state = await page.evaluate(() => window.editor.appState());
      return { x: box.x + (x + state.scrollX) * state.zoom.value, y: box.y + (y + state.scrollY) * state.zoom.value };
    };
    /** Performs an actual pointer drag between two scene points. */
    const drag = async (from, to) => {
      const start = await scenePoint(from.x, from.y); const end = await scenePoint(to.x, to.y);
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(150);
    };
    const before = await geometry();
    const labelOffset = { x: before.label.x - before.region.x, y: before.label.y - before.region.y };
    /** Asserts that Excalidraw's bound-text padding keeps a label inside its region corner. */
    const assertAttached = (state, message) => {
      const offset = { x: state.label.x - state.region.x, y: state.label.y - state.region.y };
      assert.ok(offset.x >= 0 && offset.x <= 20 && offset.y >= 0 && offset.y <= 20, `${message}: ${JSON.stringify(offset)}`);
    };
    await drag({ x: before.region.x + before.region.width - 25, y: before.region.y + 4 }, { x: before.region.x + before.region.width + 95, y: before.region.y + 64 });
    const moved = await geometry();
    assert.ok(moved.region.x > before.region.x + 100, "the actual pointer drag moves the Area region");
    assert.deepEqual({ x: moved.label.x - moved.region.x, y: moved.label.y - moved.region.y }, labelOffset, "the bound label keeps its offset during the move");
    assert.deepEqual(moved.ink, before.ink, "parent-file ink inside the region does not move with it");

    await page.keyboard.press("Meta+z"); await page.waitForTimeout(150);
    const undone = await geometry();
    assert.deepEqual({ x: undone.region.x, y: undone.region.y }, { x: before.region.x, y: before.region.y }, "undo restores the complete region move");
    assertAttached(undone, "the label remains attached after undo");
    await page.keyboard.press("Meta+Shift+z"); await page.waitForTimeout(150);
    const redone = await geometry();
    assert.deepEqual({ x: redone.region.x, y: redone.region.y }, { x: moved.region.x, y: moved.region.y }, "redo restores the complete region move");
    assertAttached(redone, "the label remains attached after redo");

    await drag({ x: redone.region.x + redone.region.width, y: redone.region.y + redone.region.height }, { x: redone.region.x + redone.region.width + 90, y: redone.region.y + redone.region.height + 70 });
    const resized = await geometry();
    assert.ok(resized.region.width > moved.region.width + 70 && resized.region.height > moved.region.height + 50, "the resize handle changes the boundary extent");
    assert.deepEqual({ x: resized.region.x, y: resized.region.y }, { x: moved.region.x, y: moved.region.y }, "resizing keeps the fixed corner in place");
    assert.deepEqual(resized.ink, before.ink, "resizing does not scale or move parent-file ink");

    const scopeLabel = await page.getByRole("button", { name: "otto, your scope" }).boundingBox();
    assert.ok(scopeLabel);
    const boundaryTop = await scenePoint(resized.boundary.x + resized.boundary.width / 2, resized.boundary.y);
    const scopeOffset = { x: scopeLabel.x - boundaryTop.x, y: scopeLabel.y - boundaryTop.y };
    await drag({ x: resized.boundary.x + resized.boundary.width / 2, y: resized.boundary.y }, { x: resized.boundary.x + resized.boundary.width / 2 + 140, y: resized.boundary.y });
    const refused = await geometry();
    const labelAfterRefusal = await page.getByRole("button", { name: "otto, your scope" }).boundingBox();
    const boundaryTopAfter = await scenePoint(refused.boundary.x + refused.boundary.width / 2, refused.boundary.y);
    assert.deepEqual(refused.boundary, resized.boundary, "a boundary-only move snaps back in the editor");
    assert.deepEqual({ x: labelAfterRefusal.x - boundaryTopAfter.x, y: labelAfterRefusal.y - boundaryTopAfter.y }, scopeOffset, "the generated scope label cannot detach from a refused boundary move");

    await page.reload();
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction((expected) => { const region = window.editor.current().elements.find((element) => element.id === "child-region"); return Math.abs(region.x - expected.x) < 0.1 && Math.abs(region.width - expected.width) < 0.1; }, resized.region);
    const reloaded = await geometry();
    assert.deepEqual(reloaded.region, resized.region, "move and resize survive reload");
    assertAttached(reloaded, "the label remains attached after reload");
    assert.deepEqual(reloaded.ink, before.ink, "contained parent ink remains unchanged after reload");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Neara Delivery Standards keeps ancestry and routes its own outline to Delivery", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/nested-fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(nestedFixture); return; }
    if (url.pathname === "/area-board-core.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(here, "public", "area-board-core.js")))); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/nested-fixture`);
    const canvas = page.locator(".excalidraw canvas.interactive"); await canvas.waitFor();
    assert.deepEqual(await page.locator(".tangent-map-ancestry button strong").allTextContents(), ["Neara", "Delivery", "Standards"], "the complete ancestry stays in root-first order");
    const box = await canvas.boundingBox(); assert.ok(box);
    const geometry = await page.evaluate(() => { const boundary = window.editor.current().elements.find((element) => element.customData?.tangent?.role === "boundary"); return { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height }; });
    const state = await page.evaluate(() => window.editor.appState());
    /** Converts one nested fixture scene point to the browser viewport. */
    const point = (x, y) => ({ x: box.x + (x + state.scrollX) * state.zoom.value, y: box.y + (y + state.scrollY) * state.zoom.value });
    const select = point(geometry.x + geometry.width / 2, geometry.y + geometry.height); await page.mouse.click(select.x, select.y);
    await page.waitForFunction(() => Object.values(window.editor.appState().selectedElementIds).some(Boolean));
    const start = point(geometry.x + geometry.width - 80, geometry.y + geometry.height - 80); const end = point(geometry.x + geometry.width + 10, geometry.y + geometry.height - 50);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(() => window.extentWrites.length > 0);
    const result = await page.evaluate(() => { const write = window.extentWrites.at(-1); const region = write.canvas.elements.find((element) => element.id === "standards"); const goal = window.editor.current().elements.find((element) => element.id === "standard-goal"); return { area: write.area, region: { x: region.x, y: region.y, width: region.width, height: region.height }, goal: { x: goal.x, y: goal.y } }; });
    assert.equal(result.area, "neara/delivery"); assert.ok(result.region.x > 120 && result.region.y > 120, "the parent-file region follows the own-scope outline"); assert.deepEqual(result.goal, { x: 140, y: 140 }, "the child's authored coordinates and ownership do not move");
    await page.keyboard.press("Meta+z"); await page.waitForFunction(() => window.extentWrites.length > 1);
    const undone = await page.evaluate(() => { const write = window.extentWrites.at(-1); const region = write.canvas.elements.find((element) => element.id === "standards"); return { x: region.x, y: region.y }; });
    assert.ok(Math.abs(undone.x - 120) < 1 && Math.abs(undone.y - 120) < 1, "undo reverses the complete parent-file extent gesture");
    await page.setViewportSize({ width: 760, height: 820 }); await page.keyboard.press("b");
    const picker = page.getByRole("dialog", { name: "Place a Tangent block" }); await picker.waitFor();
    const pickerBox = await picker.boundingBox(); assert.ok(pickerBox.height > 780 && pickerBox.width < 440, "the narrow picker is a full-height edge sheet");
    await page.keyboard.press("Escape"); await picker.waitFor({ state: "hidden" });
  } finally {
    await browser?.close(); await new Promise((resolve) => server.close(resolve));
  }
});

test("m opens the real Excalidraw island from Work", { skip: !enabled, timeout: 90_000 }, async () => {
  const work = workTableFixture();
  let scene = areaBoardCore.withBoundary(areaBoardCore.createEmptyScene(), "otto");
  scene.elements.push(...areaBoardCore.createRegionElements({ id: "tangent-region", ref: "otto/tangent/tangent.md", title: "Tangent", x: 100, y: 100, width: 820, height: 580 }));
  let childScene = areaBoardCore.withBoundary(areaBoardCore.createEmptyScene(), "otto/tangent");
  childScene.elements.push(areaBoardCore.createTextElement({ id: "child-note", text: "inside Tangent", x: 180, y: 180 }));
  let savedHash = "scene-1";
  let recordSave; const saveObserved = new Promise((resolve) => { recordSave = resolve; });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 404, { error: "use compatibility projection" });
    if (url.pathname === "/api/vault") return sendJson(response, 200, work.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "test", pipelines: work.pipelines, sessions: work.sessions, brains: work.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (url.pathname === "/api/areas/canvas" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const update = JSON.parse(body);
      if (update.area === "otto/tangent") childScene = update.canvas; else scene = update.canvas;
      savedHash = `scene-${Number(savedHash.split("-")[1]) + 1}`;
      recordSave();
      return sendJson(response, 200, { hash: savedHash });
    }
    if (url.pathname === "/api/areas/canvas") {
      const area = url.searchParams.get("area");
      const selectedScene = area === "otto/tangent" ? childScene : scene;
      return sendJson(response, 200, { area, file: `${area}/${area.split("/").at(-1)}.excalidraw`, exists: true, hash: savedHash, scene: selectedScene, canvas: selectedScene, view: null, proposals: [], warnings: [] });
    }
    if (url.pathname === "/api/areas/map-context") return sendJson(response, 200, { area: "otto/tangent", hash: savedHash, ancestors: [{ area: "otto", name: "Otto", status: "active", exists: true, hash: savedHash, boundary: { x: 0, y: 0, width: 1200, height: 800 }, regionForChild: { x: 100, y: 100, width: 820, height: 580 }, placedChildren: ["otto/tangent"] }], legacyBaseline: null });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const row = page.locator('[data-work-cursor="area:otto/tangent"]');
    await row.dispatchEvent("click");
    await row.locator("[data-work-cursor-control]").focus();
    await page.keyboard.press("m");
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    await page.getByRole("button", { name: "Otto, inside vault" }).waitFor();
    await page.getByRole("button", { name: "tangent, your scope" }).waitFor();
    await page.getByRole("button", { name: "Block" }).click();
    await page.getByRole("dialog", { name: "Place a Tangent block" }).getByRole("textbox").fill("compact table");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-tangent-area-map]") && document.body.textContent.includes("Redesign Work as a compact table"));
    const canvas = page.locator(".excalidraw canvas.interactive");
    const box = await canvas.boundingBox();
    assert.ok(box);
    await page.mouse.click(box.x + box.width - 70, box.y + box.height - 70);
    await page.keyboard.press("r");
    await page.mouse.move(box.x + 650, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 790, box.y + 350, { steps: 6 });
    await page.mouse.up();
    await saveObserved;
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10_000 });
    assert.match(await page.locator(".map-screen h1").textContent(), /^otto \/ tangent · Map$/);

    await page.reload();
    const reloadedRow = page.locator('[data-work-cursor="area:otto/tangent"]');
    await reloadedRow.dispatchEvent("click");
    await reloadedRow.locator("[data-work-cursor-control]").focus();
    await page.keyboard.press("m");
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    await page.waitForFunction(() => document.body.textContent.includes("Redesign Work as a compact table"));
    assert.ok(childScene.elements.some((element) => element.type === "rectangle" && !element.customData?.tangent), "the drawn shape survived reload");
    assert.ok(childScene.elements.some((element) => element.customData?.tangent), "the Tangent block survived reload");

    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    assert.match(await page.locator(".map-screen h1").textContent(), /^otto \/ tangent · Map$/);
    await page.getByRole("button", { name: "Outline" }).click();
    await page.getByRole("button", { name: "note: inside Tangent" }).waitFor();
    await page.getByRole("button", { name: "Close outline" }).click();
    await page.setViewportSize({ width: 520, height: 760 });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.getByRole("button", { name: "Block" }).waitFor();

    // Visual structure: Tangent controls sit beside Excalidraw's own islands, never on top of them.
    const structure = await page.evaluate(() => {
      /** Returns one element's box as plain numbers. */
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      return { toolbar: box(".App-toolbar"), controls: box(".tangent-map-top-right"), save: box(".tangent-map-save"), help: box(".help-icon"), library: box(".default-sidebar-trigger"), hint: box(".tangent-map-empty-hint"), theme: document.querySelector(".excalidraw").className, canvas: getComputedStyle(document.querySelector(".TangentAreaMap")).backgroundColor };
    });
    /** Reports whether two boxes overlap. */
    const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    assert.equal(overlaps(structure.toolbar, structure.controls), false, "Tangent controls do not cover the tool bar");
    assert.equal(Boolean(overlaps(structure.save, structure.help)), false, "the save status does not cover Excalidraw's help button");
    assert.equal(structure.library === null || structure.library.right === structure.library.left, true, "the unused library trigger is hidden");
    assert.match(structure.theme, /theme--dark/);
    assert.equal(structure.canvas, "rgb(18, 18, 18)", "the map ground is dark behind a dark-theme editor");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
