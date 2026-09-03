import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";
import { themeInkColor } from "./public/area-map-figures.js";
import { serveStaticAsset } from "./static-assets.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";
import { legacyFixtureWork } from "./work-table-harness.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

/** Returns the WCAG relative luminance of one six-digit hex colour. */
function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Returns the WCAG contrast ratio between two six-digit hex colours. */
function contrastRatio(left, right) {
  const light = Math.max(relativeLuminance(left), relativeLuminance(right));
  const dark = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (light + 0.05) / (dark + 0.05);
}

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
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
    await page.waitForFunction(() => window.editor.appState().editingTextElement && document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.editor.appState().editingTextElement);
    assert.equal(await page.getByRole("button", { name: /Ask brain/ }).count(), 0, "the map has no Ask action");
    assert.equal(await page.getByRole("button", { name: /^Correct/ }).count(), 0, "the map has no legacy Correct action");

    // A selected Block adds its verbs to the same control row, which is what
    // pushes the row furthest into the centred tool bar. A covered tool answers
    // the wrong click, so the row has to give way rather than paint over one.
    await page.getByRole("group", { name: /^Actions for / }).waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const selected = await page.evaluate(() => {
      /** Returns one element's box as plain numbers. */
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      return {
        toolbar: box(".App-toolbar"), controls: box(".tangent-map-top-right"),
        stolen: [...document.querySelectorAll(".App-toolbar label.ToolIcon")].filter((tool) => {
          const rect = tool.getBoundingClientRect();
          return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".tangent-map-top-right");
        }).map((tool) => tool.getAttribute("title")),
      };
    });
    assert.equal(overlaps(selected.toolbar, selected.controls), false, "the verbs of a selected Block never widen the Tangent row over the tool bar");
    assert.deepEqual(selected.stolen, [], "no drawing tool answers with a Tangent control");

    const canvas = page.locator(".excalidraw canvas.interactive");
    const box = await canvas.boundingBox();
    assert.ok(box);
    /** Converts fixture-local coordinates to browser coordinates. */
    const point = (x, y) => ({ x: box.x + x, y: box.y + y });
    /** Returns focus to the canvas and selects one keyboard tool. */
    const tool = async (key) => { await page.mouse.click(point(1020, 700).x, point(1020, 700).y); await page.keyboard.press(key); };

    await tool("o");
    assert.equal((await page.evaluate(() => window.editor.appState())).activeTool.type, "ellipse", "bare O keeps Excalidraw's existing ellipse interaction");
    await tool("t");
    await page.mouse.click(point(170, 560).x, point(170, 560).y);
    await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
    await page.keyboard.type("plain text");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.editor.appState().editingTextElement);

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
        appState: { activeTool: window.editor.appState().activeTool, scrollX: window.editor.appState().scrollX, scrollY: window.editor.appState().scrollY, zoom: window.editor.appState().zoom },
        elements: window.editor.current().elements.map((element) => ({ id: element.id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, role: element.customData?.tangent?.role })),
        active: { tag: document.activeElement?.tagName, className: String(document.activeElement?.className ?? "") },
      };
    });
    beforeNudge.canvasBox = box;
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

    // The Map runs Excalidraw's dark theme, whose canvas filter inverts everything
    // it paints, so a stored colour is only readable once that filter has run.
    // themeInkColor is that filter in arithmetic, so it says what a person sees.
    const drawnInk = await page.evaluate(() => {
      const elements = window.editor.current().elements;
      return {
        text: elements.find((element) => element.type === "text" && element.text === "plain text")?.strokeColor,
        freehand: elements.find((element) => element.type === "freedraw")?.strokeColor,
        background: window.editor.appState().viewBackgroundColor,
      };
    });
    const renderedGround = themeInkColor(drawnInk.background);
    for (const [what, stored] of [["typed text", drawnInk.text], ["free ink", drawnInk.freehand]]) {
      const rendered = themeInkColor(stored);
      const ratio = contrastRatio(rendered, renderedGround);
      assert.ok(ratio >= 4.5, `${what} stored as ${stored} renders as ${rendered} on the Map's ${renderedGround} ground, contrast ${ratio.toFixed(2)}`);
    }

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

