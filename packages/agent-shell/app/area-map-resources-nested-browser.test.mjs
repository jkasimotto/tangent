import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";

// This regression covers the Resources panel opened on a nested Area whose Map
// file does not exist yet. Placing a link, worktree, and repository from that
// panel loads the nested Map on demand, a toast raised by the panel stays
// readable beside or above the panel, the Suggestions rows stay bounded, and a
// Suggestion owned by an ancestor Area routes to that Area before it is dismissed.
const enabled = process.env.TANGENT_BROWSER_TEST === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core"), "utf8");
const nestedArea = "otto/tangent/nested";

/** Returns only axe findings inside the Resources panel that block the accepted serious/critical proof floor. Excalidraw's own selected-element islands are outside this proof. */
async function seriousAccessibilityViolations(page) {
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector(".tangent-map-resources"), {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
    });
    return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes[0]?.html ?? ""}`);
  });
}

const fixture = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Nested Map resources fixture</title><link rel="stylesheet" href="/agent-shell-map.css"><style>html,body,#app,#screen,.split-workspace,[data-split-pane="map"],#map{width:100%;height:100%;margin:0;overflow:hidden}.split-workspace,[data-split-pane="map"]{position:relative}</style></head><body><div id="app"><main id="screen"><div class="split-workspace"><section data-split-pane="map"><div id="map"></div></section></div></main></div><script type="module">
import { mountAreaBoardEditor } from "/agent-shell-map.js";
import core from "/area-board-core.js";

const empty = () => core.createEmptyScene();
const nested = ${JSON.stringify(nestedArea)};
const world = {
  schema: "area-map-world.v1", worldId: "nested-resource-world", treeRevision: "tree-1", worldRevision: "world-1", locatedArea: "otto/tangent",
  rootShard: { owner: "@root", hash: "root-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() },
  areas: [
    { key: "otto", parent: "@root", children: ["otto/tangent"], depth: 0, region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 1100, height: 760 } }, shard: { owner: "otto", hash: "otto-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
    { key: "otto/tangent", parent: "otto", children: [nested], depth: 1, region: { key: "otto>otto/tangent", owner: "otto", child: "otto/tangent", sourceId: "region-tangent", labelSourceId: "label-tangent", source: "stored", storedRect: { x: 100, y: 100, width: 760, height: 520 } }, shard: { owner: "otto/tangent", hash: "tangent-1", state: "ready", elementCount: 0, blockCount: 0, scene: empty() } },
    // The nested Area has no Map file yet: the world index reports it missing and, outside the eager set, supplies no scene.
    { key: nested, parent: "otto/tangent", children: [], depth: 2, region: { key: "otto/tangent>" + nested, owner: "otto/tangent", child: nested, sourceId: "region-nested", labelSourceId: "label-nested", source: "stored", storedRect: { x: 140, y: 160, width: 460, height: 340 } }, shard: { owner: nested, hash: null, state: "missing", elementCount: 0, blockCount: 0 } },
  ],
};
const documents = [
  { kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" },
  { kind: "area", area: "otto/tangent", file: "otto/tangent/tangent.md", title: "Tangent", status: "active" },
  { kind: "area", area: nested, file: nested + "/nested.md", title: "Nested", status: "active" },
];
const resource = (id, label, target, local) => ({
  locator: { owner: nested, id }, label, target, local, link: target.kind === "link" ? { kind: "generic" } : null,
  representation: { state: "current", value: "never-placed" }, origin: null, warnings: [],
});
const entities = [
  resource("link-docs", "Nested docs", { kind: "link", url: "https://example.com/nested/docs" }, null),
  resource("wt-feature", "Feature checkout", { kind: "worktree", path: "/private/tmp/tangent-nested-fixture/feature" }, { state: "current", value: { state: "available", checkout: { kind: "branch", head: "abc", branchRef: "refs/heads/feature/nested" }, repositoryPath: "/private/tmp/tangent-nested-fixture/repo" }, checkedAt: "2026-09-03T00:00:00.000Z" }),
  resource("repo-main", "Main repository", { kind: "repository", path: "/private/tmp/tangent-nested-fixture/repo" }, { state: "not-checked", value: null, checkedAt: null }),
];
const inheritedSuggestion = {
  owner: "otto", kind: "link", proposedLabel: "Shared staging", target: { kind: "link", url: "https://example.com/staging/?org=pge#designId:dykJ9uNgp4B7-with-a-long-fragment-that-should-never-wrap-one-character-per-line" },
  evidenceHash: "evidence-staging", targetFingerprint: "fingerprint-staging", evidence: { kind: "note", file: "otto/otto.md" },
  provenanceLabel: "\"Open staging via the localhost 7500 proxy\" means take any staging URL and replace the production host with localhost:7500. Everything else stays the same. Example: the Staging Network Explorer becomes the same URL on the proxy, and this explanation keeps going long enough to need a clamp.",
};
const directSuggestion = {
  owner: nested, kind: "worktree", proposedLabel: "Review checkout", target: { kind: "local-path", path: "/private/tmp/tangent-nested-fixture/review" },
  evidenceHash: "evidence-review", targetFingerprint: "fingerprint-review", evidence: { kind: "attempt", jobSlug: "review-nested" },
  provenanceLabel: "Goal review-nested ran here on 2026-09-02.",
};
const suggestions = { otto: [inheritedSuggestion], [nested]: [inheritedSuggestion, directSuggestion], "otto/tangent": [inheritedSuggestion] };
const catalogs = [{ owner: nested, revision: "cat-nested" }, { owner: "otto/tangent", revision: "cat-tangent" }, { owner: "otto", revision: "cat-otto" }];
const ancestors = (area) => area.split("/").map((_part, index, parts) => parts.slice(0, index + 1).join("/")).reverse();
const projectionFor = (area) => ({
  state: "current", viewedFrom: area, catalogs: catalogs.filter((catalog) => ancestors(area).includes(catalog.owner)),
  counts: { state: "current", confirmedAssociations: area === nested ? entities.length : 0, suggestions: (suggestions[area] ?? []).length, legacyReview: 0 },
  suggestions: structuredClone(suggestions[area] ?? []), legacyReview: [],
  rows: area === nested ? entities.map((entity) => ({ viewedFrom: nested, relation: { kind: "direct" }, alsoFrom: [], launchMatch: { state: "current", value: false }, entity: structuredClone(entity) })) : [],
});
window.apiCalls = []; window.shardLoads = []; window.worldChanges = [];
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null; window.apiCalls.push({ url, body });
  const parsed = new URL(url, "http://fixture.local");
  if (parsed.pathname === "/api/areas/map-shard") {
    window.shardLoads.push(parsed.searchParams.get("area"));
    return { status: 200, area: parsed.searchParams.get("area"), worldRevision: parsed.searchParams.get("worldRevision"), hash: null, revision: null, state: "missing", scene: empty(), errors: [] };
  }
  if (parsed.pathname === "/api/areas/map-world") return structuredClone(world);
  if (parsed.pathname === "/api/areas/map-resources") return projectionFor(parsed.searchParams.get("area"));
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") {
    return { resolutions: body.resources.map((locator) => ({ state: "current", value: structuredClone(entities.find((entity) => entity.locator.id === locator.id && entity.locator.owner === locator.owner) ?? null) })) };
  }
  if (url === "/api/areas/map-resources/apply") {
    if (body.mutation.kind === "dismiss-suggestion") {
      // The real server refuses a Suggestion write viewed from any Area but its owner.
      if (body.mutation.suggestion.owner !== body.viewedFrom) {
        const error = new Error("A resource Suggestion belongs to another Area.");
        error.status = 422; error.payload = { status: 422, code: "inherited-resource-read-only", error: error.message };
        throw error;
      }
      for (const area of Object.keys(suggestions)) suggestions[area] = suggestions[area].filter((item) => item.evidenceHash !== body.mutation.suggestion.evidenceHash);
      return { status: 200, effect: "dismiss-suggestion", operationId: body.operationId, projection: projectionFor(body.viewedFrom), sourceUpdates: [], resource: null, warnings: [], undo: { state: "unavailable" } };
    }
    throw new Error("Unexpected fixture mutation: " + body.mutation.kind);
  }
  throw new Error("Unexpected fixture resource route: " + url);
};
window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world, scene: empty(), getDocuments: () => documents, api: resourceApi, focus: { only: false, activeOnly: false, areas: [] },
  // The shell mounts through area-board.js, which loads deferred shards with the same api client. The fixture mounts the editor directly, so it supplies that loader itself.
  loadShard: (area, context = {}) => resourceApi("/api/areas/map-shard?area=" + encodeURIComponent(area) + "&worldRevision=" + encodeURIComponent(context.worldRevision ?? world.worldRevision) + "&located=" + encodeURIComponent(context.locatedArea ?? world.locatedArea)),
  onWorldChange: async (next, areas, owners) => {
    const index = window.worldChanges.length + 1;
    const placed = next.areas.map((node) => [node.key, (node.shard?.scene?.elements ?? []).filter((element) => element.customData?.tangent?.kind === "resource" && !element.isDeleted).map((element) => element.customData.tangent.ref)]);
    window.worldChanges.push({ areas: [...areas], owners: [...owners], placed: Object.fromEntries(placed) });
    return { status: 200, hashes: Object.fromEntries([...owners].filter(Boolean).map((owner) => [owner, "map-save-" + index])), treeRevision: "tree-map-save-" + index, worldRevision: "world-map-save-" + index };
  },
  onEntityVerb: () => {}, onBack: () => {},
});
window.selectNested = () => {
  const snapshot = window.editor.controller().snapshot();
  const region = snapshot.composition.scene.elements.find((element) => element.customData?.tangent?.role === "area-region" && element.customData.tangent.area === nested);
  window.editor.controller().setSelection([region.id]);
  return region.id;
};
</script></body></html>`;

