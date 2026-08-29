import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
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

test("m opens the real Excalidraw island from Work", { skip: !enabled, timeout: 90_000 }, async () => {
  const work = workTableFixture();
  let scene = areaBoardCore.withBoundary(areaBoardCore.createEmptyScene(), "otto");
  scene.elements.push(...areaBoardCore.createRegionElements({ id: "tangent-region", ref: "otto/tangent/tangent.md", title: "Tangent", x: 100, y: 100, width: 820, height: 580 }));
  let childScene = areaBoardCore.withBoundary(areaBoardCore.createEmptyScene(), "otto/tangent");
  childScene.elements.push(areaBoardCore.createTextElement({ id: "child-note", text: "inside Tangent", x: 180, y: 180 }));
  let savedHash = "scene-1";
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
    await page.getByText("Saving…", { exact: true }).waitFor();
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
