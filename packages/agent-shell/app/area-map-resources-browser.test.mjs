import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core"), "utf8");
const exactWorktree = "/private/tmp/tangent-map-resource-fixture/main-checkout";

/** Returns only axe findings that block the accepted serious/critical proof floor. */
async function seriousAccessibilityViolations(page, within = null) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (selector) => {
    const result = await window.axe.run(selector ? document.querySelector(selector) : document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes[0]?.html ?? ""}`);
  }, within);
}

/** Waits for the frame after React commits, so a geometry assertion never reads the layout of the state before it. */
async function settled(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Reports where one Map dialog sits against the retained Resources panel: whether it starts inside the Map, whether it ends before the panel starts, and whether its own centre answers for it. A dialog that fails any of the three is one a person cannot see or read. */
async function dialogAgainstPanel(page, selector) {
  return page.evaluate((value) => {
    const box = document.querySelector(value).getBoundingClientRect();
    const panel = document.querySelector(".tangent-map-resources").getBoundingClientRect();
    const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { onScreen: box.left >= 0, clearOfPanel: box.right <= panel.left, underPanel: Boolean(middle?.closest(".tangent-map-resources")) };
  }, selector);
}

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Map resources fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#app,#screen,.split-workspace,[data-split-pane="map"],#map{width:100%;height:100%;margin:0;overflow:hidden}.split-workspace,[data-split-pane="map"]{position:relative}#global-controls,#pre-inert,#brain-pane,#splitter{position:absolute;left:-9999px}</style></head><body><div id="app"><header id="global-controls"><button>Global route</button></header><aside id="pre-inert" inert>Already inert</aside><main id="screen"><div class="split-workspace"><section id="brain-pane" data-split-pane="brain"><button>Brain control</button></section><div id="splitter" role="separator"></div><section data-split-pane="map"><div id="map"></div></section></div></main></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const parentScene = empty();
const childScene = empty();
childScene.elements.push(...core.createBlockElements({ id: "main-resource", kind: "resource", ref: "worktree-main", title: "stale cached title", status: "", x: 160, y: 160, width: 240, height: 110 }));
childScene.elements.push(...core.createBlockElements({ id: "review-resource", kind: "resource", ref: "review-42", title: "stale review title", status: "", x: 460, y: 160, width: 240, height: 110 }));
childScene.elements.push(...core.createBlockElements({ id: "gone-resource", kind: "resource", ref: "gone-old", title: "removed cached title", status: "", x: 160, y: 340, width: 240, height: 110 }));
childScene.elements.push(...core.createBlockElements({ id: "generic-link", kind: "link", ref: "https://example.com/review/17", title: "Review 17", status: "", x: 460, y: 340, width: 240, height: 110 }));
const world = {
  schema: "area-map-world.v1", worldId: "resource-browser-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent", "otto/side"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: parentScene } },
    { key: "otto/tangent", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 100, y: 100, width: 760, height: 520 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: childScene.elements.length, blockCount: 4, scene: childScene } },
    { key: "otto/side", parent: "otto", children: [], depth: 1, region: { key: "otto>otto/side", owner: "otto", child: "otto/side", sourceId: "region-side", labelSourceId: "label-side", source: "stored", storedRect: { x: 900, y: 100, width: 240, height: 300 } }, shard: { owner: "otto/side", hash: "side-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
  { kind: "area", area: "otto/side", file: "otto/side/side.md", title: "Side", status: "active" },
];
const main = {
  locator: { owner: "otto/tangent", id: "worktree-main" }, label: "Main checkout", target: { kind: "worktree", path: ${JSON.stringify(exactWorktree)} },
  local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/map-entities-first-class" }, repositoryPath: ${JSON.stringify(exactWorktree)} }, checkedAt: "2026-09-02T01:00:00.000Z" },
  link: null, representation: { state: "current", value: "on-map" }, origin: { kind: "legacy-area-binding", field: "Worktree", evidenceHash: "legacy-main", declaredBranch: "legacy/main" }, warnings: [],
};
const inherited = {
  locator: { owner: "otto", id: "repo-shared" }, label: "Shared repository", target: { kind: "repository", path: "/private/tmp/tangent-map-resource-fixture/shared" },
  local: { state: "not-checked", value: null, checkedAt: null }, link: null, representation: { state: "current", value: "never-placed" }, origin: null, warnings: [],
};
const review = {
  locator: { owner: "otto/tangent", id: "review-42" }, label: "Map entities review", target: { kind: "link", url: "https://github.com/otto/tangent/pull/42" }, local: null,
  link: { kind: "github-pr", owner: "otto", repository: "tangent", number: 42, lifecycle: { state: "current", value: { stateLabel: "Merged", treatment: "success", providerUpdatedAt: "2026-09-02T00:00:00.000Z" } } },
  representation: { state: "current", value: "on-map" }, origin: null, warnings: [],
};
const wrongKind = {
  locator: { owner: "otto/tangent", id: "wrong-kind" }, label: "Checkout-shaped repository", target: { kind: "worktree", path: "/private/tmp/tangent-map-resource-fixture/not-a-worktree" },
  local: { state: "current", value: { state: "not-a-worktree", checkout: null, repositoryPath: null }, checkedAt: "2026-09-02T01:00:00.000Z" },
  link: null, representation: { state: "current", value: "never-placed" }, origin: null, warnings: [],
};
const gone = {
  locator: { owner: "otto/tangent", id: "gone-old" }, reason: "removed",
  lastKnown: { label: "Removed checkout", target: { kind: "worktree", path: "/private/tmp/tangent-map-resource-fixture/removed" } },
  representation: { state: "current", value: "on-map" }, warnings: [],
};
const projection = {
  state: "current", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "cat-child" }, { owner: "otto", revision: "cat-parent" }],
  counts: { state: "current", confirmedAssociations: 4, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [],
  rows: [
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: main },
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: review },
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: wrongKind },
    { viewedFrom: "otto/tangent", relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: gone },
    { viewedFrom: "otto/tangent", relation: { kind: "inherited", sourceArea: "otto" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: inherited },
  ],
};
const byKey = new Map([["otto/tangent\u0000worktree-main", main], ["otto/tangent\u0000review-42", review], ["otto/tangent\u0000wrong-kind", wrongKind], ["otto/tangent\u0000gone-old", gone], ["otto\u0000repo-shared", inherited]]);
window.mainDirty = false; window.mainMissing = false; window.apiCalls = []; window.copied = []; window.worldChanges = []; window.resourceLabel = ""; window.reviewLifecycle = ""; window.clipboardFails = false; window.loseNextSceneResponse = false; window.failNextCatalogMutation = false; window.failNextPanelRead = false; window.holdNextPanelRead = false; window.holdNextRefresh = false; window.panelOverride = null; window.sceneReceipts = new Map();
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { if (window.clipboardFails) throw new DOMException("Denied", "NotAllowedError"); window.copied.push(value); } } });
const currentEntity = (entity) => {
  const value = structuredClone(entity);
  if (value?.locator?.id === "worktree-main" && window.resourceLabel) value.label = window.resourceLabel;
  if (value?.locator?.id === "worktree-main" && window.mainDirty) value.local.value.dirty = true;
  if (value?.locator?.id === "worktree-main" && window.mainMissing) value.local.value = { state: "missing" };
  if (value?.locator?.id === "review-42" && window.reviewLifecycle) value.link.lifecycle.value.stateLabel = window.reviewLifecycle;
  return value;
};
const currentProjection = () => {
  const value = structuredClone(projection);
  for (const row of value.rows) row.entity = currentEntity(row.entity);
  return value;
};
const updateSource = (owner, sourceElementId, tangent, hash) => {
  const node = window.editor.controller().world().areas.find((entry) => entry.key === owner);
  const scene = structuredClone(node.shard.scene);
  const root = scene.elements.find((element) => element.id === sourceElementId);
  if (!root) throw new Error("Missing fixture source " + sourceElementId);
  root.customData = { ...(root.customData ?? {}), tangent: structuredClone(tangent) };
  return { owner, hash, serializedSource: JSON.stringify(scene), treeRevision: "tree-" + hash, worldRevision: "world-" + hash };
};
const replaceProjectionEntity = (previousId, entity) => {
  const row = projection.rows.find((candidate) => candidate.entity?.locator?.owner === entity.locator.owner && candidate.entity?.locator?.id === previousId);
  if (row) row.entity = entity;
  else projection.rows.unshift({ viewedFrom: entity.locator.owner, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity });
  byKey.delete(entity.locator.owner + "\u0000" + previousId);
  byKey.set(entity.locator.owner + "\u0000" + entity.locator.id, entity);
};
const mapKindsVariant = new URL(location.href).searchParams.get("mapKinds") ?? "";
/** Builds one small drawing in the normal form the catalog serves. */
const iconDrawing = (name, colour) => ({
  name, width: 100, height: 80, elementCount: 1, warning: null,
  elements: [{ id: name + "-shape", type: "rectangle", x: 0, y: 0, width: 100, height: 80, angle: 0, opacity: 100, strokeWidth: 2, roughness: 1, strokeColor: colour, backgroundColor: "transparent", fillStyle: "solid", strokeStyle: "solid", seed: 11, versionNonce: 12, groupIds: [], frameId: null, roundness: null, boundElements: null, isDeleted: false, locked: false, link: null, updated: 1, version: 1, index: null }],
});
/** Builds the Map kinds catalog this fixture serves for the requested variant. */
const mapKindsCatalog = () => (mapKindsVariant ? {
  revision: "kinds-" + mapKindsVariant, source: "vault", problems: [],
  kinds: [
    { id: "worktree", label: "Worktree", target: "path", provider: null, builtIn: true, icon: "worktree", icons: [{ when: "missing", icon: "worktree-missing" }, { when: "dirty", icon: "worktree-dirty" }], click: "copy-path", problems: [] },
    { id: "github-pr", label: "GitHub PR", target: "url", provider: "github-pr", builtIn: true, icon: "pull-request", icons: [{ when: "success", icon: "pull-request-merged" }, { when: "muted", icon: "pull-request-closed" }], click: "open", problems: [] },
  ],
  icons: {
    worktree: iconDrawing("worktree", "#1e1e1e"), "worktree-dirty": iconDrawing("worktree-dirty", "#1e1e1e"), "worktree-missing": iconDrawing("worktree-missing", "#1e1e1e"),
    "pull-request": iconDrawing("pull-request", "#1e1e1e"), "pull-request-merged": iconDrawing("pull-request-merged", "#9c36b5"), "pull-request-closed": iconDrawing("pull-request-closed", "#868e96"),
  },
} : { revision: "no-kinds", source: "vault", kinds: [], icons: {}, problems: [] });
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null; window.apiCalls.push({ url, body });
  if (url.startsWith("/api/areas/map-resources?")) {
    if (window.failNextPanelRead) { window.failNextPanelRead = false; throw new Error("Injected panel read failure"); }
    if (window.panelOverride) return structuredClone(window.panelOverride);
    if (window.holdNextPanelRead) {
      window.holdNextPanelRead = false;
      const held = currentProjection();
      await new Promise((resolve) => { window.releasePanelRead = resolve; });
      window.releasePanelRead = null;
      return held;
    }
    return currentProjection();
  }
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") {
    if (url.endsWith("/refresh") && window.holdNextRefresh) {
      window.holdNextRefresh = false;
      await new Promise((resolve) => { window.releaseRefresh = resolve; });
      window.releaseRefresh = null;
    }
    return { resolutions: body.resources.map((locator) => { const value = currentEntity(byKey.get(locator.owner + "\u0000" + locator.id)); return { state: value?.reason ? "gone" : "current", value }; }) };
  }
  if (url === "/api/areas/map-resources/inspect-target") return body.kind === "link"
    ? { kind: "link", normalized: { kind: "link", url: body.url }, state: "available" }
    : { kind: "local", normalized: { kind: body.kind, path: body.path }, state: "available", targetFingerprint: "fixture-target" };
  if (url === "/api/areas/map-resources/discover") return {
    state: "partial", area: body.area, suggestions: [], limits: { attempts: 20, days: 30, concurrency: 4 },
    sources: [{ source: { kind: "repository", resource: inherited.locator }, state: "error", suggestions: [], diagnostics: [{ code: "repository-inspection-failed", message: "Could not inspect the recorded repository.", retryable: true }] }],
    problems: [{ source: { kind: "repository", resource: inherited.locator }, code: "repository-inspection-failed", message: "Could not inspect the recorded repository.", retryable: true }],
  };
  if (url === "/api/areas/map-resources/apply") {
    const sceneUndo = body.mutation.kind === "undo" && ["undo-associated", "undo-add-back"].includes(body.mutation.token);
    const sceneCoupled = ["associate-generic-link", "add-back-gone"].includes(body.mutation.kind) || sceneUndo;
    if (sceneCoupled) {
      window.sceneSaveStates ??= [];
      window.sceneSaveStates.push(window.editor.controller().snapshot().save.state);
      const receipt = window.sceneReceipts.get(body.operationId);
      if (receipt) {
        if (JSON.stringify(receipt.request) !== JSON.stringify(body)) throw new Error("Fixture replay changed the retained transaction envelope");
        return { ...structuredClone(receipt.result), idempotent: true };
      }
      const owner = sceneUndo ? "otto/tangent" : body.mutation.kind === "associate-generic-link" ? body.mutation.owner : body.mutation.oldResource.owner;
      const liveHash = window.editor.controller().world().areas.find((entry) => entry.key === owner).shard.hash;
      if (!sceneUndo && (body.expectedScenes?.length !== 1 || body.expectedScenes[0].owner !== owner || body.expectedScenes[0].hash !== liveHash)) throw new Error("Fixture received a stale or broad scene fence");
      if (!sceneUndo && (body.expectedCatalogs?.length !== 1 || body.expectedCatalogs[0].owner !== owner)) throw new Error("Fixture received a stale or broad catalog fence");
      if (sceneUndo) {
        if (body.expectedScenes || body.expectedCatalogs) throw new Error("Semantic Undo must use only its retained server token");
        const restoredGone = structuredClone(gone);
        const sourceUpdates = [updateSource(owner, "gone-resource", { kind: "resource", ref: restoredGone.locator.id }, "scene-undo-add-back")];
        replaceProjectionEntity("gone-restored", restoredGone);
        projection.catalogs[0].revision = "cat-undo-add-back";
        return { status: 200, effect: "undo", operationId: body.operationId, projection: currentProjection(), sourceUpdates, resource: restoredGone, warnings: [], undo: { state: "unavailable" } };
      }
      if (body.mutation.kind === "associate-generic-link") {
        const associated = { locator: { owner, id: "associated-review" }, label: "Review 17", target: { kind: "link", url: "https://example.com/review/17" }, local: null, link: { kind: "generic" }, representation: { state: "current", value: "on-map" }, origin: null, warnings: [] };
        const sourceUpdates = [updateSource(owner, body.mutation.sourceElementId, { kind: "resource", ref: associated.locator.id }, "scene-associated")];
        replaceProjectionEntity("associated-review", associated);
        projection.catalogs[0].revision = "cat-associated";
        const result = { status: 200, effect: body.mutation.kind, operationId: body.operationId, projection: currentProjection(), sourceUpdates, resource: associated, warnings: [], undo: { state: "available", token: "undo-associated" } };
        window.sceneReceipts.set(body.operationId, { request: structuredClone(body), result: structuredClone(result) });
        if (window.loseNextSceneResponse) { window.loseNextSceneResponse = false; throw new Error("Injected lost success response"); }
        return result;
      }
      const restored = { locator: { owner, id: "gone-restored" }, label: gone.lastKnown.label, target: gone.lastKnown.target, local: { state: "not-checked", value: null, checkedAt: null }, link: null, representation: { state: "current", value: "on-map" }, origin: null, warnings: [] };
      const sourceUpdates = [updateSource(owner, "gone-resource", { kind: "resource", ref: restored.locator.id }, "scene-add-back")];
      replaceProjectionEntity("gone-old", restored);
      projection.catalogs[0].revision = "cat-add-back";
      const result = { status: 200, effect: body.mutation.kind, operationId: body.operationId, projection: currentProjection(), sourceUpdates, resource: restored, warnings: [], undo: { state: "available", token: "undo-add-back" } };
      window.sceneReceipts.set(body.operationId, { request: structuredClone(body), result: structuredClone(result) });
      if (window.loseNextSceneResponse) { window.loseNextSceneResponse = false; throw new Error("Injected lost success response"); }
      return result;
    }
    if (window.failNextCatalogMutation) {
      window.failNextCatalogMutation = false;
      projection.catalogs[0].revision = "cat-external";
      const error = new Error("Injected catalog conflict"); error.payload = { code: "catalog-revision-changed", error: error.message, recovery: { code: "catalog-revision-changed", projection: currentProjection() } }; throw error;
    }
    let resource = null;
    if (body.mutation.kind === "edit" && body.mutation.resource.id === "wrong-kind") {
      wrongKind.target = structuredClone(body.mutation.input.target); wrongKind.label = body.mutation.label || wrongKind.label;
      wrongKind.local = { state: "not-checked", value: null, checkedAt: null }; resource = structuredClone(wrongKind);
    }
    return { status: 200, effect: body.mutation.kind, operationId: body.operationId, projection: currentProjection(), sourceUpdates: [], resource, warnings: [], undo: { state: "unavailable" } };
  }
  if (url === "/api/areas/map-kinds") return mapKindsCatalog();
  throw new Error("Unexpected fixture resource route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api: resourceApi, focus: { only: false, activeOnly: false, areas: [] },
  resourceCadenceMs: Number(new URL(location.href).searchParams.get("resourceCadenceMs")) || undefined,
  onWorldChange: async (next, areas, owners) => { const index = window.worldChanges.length + 1; window.worldChanges.push({ next: structuredClone(next), areas: [...areas], owners: [...owners] }); return { status: 200, hashes: Object.fromEntries([...owners].filter((owner) => owner).map((owner) => [owner, "map-save-" + index])), treeRevision: "tree-map-save-" + index, worldRevision: "world-map-save-" + index }; }, onEntityVerb: () => {}, onBack: () => {},
});
window.selectMain = (withLabel = false) => {
  const snapshot = window.editor.controller().snapshot();
  const block = snapshot.composition.scene.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "worktree-main");
  const ids = [block.id];
  if (withLabel) ids.push(block.boundElements[0].id);
  window.editor.controller().setSelection(ids);
  return ids;
};
window.selectGeneric = () => {
  const snapshot = window.editor.controller().snapshot();
  const block = snapshot.composition.scene.elements.find((element) => element.customData?.tangent?.kind === "link" && element.customData.tangent.ref === "https://example.com/review/17");
  window.editor.controller().setSelection([block.id]);
  return block.id;
};
window.selectReview = () => {
  const snapshot = window.editor.controller().snapshot();
  const block = snapshot.composition.scene.elements.find((element) => element.customData?.tangent?.kind === "resource" && element.customData.tangent.ref === "review-42");
  window.editor.controller().setSelection([block.id]);
  return block.id;
};
window.settleMap = async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return window.editor.controller().flush();
};
window.captureExactView = () => {
  const view = window.editor.controller().captureView(); const appState = window.editor.appState();
  return { ...view, camera: { scrollX: Number(appState.scrollX), scrollY: Number(appState.scrollY), zoom: Number(appState.zoom?.value ?? appState.zoom) } };
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
    await page.waitForFunction(() => {
      const elements = window.editor.rendered?.() ?? [];
      const labels = elements.filter((element) => element.type === "text").map((element) => element.text);
      return labels.some((text) => /^WORKTREE\nMain checkout\nmap-entities-first-class$/.test(text))
        && labels.some((text) => /^GITHUB PR  ✓\nMap entities review\notto\/tangent#42 · Merged$/.test(text))
        && elements.some((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-success-rail");
    });
    const projectedFacts = await page.evaluate(() => {
      const rendered = window.editor.rendered();
      const source = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements;
      return {
        labels: rendered.filter((element) => element.type === "text").map((element) => element.text),
        rail: rendered.find((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-success-rail")?.customData,
        sourceLabels: source.filter((element) => element.type === "text").map((element) => element.text),
        sourceHasRail: source.some((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-success-rail"),
      };
    });
    assert.ok(projectedFacts.labels.includes("WORKTREE\nMain checkout\nmap-entities-first-class"), "resolved worktree facts replace stale cached words in the rendered shared Block");
    assert.ok(projectedFacts.labels.includes("GITHUB PR  ✓\nMap entities review\notto/tangent#42 · Merged"), "provider kind, label, target clue, state, and non-color success mark render together");
    assert.equal(projectedFacts.rail.tangentWorld.owner, "otto/tangent");
    assert.equal(projectedFacts.sourceHasRail, false, "the success rail remains a render-only fact projection");
    assert.ok(projectedFacts.sourceLabels.some((text) => text.includes("stale cached title")), "fact refresh never rewrites source scene words");

    await page.evaluate(() => window.selectMain(false));
    await page.getByRole("button", { name: /Copy path.*Main checkout/ }).waitFor();
    await page.waitForFunction(() => {
      const ids = Object.keys(window.editor.appState().selectedElementIds).filter((id) => window.editor.appState().selectedElementIds[id]);
      return ids.length === 1 && window.editor.rendered().find((element) => element.id === ids[0])?.customData?.tangent?.ref === "worktree-main";
    });
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.waitForFunction(() => window.copied.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copied), [exactWorktree]);
    await page.getByRole("status").filter({ hasText: "Copied Main checkout path." }).waitFor();

    await page.evaluate(() => window.selectMain(true));
    await page.waitForFunction(() => Object.keys(window.editor.appState().selectedElementIds).filter((id) => window.editor.appState().selectedElementIds[id]).length === 2);
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.copied.length), 1, "a Block plus its label has no semantic action");
    assert.equal(await page.getByRole("button", { name: /Copy path.*Main checkout/ }).count(), 0, "multiple selection has no visible primary action");

    await page.evaluate(() => window.selectMain(false));
    await page.getByRole("button", { name: /Copy path.*Main checkout/ }).waitFor();
    await page.waitForFunction(() => {
      const ids = Object.keys(window.editor.appState().selectedElementIds).filter((id) => window.editor.appState().selectedElementIds[id]);
      return ids.length === 1 && window.editor.rendered().find((element) => element.id === ids[0])?.customData?.tangent?.ref === "worktree-main";
    });
    const blockDoubleClickHandled = await page.evaluate(() => {
      const block = window.editor.rendered().find((element) => element.customData?.tangent?.ref === "worktree-main");
      const appState = window.editor.appState(); const zoom = Number(appState.zoom?.value ?? 1) || 1;
      const canvas = document.querySelector(".excalidraw canvas.interactive"); const rect = canvas.getBoundingClientRect();
      const clientX = Number(appState.offsetLeft ?? rect.left) + (block.x + block.width / 2 + Number(appState.scrollX ?? 0)) * zoom;
      const clientY = Number(appState.offsetTop ?? rect.top) + (block.y + block.height / 2 + Number(appState.scrollY ?? 0)) * zoom;
      const event = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, detail: 2 }); canvas.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(blockDoubleClickHandled, true, "a double click on the exact selected Block is claimed by semantic dispatch");
    await page.waitForFunction(() => window.copied.length === 2);
    assert.equal(await page.evaluate(() => window.copied.at(-1)), exactWorktree);
    const emptyDoubleClickHandled = await page.evaluate(() => {
      const block = window.editor.rendered().find((element) => element.customData?.tangent?.ref === "worktree-main");
      const appState = window.editor.appState(); const zoom = Number(appState.zoom?.value ?? 1) || 1;
      const canvas = document.querySelector(".excalidraw canvas.interactive"); const rect = canvas.getBoundingClientRect();
      const clientX = Number(appState.offsetLeft ?? rect.left) + (block.x + block.width + 200 + Number(appState.scrollX ?? 0)) * zoom;
      const clientY = Number(appState.offsetTop ?? rect.top) + (block.y + block.height + 200 + Number(appState.scrollY ?? 0)) * zoom;
      const event = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, detail: 2 }); canvas.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(emptyDoubleClickHandled, false, "empty-canvas double click remains available to Excalidraw");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.copied.length), 2, "double-clicking elsewhere never dispatches the selected Block");
    if (await page.locator('textarea[data-type="wysiwyg"]').count()) await page.keyboard.press("Escape");

    const resourcesButton = page.getByRole("button", { name: "Resources", exact: true });
    await resourcesButton.click();
    const heading = page.getByRole("heading", { name: "Map resources · Tangent" });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "tangent-map-resources-title");
    assert.equal(await resourcesButton.isVisible(), true, "the narrow toolbar keeps Resources named");
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), true, "the retained canvas is inert under the sheet");
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), true, "the retained Brain pane is inert under the narrow sheet");
    assert.equal(await page.locator("#global-controls").evaluate((element) => element.inert), true, "global route controls are inert under the narrow sheet");
    assert.equal(await page.locator("#pre-inert").evaluate((element) => element.inert), true, "pre-existing inert state stays inert under the narrow sheet");
    await page.getByText("Direct", { exact: true }).first().waitFor();
    await page.getByText("From otto", { exact: true }).waitFor();
    await page.getByText(exactWorktree, { exact: true }).waitFor();
    const sheetBox = await page.locator(".tangent-map-resources").boundingBox();
    assert.ok(sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 800, `sheet stays inside 800px: ${JSON.stringify(sheetBox)}`);
    for (const expected of [
      { label: "Main checkout", tokens: ["Worktree", "Main checkout", "Current", "otto/tangent", exactWorktree] },
      { label: "Map entities review", tokens: ["GitHub PR", "Map entities review", "Merged", "otto/tangent", "https://github.com/otto/tangent/pull/42"] },
      { label: "Checkout-shaped repository", tokens: ["Worktree", "Checkout-shaped repository", "Not a worktree", "otto/tangent", "/private/tmp/tangent-map-resource-fixture/not-a-worktree"] },
      { label: "Removed checkout", tokens: ["Worktree", "Removed checkout", "gone", "otto/tangent", "/private/tmp/tangent-map-resource-fixture/removed"] },
      { label: "Shared repository", tokens: ["Repository", "Shared repository", "Not checked", "otto", "/private/tmp/tangent-map-resource-fixture/shared"] },
    ]) {
      const row = page.locator(".tangent-map-resource-row").filter({ hasText: expected.label });
      const names = [await row.getAttribute("aria-label"), ...await row.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))];
      assert.ok(names.length > 1);
      for (const name of names) for (const token of expected.tokens) assert.ok(name?.includes(token), `${expected.label} accessible name contains ${token}: ${name}`);
    }
    assert.deepEqual(await seriousAccessibilityViolations(page), [], "the 800px Resources sheet has no serious or critical axe finding");

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => { window.failNextPanelRead = true; });
    await resourcesButton.click();
    await page.getByText("Could not refresh Map resources · Last known.", { exact: true }).waitFor();
    const staleMainRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Main checkout" });
    assert.equal(await staleMainRow.getByRole("button", { name: "Copy path" }).isEnabled(), true, "a retained exact target remains copyable through Last known transport");
    assert.equal(await staleMainRow.getByRole("button", { name: "Remove from Area" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Add Worktree", exact: true }).isDisabled(), true);
    assert.equal(await page.locator(".tangent-map-resource-row").filter({ hasText: "Shared repository" }).getByRole("button", { name: "Place in otto" }).isDisabled(), true, "stale transport cannot start placement");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".tangent-map-resource-problem") && [...document.querySelectorAll("button")].some((button) => button.textContent === "Add Worktree" && !button.disabled));

    const tangentBreadcrumb = page.getByRole("navigation", { name: "Resource Area breadcrumb" }).getByRole("button", { name: "Tangent", exact: true });
    await page.evaluate(() => { window.holdNextPanelRead = true; });
    await tangentBreadcrumb.click();
    await page.waitForFunction(() => typeof window.releasePanelRead === "function");
    await page.evaluate(() => { window.resourceLabel = "Newest projection"; });
    await tangentBreadcrumb.click();
    await page.getByText("Newest projection", { exact: true }).waitFor();
    await page.evaluate(() => window.releasePanelRead());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText("Newest projection", { exact: true }).count(), 1, "a slow older inventory response cannot overwrite the newer current Area projection");
    assert.equal(await page.getByRole("button", { name: "Add Worktree", exact: true }).isEnabled(), true, "the stale response cannot downgrade current transport authority");
    await page.evaluate(() => { window.resourceLabel = ""; });
    await tangentBreadcrumb.click();
    await page.getByText("Main checkout", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => { window.panelOverride = { state: "partial", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "partial" }], counts: { state: "lower-bound", confirmedAssociationsAtLeast: 0, suggestionsAtLeast: 0, legacyReviewAtLeast: 0 }, rows: [], suggestions: [], legacyReview: [], problems: [{ code: "resource-source-load-failed", message: "Source unavailable" }] }; });
    await resourcesButton.click();
    await page.getByText("Some source facts are unavailable. Counts are lower bounds; Copy and Open remain available.", { exact: true }).waitFor();
    assert.equal(await page.getByText("No confirmed Map resources in this Area yet.", { exact: true }).count(), 0, "a partial lower bound never claims exact emptiness");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => { window.panelOverride = { state: "current", viewedFrom: "otto/tangent", catalogs: [{ owner: "otto/tangent", revision: "legacy" }], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 1 }, rows: [], suggestions: [], legacyReview: [{ state: "problem", owner: "otto/tangent", field: "Worktree", message: "Review the retained legacy binding" }] }; });
    await resourcesButton.click();
    await page.getByRole("heading", { name: "Legacy resources to review" }).waitFor();
    assert.equal(await page.getByText("No confirmed Map resources in this Area yet.", { exact: true }).count(), 0, "pending legacy review suppresses the false-empty claim");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => { window.panelOverride = null; });
    await resourcesButton.click();
    await page.getByText("Main checkout", { exact: true }).waitFor();
    const mainRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Main checkout" });
    await mainRow.getByRole("button", { name: "Details" }).click();
    const mainDetails = page.locator(".tangent-map-resource-details");
    await mainDetails.getByRole("heading", { name: "Main checkout" }).waitFor();
    for (const value of ["map-entities-first-class", "2026-09-02T01:00:00.000Z", "No", "Worktree · Branch legacy/main"]) await mainDetails.getByText(value, { exact: true }).waitFor();
    assert.equal(await mainDetails.getByRole("textbox").inputValue(), exactWorktree);
    await mainDetails.locator("code").filter({ hasText: exactWorktree }).waitFor();
    await mainDetails.getByRole("button", { name: "Back to resources" }).click();
    const reviewRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Map entities review" });
    await reviewRow.getByRole("button", { name: "Details" }).click();
    const reviewDetails = page.locator(".tangent-map-resource-details");
    await reviewDetails.getByText("2026-09-02T00:00:00.000Z", { exact: true }).waitFor();
    await reviewDetails.getByRole("button", { name: "Back to resources" }).click();
    await page.evaluate(() => { window.selectReview(); window.reviewLifecycle = "Closed"; window.holdNextRefresh = true; });
    await reviewRow.getByRole("button", { name: "Refresh status" }).click();
    const checkingButton = reviewRow.getByRole("button", { name: /^Checking\./ });
    await checkingButton.waitFor();
    assert.equal(await checkingButton.isDisabled(), true, "an in-flight observation cannot be checked twice");
    const checkingLabels = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return (window.editor.rendered?.() ?? []).filter((element) => element.type === "text").map((element) => element.text);
    });
    assert.ok(checkingLabels.some((text) => /Map entities review\notto\/tangent#42 · Merged\nChecking$/.test(text)), `the canonical Block publishes Checking: ${JSON.stringify(checkingLabels)}`);
    await page.evaluate(() => window.releaseRefresh());
    await reviewRow.getByText("Closed", { exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "Map entities review is now Closed." }).waitFor();
    await page.getByRole("button", { name: "Discover worktrees" }).click();
    const discovery = page.getByRole("region", { name: "Worktree discovery results" });
    await discovery.getByRole("heading", { name: "Discovery sources" }).waitFor();
    await discovery.getByText("Shared repository", { exact: true }).waitFor();
    assert.ok(await discovery.getByText("Could not inspect the recorded repository.", { exact: true }).count() >= 1, "all-settled discovery keeps its named source problem");
    await discovery.getByRole("button", { name: "Copy repository path" }).click();
    await page.waitForFunction(() => window.copied.includes("/private/tmp/tangent-map-resource-fixture/shared"));
    const baseline = await page.evaluate(async () => {
      const controller = window.editor.controller();
      controller.navigateArea("otto/side", { push: false, select: false });
      if (!controller.snapshot().manualFolded.has("otto")) controller.toggleFold("otto");
      controller.setRestriction("otto/side");
      controller.setFocus({ only: true, activeOnly: false, areas: ["otto/side"] });
      controller.selectArea("otto/side");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { view: window.captureExactView(), focus: controller.snapshot().focus, manualFolded: [...controller.snapshot().manualFolded].sort() };
    });
    await mainRow.getByRole("button", { name: "Show on Map" }).click();
    await page.waitForFunction(() => {
      const state = window.editor.controller().snapshot();
      const selected = state.composition.scene.elements.find((element) => state.selection.has(element.id));
      return state.restrictionArea === null && !state.manualFolded.has("otto") && !state.focus.only && selected?.customData?.tangent?.ref === "worktree-main";
    });
    assert.equal(await heading.count(), 0, "Show closes the narrow Resources sheet");
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.contains(document.activeElement)), true, "Show transfers focus to the selected Map Block surface");
    await page.locator("#map").dispatchEvent("keydown", { key: "Escape" });
    await heading.waitFor();
    await page.waitForFunction(() => document.activeElement?.dataset.resourceShow === encodeURIComponent("otto/tangent/worktree-main"));
    const restored = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const controller = window.editor.controller();
      return { view: window.captureExactView(), focus: controller.snapshot().focus, manualFolded: [...controller.snapshot().manualFolded].sort() };
    });
    assert.deepEqual(restored, baseline, "one Escape restores exact Focus, Only, folds, camera, selection, and Resources opener");
    await page.evaluate(async () => {
      const controller = window.editor.controller();
      controller.setRestriction(null);
      if (controller.snapshot().manualFolded.has("otto")) controller.toggleFold("otto");
      controller.setFocus({ only: false, activeOnly: false, areas: [] });
      controller.navigateArea("otto/tangent", { push: false, select: false });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    await mainRow.getByRole("button", { name: "Remove from Area" }).click();
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
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#global-controls").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#pre-inert").evaluate((element) => element.inert), true, "modal cleanup restores exact prior inert values");

    await page.evaluate(async () => {
      window.clipboardFails = true;
      window.editor.controller().fitArea("otto/tangent", { push: false, select: false });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.selectMain(false);
    });
    await page.getByRole("button", { name: /Copy path.*Main checkout/ }).waitFor();
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.getByRole("dialog", { name: "Copy Main checkout path" }).waitFor();
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), true);
    assert.equal(await page.locator("#global-controls").evaluate((element) => element.inert), true);
    assert.deepEqual(await seriousAccessibilityViolations(page), [], "the copy recovery dialog has no serious or critical axe finding");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".tangent-map-resource-recovery"));
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#global-controls").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#pre-inert").evaluate((element) => element.inert), true);

    const genericBefore = await page.evaluate(() => {
      const root = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "generic-link");
      window.clipboardFails = false;
      window.loseNextSceneResponse = true;
      window.selectGeneric();
      return { hash: window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.hash, geometry: { id: root.id, x: root.x, y: root.y, width: root.width, height: root.height, strokeColor: root.strokeColor, backgroundColor: root.backgroundColor, roughness: root.roughness, groupIds: root.groupIds } };
    });
    const addGeneric = page.getByRole("button", { name: /Add to Area.*Link: example.com/ });
    await addGeneric.waitFor();
    await addGeneric.click();
    const sceneRecovery = page.getByRole("dialog", { name: "Map resource was not saved" });
    await sceneRecovery.waitFor();
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), true, "scene transaction recovery owns the full narrow shell");
    await sceneRecovery.getByRole("button", { name: "Retry same operation" }).click();
    await page.waitForFunction(() => {
      const root = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "generic-link");
      return root?.customData?.tangent?.kind === "resource" && root.customData.tangent.ref === "associated-review" && !document.querySelector(".tangent-map-resource-recovery");
    });
    const associationProof = await page.evaluate(() => {
      const source = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements;
      const root = source.find((element) => element.id === "generic-link");
      const calls = window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/apply" && call.body?.mutation?.kind === "associate-generic-link");
      return { root, calls, saveStates: window.sceneSaveStates };
    });
    assert.equal(associationProof.calls.length, 2, "the lost response is retried exactly once");
    assert.deepEqual(associationProof.calls[1].body, associationProof.calls[0].body, "Retry resends the byte-for-byte-equivalent operation envelope");
    assert.equal(associationProof.calls[0].body.expectedCatalogs.length, 1);
    assert.deepEqual(associationProof.calls[0].body.expectedScenes, [{ owner: "otto/tangent", hash: genericBefore.hash }]);
    assert.ok(associationProof.saveStates.every((value) => value === "saved"), "every scene POST starts only after the canonical controller is saved");
    assert.deepEqual({ id: associationProof.root.id, x: associationProof.root.x, y: associationProof.root.y, width: associationProof.root.width, height: associationProof.root.height, strokeColor: associationProof.root.strokeColor, backgroundColor: associationProof.root.backgroundColor, roughness: associationProof.root.roughness, groupIds: associationProof.root.groupIds }, genericBefore.geometry, "association installs only source semantics and preserves exact Block identity, geometry, and style");

    const laterSave = await page.evaluate(async () => {
      const controller = window.editor.controller();
      const next = controller.world();
      const root = next.areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "generic-link");
      root.x += 19;
      controller.commitWorld(next, { changedOwners: new Set(["otto/tangent"]) }, "later-associated-layout");
      await controller.flush();
      const saved = window.worldChanges.filter((change) => change.owners.includes("otto/tangent")).at(-1);
      const savedRoot = saved.next.areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "generic-link");
      return { ref: savedRoot.customData.tangent.ref, kind: savedRoot.customData.tangent.kind, hash: controller.world().areas.find((node) => node.key === "otto/tangent").shard.hash };
    });
    assert.deepEqual({ kind: laterSave.kind, ref: laterSave.ref }, { kind: "resource", ref: "associated-review" }, "a later canonical Map save cannot restore the stale generic Link ref");

    await resourcesButton.click();
    await page.getByRole("heading", { name: "Map resources · Tangent" }).waitFor();
    const goneRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Removed checkout" });
    const goneBefore = await page.evaluate(() => {
      const root = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      return { id: root.id, x: root.x, y: root.y, width: root.width, height: root.height, strokeColor: root.strokeColor, backgroundColor: root.backgroundColor, roughness: root.roughness, groupIds: root.groupIds };
    });
    await goneRow.getByRole("button", { name: "Add back to Area" }).click();
    const addBackDialog = page.getByRole("dialog", { name: "Add Removed checkout back to Area?" });
    await addBackDialog.waitFor();
    assert.equal(await addBackDialog.getByRole("textbox", { name: "Exact Last-known target" }).inputValue(), "/private/tmp/tangent-map-resource-fixture/removed");
    assert.deepEqual(await seriousAccessibilityViolations(page), [], "Add-back confirmation has no serious or critical axe finding");
    await addBackDialog.getByRole("button", { name: "Confirm add back" }).click();
    await page.waitForFunction(() => {
      const root = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      return root?.customData?.tangent?.ref === "gone-restored" && !document.querySelector(".tangent-map-resource-recovery");
    });
    const addBackProof = await page.evaluate(() => {
      const controller = window.editor.controller();
      const root = controller.world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      const call = window.apiCalls.find((entry) => entry.url === "/api/areas/map-resources/apply" && entry.body?.mutation?.kind === "add-back-gone");
      return { root, call };
    });
    assert.deepEqual(addBackProof.call.body.mutation, { kind: "add-back-gone", oldResource: { owner: "otto/tangent", id: "gone-old" }, source: { kind: "tombstone" } });
    assert.deepEqual(addBackProof.call.body.expectedScenes, [{ owner: "otto/tangent", hash: laterSave.hash }]);
    assert.deepEqual({ id: addBackProof.root.id, x: addBackProof.root.x, y: addBackProof.root.y, width: addBackProof.root.width, height: addBackProof.root.height, strokeColor: addBackProof.root.strokeColor, backgroundColor: addBackProof.root.backgroundColor, roughness: addBackProof.root.roughness, groupIds: addBackProof.root.groupIds }, goneBefore, "Add back replaces only the stale ID and keeps authored Block identity, geometry, and style");

    await page.locator(".tangent-map-resource-undo").getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(() => {
      const root = window.editor.controller().world().areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      return root?.customData?.tangent?.ref === "gone-old";
    });
    const sceneUndoProof = await page.evaluate(async () => {
      const controller = window.editor.controller();
      const call = window.apiCalls.find((entry) => entry.url === "/api/areas/map-resources/apply" && entry.body?.mutation?.kind === "undo" && entry.body.mutation.token === "undo-add-back");
      const next = controller.world();
      const root = next.areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      root.x += 7;
      controller.commitWorld(next, { changedOwners: new Set(["otto/tangent"]) }, "later-undone-layout");
      await controller.flush();
      const saved = window.worldChanges.filter((change) => change.owners.includes("otto/tangent")).at(-1);
      const savedRoot = saved.next.areas.find((node) => node.key === "otto/tangent").shard.scene.elements.find((element) => element.id === "gone-resource");
      return { call, savedRef: savedRoot.customData.tangent.ref, saveStates: window.sceneSaveStates };
    });
    assert.deepEqual(sceneUndoProof.call.body.mutation, { kind: "undo", token: "undo-add-back" });
    assert.equal(sceneUndoProof.call.body.expectedScenes, undefined, "semantic Undo uses the retained server token, not a rebuilt scene envelope");
    assert.equal(sceneUndoProof.call.body.expectedCatalogs, undefined);
    assert.equal(sceneUndoProof.savedRef, "gone-old", "a later canonical Map save preserves the installed semantic Undo source update");
    assert.ok(sceneUndoProof.saveStates.every((value) => value === "saved"), "semantic Undo also waits for the canonical Map save boundary");

    const wrongKindRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Checkout-shaped repository" });
    await wrongKindRow.getByRole("button", { name: "Change to Repository" }).click();
    const kindSelect = page.getByLabel("Kind");
    assert.equal(await kindSelect.inputValue(), "repository");
    assert.equal(await kindSelect.isEnabled(), true, "Edit permits an explicit resource-kind correction");
    await page.getByLabel("Label (optional)").fill("Recorded repository");
    await page.evaluate(() => { window.failNextCatalogMutation = true; });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Injected catalog conflict" }).first().waitFor();
    const readsBeforeRecovery = await page.evaluate(() => window.apiCalls.filter((call) => call.url.startsWith("/api/areas/map-resources?")).length);
    await page.getByRole("button", { name: "Reload resources" }).click();
    await page.waitForFunction((before) => window.apiCalls.filter((call) => call.url.startsWith("/api/areas/map-resources?")).length > before && document.querySelector(".tangent-map-resource-editor"), readsBeforeRecovery);
    await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".tangent-map-resource-editor"));
    await page.waitForFunction(() => window.apiCalls.some((call) => call.url === "/api/areas/map-resources/refresh" && call.body?.resources?.some((locator) => locator.id === "wrong-kind")));
    const editCalls = await page.evaluate(() => window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/apply" && call.body?.mutation?.kind === "edit").map((call) => call.body));
    assert.equal(editCalls.length, 2);
    assert.equal(editCalls[0].operationId, editCalls[1].operationId, "a retained Edit draft retries with its original operation ID");
    assert.deepEqual(editCalls[0].expectedCatalogs, [{ owner: "otto/tangent", revision: "cat-undo-add-back" }], "Save keeps the catalog revision captured when the draft opened");
    assert.deepEqual(editCalls[1].expectedCatalogs, [{ owner: "otto/tangent", revision: "cat-external" }], "explicit Reload rebases the retained draft onto reviewed current evidence");
    assert.equal(editCalls[1].mutation.input.target.kind, "repository");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("wide Resources stays a non-modal panel and the resource cadence changes facts without Map authority", { skip: !enabled, timeout: 45_000 }, async () => {
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
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture?resourceCadenceMs=100`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.waitForFunction(() => window.apiCalls.some((call) => call.url === "/api/areas/map-resources/resolve"));

    await page.getByRole("button", { name: "Resources", exact: true }).click();
    const panel = page.getByRole("region", { name: "Map resources · Tangent" });
    await panel.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Map resources · Tangent" }).count(), 0, "wide Resources is not a modal dialog");
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), false);
    assert.equal(await page.locator("#global-controls").evaluate((element) => element.inert), false, "wide inventory leaves retained shell navigation interactive");
    await page.evaluate(() => window.selectMain(false));
    await page.waitForFunction(() => Object.keys(window.editor.appState().selectedElementIds).filter((id) => window.editor.appState().selectedElementIds[id]).length === 1);
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.waitForFunction(() => window.copied.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copied), [exactWorktree], "the open wide panel leaves canvas Enter on the selected worktree");
    await panel.getByRole("heading", { name: "Map resources · Tangent" }).evaluate((heading) => heading.focus());
    await panel.getByRole("heading", { name: "Map resources · Tangent" }).dispatchEvent("keydown", { key: "Enter", bubbles: true });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.copied.length), 1, "Enter typed inside the panel is not a canvas action");
    assert.equal(await panel.count(), 1, "Enter inside the panel keeps it open");
    await page.waitForFunction(() => window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/refresh").length >= 2);
    const beforeCadence = await page.evaluate(() => ({
      world: window.editor.controller().world(),
      view: window.captureExactView(),
      focus: window.editor.controller().snapshot().focus,
      folded: [...window.editor.controller().snapshot().manualFolded].sort(),
      save: window.editor.controller().snapshot().save.state,
      resolveCount: window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/resolve").length,
      panelCount: window.apiCalls.filter((call) => call.url.startsWith("/api/areas/map-resources?")).length,
      refreshCount: window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/refresh").length,
    }));
    await page.evaluate(() => { window.resourceLabel = "Cadence checkout"; });
    await page.waitForFunction(({ resolveCount, panelCount }) => window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/resolve").length > resolveCount
      && window.apiCalls.filter((call) => call.url.startsWith("/api/areas/map-resources?")).length > panelCount, beforeCadence);
    await page.getByText("Cadence checkout", { exact: true }).waitFor();
    await page.waitForFunction(() => (window.editor.rendered?.() ?? []).some((element) => element.type === "text" && element.text === "WORKTREE\nCadence checkout\nmap-entities-first-class"));
    const afterCadence = await page.evaluate(() => ({
      world: window.editor.controller().world(),
      view: window.captureExactView(),
      focus: window.editor.controller().snapshot().focus,
      folded: [...window.editor.controller().snapshot().manualFolded].sort(),
      save: window.editor.controller().snapshot().save.state,
      refreshCount: window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/refresh").length,
    }));
    assert.deepEqual(afterCadence.world, beforeCadence.world);
    assert.deepEqual(afterCadence.view, beforeCadence.view);
    assert.deepEqual(afterCadence.focus, beforeCadence.focus);
    assert.deepEqual(afterCadence.folded, beforeCadence.folded);
    assert.equal(afterCadence.save, beforeCadence.save);
    assert.equal(afterCadence.refreshCount, beforeCadence.refreshCount, "the catalog cadence re-resolves cached facts but never polls providers");

    const mainRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Cadence checkout" });
    const beforeShow = await page.evaluate(() => ({ view: window.captureExactView(), focus: window.editor.controller().snapshot().focus, folded: [...window.editor.controller().snapshot().manualFolded].sort() }));
    await mainRow.getByRole("button", { name: "Show on Map" }).click();
    await page.waitForFunction(() => window.editor.controller().snapshot().selection.size === 1 && !document.querySelector(".tangent-map-resources"));
    assert.deepEqual(await page.evaluate(() => window.editor.escape()), { kind: "resource-locate" }, "the Map Back API removes the same atomic locate layer as Escape");
    await panel.waitFor();
    await page.waitForFunction(() => document.activeElement?.dataset.resourceShow === encodeURIComponent("otto/tangent/worktree-main"));
    const afterShow = await page.evaluate(() => ({ view: window.captureExactView(), focus: window.editor.controller().snapshot().focus, folded: [...window.editor.controller().snapshot().manualFolded].sort() }));
    assert.deepEqual(afterShow, beforeShow, "Back restores the wide panel opener and exact pre-Show view");

    const inheritedRow = page.locator(".tangent-map-resource-row").filter({ hasText: "Shared repository" });
    const beforePlacement = await page.evaluate(() => ({ view: window.captureExactView(), focus: window.editor.controller().snapshot().focus, folded: [...window.editor.controller().snapshot().manualFolded].sort() }));
    await inheritedRow.getByRole("button", { name: "Place in otto" }).click();
    await page.getByRole("status", { name: "Place Shared repository on the Map" }).waitFor();
    await panel.waitFor();
    assert.equal(await page.locator(".excalidraw").evaluate((element) => element.inert), false, "wide placement keeps the mounted Map active beside the panel");
    assert.equal(await page.locator("#brain-pane").evaluate((element) => element.inert), false);
    await page.locator("#map").dispatchEvent("keydown", { key: "Escape" });
    await page.waitForFunction(() => document.activeElement?.dataset.resourcePlace === encodeURIComponent("otto/repo-shared"));
    const afterPlacement = await page.evaluate(() => ({ view: window.captureExactView(), focus: window.editor.controller().snapshot().focus, folded: [...window.editor.controller().snapshot().manualFolded].sort() }));
    assert.deepEqual(afterPlacement, beforePlacement, "cancel restores the wide panel opener and exact placement masks, camera, and selection");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a figure changes its icon with the state, fades when it is gone, and keeps the keyboard", { skip: !enabled, timeout: 60_000 }, async () => {
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
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture?mapKinds=starter&resourceCadenceMs=100`, { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();

    /** Returns the icon name drawn for one resource reference. */
    const iconFor = (ref) => page.evaluate((wanted) => {
      const rendered = window.editor.controller().snapshot().scene.elements;
      const block = rendered.find((element) => element.customData?.tangent?.ref === wanted && !element.isDeleted);
      const icon = rendered.find((element) => element.customData?.tangentWorldEphemeral?.sourceId === block?.id && !element.isDeleted);
      const label = rendered.find((element) => element.id === block?.boundElements?.find((binding) => binding.type === "text")?.id);
      return { icon: icon?.customData?.tangentWorldEphemeral?.icon ?? null, opacity: icon?.opacity ?? null, caption: label?.text ?? "", body: block?.strokeColor ?? null };
    }, ref);

    await page.waitForFunction(() => window.editor.controller().snapshot().scene.elements.some((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-figure-icon"));
    assert.equal((await iconFor("worktree-main")).icon, "worktree");
    assert.equal((await iconFor("review-42")).icon, "pull-request-merged", "a merged review draws the state icon Julian named");
    const goneFigure = await iconFor("gone-old");
    assert.equal(goneFigure.icon, "worktree");
    assert.equal(goneFigure.opacity, 45, "a gone figure fades like a folded Area");
    assert.ok(goneFigure.caption.includes("gone"), `a gone figure still says so: ${goneFigure.caption}`);

    // A changed state changes the drawing on the next cadence, with no restart.
    await page.evaluate(() => { window.mainDirty = true; });
    await page.waitForFunction(() => {
      const rendered = window.editor.controller().snapshot().scene.elements;
      return rendered.some((element) => element.customData?.tangentWorldEphemeral?.icon === "worktree-dirty");
    });
    const dirty = await iconFor("worktree-main");
    assert.ok(dirty.caption.includes("Dirty"), `an uncommitted change reads on the caption: ${dirty.caption}`);
    assert.equal(dirty.body, "transparent", "the figure body stays quiet");

    await page.evaluate(() => { window.mainDirty = false; window.mainMissing = true; });
    await page.waitForFunction(() => window.editor.controller().snapshot().scene.elements.some((element) => element.customData?.tangentWorldEphemeral?.icon === "worktree-missing"));
    assert.ok((await iconFor("worktree-main")).caption.includes("Missing"));

    // The canvas keyboard still runs the verb on the figure.
    await page.evaluate(() => window.selectMain(false));
    await page.waitForFunction(() => Object.values(window.editor.appState().selectedElementIds).filter(Boolean).length === 1);
    await page.locator("#map").dispatchEvent("keydown", { key: "Enter" });
    await page.waitForFunction(() => window.copied.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copied), [exactWorktree], "Enter on a selected figure copies the exact path");

    // A figure is canvas ink; its accessible surface is the Outline, so axe
    // reads the Tangent-owned tree rather than Excalidraw's own chrome.
    await page.locator("#map").dispatchEvent("keydown", { key: "o", metaKey: true, shiftKey: true });
    const outline = page.getByRole("region", { name: "Area hierarchy" });
    await outline.waitFor();
    const rows = await outline.getByRole("treeitem", { name: /^Worktree: / }).count();
    assert.ok(rows >= 1, "every figure keeps an Outline row");
    assert.deepEqual(await seriousAccessibilityViolations(page, ".tangent-map-outline"), [], "the Outline of a Map of figures has no serious accessibility violation");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

// The wide Resources panel is retained beside the canvas rather than over it, so
// the canvas keeps every Map key while it is open. A dialog those keys raise has
// to appear in the Map that stays visible, not behind the opaque panel.
test("the Block picker and the Keys dialog open in the Map that stays visible beside the wide Resources panel", { skip: !enabled, timeout: 45_000 }, async () => {
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
    await page.goto("http://127.0.0.1:" + server.address().port + "/fixture", { waitUntil: "networkidle" });
    await page.locator(".excalidraw canvas.interactive").waitFor();
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.getByRole("region", { name: "Map resources · Tangent" }).waitFor();
    await page.locator(".TangentAreaMap.resources-panel-open").waitFor();

    // The pointer on the left half of the canvas is the dock-right branch, which
    // is the branch that used to put the dialog behind the panel.
    await page.mouse.move(200, 400);
    await page.locator("#map").dispatchEvent("keydown", { key: "b" });
    await page.getByRole("dialog", { name: "Place a Tangent block" }).waitFor();
    await settled(page);
    assert.equal(await page.locator(".tangent-map-dialog-backdrop.dock-right").count(), 1, "a pointer on the left of the canvas still docks the picker right");
    assert.deepEqual(await dialogAgainstPanel(page, ".tangent-map-picker"), { onScreen: true, clearOfPanel: true, underPanel: false }, "B beside the wide panel opens the picker in the Map that stays visible");

    // Escape closes the panel before the dialog, so the picker is closed on the
    // second press and the panel is reopened for the Keys dialog.
    await page.locator("#map").dispatchEvent("keydown", { key: "Escape" });
    await page.locator("#map").dispatchEvent("keydown", { key: "Escape" });
    await page.getByRole("dialog", { name: "Place a Tangent block" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Resources", exact: true }).click();
    await page.locator(".TangentAreaMap.resources-panel-open").waitFor();
    await page.locator("#map").dispatchEvent("keydown", { key: "?" });
    await page.getByRole("dialog", { name: "Map keys" }).waitFor();
    await settled(page);
    assert.deepEqual(await dialogAgainstPanel(page, ".tangent-map-help"), { onScreen: true, clearOfPanel: true, underPanel: false }, "the Keys dialog carries no dock class and still opens beside the panel");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