/** Serves the fixture page and the built shell assets on one loopback port. */
async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture") { response.writeHead(200, { "content-type": "text/html" }); response.end(fixture); return; }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** Opens the fixture Map, selects the nested Area, and opens its Resources panel. */
async function openNestedResources(page) {
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => Boolean(window.editor?.controller?.()));
  await page.evaluate(() => window.selectNested());
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page.getByRole("heading", { name: "Map resources · Nested" }).waitFor();
  await page.locator(".tangent-map-resource-row").filter({ hasText: "Nested docs" }).waitFor();
}

/** Returns the viewport rectangle of one selector, or null when it is absent. */
async function rect(page, selector) {
  return page.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  }, selector);
}

/** Proves the visible toast is fully inside the viewport and nothing covers its centre. */
async function assertToastReadable(page, expectedText) {
  await page.waitForFunction((text) => document.querySelector(".tangent-map-location")?.textContent === text, expectedText);
  const toast = await rect(page, ".tangent-map-location");
  const viewport = page.viewportSize();
  assert.ok(toast.left >= 0 && toast.right <= viewport.width && toast.top >= 0 && toast.bottom <= viewport.height, `the toast stays inside the viewport: ${JSON.stringify(toast)}`);
  const covered = await page.evaluate(() => {
    const element = document.querySelector(".tangent-map-location");
    const box = element.getBoundingClientRect();
    const probes = [[box.left + 4, box.top + box.height / 2], [box.left + box.width / 2, box.top + box.height / 2], [box.right - 4, box.top + box.height / 2]];
    element.style.pointerEvents = "auto";
    try { return probes.map(([x, y]) => document.elementFromPoint(x, y)?.closest(".tangent-map-location") ? null : document.elementFromPoint(x, y)?.className ?? "nothing").filter(Boolean); } finally { element.style.pointerEvents = ""; }
  });
  assert.deepEqual(covered, [], `no Map control covers the toast "${expectedText}"`);
  return toast;
}