test("Map-first shell keeps Brain, Work, camera, focus, and compact accessibility state exact", { skip: !enabled, timeout: 90_000 }, async () => {
  const work = workTableFixture();
  work.vault.areas.push(
    { path: "otto", name: "otto", goals: [], documents: [] },
    { path: "otto/tangent/desk", name: "desk", goals: [], documents: [] },
    { path: "neara", name: "neara", goals: [], documents: [] },
    { path: "neara/designwarden", name: "designwarden", goals: [], documents: [] },
  );
  /** Returns one source-compatible empty scene. */
  const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
  const shellWorld = {
    schema: "area-map-world.v1", worldId: "work-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
    rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, scene: empty() },
    areas: [
      { key: "otto", parent: "@root", children: ["otto/tangent", "otto/other", "otto/standards"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "root-otto", labelSourceId: "root-otto-label", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 800 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "otto/tangent", parent: "otto", children: ["otto/tangent/desk"], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "otto-tangent", labelSourceId: "otto-tangent-label", source: "stored", storedRect: { x: 100, y: 100, width: 820, height: 580 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "otto/tangent/desk", parent: "otto/tangent", children: [], depth: 2, region: { key: "otto/tangent>otto/tangent/desk", owner: "otto/tangent", child: "otto/tangent/desk", sourceId: "tangent-desk", labelSourceId: "tangent-desk-label", source: "stored", storedRect: { x: 120, y: 120, width: 360, height: 260 } }, shard: { owner: "otto/tangent/desk", hash: "desk-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "otto/other", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/other", owner: "otto", child: "otto/other", sourceId: "otto-other", labelSourceId: "otto-other-label", source: "stored", storedRect: { x: 940, y: 120, width: 340, height: 260 } }, shard: { owner: "otto/other", hash: "other-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "otto/standards", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/standards", owner: "otto", child: "otto/standards", sourceId: "otto-standards", labelSourceId: "otto-standards-label", source: "stored", storedRect: { x: 940, y: 420, width: 340, height: 260 } }, shard: { owner: "otto/standards", hash: "standards-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "neara", parent: "@root", children: ["neara/designwarden"], depth: 0, region: { key: "@root>neara", owner: "@root", child: "neara", sourceId: "root-neara", labelSourceId: "root-neara-label", source: "stored", storedRect: { x: 1300, y: 100, width: 520, height: 420 } }, shard: { owner: "neara", hash: "neara-1", state: "ready", elementCount: 0, scene: empty() } },
      { key: "neara/designwarden", parent: "neara", children: [], depth: 1, region: { key: "neara>neara/designwarden", owner: "neara", child: "neara/designwarden", sourceId: "neara-designwarden", labelSourceId: "neara-designwarden-label", source: "stored", storedRect: { x: 120, y: 120, width: 320, height: 220 } }, shard: { owner: "neara/designwarden", hash: "designwarden-1", state: "ready", elementCount: 0, scene: empty() } },
    ],
  };
  const designDocument = { file: "otto/tangent/design-map-first-proof.md", area: "otto/tangent", kind: "document", docKind: "design", title: "Map-first proof", links: [], mtime: 1 };
  work.vault.documents.push(designDocument);
  work.vault.areas.find((area) => area.path === designDocument.area).documents.push(designDocument);
  const workProjection = legacyFixtureWork(work);
  let rejectMapSaves = false;
  let rejectedMapSaveAttempts = 0;
  let brainConnections = 0;
  let resolveReplacementConnection;
  const replacementConnection = new Promise((resolve) => { resolveReplacementConnection = resolve; });
  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on("connection", (socket, request) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const session = url.searchParams.get("session") ?? "";
    if (session !== "otto-tangent--brain") {
      socket.send(`\r\n${session} ready\r\n`);
      return;
    }
    brainConnections += 1;
    if (brainConnections === 1) {
      socket.send("\r\nOtto / Tangent Brain ready\r\n");
      setTimeout(() => socket.close(1012, "fixture transport restart"), 80);
      return;
    }
    if (brainConnections === 2) resolveReplacementConnection(socket);
    else socket.send("\r\nOtto / Tangent Brain ready\r\n");
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") {
      const body = JSON.stringify(workProjection);
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        etag: `"${workProjection.epoch}:${workProjection.revision}"`,
        "x-tangent-work-state": "current",
        "x-tangent-work-epoch": workProjection.epoch,
        "x-tangent-work-revision": String(workProjection.revision),
        "x-tangent-work-published-at": workProjection.publishedAt,
      });
      response.end(body);
      return;
    }
    if (url.pathname === "/api/vault") return sendJson(response, 200, work.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "test", pipelines: work.pipelines, sessions: work.sessions, brains: work.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (url.pathname === "/api/areas/map-world") return sendJson(response, 200, { ...shellWorld, locatedArea: url.searchParams.get("located") || shellWorld.locatedArea });
    if (url.pathname === "/api/areas/map-view") return sendJson(response, 200, { ok: true });
    if (url.pathname === "/api/areas/map-gestures") {
      if (rejectMapSaves) {
        rejectedMapSaveAttempts += 1;
        return sendJson(response, 503, { status: 503, code: "proof-save-failure", retryable: true, error: "injected Map save failure" });
      }
      return sendJson(response, 200, { status: 200, hashes: {}, worldRevision: shellWorld.worldRevision, treeRevision: shellWorld.treeRevision });
    }
    if (url.pathname === "/api/navigation/search") return sendJson(response, 200, {
      schema: "agent-shell-navigation.v1", query: url.searchParams.get("q") ?? "", limit: 100,
      rows: [{ kind: "document", id: designDocument.file, area: designDocument.area, name: designDocument.title, file: designDocument.file, docKind: designDocument.docKind }],
      areas: shellWorld.areas.map((area) => ({ path: area.key, name: area.key.split("/").at(-1) })), areasComplete: true, kinds: ["document"],
    });
    if (url.pathname === "/api/document") return sendJson(response, 200, { ...designDocument, text: "# Map-first proof\n\nA compact-reader proof.", hash: "design-proof-1", comments: [] });
    if (url.pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true });
    await serveStaticAsset(url, response, here);
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/term") return socket.destroy();
    websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 2048, height: 900 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("tangent.area-map-view.v2:work-world", JSON.stringify({
      schema: "area-map-view.v2", worldId: "work-world", pan: { x: -40, y: -30 }, zoom: 0.8,
      foldedAreas: [], detailAreas: [], locatedArea: "otto/tangent", cameraTarget: "otto/tangent",
      cameraTrail: [], restrictionArea: "otto/tangent", selection: [],
    })));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    assert.equal(await page.locator("#map-tab").getAttribute("aria-current"), "page", "Map is the first announced surface before Work is opened");

    // The Map owns the bottom-right corner: its save status lives there, and a
    // failed save puts Retry, Reload saved, and Keep mine in the same island.
    // The shell toast is fixed to that corner too, so it has to step above it.
    await page.locator("#awake-button").dispatchEvent("click");
    await page.locator("#toast.show").waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const savedCorner = await page.evaluate(() => {
      const box = document.querySelector(".tangent-map-save").getBoundingClientRect();
      const toast = document.querySelector("#toast").getBoundingClientRect();
      const map = document.querySelector(".TangentAreaMap").getBoundingClientRect();
      return {
        mapOwnsTheCorner: toast.right <= map.right && toast.bottom <= map.bottom,
        overlaps: toast.bottom > box.top && toast.top < box.bottom && toast.right > box.left && toast.left < box.right,
      };
    });
    assert.equal(savedCorner.mapOwnsTheCorner, true, "the proof measures a Map that really reaches the corner the toast is fixed to");
    assert.equal(savedCorner.overlaps, false, "a shell toast never covers the Map save status corner");
    await page.locator("#awake-button").dispatchEvent("click");
    await page.locator("#toast.show").waitFor({ state: "hidden" });
    const shellBack = page.locator("#back-button");
    assert.equal(await shellBack.getAttribute("aria-haspopup"), "menu", "top-level Agent Shell opens a menu");
    assert.equal(await shellBack.getAttribute("aria-controls"), "shell-menu");
    assert.equal(await shellBack.getAttribute("aria-expanded"), "false");
    await shellBack.click();
    assert.equal(await page.locator("#shell-menu").isVisible(), true);
    assert.equal(await shellBack.getAttribute("aria-expanded"), "true");
    await shellBack.click();
    assert.equal(await page.locator("#shell-menu").isHidden(), true);
    assert.equal(await shellBack.getAttribute("aria-expanded"), "false");
    assert.match(await page.locator("#bar-context").textContent(), /otto \/ tangentMap/i, "the wide header names the active Area and Map surface");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain/, "the wide header exposes the responsible named Brain");
    assert.match(await page.locator("#context-brain-button kbd").textContent(), /⌘⇧↵/, "the visible contextual Brain action names its working shortcut");
    assert.equal(await page.locator("#context-brain-button").getAttribute("aria-keyshortcuts"), "Meta+Shift+Enter");
    assert.deepEqual(await page.locator(".primary-tabs > button:visible").allTextContents(), ["Map", "Work"], "Map and Work are the only primary destinations");
    assert.equal(await page.locator(".app-bar [data-map-brain]").count(), 0, "the 2048px header has no duplicate Brain row action");
    assert.equal(await page.locator(".map-screen > header").count(), 0, "the Map has no duplicate header row");
    assert.equal(await page.locator("#prompts-tab").evaluate((button) => button.closest("#shell-menu") !== null), true, "Model lives in the shell menu instead of primary navigation");
    assert.equal(await page.locator(".tangent-map-toolbar-extra .tangent-map-label").textContent(), "Block", "the wide Map names its primary creation action");
    await page.setViewportSize({ width: 1440, height: 760 });
    const wideForYou = page.locator("#for-you-button");
    assert.match(await wideForYou.textContent(), /^For you \d+$/, "direct attention is a visible named route");
    await wideForYou.click();
    assert.equal(await page.locator("#work-lens-title").textContent(), "For you", "the visible attention route opens filtered Work");
    await page.locator("[data-close-work-lens]").click();
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    await page.locator("#work-tab").click();
    await page.locator("#work-lens-layer").waitFor();
    const row = page.locator('[data-work-cursor="area:otto/tangent"]');
    await row.dispatchEvent("click");
    await row.locator("[data-work-cursor-control]").focus();

    // Brain-first uses the same workspace. One visible Map action opens the
    // exact Area without replacing the mounted xterm presentation.
    await page.locator('[data-open-brain="otto-tangent--brain"]').click();
    const brainFirstPane = page.locator('[data-map-brain-pane]');
    await brainFirstPane.locator('.map-brain-terminal[data-session="otto-tangent--brain"]').waitFor();
    const brainFirstComposer = brainFirstPane.locator(".xterm-helper-textarea");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    try {
      await brainFirstComposer.waitFor({ state: "attached", timeout: 5_000 });
    } catch (error) {
      const diagnostics = await brainFirstPane.evaluate((pane) => ({
        html: pane.innerHTML,
        mode: pane.dataset.mode,
        terminal: typeof window.Terminal,
        fitAddon: typeof window.FitAddon,
        active: document.activeElement?.outerHTML,
      }));
      throw new Error(`the Area Brain terminal did not mount: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    assert.equal(
      await brainFirstComposer.evaluate((composer) => document.activeElement === composer),
      true,
      "opening a live Brain keeps its composer focused after workspace mount and the first resize repaint",
    );
    await brainFirstComposer.evaluate((composer) => {
      window.brainFocusKey = null;
      composer.addEventListener("keydown", (event) => { window.brainFocusKey = event.key; }, { capture: true, once: true });
    });
    await page.keyboard.press("q");
    assert.equal(await page.evaluate(() => window.brainFocusKey), "q", "typing immediately reaches the composer without another pointer click");
    const brainFirstTerminal = brainFirstPane.locator(".xterm").first();
    await brainFirstTerminal.evaluate((node) => { node.dataset.workspaceIdentity = "brain-first"; });
    const reconnectStatus = brainFirstPane.locator("[data-terminal-transport-status]");
    await reconnectStatus.waitFor({ state: "visible" });
    assert.equal(await reconnectStatus.getAttribute("data-state"), "reconnecting", "a lasting transport loss is explained inside its terminal");
    const replacementSocket = await replacementConnection;
    assert.equal(brainConnections, 2, "the replacement transport opened exactly once");
    assert.equal(await reconnectStatus.getAttribute("data-state"), "reconnecting", "socket open alone does not claim recovery");
    assert.doesNotMatch(await page.locator("#toast").textContent(), /reconnect/i, "terminal recovery never interrupts the shell with a global toast");
    replacementSocket.send("\r\nreplacement terminal frame\r\n");
    await page.waitForFunction(() => document.querySelector("[data-terminal-transport-status]")?.getAttribute("data-state") === "restored");
    assert.equal(await brainFirstTerminal.getAttribute("data-workspace-identity"), "brain-first", "replacement data restores the same xterm node");
    assert.equal(await brainFirstComposer.evaluate((composer) => document.activeElement === composer), true, "recovery does not move composer focus");
    await reconnectStatus.waitFor({ state: "hidden" });
    assert.equal(await brainFirstPane.locator("[data-toggle-workspace-map], [data-leave-area-workspace], [data-hide-workspace-brain]").count(), 0, "Brain metadata has no duplicate navigation row");
    assert.match(await page.locator("#back-button").textContent(), /^Work ⌘⇧↵$/i, "the global Back route names its working Brain return chord");
    assert.equal(await page.locator("#back-button").getAttribute("aria-keyshortcuts"), "Meta+Shift+Enter");
    assert.equal(await page.locator("#back-button").getAttribute("aria-haspopup"), null, "a child Back route does not claim menu behavior");
    assert.equal(await page.locator("#back-button").getAttribute("aria-expanded"), null);
    assert.equal(await page.locator("[data-area-workspace]").getAttribute("data-presentation"), "single", "opening a Brain from Work enters the Brain alone, however wide the window is");
    assert.equal(await page.locator('[data-split-pane="map"]').isVisible(), false, "entering a Brain never opens the Map beside it");
    assert.equal(await page.locator("#split-button").getAttribute("aria-pressed"), "false", "the split control states that one pane is open");
    await page.locator("#back-button").click();
    await row.waitFor();
    await row.dispatchEvent("click");
    await row.locator("[data-work-cursor-control]").focus();
    await page.keyboard.press("m");
    await page.locator('[data-tangent-area-map="otto/tangent"] .excalidraw canvas.interactive').waitFor();
    const only = page.locator("[data-map-only]");
    /** Waits until the shell reflects the controller's Only state. */
    const waitForOnly = (pressed) => page.waitForFunction(
      (expected) => document.querySelector("[data-map-only]")?.getAttribute("aria-pressed") === String(expected),
      pressed,
    );
    await page.waitForFunction(() => document.querySelector("[data-map-only]")?.getAttribute("aria-pressed") === "true");
    await page.getByRole("button", { name: "Otto, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Tangent, child of Otto, depth 2, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Desk, child of Otto / Tangent, depth 3, unfolded, ready, 0 blocks" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Other, child of Otto, depth 2, unfolded, ready, 0 blocks" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Neara, child of map root, depth 1, unfolded, ready, 0 blocks" }).count(), 0);
    assert.equal(await page.locator(".tangent-map-ancestry [data-area-map-label]").count(), 3);
    assert.match(await page.locator("#back-button").textContent(), /^Work esc$/i, "the primary shell Back control owns the one map exit");
    assert.equal(await page.locator(".map-screen > header").count(), 0, "the map has no redundant sub-header");
    assert.equal(await page.locator(".tangent-map-escape").count(), 0, "the canvas has no second Escape ladder");
    assert.match(await page.locator("#bar-context").textContent(), /otto \/ tangentMap/i);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tangentLabel = page.locator('[data-area-map-label="otto/tangent"]');
    /** Reads the Tangent label position from the rendered Map. */
    const tangentPosition = () => tangentLabel.evaluate((label) => ({ left: Number.parseFloat(label.style.left), top: Number.parseFloat(label.style.top) }));
    const openingBox = await tangentLabel.boundingBox();
    const openingPosition = await tangentPosition();
    assert.ok(openingBox);
    const mapPaneBox = await page.locator("[data-map-column]").boundingBox();
    assert.ok(mapPaneBox && openingBox.x + openingBox.width > mapPaneBox.x && openingBox.y + openingBox.height > mapPaneBox.y && openingBox.x < mapPaneBox.x + mapPaneBox.width && openingBox.y < mapPaneBox.y + mapPaneBox.height, `the exact Work target is visible inside Map: ${JSON.stringify({ openingBox, mapPaneBox })}`);

    // Keyboard find owns Ctrl-F, reports misses, previews a folded descendant,
    // and Cancel restores the exact opening camera instead of creating history.
    await page.keyboard.press("Control+f");
    const find = page.getByRole("search", { name: "Find on the map" });
    const findInput = find.getByRole("textbox", { name: "Find on the map" });
    await findInput.fill("does-not-exist");
    await find.getByText("No match", { exact: true }).waitFor();
    const missPosition = await tangentPosition();
    assert.ok(Math.abs(missPosition.left - openingPosition.left) < 1 && Math.abs(missPosition.top - openingPosition.top) < 1, "a miss does not move the camera");
    await findInput.fill("desk");
    assert.equal(await find.getByRole("option").count(), 1);
    assert.match(await find.textContent(), /1 of 1/);
    await find.getByRole("button", { name: "Cancel" }).click();
    await find.waitFor({ state: "detached" });
    const restoredPosition = await tangentPosition();
    assert.ok(Math.abs(restoredPosition.left - openingPosition.left) < 1 && Math.abs(restoredPosition.top - openingPosition.top) < 1, `Cancel restores the camera from before find: ${JSON.stringify({ openingPosition, missPosition, restoredPosition })}`);
    await page.keyboard.press("Control+f");
    await findInput.fill("desk");
    await page.keyboard.press("Enter");
    await find.waitFor({ state: "detached" });
    assert.match(await page.locator("#bar-context").textContent(), /otto \/ tangent \/ deskMap/i, "Enter selects and centers the visible Area");
    assert.equal(await only.getAttribute("aria-pressed"), "true", "Find never changes the active Only scope");
    assert.match(await only.textContent(), /Only tangent/i, "Find leaves the scope target unchanged");
    await page.locator('[data-map-breadcrumb="otto/tangent"]').click();

    // Only changes only through its visible chip and restores a manual fold
    // after Julian returns to the whole map.
    await only.click();
    await waitForOnly(false);
    await page.getByRole("button", { name: "Neara, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    const otherTreeItem = page.getByRole("treeitem", { name: "Other, child of Otto, depth 2, unfolded, ready, 0 blocks" });
    await otherTreeItem.focus();
    await page.keyboard.press(" ");
    await page.getByRole("button", { name: "Other, child of Otto, depth 2, folded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await only.click();
    await waitForOnly(true);
    await page.getByRole("button", { name: "Desk, child of Otto / Tangent, depth 3, unfolded, ready, 0 blocks" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Neara, child of map root, depth 1, unfolded, ready, 0 blocks" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Other, child of Otto, depth 2, folded, ready, 0 blocks" }).count(), 0);
    assert.equal(await page.locator(".tangent-map-ancestry [data-area-map-label]").count(), 3, "Only renders only the target lineage and subtree");
    await only.click();
    await waitForOnly(false);
    await page.getByRole("button", { name: "Neara, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Designwarden, child of Neara, depth 2, unfolded, ready, 0 blocks" }).waitFor();
    await page.getByRole("button", { name: "Other, child of Otto, depth 2, folded, ready, 0 blocks" }).waitFor();

    // The contextual Brain follows the exact selected Area. Map and Work use
    // the same pane implementation, while the global route owns navigation.
    const designwardenLabel = page.locator('[data-area-map-label="neara/designwarden"]');
    await designwardenLabel.dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector("#context-brain-button")?.dataset.brainArea === "neara/designwarden");
    assert.match(await page.locator("#context-brain-button").textContent(), /Neara \/ Designwarden Brain\s+⌘⇧↵/, "the global Brain action follows the selected Area and shows its shortcut");
    await page.locator("#context-brain-button").click();
    const mismatchPane = page.locator("[data-map-brain-pane]");
    assert.match(await mismatchPane.locator(":scope > header strong").textContent(), /Neara \/ Designwarden Brain · No brain/, "Map opens the selected Area's exact Brain identity and lifecycle");
    assert.equal(await mismatchPane.locator("[data-toggle-workspace-map], [data-leave-area-workspace], [data-hide-workspace-brain]").count(), 0, "the same Brain pane has metadata without local navigation");
    await page.locator("#map-tab").click();
    await page.locator('[data-area-map-label="otto/tangent"]').dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector("#context-brain-button")?.dataset.brainArea === "otto/tangent");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain\s+⌘⇧↵/, "returning to Tangent restores the same contextual route used from Work");
    await page.locator("[data-map-column]").focus();
    await page.keyboard.press("Shift+o");
    await waitForOnly(true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(500);

    // Find searches only the current projection. An outside Area is a miss
    // that leaves the exact scope and camera unchanged.
    const scopedPosition = await tangentPosition();
    await page.locator("[data-map-find]").click();
    await findInput.fill("neara");
    await find.getByText("No match", { exact: true }).waitFor();
    assert.equal(await find.getByRole("option").count(), 0, "an Area outside Only is not a result");
    assert.equal(await only.getAttribute("aria-pressed"), "true");
    const afterOutsideMiss = await tangentPosition();
    assert.ok(Math.abs(afterOutsideMiss.left - scopedPosition.left) < 1 && Math.abs(afterOutsideMiss.top - scopedPosition.top) < 1, "an outside miss leaves the camera unchanged");
    await find.getByRole("button", { name: "Cancel" }).click();
    await find.waitFor({ state: "detached" });
    assert.equal(await only.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".tangent-map-ancestry [data-area-map-label]").count(), 3, "the Tangent scope never changed");

    // The toolbar click bubbles through the complete shell after React gives
    // the picker input focus. Shell focus styling must not take that focus.
    const focusCanvas = page.locator(".excalidraw canvas.interactive");
    await focusCanvas.evaluate((canvas) => { canvas.dataset.focusJourneyIdentity = "original"; });
    await page.getByRole("button", { name: /^Block/ }).click();
    const pickerInput = page.getByRole("dialog", { name: "Place a Tangent block" }).getByRole("textbox");
    await pickerInput.evaluate((input) => { input.dataset.focusJourneyIdentity = "original"; });
    assert.equal(await pickerInput.evaluate((input) => document.activeElement === input), true, "the Block click leaves its auto-focused input active before the click task ends");
    await page.keyboard.type("cont");
    await page.evaluate(async () => { const { refresh } = await import("/shell.js"); await refresh(); });
    await page.keyboard.type("inuous");
    assert.equal(await pickerInput.getAttribute("data-focus-journey-identity"), "original", "fact refresh keeps the exact picker input node");
    assert.equal(await pickerInput.evaluate((input) => document.activeElement === input), true, "fact refresh keeps Block input focus");
    assert.equal(await pickerInput.inputValue(), "continuous", "typing continues across fact refresh without a second click");
    assert.equal(await focusCanvas.getAttribute("data-focus-journey-identity"), "original", "fact refresh keeps the exact canvas");
    await page.locator("[data-tangent-area-map]").dispatchEvent("pointerdown");
    await pickerInput.waitFor({ state: "detached" });

    // A failed local Map draft survives a direct reading route, its named
    // Brain, and Work. The same selected block, camera, and canvas return.
    rejectMapSaves = true;
    await page.getByRole("button", { name: /^Block/ }).click();
    const draftPicker = page.getByRole("dialog", { name: "Place a Tangent block" });
    await page.keyboard.press("Tab");
    await draftPicker.getByRole("heading", { name: "Place from the whole vault" }).waitFor();
    await draftPicker.getByRole("textbox").fill("map-first proof");
    await draftPicker.getByRole("button", { name: /Map-first proof/ }).waitFor();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
    await page.keyboard.press("Escape");
    const blockedSave = page.getByRole("status", { name: "Map save status" });
    await blockedSave.getByText("Not saved", { exact: false }).waitFor();
    for (const name of ["Retry", "Reload saved", "Keep mine"]) await blockedSave.getByRole("button", { name }).waitFor();

    const draftCanvas = page.locator(".excalidraw canvas.interactive");
    await draftCanvas.evaluate((canvas) => { canvas.dataset.failedDraftIdentity = "original"; });
    const draftCamera = await tangentPosition();
    await page.getByRole("group", { name: "Actions for Map-first proof" }).waitFor();
    await page.keyboard.press("Enter");
    const mapDocument = page.locator("#document-peek-layer .document-peek-surface");
    await mapDocument.waitFor();
    await mapDocument.getByText("Map-first proof", { exact: true }).first().waitFor();
    assert.match(await mapDocument.textContent(), /Map-first proof/, "Enter opens the selected Map block directly");
    assert.match(await blockedSave.textContent(), /Not saved/, "opening a Document keeps the failed Map draft");
    await mapDocument.getByRole("button", { name: "Discuss with Otto / Tangent Brain" }).click();
    const discussionSubject = page.locator("[data-map-brain-pane] [data-brain-subject]:visible");
    const discussionPane = discussionSubject.locator("xpath=ancestor::*[@data-map-brain-pane][1]");
    await discussionSubject.waitFor();
    assert.match(await discussionSubject.textContent(), /Map-first proof/, "the responsible Brain receives the exact removable subject");
    assert.match(await discussionPane.locator(":scope > header").textContent(), /Otto \/ Tangent Brain/);
    assert.match(await blockedSave.textContent(), /Not saved/, "opening the responsible Brain keeps the failed Map draft");
    await discussionSubject.getByRole("button", { name: "Remove Document subject" }).click();
    await discussionSubject.waitFor({ state: "hidden" });
    assert.match(await page.locator("#back-button").textContent(), /^Document ⌘⇧↵$/i, "the global Back route names the working Brain return chord");
    await page.locator("#back-button").click();
    await mapDocument.waitFor();
    await mapDocument.getByRole("button", { name: "Close" }).click();
    await mapDocument.waitFor({ state: "detached" });
    await page.locator("#work-tab").click();
    await page.locator("#work-lens-layer").waitFor();
    assert.match(await blockedSave.textContent(), /Not saved/, "opening Work keeps the failed Map draft");
    await page.locator("[data-close-work-lens]").click();
    assert.equal(await draftCanvas.getAttribute("data-failed-draft-identity"), "original", "surface changes retain the exact Map canvas");
    await page.getByRole("group", { name: "Actions for Map-first proof" }).waitFor();
    assert.deepEqual(await tangentPosition(), draftCamera, "surface changes retain the failed draft camera");
    assert.ok(rejectedMapSaveAttempts >= 1, "the proof injected a real failed Map save");
    rejectMapSaves = false;
    await blockedSave.getByRole("button", { name: "Retry" }).click();
    await blockedSave.getByText("Saved", { exact: true }).waitFor();

    await page.locator(".excalidraw canvas.interactive").evaluate((canvas) => { canvas.dataset.companionIdentity = "original"; });
    const mapBrainRoute = await page.locator("#context-brain-button").evaluate((button) => ({ area: button.dataset.brainArea, hidden: button.hidden, text: button.textContent, active: { tag: document.activeElement?.tagName, className: String(document.activeElement?.className ?? "") } }));
    assert.deepEqual({ area: mapBrainRoute.area, hidden: mapBrainRoute.hidden }, { area: "otto/tangent", hidden: false }, `Map keeps the exact Tangent Brain route before its shortcut: ${JSON.stringify(mapBrainRoute)}`);
    assert.match(mapBrainRoute.active.className, /excalidraw/, "successful Map recovery returns focus to the retained editor instead of body");
    await page.keyboard.press("Meta+Shift+Enter");
    const pane = page.locator('[data-map-brain-pane]:has(.map-brain-terminal[data-session="otto-tangent--brain"])');
    try { await pane.waitFor({ timeout: 3_000 }); }
    catch (error) {
      const diagnostics = await page.evaluate(() => ({
        active: { tag: document.activeElement?.tagName, id: document.activeElement?.id, className: String(document.activeElement?.className ?? "") },
        context: document.querySelector("#context-brain-button")?.outerHTML,
        panes: [...document.querySelectorAll("[data-map-brain-pane]")].map((item) => ({ hidden: item.hidden, mode: item.dataset.mode, header: item.querySelector(":scope > header")?.textContent })),
        launch: document.querySelector("[data-launch-popover]")?.outerHTML,
        toast: document.querySelector("#toast")?.textContent,
      }));
      throw new Error(`the named Map Brain shortcut did not open Tangent: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    assert.equal(await pane.isVisible(), true, "the named Brain shortcut docks the exact Area brain on a wide map");
    assert.match(await pane.locator(":scope > header").textContent(), /Brain · working/);
    assert.equal(await pane.locator(".map-brain-terminal").getAttribute("data-session"), "otto-tangent--brain");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(
      await pane.locator(".xterm-helper-textarea").evaluate((composer) => document.activeElement === composer),
      true,
      "opening the live Brain from its hidden Map companion focuses its composer",
    );
    await pane.locator(".xterm-helper-textarea").evaluate((composer) => {
      window.wideMapBrainKey = null;
      composer.addEventListener("keydown", (event) => { window.wideMapBrainKey = event.key; }, { capture: true, once: true });
    });
    await page.keyboard.press("w");
    assert.equal(await page.evaluate(() => window.wideMapBrainKey), "w", "the 1440px Map → Brain route accepts typing without another click");
    // The split is Julian's own request. Every pane pair below this line
    // exists because this control asked for it, never because a route did.
    await page.locator("#split-button").click();
    await page.waitForFunction(() => document.querySelector("[data-area-workspace]")?.dataset.presentation === "wide");
    assert.equal(await page.locator("#split-button").getAttribute("aria-pressed"), "true", "the split control states that both panes are open");
    const widths = await page.evaluate(() => ({ pane: document.querySelector("[data-map-brain-pane]").getBoundingClientRect().width, map: document.querySelector("[data-map-column]").getBoundingClientRect().width }));
    assert.ok(widths.pane >= 550 && widths.pane <= 570, `the dock starts at 560px: ${JSON.stringify(widths)}`);
    assert.ok(widths.map >= 560, `the map keeps its usable minimum: ${JSON.stringify(widths)}`);
    const separator = page.getByRole("separator", { name: "Resize Brain" });
    await separator.focus();
    await page.keyboard.press("ArrowLeft");
    const resizedBrainWidth = await pane.evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(resizedBrainWidth > widths.pane, `the keyboard separator resizes Brain without route logic: ${resizedBrainWidth}`);
    await page.locator("#map-tab").click();
    await page.locator('[data-map-breadcrumb="otto"]').click();
    assert.equal(await pane.locator(".map-brain-terminal").getAttribute("data-session"), "otto-tangent--brain", "Map drill does not close or retarget Brain");
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "Map drill preserves the same Map controller");
    await page.locator("[data-map-find]").click();
    await findInput.fill("tangent");
    const tangentResult = find.getByRole("option").filter({ hasText: "Tangent" }).first();
    await tangentResult.click();
    await findInput.focus();
    await page.keyboard.press("Enter");
    await find.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector('[data-map-breadcrumb="otto/tangent"]')?.getAttribute("aria-current") === "page");
    await page.locator("[data-map-column]").click({ position: { x: 20, y: 20 } });
    assert.match(await page.locator("[data-map-column]").getAttribute("class"), /focused/);
    await pane.dispatchEvent("pointerdown");
    assert.match(await pane.getAttribute("class"), /focused/, "pointer focus selects the Brain pane");
    const terminalKeyOwnership = await page.evaluate(() => {
      const target = document.querySelector("[data-map-brain-pane] .xterm-helper-textarea");
      return [
        { name: "m", key: "m" }, { name: "b", key: "b" }, { name: "Escape", key: "Escape" },
        { name: "Control-H", key: "h", ctrlKey: true }, { name: "Control-L", key: "l", ctrlKey: true },
      ].map((definition) => {
        let shellPrevented = null;
        /** Records whether the shell consumed this terminal key in capture. */
        const probe = (event) => { shellPrevented = event.defaultPrevented; };
        document.addEventListener("keydown", probe, { capture: true, once: true });
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...definition }));
        return [definition.name, shellPrevented];
      });
    });
    assert.deepEqual(terminalKeyOwnership, [["m", false], ["b", false], ["Escape", false], ["Control-H", false], ["Control-L", false]], "Brain terminal keys reach xterm without split interception");
    await page.locator("[data-map-column]").click({ position: { x: 20, y: 20 } });
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "focus changes never remount the canvas");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain\s+⌘⇧↵/, "Map exposes one visible named route back to its Brain");
    await page.locator("#context-brain-button").click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await pane.locator(".xterm-helper-textarea").evaluate((composer) => document.activeElement === composer), true, "the global Brain route returns typing to its composer");
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "Map and Brain navigation keeps the map island");
    const companionTerminal = pane.locator(".xterm").first();
    await companionTerminal.evaluate((node) => { node.dataset.responsiveIdentity = "original"; });
    await page.locator("#map-tab").click();
    await page.setViewportSize({ width: 800, height: 760 });
    await page.waitForFunction(() => document.querySelector("[data-area-workspace]")?.dataset.presentation === "single");
    assert.equal(await page.locator("[data-split-pane]").count(), 2, "narrow presentation keeps both pane roots mounted");
    assert.equal(await pane.isVisible(), false, "the primary Map is the initial narrow pane");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain\s+⌘⇧↵/, "the 800px Map keeps the Brain shortcut label visible");
    await page.keyboard.press("Meta+Shift+Enter");
    assert.equal(await pane.isVisible(), true, "the named Brain shortcut selects the mounted Brain in narrow mode");
    assert.equal(await page.locator("[data-map-column]").isVisible(), false);
    assert.equal(await page.locator('[data-split-pane="map"]').getAttribute("inert"), "", "the hidden compact Map is absent from keyboard and assistive input");
    assert.equal(await pane.locator(".xterm-helper-textarea").evaluate((composer) => document.activeElement === composer), true, "narrow Brain activation owns the keyboard immediately");
    await pane.locator(".xterm-helper-textarea").evaluate((composer) => {
      window.compactMapBrainKey = null;
      composer.addEventListener("keydown", (event) => { window.compactMapBrainKey = event.key; }, { capture: true, once: true });
    });
    await page.keyboard.press("n");
    assert.equal(await page.evaluate(() => window.compactMapBrainKey), "n", "the 800px Map → Brain route accepts typing without another click");
    assert.equal(await companionTerminal.getAttribute("data-responsive-identity"), "original", "narrow selection preserves the exact xterm node");
    assert.equal(await page.locator("#map-tab").getAttribute("aria-current"), null, "the hidden compact Map is not announced as current");
    assert.equal(await page.locator("#context-brain-button").getAttribute("aria-pressed"), "true", "the compact Brain state is reflected by the one contextual route");
    assert.equal(await page.locator("#context-brain-button").isHidden(), true, "the open Brain action is not duplicated on the Brain surface");
    assert.match(await page.locator("#back-button").textContent(), /^Map ⌘⇧↵$/i, "the compact Brain has one visible global Map return chord");
    const compactActions = await page.locator(".app-bar button:visible").evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { label: button.getAttribute("aria-label") || button.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    assert.ok(compactActions.every((box) => box.left >= 0 && box.right <= 800 && box.top >= 0 && box.bottom <= 760), `every visible compact action stays in the 800px viewport: ${JSON.stringify(compactActions)}`);
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.waitForFunction(() => document.querySelector("[data-area-workspace]")?.dataset.presentation === "wide");
    await page.setViewportSize({ width: 800, height: 760 });
    await page.waitForFunction(() => document.querySelector("[data-area-workspace]")?.dataset.presentation === "single");
    assert.equal(await pane.isVisible(), true, "a later narrow interval restores the last narrow pane");
    assert.equal(await page.locator("[data-map-column]").isVisible(), false);
    await page.locator("#map-tab").click();
    assert.equal(await page.locator("[data-map-column]").isVisible(), true, "the global Map route selects the mounted Map in narrow mode");
    assert.equal(await page.locator(".excalidraw canvas.interactive").getAttribute("data-companion-identity"), "original", "narrow selection preserves the exact canvas");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain\s+⌘⇧↵/);
    await page.locator("#context-brain-button").click();
    assert.equal(await pane.isVisible(), true, "the contextual Brain route restores the exact compact companion");
    assert.equal(await companionTerminal.getAttribute("data-responsive-identity"), "original", "Brain → Map → Brain keeps the exact terminal node");
    assert.equal(await pane.locator(".xterm-helper-textarea").evaluate((composer) => document.activeElement === composer), true, "Brain → Map → Brain restores composer focus");
    // The terminal-visible route is the pointer alternative to Command-K.
    // Its selected Document closes to the exact compact Brain terminal.
    const compactComposer = pane.locator(".xterm-helper-textarea");
    await page.locator("#go-to-button").click();
    await page.locator("#go-to-input").fill("Map-first proof");
    await page.getByRole("option", { name: /Map-first proof/ }).waitFor();
    const compactGoToLayout = await page.locator("#go-to-layer .go-to").evaluate((surface) => ({
      width: surface.getBoundingClientRect().width,
      scrollWidth: surface.scrollWidth,
      controls: [...surface.querySelectorAll("input, select, button")].filter((control) => control.offsetParent !== null).map((control) => {
        const box = control.getBoundingClientRect();
        return { label: control.getAttribute("aria-label") || control.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    }));
    assert.ok(compactGoToLayout.scrollWidth <= compactGoToLayout.width + 1, `the 800px Go To layer has no clipped horizontal controls: ${JSON.stringify(compactGoToLayout)}`);
    assert.ok(compactGoToLayout.controls.every((box) => box.left >= 0 && box.right <= 800 && box.top >= 0 && box.bottom <= 760), `every Go To control remains reachable at 800px: ${JSON.stringify(compactGoToLayout.controls)}`);
    await page.keyboard.press("Enter");
    const compactReader = page.locator("#document-peek-layer .document-peek-surface");
    await compactReader.waitFor();
    assert.equal(await compactReader.getAttribute("role"), "region");
    assert.equal(await page.locator('#document-peek-layer [aria-modal="true"]').count(), 0, "the visible global header is not outside an asserted Document modal");
    await compactReader.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "go-to-button", "Shift-Tab reaches the visible global header from the Document");
    await page.keyboard.press("Tab");
    assert.equal(await compactReader.evaluate((reader) => reader.contains(document.activeElement)), true, "Tab returns from global chrome to the Document");
    assert.match(await compactReader.getByRole("button", { name: /Discuss with Otto \/ Tangent Brain/ }).textContent(), /Otto \/ Tangent Brain/);
    await compactReader.getByRole("button", { name: /Close/ }).click();
    await compactReader.waitFor({ state: "detached" });
    assert.equal(await companionTerminal.getAttribute("data-responsive-identity"), "original", "Go To from compact Brain preserves the exact terminal node");
    assert.equal(await compactComposer.evaluate((composer) => document.activeElement === composer), true, "closing the Go To Document restores compact Brain focus");

    await page.locator("#map-tab").click();
    assert.equal(await page.locator("[data-map-column]").isVisible(), true, "the global Map route exposes the retained Map after the return proof");
    assert.equal(await page.locator("#map-tab").getAttribute("aria-current"), "page", "the compact header announces Map as the active surface");
    assert.match(await page.locator("#context-brain-button").textContent(), /Otto \/ Tangent Brain/, "the compact header keeps the active Area visible in its named Brain route");
    await page.locator("#map-tab").focus();
    for (const expected of [
      "#work-tab",
      '[data-map-breadcrumb="otto"]',
      '[data-map-breadcrumb="otto/tangent"]',
      "[data-map-find]",
      "[data-map-only]",
      "#for-you-button",
      "#problems-button",
      "#context-brain-button",
      "#go-to-button",
    ]) {
      await page.keyboard.press("Tab");
      const focused = await page.locator(expected).evaluate((control) => document.activeElement === control);
      assert.equal(focused, true, `compact header focus reaches ${expected} in visible order`);
    }
    if (await only.getAttribute("aria-pressed") === "true") {
      await only.click();
      await waitForOnly(false);
    }
    await designwardenLabel.dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector("#context-brain-button")?.dataset.brainArea === "neara/designwarden");
    const shortcutLayout = await page.locator("#context-brain-button").evaluate((button) => {
      const key = button.querySelector("kbd");
      const outer = button.getBoundingClientRect();
      const inner = key?.getBoundingClientRect();
      return inner && {
        left: inner.left, right: inner.right, top: inner.top, bottom: inner.bottom,
        outerLeft: outer.left, outerRight: outer.right, outerTop: outer.top, outerBottom: outer.bottom,
        width: inner.width, height: inner.height, visibility: getComputedStyle(key).visibility,
      };
    });
    assert.ok(shortcutLayout && shortcutLayout.width > 0 && shortcutLayout.height > 0
      && shortcutLayout.visibility === "visible"
      && shortcutLayout.left >= shortcutLayout.outerLeft - 1
      && shortcutLayout.right <= shortcutLayout.outerRight + 1
      && shortcutLayout.top >= shortcutLayout.outerTop - 1
      && shortcutLayout.bottom <= shortcutLayout.outerBottom + 1,
    `the complete Designwarden Brain shortcut is visible at 800px: ${JSON.stringify(shortcutLayout)}`);
    await page.locator('[data-area-map-label="otto/tangent"]').dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector("#context-brain-button")?.dataset.brainArea === "otto/tangent");
    const compactBlockAction = page.getByRole("button", { name: /^Block/ });
    await compactBlockAction.waitFor();
    assert.equal(await compactBlockAction.locator(".tangent-map-label").isVisible(), true, "the primary Block action keeps its visible name at 800px");
    const compactBlockBox = await compactBlockAction.boundingBox();
    assert.ok(compactBlockBox && compactBlockBox.x >= 0 && compactBlockBox.x + compactBlockBox.width <= 800, `the named Block action stays inside the 800px viewport: ${JSON.stringify(compactBlockBox)}`);

    // At 800px, B places the complete-vault Document directly. A real save
    // rejection then survives Document, Brain, and Work before Retry succeeds.
    rejectMapSaves = true;
    const compactFailureCanvas = page.locator(".excalidraw canvas.interactive");
    await compactFailureCanvas.evaluate((canvas) => { canvas.dataset.compactFailureIdentity = "original"; });
    await page.locator("[data-tangent-area-map] .excalidraw").focus();
    await page.keyboard.press("b");
    const compactPicker = page.getByRole("dialog", { name: "Place a Tangent block" });
    await compactPicker.waitFor();
    await page.keyboard.press("Tab");
    await compactPicker.getByRole("heading", { name: "Place from the whole vault" }).waitFor();
    await compactPicker.getByRole("textbox").fill("map-first proof");
    await compactPicker.getByRole("button", { name: /Map-first proof/ }).waitFor();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches('textarea[data-type="wysiwyg"]'));
    await page.keyboard.press("Escape");
    await blockedSave.getByText("Not saved", { exact: false }).waitFor();
    const compactFailureCamera = await tangentPosition();
    await page.getByRole("group", { name: "Actions for Map-first proof" }).waitFor();
    await compactFailureCanvas.focus();
    await page.keyboard.press("Enter");
    await compactReader.waitFor();
    await compactReader.getByText("Map-first proof", { exact: true }).first().waitFor();
    assert.match(await compactReader.textContent(), /Map-first proof/, "the 800px Map Document opens in one direct keyboard action");
    const readerLayout = await compactReader.evaluate((surface) => ({
      width: surface.getBoundingClientRect().width,
      scrollWidth: surface.scrollWidth,
      actions: [...surface.querySelectorAll(".document-peek-actions button")].map((button) => {
        const box = button.getBoundingClientRect();
        return { label: button.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    }));
    assert.ok(readerLayout.scrollWidth <= readerLayout.width + 1, `the 800px quick reader has no clipped horizontal action row: ${JSON.stringify(readerLayout)}`);
    assert.ok(readerLayout.actions.every((box) => box.left >= 0 && box.right <= 800 && box.top >= 0 && box.bottom <= 760), `every quick-reader action remains reachable at 800px: ${JSON.stringify(readerLayout.actions)}`);
    const exposedDialogs = await page.locator('[role="dialog"]:visible').evaluateAll((dialogs) => dialogs
      .filter((dialog) => !dialog.closest("[inert], [hidden]"))
      .map((dialog) => dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby")));
    assert.deepEqual(exposedDialogs, [], `the quick Document does not claim modal ownership of visible global routes: ${JSON.stringify(exposedDialogs)}`);
    assert.equal(await page.locator("#context-brain-button").getAttribute("data-brain-area"), "otto/tangent");
    await page.locator("#context-brain-button").click();
    const compactDiscussionBrain = page.locator("#document-peek-layer [data-map-brain-pane]");
    await compactDiscussionBrain.waitFor();
    assert.equal(await page.locator('#document-peek-layer [aria-modal="true"]').count(), 0, "the combined Document discussion is also nonmodal");
    assert.deepEqual(await page.locator(".document-discussion-switcher button:visible").allTextContents(), ["Document", "Otto / Tangent Brain"], "compact discussion switches only between its two retained surfaces");
    assert.match(await compactDiscussionBrain.locator("[data-brain-subject]").textContent(), /Map-first proof/, "the 800px discussion names the exact Document subject");
    assert.equal(await compactDiscussionBrain.locator(".xterm-helper-textarea").evaluate((composer) => document.activeElement === composer), true, "the 800px discussion Brain accepts typing immediately");
    assert.match(await page.locator(".tangent-map-save").textContent(), /Not saved/, "the compact discussion preserves the failed local Map draft");
    assert.match(await page.locator("#back-button").textContent(), /^Document ⌘⇧↵$/i);
    await page.locator("#back-button").click();
    await compactReader.waitFor();
    await compactReader.getByRole("button", { name: /Close/ }).click();
    await compactReader.waitFor({ state: "detached" });

    const compactMapReturn = page.locator('[data-area-map-label="otto/tangent"]');
    await compactMapReturn.evaluate((control) => { control.dataset.compactMapReturnIdentity = "original-map-control"; });
    await compactMapReturn.focus();
    await page.keyboard.press("Meta+/");
    const compactWork = page.locator("#work-lens-layer");
    await compactWork.waitFor();
    assert.match(await page.locator(".tangent-map-save").textContent(), /Not saved/, "the 800px Work layer preserves the failed local Map draft");
    const compactWorkLayout = await compactWork.locator(".work-lens-surface").evaluate((surface) => ({
      width: surface.getBoundingClientRect().width,
      scrollWidth: surface.scrollWidth,
      controls: [...surface.querySelectorAll("button, input")].filter((control) => control.offsetParent !== null).map((control) => {
        const box = control.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    }));
    assert.ok(compactWorkLayout.scrollWidth <= compactWorkLayout.width + 1, `the 800px Work lens has no clipped horizontal controls: ${JSON.stringify(compactWorkLayout)}`);
    assert.ok(compactWorkLayout.controls.every((box) => box.left >= 0 && box.right <= 800), `every Work control stays horizontally reachable in the 800px scroll surface: ${JSON.stringify(compactWorkLayout.controls)}`);
    const compactQuery = page.locator("#work-search-input");
    await compactQuery.fill("compact");
    const compactWorkerRow = page.locator('[data-goal-anchor="otto/tangent/goal-compact-table.md"]');
    const compactWorkerTitle = compactWorkerRow.locator("[data-work-row-title]");
    await compactWorkerRow.dispatchEvent("click");
    await compactWorkerTitle.evaluate((node) => { node.dataset.compactReturnIdentity = "original-work-row"; });
    await compactWorkerTitle.focus();
    await page.keyboard.press("Meta+Shift+Enter");
    const compactSession = page.locator("#session-layer:not([hidden])");
    await compactSession.locator('.xterm').waitFor();
    assert.equal(await compactSession.locator("#session-layer-terminal").getAttribute("data-session"), "tangent--table", "the 800px Work route opens the exact worker");
    const compactSessionActions = await compactSession.locator(".session-layer-header button:visible").evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { label: button.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    assert.ok(compactSessionActions.every((box) => box.left >= 0 && box.right <= 800 && box.top >= 0 && box.bottom <= 760), `full-screen agent actions remain reachable at 800px: ${JSON.stringify(compactSessionActions)}`);
    await compactSession.locator("[data-close-session-layer]").click();
    await page.waitForFunction(() => document.activeElement?.dataset.compactReturnIdentity === "original-work-row");
    assert.equal(await compactQuery.inputValue(), "compact", "800px worker inspection restores the exact Work query");
    await compactWork.locator("[data-close-work-lens]").click();
    await page.waitForFunction(() => document.querySelector("#work-lens-layer").hidden);
    assert.equal(await compactFailureCanvas.getAttribute("data-compact-failure-identity"), "original", "800px worker inspection preserves the exact Map canvas");
    assert.equal(await compactMapReturn.getAttribute("data-compact-map-return-identity"), "original-map-control", "800px Work retains the exact Map opener");
    assert.equal(await compactMapReturn.evaluate((control) => document.activeElement === control), true, "closing compact Work restores exact Map focus");
    assert.deepEqual(await tangentPosition(), compactFailureCamera, "800px Document, Brain, and Work routes preserve the failed-draft camera");
    rejectMapSaves = false;
    await blockedSave.getByRole("button", { name: "Retry" }).click();
    await blockedSave.getByText("Saved", { exact: true }).waitFor();

    await page.evaluate(() => { document.activeElement.dataset.pollFocusProof = "before"; });
    await page.waitForTimeout(30_500);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.pollFocusProof), "before", "a session poll preserves the exact Map focus instead of stealing it for Brain");
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.waitForFunction(() => document.querySelector("[data-area-workspace]")?.dataset.presentation === "wide");
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.getByRole("treeitem", { name: "Otto, child of map root, depth 1, unfolded, ready, 0 blocks" }).waitFor();
    await page.locator('[data-area-map-label="otto/tangent"]').waitFor();
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

    // Work is a lens. Inspecting a worker and temporarily locating another
    // Area return to the exact row/query, then closing Work reveals the exact
    // camera, selection control, and focus that opened it.
    await page.setViewportSize({ width: 1440, height: 760 });
    const mapOrigin = page.locator('[data-area-map-label="otto/tangent"]');
    await mapOrigin.dispatchEvent("click");
    await mapOrigin.evaluate((node) => { node.dataset.returnIdentity = "original-map-control"; });
    const cameraBeforeWork = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll("[data-area-map-label]")].map((node) => [node.dataset.areaMapLabel, { left: node.style.left, top: node.style.top }]),
    ));
    await mapOrigin.focus();
    await page.keyboard.press("Meta+/");
    await page.locator("#work-lens-layer").waitFor();
    const query = page.locator("#work-search-input");
    await query.fill("compact");
    const workerRow = page.locator('[data-goal-anchor="otto/tangent/goal-compact-table.md"]');
    const workerTitle = workerRow.locator("[data-work-row-title]");
    await workerRow.dispatchEvent("click");
    await workerTitle.evaluate((node) => { node.dataset.returnIdentity = "original-work-row"; });
    await workerTitle.focus();
    await page.keyboard.press("Meta+Shift+Enter");
    await page.locator("#session-layer:not([hidden]) .xterm").waitFor();
    await page.locator("#session-layer [data-close-session-layer]").click();
    try {
      await page.waitForFunction(() => document.activeElement?.dataset.returnIdentity === "original-work-row", null, { timeout: 2_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        active: document.activeElement?.outerHTML,
        expected: document.querySelector('[data-return-identity="original-work-row"]')?.outerHTML,
        workHidden: document.querySelector("#work-lens-layer")?.hidden,
        workInert: document.querySelector("#work-lens-layer")?.hasAttribute("inert"),
      }));
      throw new Error(`worker inspection did not restore its exact Work control: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    assert.equal(await query.inputValue(), "compact", "worker inspection returns to the exact Work query");
    assert.equal(await workerTitle.getAttribute("data-return-identity"), "original-work-row", "worker inspection retains the exact row node");

    await query.fill("");
    const standardsRow = page.locator('[data-work-cursor="area:otto/standards"]');
    await standardsRow.dispatchEvent("click");
    await standardsRow.locator("[data-work-cursor-control]").focus();
    await page.keyboard.press("m");
    try {
      await page.waitForFunction(() => document.querySelector('[data-tangent-area-map="otto/standards"]'), null, { timeout: 3_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        active: document.activeElement?.outerHTML,
        cursor: document.querySelector("[data-work-cursor].cursor")?.getAttribute("data-work-cursor"),
        workHidden: document.querySelector("#work-lens-layer")?.hidden,
        map: document.querySelector("[data-tangent-area-map]")?.getAttribute("data-tangent-area-map"),
        toast: document.querySelector("#toast")?.textContent,
      }));
      throw new Error(`Show on Map did not locate Standards: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    await page.locator("#back-button").click();
    await page.waitForFunction(() => !document.querySelector("#work-lens-layer").hidden);
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-work-cursor="area:otto/standards"] [data-work-cursor-control]'));
    await page.locator("[data-close-work-lens]").click();
    await page.waitForFunction(() => document.querySelector("#work-lens-layer").hidden);
    assert.equal(await mapOrigin.getAttribute("data-return-identity"), "original-map-control", "closing Work returns the exact Map control");
    assert.equal(await mapOrigin.evaluate((node) => document.activeElement === node), true, "closing Work restores Map focus");
    const cameraAfterWork = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll("[data-area-map-label]")].map((node) => [node.dataset.areaMapLabel, { left: node.style.left, top: node.style.top }]),
    ));
    assert.deepEqual(cameraAfterWork, cameraBeforeWork, "Work Show on Map restores the exact retained camera");
  } finally {
    await browser?.close();
    for (const client of websocketServer.clients) client.terminate();
    await new Promise((resolve) => websocketServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
