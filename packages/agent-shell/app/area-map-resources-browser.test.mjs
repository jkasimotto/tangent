import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const exactWorktree = "/private/tmp/tangent-map-resource-fixture/main-checkout";

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="map"></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const parentScene = empty();
const childScene = empty();
childScene.elements.push(...core.createBlockElements({ id: "main-resource", kind: "resource", ref: "worktree-main", title: "stale cached title", status: "", x: 160, y: 160, width: 240, height: 110 }));
const world = {
  schema: "area-map-world.v1", worldId: "resource-browser-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: parentScene } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 100, y: 100, width: 760, height: 520 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: childScene.elements.length, blockCount: 1, scene: childScene } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
];
const main = {
  locator: { owner: "otto/tangent", id: "worktree-main" }, label: "Main checkout", target: { kind: "worktree", path: ${JSON.stringify(exactWorktree)} },
  local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-entities-first-class" }, repositoryPath: ${JSON.stringify(exactWorktree)} }, checkedAt: "2026-09-02T01:00:00.000Z" },
  link: null, representation: { state: "current", value: "on-map" }, origin: null, warnings: [],
};
const inherited = {
  locator: { owner: "otto", id: "repo-shared" }, label: "Shared repository", target: { kind: "repository", path: "/private/tmp/tangent-map-resource-fixture/shared" },
  local: { state: "not-checked", value: null, checkedAt: null }, link: null, representation: { state: "current", value: "never-placed" }, origin: null, warnings: [],
};
const projection = {
  state: "current", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "cat-child" }, { owner: "otto", revision: "cat-parent" }],
  counts: { state: "current", confirmedAssociations: 2, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [],
  rows: [
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: main },
    { viewedFrom: "otto/tangent", relation: { kind: "inherited", sourceArea: "otto" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: inherited },
  ],
};
const byKey = new Map([["otto/tangent\u0000worktree-main", main], ["otto\u0000repo-shared", inherited]]);
window.apiCalls = []; window.copied = []; window.worldChanges = [];
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.copied.push(value); } } });
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null; window.apiCalls.push({ url, body });
  if (url.startsWith("/api/areas/map-resources?")) return structuredClone(projection);
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") return { resolutions: body.resources.map((locator) => ({ state: "current", value: structuredClone(byKey.get(locator.owner + "\u0000" + locator.id)) })) };
  if (url === "/api/areas/map-resources/apply") return { status: 200, effect: body.mutation.kind, projection: structuredClone(projection), sourceUpdates: [], warnings: [], undo: { state: "unavailable" } };
  throw new Error("Unexpected fixture resource route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api: resourceApi, focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: async (_next, areas, owners) => { window.worldChanges.push({ areas: [...areas], owners: [...owners] }); return { status: 200 }; }, onEntityVerb: () => {}, onBack: () => {},
});
window.selectMain = (withLabel = false) => {
  const snapshot = window.editor.controller().snapshot();
  const block = snapshot.composition.scene.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "worktree-main");
  const ids = [block.id];
  if (withLabel) ids.push(block.boundElements[0].id);
  window.editor.controller().setSelection(ids);
  return ids;
};
window.settleMap = async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return window.editor.controller().flush();
};
</script></body></html>`;

test("Resources keeps the 800px Map mounted, copies an exact worktree, and places inherited resources through the shared world", { skip: !enabled, timeout: 90_000 }, async () => {
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

    await page.evaluate(() => window.selectMain(false));
    await page.getByRole("button", { name: "Copy path for Main checkout" }).waitFor();
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.waitForFunction(() => window.copied.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copied), [exactWorktree]);
    await page.getByRole("status").filter({ hasText: "Copied Main checkout path." }).waitFor();

    await page.evaluate(() => window.selectMain(true));
    await page.waitForFunction(() => Object.keys(window.editor.appState().selectedElementIds).filter((id) => window.editor.appState().selectedElementIds[id]).length === 2);
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.copied.length), 1, "a Block plus its label has no semantic action");
    assert.equal(await page.getByRole("button", { name: "Copy path for Main checkout" }).count(), 0, "multiple selection has no visible primary action");

    await page.evaluate(() => window.selectMain(false));
    await page.getByRole("button", { name: "Copy path for Main checkout" }).waitFor();
    await page.locator(".excalidraw canvas.interactive").dispatchEvent("dblclick", { detail: 2 });
    await page.waitForFunction(() => window.copied.length === 2);
    assert.equal(await page.evaluate(() => window.copied.at(-1)), exactWorktree);

    const resourcesButton = page.getByRole("button", { name: "Resources", exact: true });
    await resourcesButton.click();
    const heading = page.getByRole("heading", { name: "Map resources · Tangent" });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "tangent-map-resources-title");
    assert.equal(await resourcesButton.isVisible(), true, "the narrow toolbar keeps Resources named");
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), true, "the retained canvas is inert under the sheet");
    await page.getByText("Direct", { exact: true }).waitFor();
    await page.getByText("From otto", { exact: true }).waitFor();
    await page.getByText(exactWorktree, { exact: true }).waitFor();
    const sheetBox = await page.locator(".tangent-map-resources").boundingBox();
    assert.ok(sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 800, `sheet stays inside 800px: ${JSON.stringify(sheetBox)}`);
    await page.getByRole("button", { name: "Remove from Area" }).click();
    await page.waitForFunction(() => window.apiCalls.some((call) => call.url === "/api/areas/map-resources/apply"));
    const mutationRequest = await page.evaluate(() => window.apiCalls.find((call) => call.url === "/api/areas/map-resources/apply").body);
    assert.deepEqual(mutationRequest.expectedCatalogs, [{ owner: "otto/tangent", revision: "cat-child" }], "a direct descendant mutation never sends the inherited ancestor catalog guard");

    await page.getByRole("button", { name: "Place in otto" }).click();
    await page.getByRole("status", { name: "Place Shared repository on the Map" }).waitFor();
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), false, "placement returns keyboard and pointer ownership to the retained Map");
    await page.locator("#map").dispatchEvent("keydown", { key: "ArrowRight" });
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    await page.waitForFunction(() => window.worldChanges.length >= 1);
    const placed = await page.evaluate(() => {
      const state = window.editor.controller().snapshot();
      const source = window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared");
      return { source, save: state.save.state, selection: [...state.selection], changes: window.worldChanges };
    });
    assert.equal(placed.source.customData.tangentWorld, undefined, "the shared split pipeline persists source metadata, not runtime geometry metadata");
    assert.ok(placed.selection.length === 1, "placement owns one exact selection");
    assert.ok(placed.changes.some((change) => change.owners.includes("otto")), "placement saves through the source owner's canonical Map gesture");
    assert.equal((await page.evaluate(() => window.apiCalls)).some((call) => call.url === "/api/areas/map-resources/representation"), false, "the browser never uses the Brain/CLI representation adapter");

    await page.locator("#map").dispatchEvent("keydown", { key: "z", ctrlKey: true });
    await page.waitForFunction(() => !window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => !element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    await page.locator("#map").dispatchEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true });
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => !element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    await page.evaluate(() => window.settleMap());
    const authoredBeforeHide = await page.evaluate(() => {
      const elements = window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements;
      const root = elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared");
      const label = elements.find((element) => element.id === root.boundElements.find((entry) => entry.type === "text").id);
      return { root: { id: root.id, x: root.x, y: root.y, width: root.width, height: root.height, strokeColor: root.strokeColor, backgroundColor: root.backgroundColor, roughness: root.roughness, groupIds: root.groupIds }, label: { id: label.id, x: label.x, y: label.y, text: label.text } };
    });

    await page.locator("#map").dispatchEvent("keydown", { key: "x" });
    await page.waitForFunction(() => {
      const elements = window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements;
      const root = elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared");
      const label = elements.find((element) => element.id === root.boundElements.find((entry) => entry.type === "text").id);
      return root.isDeleted && label.isDeleted;
    });
    await page.evaluate(() => window.settleMap());
    await page.locator("#map").dispatchEvent("keydown", { key: "z", ctrlKey: true });
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => !element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    await page.locator("#map").dispatchEvent("keydown", { key: "x" });
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    await page.evaluate(() => window.settleMap());

    await resourcesButton.click();
    await page.getByRole("heading", { name: "Map resources · Otto" }).waitFor();
    await page.getByRole("button", { name: "Restore on Map" }).click();
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => !element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));
    const authoredAfterRestore = await page.evaluate(() => {
      const elements = window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements;
      const root = elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared");
      const label = elements.find((element) => element.id === root.boundElements.find((entry) => entry.type === "text").id);
      return { root: { id: root.id, x: root.x, y: root.y, width: root.width, height: root.height, strokeColor: root.strokeColor, backgroundColor: root.backgroundColor, roughness: root.roughness, groupIds: root.groupIds }, label: { id: label.id, x: label.x, y: label.y, text: label.text } };
    });
    assert.deepEqual(authoredAfterRestore, authoredBeforeHide, "Hide → Restore preserves source IDs, style, position, and bound label");
    await page.locator("#map").dispatchEvent("keydown", { key: "z", ctrlKey: true });
    await page.waitForFunction(() => window.editor.controller().world().areas.find((node) => node.key === "otto").shard.scene.elements.some((element) => element.isDeleted && element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "repo-shared"));

    await resourcesButton.click();
    await page.getByRole("heading", { name: "Map resources · Otto" }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains("tangent-map-resources-button"));
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), false);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
