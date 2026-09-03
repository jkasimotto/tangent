// Real-browser proof that an image icon reaches the Map. Julian asked for
// pictures instead of Excalidraw drawings, and the earlier design rejected
// pictures because the Map's dark theme inverts the whole canvas. This test
// mounts the Map with a PNG icon and with an SVG icon, and reads the pixels
// back off the canvas through the very filter the canvas element carries, so
// it proves both halves: the picture is drawn, not a placeholder, and what the
// filter shows is the colour the picture was supplied in.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticAsset } from "./static-assets.mjs";
import { figureIconFileId } from "./public/area-map-figures.js";
import { pngIconBytes, svgIconText } from "./test-fixtures/map-icon-images.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The two icons are painted in colours from the starter icons' own palette, so
// the test measures what a real icon looks like. The Map's dark theme is not a
// perfect round trip for either a drawing or a picture, so the check allows the
// same distance the drawn-ink check allows.
/** The colour the PNG icon is painted in, which is nothing like a placeholder. */
const ICON_COLOUR = [0x9c, 0x36, 0xb5];
/** The largest channel distance the theme's round trip may cost one colour. */
const COLOUR_TOLERANCE = 20;
const ICON_BYTES = pngIconBytes({ width: 256, height: 256, colour: ICON_COLOUR });
const ICON_DATA_URL = `data:image/png;base64,${ICON_BYTES.toString("base64")}`;
const ICON_CONTENT_HASH = createHash("sha256").update(ICON_BYTES).digest("hex").slice(0, 16);
// A raster icon is registered exactly as it was supplied, so its file id is the
// icon name and the hash of those bytes.
const ICON_FILE_ID = figureIconFileId("worktree", ICON_CONTENT_HASH);

// The SVG declares only a viewBox, which is the case a browser gets wrong on
// its own: it invents 300 by 150 for such a file, so the Map has to use the
// size the catalog read out of the viewBox itself.
/** The SVG icon, in its own colour, which the Map rasterizes for the dark theme. */
const SVG_COLOUR = [0x2f, 0x9e, 0x44];
const SVG_TEXT = svgIconText({ width: 120, height: 60, sized: false, colour: "#2f9e44" });
const SVG_CONTENT_HASH = createHash("sha256").update(Buffer.from(SVG_TEXT)).digest("hex").slice(0, 16);
const SVG_FILE_ID = figureIconFileId("repository", `${SVG_CONTENT_HASH}-dark`);

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

const iconDataURL = "ICON_DATA_URL";
const iconContentHash = "ICON_CONTENT_HASH";
const svgDataURL = "SVG_DATA_URL";
const svgContentHash = "SVG_CONTENT_HASH";
const scene = core.createEmptyScene();
scene.elements.push(
  ...core.createBlockElements({ id: "otto-worktree", kind: "resource", ref: "wt-a", title: "Checkout A", status: "", x: 200, y: 200, width: 260, height: 132 }),
  ...core.createBlockElements({ id: "otto-repository", kind: "resource", ref: "repo-a", title: "The repository", status: "", x: 200, y: 380, width: 260, height: 132 }),
);

const world = {
  schema: "area-map-world.v1",
  worldId: "figure-image-world",
  treeRevision: "tree-1",
  worldRevision: "world-1",
  locatedArea: "otto",
  areas: [{
    key: "otto", parent: "@root", children: [], depth: 0,
    region: { key: "@root>otto", owner: "@root", child: "otto", sourceId: "region-otto", labelSourceId: "label-otto", source: "stored", storedRect: { x: 80, y: 80, width: 900, height: 600 } },
    shard: { owner: "otto", hash: "hash-otto", state: "ready", elementCount: scene.elements.length, blockCount: 1, scene },
  }],
};

const documents = [{ kind: "area", area: "otto", file: "otto/otto.md", title: "Otto", status: "active" }];
const resourceFacts = new Map([
  ["wt-a", {
    label: "Checkout A",
    target: { kind: "worktree", path: "/private/tmp/tangent-figure-image/wt-a" },
    local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "aaa", branchRef: "refs/heads/feature/a" }, repositoryPath: "/private/tmp/tangent-figure-image/repo" }, checkedAt: "2026-09-02T01:00:00.000Z" },
    link: null,
  }],
  ["repo-a", {
    label: "The repository",
    target: { kind: "repository", path: "/private/tmp/tangent-figure-image/repo" },
    local: { state: "current", value: { state: "available", checkout: { kind: "branch", head: "bbb", branchRef: "refs/heads/main" }, repositoryPath: "/private/tmp/tangent-figure-image/repo" }, checkedAt: "2026-09-02T01:00:00.000Z" },
    link: null,
  }],
]);

