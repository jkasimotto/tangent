import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { validateAreaCanvas } from "./area-canvas.mjs";
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
const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: { theme: "dark", viewBackgroundColor: "#121216" }, files: {} };
const documents = [{ file: "otto/goal-map.md", kind: "goal", title: "Map quality", status: "active" }];
window.editor = mountAreaBoardEditor(document.querySelector("#map"), { area: "otto", scene, proposals: [], getDocuments: () => documents, onSceneChange: (next) => { window.lastScene = next; }, onFactScene: () => {}, onEntityVerb: () => {}, onBack: () => {}, onSaveNow: () => {} });
</script></body></html>`;

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
  const scene = { type: "excalidraw", version: 2, source: "test", elements: [], appState: { theme: "dark", viewBackgroundColor: "#121216" }, files: {} };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/work") return sendJson(response, 404, { error: "use compatibility projection" });
    if (url.pathname === "/api/vault") return sendJson(response, 200, work.vault);
    if (url.pathname === "/api/sessions") return sendJson(response, 200, { boot: "test", pipelines: work.pipelines, sessions: work.sessions, brains: work.brains });
    if (url.pathname === "/api/operations") return sendJson(response, 200, { operations: [], processes: [], problems: [], areas: [], liveCount: 0 });
    if (url.pathname === "/api/areas/canvas") return sendJson(response, 200, { area: url.searchParams.get("area"), file: "otto/tangent/tangent.excalidraw", exists: true, hash: "scene-1", scene, canvas: scene, proposals: [], warnings: [] });
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
    await page.keyboard.press("b");
    await page.getByRole("dialog", { name: "Place a Tangent block" }).getByRole("textbox").fill("compact table");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-tangent-area-map]") && document.body.textContent.includes("Redesign Work as a compact table"));
    assert.match(await page.locator(".map-screen h1").textContent(), /^otto\/tangent · Map$/);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
