import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));

const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0}</style></head><body><div id="map"></div><script type="module">
import areaBoard from "/area-board.js";
import boardCore from "/area-board-core.js";
window.TANGENT_FEATURES = { areaMapWorld: false, areaMapResourceWrites: false };
window.calls = [];
window.saved = null;
const empty = () => ({ type: "excalidraw", version: 2, source: "test", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
const initial = empty();
initial.elements.push(...boardCore.createBlockElements({ id: "visible-resource", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23b", title: "Visible compatibility resource", x: 20, y: 30 }));
const hidden = empty();
hidden.elements.push(...boardCore.createBlockElements({ id: "hidden-resource", kind: "resource", ref: "0198e8c5-2be6-7d6a-a142-f0903a13a23c", title: "Hidden compatibility resource", x: 420, y: 30 }));
initial.elements.push(...boardCore.setBlockHidden(hidden, "hidden-resource", true).elements);
window.initialResourceRecords = structuredClone(initial.elements);
const api = async (resource, options = {}) => {
  window.calls.push({ resource, method: options.method ?? "GET" });
  if (resource.startsWith("/api/areas/canvas?") && !options.method) return { area: "otto", exists: true, ok: true, hash: "hash-1", scene: structuredClone(initial), canvas: structuredClone(initial) };
  if (resource === "/api/areas/canvas" && options.method === "POST") {
    window.saved = JSON.parse(options.body).canvas;
    return { status: 200, hash: "hash-2", hashes: { otto: "hash-2" } };
  }
  throw new Error("unexpected authority route " + resource);
};
const authority = await areaBoard.loadAreaMapAuthority(api, "otto");
window.editor = areaBoard.mount(document.querySelector("#map"), { area: "otto", ...authority, api, onBack() {} });
</script></body></html>`;

test("disabled areaMapWorld mounts and saves only the format-2 legacy editor", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.locator('[data-tangent-area-map-legacy="format-2"] .excalidraw canvas.interactive').waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls), [{ resource: "/api/areas/canvas?area=otto", method: "GET" }]);
    assert.equal(await page.locator(".tangent-map-ancestry").count(), 0, "rollback does not restore ancestor projections");

    const canvas = page.locator(".excalidraw canvas.interactive");
    const box = await canvas.boundingBox();
    assert.ok(box);
    const textTool = page.getByRole("radio", { name: /Text/i }).first();
    await textTool.click({ force: true });
    assert.equal(await textTool.isChecked(), true);
    await page.mouse.click(box.x + 220, box.y + 260);
    await page.keyboard.type("rollback text");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.editor.current().elements.some((element) => element.type === "text" && element.text === "rollback text"));
    await page.evaluate(() => window.editor.flush());
    await page.waitForFunction(() => window.saved?.elements?.some((element) => element.type === "text" && element.text === "rollback text"));
    const resourceRecords = await page.evaluate(() => ({
      before: window.initialResourceRecords,
      after: window.saved.elements.filter((element) => ["visible-resource", "visible-resource-tangent-label", "hidden-resource", "hidden-resource-tangent-label"].includes(element.id)),
    }));
    assert.deepEqual(resourceRecords.after, resourceRecords.before, "rollback-compatible unrelated saves preserve visible and hidden resource records exactly");
    assert.equal(resourceRecords.after.filter((element) => element.isDeleted).length, 2, "the hidden root and bound label stay retained");
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.map(({ resource, method }) => [resource, method]), [["/api/areas/canvas?area=otto", "GET"], ["/api/areas/canvas", "POST"]]);
    assert.ok(calls.every(({ resource }) => !resource.includes("map-world") && !resource.includes("map-gestures")));
    assert.deepEqual(pageErrors, [], "the rollback editor does not cross a React error boundary");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