/** The catalog the Map reads, with one image icon in place of a drawing. */
const mapKindsCatalog = () => ({
  revision: "kinds-image-1",
  source: "vault",
  kinds: [
    { id: "worktree", label: "Worktree", target: "path", provider: null, builtIn: true, icon: "worktree", icons: [], click: "copy-path", problems: [] },
    { id: "repository", label: "Repository", target: "path", provider: null, builtIn: true, icon: "repository", icons: [], click: "copy-path", problems: [] },
  ],
  icons: {
    worktree: { name: "worktree", kind: "image", mimeType: "image/png", dataURL: iconDataURL, width: 256, height: 256, contentHash: iconContentHash, warning: null },
    repository: { name: "repository", kind: "image", mimeType: "image/svg+xml", dataURL: svgDataURL, width: 120, height: 60, contentHash: svgContentHash, warning: null },
  },
  problems: [],
});

window.iconFileEvents = [];
window.addEventListener("tangent:area-map", (event) => {
  if (event.detail?.name === "map-icon-files") window.iconFileEvents.push(...event.detail.files);
});

/** Serves only the read routes this one-Block Map needs. */
const resourceApi = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (url === "/api/areas/map-resources/resolve" || url === "/api/areas/map-resources/refresh") {
    return { resolutions: body.resources.map((locator) => ({ state: "current", value: { locator, ...structuredClone(resourceFacts.get(locator.id)), representation: { state: "current", value: "on-map" }, origin: null, warnings: [] } })) };
  }
  if (url === "/api/areas/map-kinds") return mapKindsCatalog();
  if (url.startsWith("/api/areas/map-resources?")) return { state: "current", viewedFrom: "otto", catalogs: [], counts: { state: "current", confirmedAssociations: 0, suggestions: 0, legacyReview: 0 }, suggestions: [], legacyReview: [], rows: [] };
  throw new Error("Unexpected figure image fixture route: " + url);
};

window.editor = mountAreaBoardEditor(document.querySelector("#map"), {
  world,
  scene: core.createEmptyScene(),
  getDocuments: () => documents,
  api: resourceApi,
  focus: { only: false, activeOnly: false, areas: [] },
  onWorldChange: () => {},
  loadShard: async (area) => ({ area, worldRevision: world.worldRevision, hash: "hash-" + area, state: "ready", scene: core.createEmptyScene() }),
  reloadWorld: async () => structuredClone(world),
  onEntityVerb: () => {},
  onBack: () => {},
});

/** Reads one scene point straight off the canvas Excalidraw painted. */
window.canvasPixel = (sceneX, sceneY) => {
  const canvas = document.querySelector(".excalidraw canvas.static");
  const rect = canvas.getBoundingClientRect();
  const appState = window.editor.appState();
  const scale = canvas.width / rect.width;
  const context = canvas.getContext("2d");
  const at = context.getImageData(
    Math.round((sceneX + appState.scrollX) * appState.zoom.value * scale),
    Math.round((sceneY + appState.scrollY) * appState.zoom.value * scale),
    1, 1,
  ).data;
  return [at[0], at[1], at[2], at[3]];
};

