import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
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
const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
const world = { schema: "area-map-world.v1", worldId: "editor-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto", rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, scene: empty() }, areas: [{ key: "otto", parent: "@root", children: [], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "root-otto", labelSourceId: "root-otto-label", source: "stored", storedRect: { x: 80, y: 80, width: 900, height: 650 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, scene: empty() } }] };
const documents = [{ kind: "area", area: "otto", title: "Otto" }, { file: "otto/goal-map.md", area: "otto", kind: "goal", title: "Map quality", status: "active" }];
window.changes = [];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { world, scene: empty(), getDocuments: () => documents, focus: { only: false, activeOnly: false, areas: [] }, onWorldChange: async (_world, areas, owners) => { window.changes.push({ areas: [...areas], owners: [...owners] }); return { status: 200 }; }, onEntityVerb: () => {}, onBack: () => {} });
</script></body></html>`;

const failureFixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
const world = { schema: "area-map-world.v1", worldId: "failure-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto", rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, scene: empty() }, areas: [{ key: "otto", parent: "@root", children: [], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "root-otto", labelSourceId: "root-otto-label", source: "stored", storedRect: { x: 80, y: 80, width: 900, height: 650 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, scene: empty() } }] };
let fail = true;
mountAreaBoardEditor(document.querySelector("#map"), { world, scene: empty(), getDocuments: () => { if (fail) throw new Error("fixture render failed"); return [{ kind: "area", area: "otto", title: "Otto" }]; }, onEditorError: () => { fail = false; }, onWorldChange: async () => ({ status: 200 }) });
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
    await alert.getByRole("heading", { name: "The complete Area map did not load." }).waitFor();
    assert.match(await alert.textContent(), /fixture render failed/);
    await alert.getByRole("button", { name: "Retry" }).click();
    await page.locator(".excalidraw canvas.interactive").waitFor();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
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
    await page.getByRole("button", { name: /^Block/ }).waitFor();

    // Visual structure: Tangent controls sit beside Excalidraw's own islands, never on top of them.
    const structure = await page.evaluate(() => {
      /** Returns one element's box as plain numbers. */
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      return { toolbar: box(".App-toolbar"), controls: box(".tangent-map-top-right"), save: box(".tangent-map-save"), help: box(".help-icon"), library: box(".default-sidebar-trigger"), theme: document.querySelector(".excalidraw").className, canvas: getComputedStyle(document.querySelector(".TangentAreaMap")).backgroundColor };
    });
    /** Reports whether two boxes overlap. */
    const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    assert.equal(overlaps(structure.toolbar, structure.controls), false, "Tangent controls do not cover the tool bar");
    assert.equal(overlaps(structure.save, structure.help), false, "the save status does not cover Excalidraw's help button");
    assert.equal(structure.library === null || structure.library.right === structure.library.left, true, "the unused library trigger is hidden");
    assert.match(structure.theme, /theme--dark/);
    assert.equal(structure.canvas, "rgb(18, 18, 18)", "the map ground is dark behind a dark-theme editor");

    await page.keyboard.press("b");
    await page.getByRole("dialog", { name: "Place a Tangent block" }).getByRole("textbox").fill("map");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.editor.current().elements.some((element) => element.customData?.tangent?.kind === "goal"));
    assert.equal(await page.getByRole("button", { name: /Ask brain/ }).count(), 0, "the map has no Journal-note Ask action");
    assert.equal(await page.getByRole("button", { name: /^Correct/ }).count(), 0, "the map has no legacy Correct action");

    const canvas = page.locator(".excalidraw canvas.interactive");
    const box = await canvas.boundingBox();
    assert.ok(box);
    /** Converts fixture-local coordinates to browser coordinates. */
    const point = (x, y) => ({ x: box.x + x, y: box.y + y });
    /** Returns focus to the canvas and selects one keyboard tool. */
    const tool = async (key) => { await page.mouse.click(point(1020, 700).x, point(1020, 700).y); await page.keyboard.press(key); };

    await tool("t");
    await page.mouse.click(point(170, 560).x, point(170, 560).y);
    await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
    await page.keyboard.type("plain text");
    await page.keyboard.press("Escape");

    await tool("r");
    await page.mouse.move(point(720, 250).x, point(720, 250).y);
    await page.mouse.down();
    await page.mouse.move(point(900, 390).x, point(900, 390).y, { steps: 8 });
    await page.mouse.up();

    const beforeNudge = await page.evaluate(() => {
      const rectangle = window.editor.current().elements.find((element) => element.type === "rectangle" && !element.customData?.tangent);
      const controller = window.editor.controller();
      const origin = controller?.snapshot().composition.origins.get(rectangle?.id);
      return {
        rectangle: rectangle && { id: rectangle.id, x: rectangle.x, width: rectangle.width, height: rectangle.height, sourceId: origin?.sourceId },
        appSelection: window.editor.appState().selectedElementIds,
        controllerSelection: controller ? [...controller.snapshot().selection] : null,
        active: { tag: document.activeElement?.tagName, className: String(document.activeElement?.className ?? "") },
      };
    });
    assert.ok(beforeNudge.controllerSelection, `the live world controller remains mounted: ${JSON.stringify(beforeNudge)}`);
    assert.ok(beforeNudge.rectangle, `the real rectangle tool creates one authored shape: ${JSON.stringify(beforeNudge)}`);
    assert.ok(Object.values(beforeNudge.appSelection).some(Boolean), `the new shape remains visibly selected for a keyboard command: ${JSON.stringify(beforeNudge)}`);
    const beforeMove = beforeNudge.rectangle.x;
    await page.keyboard.press("ArrowRight");
    try {
      await page.waitForFunction((before) => window.editor.current().elements.some((element) => element.type === "rectangle" && !element.customData?.tangent && element.x !== before), beforeMove, { timeout: 5_000 });
    } catch (error) {
      const afterNudge = await page.evaluate(() => ({
        rectangles: window.editor.current().elements.filter((element) => element.type === "rectangle" && !element.customData?.tangent).map((element) => ({ id: element.id, x: element.x })),
        appSelection: window.editor.appState().selectedElementIds,
        controllerSelection: [...window.editor.controller().snapshot().selection],
        changes: window.changes,
      }));
      throw new Error(`ArrowRight did not nudge the selected authored rectangle: ${JSON.stringify({ beforeNudge, afterNudge })}`, { cause: error });
    }
    const afterNudge = await page.evaluate(() => {
      const rectangle = window.editor.current().elements.find((element) => element.type === "rectangle" && !element.customData?.tangent);
      const controller = window.editor.controller();
      return { rectangle: rectangle && { id: rectangle.id, x: rectangle.x, width: rectangle.width, height: rectangle.height, sourceId: controller.snapshot().composition.origins.get(rectangle.id)?.sourceId }, appSelection: window.editor.appState().selectedElementIds, controllerSelection: [...controller.snapshot().selection] };
    });
    assert.equal(afterNudge.appSelection[afterNudge.rectangle.id], true, `the keyboard command restores selection to the claimed runtime ID: ${JSON.stringify({ beforeNudge, afterNudge })}`);
    assert.equal(afterNudge.controllerSelection.includes(afterNudge.rectangle.id), true, `world selection follows the claimed runtime ID: ${JSON.stringify({ beforeNudge, afterNudge })}`);
    assert.deepEqual({ id: afterNudge.rectangle.id, sourceId: afterNudge.rectangle.sourceId }, { id: beforeNudge.rectangle.id, sourceId: beforeNudge.rectangle.sourceId }, "rectangle source identity does not change across pointer settle and the next command");
    assert.ok(afterNudge.rectangle.width > 100 && afterNudge.rectangle.height > 80, `the rectangle keeps the substantial geometry from every pointer frame: ${JSON.stringify(afterNudge.rectangle)}`);

    await tool("p");
    await page.mouse.move(point(120, 150).x, point(120, 150).y);
    await page.mouse.down();
    await page.mouse.move(point(210, 210).x, point(210, 210).y, { steps: 12 });
    await page.mouse.up();

    const block = await page.evaluate(() => window.editor.current().elements.find((element) => element.customData?.tangent?.kind === "goal"));
    const moved = await page.evaluate(() => window.editor.current().elements.find((element) => element.type === "rectangle" && !element.customData?.tangent));
    assert.notEqual(moved.x, beforeMove, "the keyboard nudge moves the authored rectangle");

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
    await page.waitForFunction(() => window.editor.current().elements.some((element) => element.type === "arrow" && element.customData?.tangentWorld?.sourceId));
    const releasedArrowIdentity = await page.evaluate(() => {
      const arrow = window.editor.current().elements.find((element) => element.type === "arrow");
      return { runtimeId: arrow.id, sourceId: arrow.customData.tangentWorld.sourceId };
    });

    await page.waitForTimeout(250);
    const summary = await page.evaluate(() => window.editor.current().elements.map((element) => ({ id: element.id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, points: element.points, text: element.text, startBinding: element.startBinding, endBinding: element.endBinding, boundElements: element.boundElements, tangent: element.customData?.tangent?.kind, role: element.customData?.tangent?.role, world: element.customData?.tangentWorld, endpoints: element.customData?.tangentWorldEndpoints })));
    assert.ok(summary.some((element) => element.type === "text" && element.text === "plain text"), `typed text remains in its Area owner: ${JSON.stringify(summary)}`);
    assert.ok(summary.some((element) => element.type === "freedraw" && element.points?.length > 1), `free ink keeps more than one pointer point in its Area owner: ${JSON.stringify(summary)}`);
    assert.ok(summary.some((element) => element.type === "rectangle" && !element.tangent && element.width > 100 && element.height > 80), `the authored rectangle keeps its full pointer geometry in its Area owner: ${JSON.stringify(summary)}`);
    assert.ok(summary.some((element) => element.tangent === "goal"), `the Tangent block remains in its Area owner: ${JSON.stringify(summary)}`);
    const settledArrow = summary.find((element) => element.type === "arrow");
    assert.ok(settledArrow?.points?.length > 1, `the arrow keeps more than one pointer point: ${JSON.stringify(summary)}`);
    assert.ok(settledArrow.startBinding?.elementId && settledArrow.endBinding?.elementId, `the arrow binds directly to both connectable endpoints: ${JSON.stringify(summary)}`);
    const startTarget = summary.find((element) => element.id === settledArrow.startBinding.elementId);
    const endTarget = summary.find((element) => element.id === settledArrow.endBinding.elementId);
    assert.ok(startTarget?.boundElements?.some((binding) => binding.id === settledArrow.id && binding.type === "arrow"), `the start target keeps the reverse arrow binding: ${JSON.stringify(summary)}`);
    assert.ok(endTarget?.boundElements?.some((binding) => binding.id === settledArrow.id && binding.type === "arrow"), `the end target keeps the reverse arrow binding: ${JSON.stringify(summary)}`);
    assert.deepEqual({ runtimeId: settledArrow.id, sourceId: settledArrow.world?.sourceId }, releasedArrowIdentity, "arrow source identity does not change during delayed pointer settle");
    const authored = summary.filter((element) => element.role !== "area-region" && element.world?.sourceId);
    assert.ok(authored.length >= 5, `the journey keeps every new source-owned element: ${JSON.stringify(summary)}`);
    assert.ok(authored.every((element) => element.world.owner === "otto"), `every new element keeps the Area chosen at pointer start: ${JSON.stringify(authored)}`);

    const inkColor = await page.evaluate(() => window.editor.current().elements.find((element) => element.type === "text" && element.text === "plain text")?.strokeColor);
    assert.equal(inkColor, "#1e1e1e", "typed text uses Excalidraw's default ink, which the dark theme shows light on the dark canvas");

    const changesBeforeOutline = await page.evaluate(() => window.changes.length);
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    const areaOutline = page.getByRole("treeitem", { name: "Otto, child of map root, depth 1, unfolded, ready, 1 block" });
    await areaOutline.waitFor();
    assert.equal(await areaOutline.getAttribute("aria-selected"), "false");
    await areaOutline.focus();
    await page.keyboard.press("Enter");
    assert.equal(await areaOutline.getAttribute("aria-selected"), "true", "the generic editor keeps the world Area outline interactive");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.changes.length), changesBeforeOutline, "programmatic Outline selection and camera fit never create a source mutation");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("m opens the real Excalidraw island from Work", { skip: !enabled, timeout: 90_000 }, async () => {
  const work = workTableFixture();
  /** Returns one source-compatible empty scene. */
  const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
  const shellWorld = {
    schema: "area-map-world.v1", worldId: "work-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
    rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, scene: empty() },
    areas: [
      { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "root-otto", labelSourceId: "root-otto-label", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 800 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "otto-tangent", labelSourceId: "otto-tangent-label", source: "stored", storedRect: { x: 100, y: 100, width: 820, height: 580 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: 0, scene: empty() } },
    ],
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/vault") return sendJson(response, 200, work.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "test", pipelines: work.pipelines, sessions: work.sessions, brains: work.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (url.pathname === "/api/areas/map-world") return sendJson(response, 200, shellWorld);
    if (url.pathname === "/api/areas/map-view") return sendJson(response, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const row = page.locator('[data-work-cursor="area:otto/tangent"]');
    await row.dispatchEvent("click");
    await row.locator("[data-work-cursor-control]").focus();
    await page.keyboard.press("m");
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    await page.getByRole("button", { name: "Otto, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Tangent, child of Otto, depth 2, unfolded, ready, 0 blocks" }).waitFor();
    assert.match(await page.locator(".map-screen h1").textContent(), /^otto \/ tangent · Map$/);
    await page.locator(".excalidraw canvas.interactive").evaluate((canvas) => { canvas.dataset.companionIdentity = "original"; });
    await page.keyboard.press("b");
    const pane = page.locator("[data-map-brain-pane]");
    await pane.waitFor();
    assert.equal(await pane.isVisible(), true, "b docks the exact Area brain on a wide map");
    assert.match(await pane.locator(":scope > header").textContent(), /Brain working/);
    assert.equal(await pane.locator(".map-brain-terminal").getAttribute("data-session"), "otto-tangent--brain");
    const widths = await page.evaluate(() => ({ pane: document.querySelector("[data-map-brain-pane]").getBoundingClientRect().width, map: document.querySelector("[data-map-column]").getBoundingClientRect().width }));
    assert.ok(widths.pane >= 550 && widths.pane <= 570, `the dock starts at 560px: ${JSON.stringify(widths)}`);
    assert.ok(widths.map >= 560, `the map keeps its usable minimum: ${JSON.stringify(widths)}`);
    await page.locator("[data-map-column]").click({ position: { x: 20, y: 20 } });
    assert.equal(await page.locator("[data-map-column]").getAttribute("class"), "map-column focused");
    await page.keyboard.press("Control+l");
    assert.match(await pane.getAttribute("class"), /focused/, "Control-L focuses the brain column");
    await page.keyboard.press("Control+h");
    assert.match(await page.locator("[data-map-column]").getAttribute("class"), /focused/, "Control-H returns focus to the map");
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "focus changes never remount the canvas");
    await pane.locator("[data-close-map-brain]").click();
    assert.equal(await pane.isVisible(), false, "Close b hides only the pane");
    await page.keyboard.press("b");
    assert.equal(await pane.isVisible(), true, "b reopens the same companion");
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "close and reopen keep the map island");
    await pane.locator("[data-close-map-brain]").click();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.getByRole("treeitem", { name: "Otto, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("treeitem", { name: "Tangent, child of Otto, depth 2, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.setViewportSize({ width: 520, height: 760 });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.getByTitle("Place a Tangent block (B)").waitFor();

    // Visual structure: Tangent controls sit beside Excalidraw's own islands, never on top of them.
    const structure = await page.evaluate(() => {
      /** Returns one element's box as plain numbers. */
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      return { toolbar: box(".App-toolbar"), controls: box(".tangent-map-top-right"), save: box(".tangent-map-save"), help: box(".help-icon"), library: box(".default-sidebar-trigger"), theme: document.querySelector(".excalidraw").className, canvas: getComputedStyle(document.querySelector(".TangentAreaMap")).backgroundColor };
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