test("the wide Resources panel places link, worktree, and repository resources into a nested Area with no Map file, keeps toasts and Suggestions readable, and routes an inherited Suggestion to its owner", { skip: !enabled, timeout: 90_000 }, async () => {
  const server = await startFixtureServer();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", colorScheme: "dark" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await openNestedResources(page);
    assert.equal(await page.locator(".TangentAreaMap.resources-panel-open").count(), 1, "the wide panel marks the Map so toasts centre beside it");
    assert.deepEqual(await page.evaluate(() => window.shardLoads), [], "opening the panel alone never loads the nested Map");

    const panel = await rect(page, ".tangent-map-resources");
    for (const label of ["Nested docs", "Feature checkout", "Main repository"]) {
      const row = page.locator(".tangent-map-resource-row").filter({ hasText: label });
      await row.getByRole("button", { name: new RegExp(`^Place on Map\\. .*${label}`) }).click();
      const bar = page.getByRole("status", { name: `Place ${label} on the Map` });
      await bar.waitFor();
      const barBox = await rect(page, ".tangent-map-resource-placement");
      assert.ok(barBox.right <= panel.left, `the placement bar stays beside the open panel for ${label}: ${JSON.stringify(barBox)} vs panel ${panel.left}`);
      assert.equal(await page.locator(".tangent-map-location").count(), 0, "the placement bar replaces the instruction toast instead of stacking under it");
      await page.keyboard.press("Enter");
      await bar.waitFor({ state: "hidden" });
      const toast = await assertToastReadable(page, `Placed ${label} on the Map.`);
      assert.ok(toast.right <= panel.left, `the toast stays beside the open panel: ${JSON.stringify(toast)} vs panel ${panel.left}`);
      await row.getByRole("button", { name: new RegExp(`^Show on Map\\. .*${label}`) }).waitFor();
    }
    assert.deepEqual(await page.evaluate(() => window.shardLoads), [nestedArea], "the first placement loads the nested Map once and later placements reuse it");
    await page.waitForFunction(() => window.worldChanges.length >= 3);
    const changes = await page.evaluate(() => window.worldChanges);
    assert.deepEqual(changes.at(-1).placed[nestedArea].sort(), ["link-docs", "repo-main", "wt-feature"], "every placement wrote its resource Block into the nested Area's own scene");
    assert.ok(changes.every((change) => change.owners.includes(nestedArea)), "each placement saved the nested owner");

    // Suggestions stay one bounded block each: label and target on one line, provenance clamped, actions below.
    const rows = await page.evaluate(() => [...document.querySelectorAll(".tangent-map-resource-review li")].map((item) => {
      const code = item.querySelector("code");
      return { text: item.textContent, height: item.getBoundingClientRect().height, codeLines: Math.round(code.getBoundingClientRect().height / (parseFloat(getComputedStyle(code).fontSize) * 1.5)), buttons: [...item.querySelectorAll("button")].map((button) => button.textContent) };
    }));
    assert.equal(rows.length, 2, "both the inherited and the direct Suggestion render");
    for (const row of rows) {
      assert.equal(row.codeLines, 1, `the Suggestion target stays on one line: ${row.text.slice(0, 60)}`);
      assert.ok(row.height <= 140, `a Suggestion row stays bounded at ${row.height}px: ${row.text.slice(0, 60)}`);
    }
    assert.equal(await page.evaluate(() => { const panel = document.querySelector(".tangent-map-resources"); return panel.scrollWidth <= panel.clientWidth; }), true, "long Suggestion targets never widen the panel");
    const inheritedRow = rows.find((row) => row.text.includes("Shared staging"));
    assert.ok(inheritedRow.text.includes("From otto"), "an inherited Suggestion names its owning Area");
    assert.deepEqual(inheritedRow.buttons, ["Review in Otto"], "an inherited Suggestion offers the route to its owner instead of a write that the server would refuse");
    assert.deepEqual(rows.find((row) => row.text.includes("Review checkout")).buttons, ["Add to Area", "Dismiss"], "a direct Suggestion keeps its writes");
    assert.deepEqual(await seriousAccessibilityViolations(page), []);

    await page.getByRole("button", { name: "Review Shared staging in otto" }).click();
    await page.getByRole("heading", { name: "Map resources · Otto" }).waitFor();
    await page.getByRole("button", { name: "Dismiss Shared staging" }).click();
    await assertToastReadable(page, "Suggestion dismissed.");
    const dismiss = await page.evaluate(() => window.apiCalls.filter((call) => call.url === "/api/areas/map-resources/apply").map((call) => [call.body.viewedFrom, call.body.mutation.kind, call.body.mutation.suggestion.owner]));
    assert.deepEqual(dismiss, [["otto", "dismiss-suggestion", "otto"]], "the inherited Suggestion is dismissed from its owning Area, so the write is accepted");
    assert.equal(await page.locator(".tangent-map-resource-review").count(), 0, "the dismissed Suggestion leaves the owner's panel");
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the narrow Resources sheet places into the nested Area and shows panel-raised toasts above the open sheet", { skip: !enabled, timeout: 60_000 }, async () => {
  const server = await startFixtureServer();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(), headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 720 }, reducedMotion: "reduce", colorScheme: "dark" });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`, { waitUntil: "networkidle" });
    await openNestedResources(page);
    assert.equal(await page.locator(".tangent-map-resources[role='dialog']").count(), 1, "800px opens the modal sheet");

    // A write from inside the open sheet: the toast must sit above the modal, not behind it.
    const direct = page.locator(".tangent-map-resource-review li").filter({ hasText: "Review checkout" });
    await direct.getByRole("button", { name: "Dismiss Review checkout" }).click();
    await assertToastReadable(page, "Suggestion dismissed.");
    assert.equal(await page.locator(".tangent-map-resources[role='dialog']").count(), 1, "the sheet stays open while the toast shows");

    // The sheet closes for placement, and the commit toast is readable on the Map.
    const row = page.locator(".tangent-map-resource-row").filter({ hasText: "Feature checkout" });
    await row.getByRole("button", { name: /^Place on Map\. .*Feature checkout/ }).click();
    const bar = page.getByRole("status", { name: "Place Feature checkout on the Map" });
    await bar.waitFor();
    await page.locator(".tangent-map-resources").waitFor({ state: "hidden" });
    await page.keyboard.press("Enter");
    await bar.waitFor({ state: "hidden" });
    await assertToastReadable(page, "Placed Feature checkout on the Map.");
    assert.deepEqual(await page.evaluate(() => window.shardLoads), [nestedArea]);
    await page.waitForFunction(() => window.worldChanges.length >= 1);
    assert.deepEqual((await page.evaluate(() => window.worldChanges.at(-1).placed))[nestedArea], ["wt-feature"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "nothing creates horizontal page scroll at 800px");
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