/** Puts one colour through the very filter the Map's canvas element carries. */
window.throughThemeFilter = (rgb) => {
  const filter = getComputedStyle(document.querySelector(".excalidraw canvas.static")).filter;
  const source = document.createElement("canvas");
  source.width = 1; source.height = 1;
  const sourceContext = source.getContext("2d");
  sourceContext.fillStyle = "rgb(" + rgb.join(",") + ")";
  sourceContext.fillRect(0, 0, 1, 1);
  const out = document.createElement("canvas");
  out.width = 1; out.height = 1;
  const outContext = out.getContext("2d");
  outContext.filter = filter;
  outContext.drawImage(source, 0, 0);
  const at = outContext.getImageData(0, 0, 1, 1).data;
  return { filter, seen: [at[0], at[1], at[2]] };
};
</script>
</body>
</html>`
  .replace("ICON_DATA_URL", ICON_DATA_URL)
  .replace("ICON_CONTENT_HASH", ICON_CONTENT_HASH)
  .replace("SVG_DATA_URL", `data:image/svg+xml;base64,${Buffer.from(SVG_TEXT).toString("base64")}`)
  .replace("SVG_CONTENT_HASH", SVG_CONTENT_HASH);

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/figure-image-fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fixture);
      return;
    }
    await serveStaticAsset(url, response, here);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Opens the one-Block image-icon fixture and registers its cleanup. */
async function openFixture(context) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
    headless: true,
  });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(`${baseUrl}/figure-image-fixture`, { waitUntil: "networkidle" });
  await page.locator(".excalidraw canvas.interactive").waitFor();
  await page.waitForFunction(() => window.editor?.appState?.()?.zoom?.value);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return page;
}

/** Returns the largest channel distance between two colours. */
function distance(left, right) {
  return Math.max(...[0, 1, 2].map((channel) => Math.abs(left[channel] - right[channel])));
}

/** Returns one hex colour as its three channels. */
function channels(hex) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

/** Returns the drawn figure icons of the mounted Map, by the icon each one names. */
async function drawnIcons(page) {
  return page.evaluate(() => Object.fromEntries((window.editor.rendered?.() ?? [])
    .filter((element) => element.customData?.tangentWorldEphemeral?.kind === "resource-figure-icon" && !element.isDeleted)
    .map((element) => [element.customData.tangentWorldEphemeral.icon, {
      id: element.id, type: element.type, fileId: element.fileId, status: element.status, locked: element.locked,
      sourceId: element.customData.tangentWorldEphemeral.sourceId,
      x: element.x, y: element.y, width: element.width, height: element.height,
    }])));
}

test("an image icon renders on the Map as the picture it is, in the colour it was drawn", { timeout: 120_000 }, async (context) => {
  const page = await openFixture(context);

  // Each kind draws one image element, locked and ephemeral like every figure.
  await page.waitForFunction(() => (window.editor.rendered?.() ?? []).filter((element) => element.type === "image" && !element.isDeleted).length === 2);
  const icons = await drawnIcons(page);
  assert.deepEqual(Object.keys(icons).sort(), ["repository", "worktree"], `one image icon each, not a drawing's many elements: ${JSON.stringify(icons)}`);
  for (const [name, icon] of Object.entries(icons)) {
    assert.equal(icon.type, "image", name);
    assert.equal(icon.locked, true, `${name} is never selectable on its own`);
    assert.equal(icon.status, "saved", name);
  }
  const blocks = await page.evaluate(() => Object.fromEntries((window.editor.rendered?.() ?? [])
    .filter((element) => element.customData?.tangent?.ref)
    .map((element) => [element.customData.tangent.ref, element.id])));
  assert.equal(icons.worktree.sourceId, blocks["wt-a"], "the picture belongs to its Block");
  assert.equal(icons.repository.sourceId, blocks["repo-a"]);

  // A raster icon is registered exactly as supplied; an SVG is rasterized for
  // the dark theme, so its bytes, and its file id, are the theme's own.
  assert.equal(icons.worktree.fileId, ICON_FILE_ID);
  assert.equal(icons.repository.fileId, SVG_FILE_ID);
  assert.deepEqual((await page.evaluate(() => window.iconFileEvents)).sort(), [SVG_FILE_ID, ICON_FILE_ID].sort(), "the Map registered the bytes of both pictures");

  // The square picture stays square, and the wide one keeps its two to one shape.
  assert.equal(Math.round(icons.worktree.width), Math.round(icons.worktree.height));
  assert.equal(Math.round(icons.repository.width), Math.round(icons.repository.height * 2));

  // The canvas shows each picture, not Excalidraw's missing-file placeholder,
  // and the filter the canvas element carries shows it in its drawn colour.
  for (const [name, colour] of [["worktree", ICON_COLOUR], ["repository", SVG_COLOUR]]) {
    const icon = icons[name];
    const centre = { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
    await page.waitForFunction((point) => window.canvasPixel(point.x, point.y)[3] > 250, centre, { timeout: 30_000 });
    const painted = await page.evaluate((point) => window.canvasPixel(point.x, point.y), centre);
    const { filter, seen } = await page.evaluate((rgb) => window.throughThemeFilter(rgb), painted);
    assert.match(filter, /invert/, "the Map's canvas really does carry an inverting filter");
    assert.ok(distance(seen, colour) <= COLOUR_TOLERANCE, `${name} is seen as it was drawn: ${JSON.stringify({ painted, seen, drawn: colour, filter })}`);
    assert.ok(distance(seen, [128, 128, 128]) > 40, `${name} is a picture, not a grey placeholder: ${JSON.stringify(seen)}`);
  }

  // The caption keeps every other fact, and the source shard is untouched.
  const words = await page.evaluate(() => (window.editor.rendered?.() ?? [])
    .filter((element) => element.type === "text" && element.containerId && !element.isDeleted)
    .map((element) => element.text));
  assert.ok(words.includes("Checkout A\nfeature/a"), `the caption sits beside the picture: ${JSON.stringify(words)}`);
  const source = await page.evaluate(() => {
    const node = window.editor.controller().world().areas.find((entry) => entry.key === "otto");
    return {
      icons: node.shard.scene.elements.filter((element) => element.customData?.tangentWorldEphemeral).length,
      images: node.shard.scene.elements.filter((element) => element.type === "image").length,
      markers: node.shard.scene.elements.filter((element) => element.customData?.tangentWorldFigure).length,
    };
  });
  assert.deepEqual(source, { icons: 0, images: 0, markers: 0 }, "a picture is a projection and never reaches a source shard");
});
