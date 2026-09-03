import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMapKindsCatalog, parseMapKinds, readMapIcon, readMapImageIcon } from "./map-kinds.mjs";
import { MAP_KINDS_STARTER_TEXT } from "./map-kind-starters.mjs";
import { jpegIconBytes, pngIconBytes, svgIconText, webpIconBytes } from "./test-fixtures/map-icon-images.mjs";

// The icon names one vault happens to hold. Tangent ships no icon, so a test
// that resolves an icon name names its own files.
const ICON_NAMES = new Set(["worktree", "worktree-dirty", "worktree-missing", "repository", "link", "pull-request", "pull-request-merged", "revision", "commit"]);

/** Wraps one JSON body in the fenced definition block, after some prose. */
function definition(body) {
  return `# Map kinds\n\nProse first.\n\n\`\`\`tangent.map-kinds.v1\n${body}\n\`\`\`\n`;
}

/** Returns the problems one entry carries, by kind id. */
function problemsById(parsed) {
  return Object.fromEntries(parsed.kinds.map((entry) => [entry.id, entry.problems]));
}

/** Returns one valid Excalidraw drawing body, the shape an icon file holds. */
function drawing() {
  return JSON.stringify({
    type: "excalidraw", version: 2,
    elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 8, height: 8, angle: 0, opacity: 100, strokeWidth: 2, roughness: 1 }],
    appState: {}, files: {},
  });
}

/** Creates one temporary vault root for a catalog reader. */
async function vaultRoot() {
  return mkdtemp(path.join(os.tmpdir(), "tangent-map-kinds-"));
}

test("the starter definition parses with no problem and names no icon", () => {
  const parsed = parseMapKinds(MAP_KINDS_STARTER_TEXT, new Set());
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.kinds.map((entry) => entry.id), ["worktree", "repository", "link", "github-pr", "phabricator-revision", "commit"]);
  // Tangent writes no icon file, so a fresh vault loads its Map with no
  // problem line and every kind as a card until Julian names an icon of his own.
  for (const entry of parsed.kinds) assert.deepEqual(entry.problems, [], `${entry.id} has a problem`);
  for (const entry of parsed.kinds) assert.deepEqual({ icon: entry.icon, icons: entry.icons }, { icon: null, icons: [] }, `${entry.id} names an icon`);
  const worktree = parsed.kinds[0];
  assert.equal(worktree.label, "Worktree");
  assert.equal(worktree.click, "copy-path");
  assert.equal(worktree.target, "path");
  assert.equal(parsed.kinds.find((entry) => entry.id === "commit").click, null, "a commit has no click action");
});

test("the starter definition still carries the icon and icons keys a kind may name", () => {
  // The shape does not change with the starters: an entry Julian writes with an
  // icon, and per-state icons, parses the same way it always did.
  const named = MAP_KINDS_STARTER_TEXT.replace(
    '{ "id": "worktree", "label": "Worktree", "click": "copy-path" }',
    '{ "id": "worktree", "label": "Worktree", "icon": "worktree", "icons": [ { "when": "missing", "icon": "worktree-missing" }, { "when": "dirty", "icon": "worktree-dirty" } ], "click": "copy-path" }',
  );
  const worktree = parseMapKinds(named, ICON_NAMES).kinds[0];
  assert.deepEqual(worktree.problems, []);
  assert.equal(worktree.icon, "worktree");
  assert.deepEqual(worktree.icons, [{ when: "missing", icon: "worktree-missing" }, { when: "dirty", icon: "worktree-dirty" }]);
});

test("a broken definition block names its line and every kind falls back to a card", () => {
  const parsed = parseMapKinds(definition('{\n  "version": 1,\n  "kinds": [ { "id": "worktree" ]\n}'), ICON_NAMES);
  assert.match(parsed.error, /^map-kinds\.md line \d+: /);
  assert.deepEqual(parsed.kinds, []);
  assert.match(parseMapKinds(definition('{ "version": 1 }'), ICON_NAMES).error, /needs a kinds list/);
  assert.deepEqual(parseMapKinds("# No block here", ICON_NAMES), { kinds: [] });
});

test("a bad entry keeps its own problem and never touches another entry", () => {
  const parsed = parseMapKinds(definition(JSON.stringify({
    version: 1,
    kinds: [
      { id: "worktree", label: "Worktree", icon: "worktre" },
      { id: "repository", label: "Repository", icon: "repository", click: "open" },
      { id: "link", label: "Link", icon: "link", icons: [{ when: "sparkling", icon: "link" }] },
      { id: "github-pr", label: "GitHub PR", icon: "pull-request", icons: [{ when: "Merged", icon: "pull-request-merged" }], click: "open" },
      { id: "commit", label: "Commit", target: "url" },
      { id: "design-file", label: "Design file", click: "open" },
      { id: "worktree", label: "Repeat" },
    ],
  }, null, 2)), ICON_NAMES);
  const problems = problemsById(parsed);
  assert.deepEqual(problems.worktree, ["a later entry repeats this id"], "the second entry with an id carries the repeat");
  assert.deepEqual(problems.repository, ["a path kind cannot run `open`"]);
  assert.deepEqual(problems.link, ["unknown state `sparkling`"]);
  assert.deepEqual(problems["github-pr"], [], "a provider word is a valid state for a provider kind");
  assert.deepEqual(problems.commit, ["commit always has the vault target"]);
  assert.deepEqual(problems["design-file"], ["a new id needs a target of path, url, or vault"]);
  assert.equal(parsed.kinds[0].problems.includes("icon `worktre` not found"), true);
});

test("an icon Tangent cannot draw is a problem on the file", () => {
  /** Builds one Excalidraw scene body around some elements. */
  const scene = (elements) => JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {}, files: {} });
  /** Builds one minimal valid rectangle element. */
  const rectangle = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, angle: 0, opacity: 100, strokeWidth: 2, roughness: 1 });
  assert.match(readMapIcon("broken", "{ not json", ".excalidraw").problem, /^broken: /);
  assert.match(readMapIcon("wrong", JSON.stringify({ type: "excalidrawlib" }), ".excalidraw").problem, /not an Excalidraw scene/);
  assert.match(readMapIcon("empty", scene([]), ".excalidraw").problem, /the drawing is empty/);
  assert.match(readMapIcon("picture", scene([{ ...rectangle("a"), type: "image" }]), ".excalidraw").problem, /cannot hold a image element/);
  assert.match(readMapIcon("unsafe", scene([{ ...rectangle("a"), x: Number.POSITIVE_INFINITY }]), ".excalidraw").problem, /finite scene number/);

  /** Builds one scene of the requested element count. */
  const many = (count) => scene(Array.from({ length: count }, (_, index) => rectangle(`r${index}`)));
  assert.match(readMapIcon("huge", many(1_001), ".excalidraw").problem, /more than 1000 elements/);
  assert.match(readMapIcon("heavy", many(201), ".excalidraw").icon.warning, /more than 200 elements/);
  assert.equal(readMapIcon("heavy", many(201), ".excalidraw").icon.elementCount, 201, "a heavy icon is still drawn");
});

test("a library icon holds exactly one item, in either library version", () => {
  const rectangle = { id: "a", type: "rectangle", x: 4, y: 6, width: 10, height: 10, angle: 0, opacity: 100, strokeWidth: 2, roughness: 1 };
  const version2 = JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems: [{ id: "item", elements: [rectangle] }] });
  const version1 = JSON.stringify({ type: "excalidrawlib", version: 1, library: [[rectangle]] });
  for (const text of [version2, version1]) {
    const read = readMapIcon("figma", text, ".excalidrawlib");
    assert.equal(read.problem, undefined);
    assert.deepEqual({ x: read.icon.elements[0].x, y: read.icon.elements[0].y }, { x: 0, y: 0 });
  }
  const two = JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems: [{ id: "one", elements: [rectangle] }, { id: "two", elements: [rectangle] }] });
  assert.match(readMapIcon("figma", two, ".excalidrawlib").problem, /exactly one item/);
});

test("the catalog writes the starter once, then never again, and keeps Julian's edits", async () => {
  const root = await vaultRoot();
  const commits = [];
  const staged = [];
  const catalog = createMapKindsCatalog({
    root,
    /** Records one provenance commit. */
    commit: async (paths, message) => { commits.push({ paths, message }); },
    /** Records one staged starter file. */
    stage: async (file) => { staged.push(file); },
  });
  const first = await catalog.read();
  assert.equal(first.source, "vault");
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.icons, {}, "Tangent writes no icon file, so a fresh vault has none");
  assert.deepEqual(await readdir(root), ["map-kinds.md"], "the definition is the only file Tangent writes");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, "add: machine map kinds starter");
  assert.deepEqual(staged, ["map-kinds.md"]);
  assert.deepEqual(commits[0].paths, ["map-kinds.md"]);

  const edited = `${await readFile(path.join(root, "map-kinds.md"), "utf8")}\n\nJulian's own note.\n`;
  await writeFile(path.join(root, "map-kinds.md"), edited, "utf8");
  const second = await catalog.read();
  assert.equal(commits.length, 1, "Tangent never rewrites the definition it already wrote");
  assert.match(await readFile(path.join(root, "map-kinds.md"), "utf8"), /Julian's own note/);
  assert.notEqual(second.revision, first.revision, "an edit changes the revision the Map watches");
  assert.equal((await catalog.read()).revision, second.revision, "an unchanged vault keeps one revision");
});

test("a read-only instance serves the starter from memory and writes nothing", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root, writable: false });
  const result = await catalog.read();
  assert.equal(result.source, "starter");
  assert.equal(result.kinds.length, 6);
  assert.deepEqual(await readdir(root), []);
  assert.deepEqual(result.problems, [], "a read-only instance loads its Map with no problem line");
  for (const entry of result.kinds) {
    assert.deepEqual(entry.problems, [], `${entry.id} has an unexpected problem`);
  }
});

test("an icon file Julian drops in is read without a restart, and a broken one names itself", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root });
  await catalog.read();
  await mkdir(path.join(root, "map-icons"), { recursive: true });
  await writeFile(path.join(root, "map-icons", "figma.excalidraw"), drawing(), "utf8");
  await writeFile(path.join(root, "map-icons", "broken.excalidraw"), "{ not json", "utf8");
  const result = await catalog.read();
  assert.ok(result.icons.figma, "a new drawing needs no restart");
  assert.deepEqual({ width: result.icons.figma.width, height: result.icons.figma.height }, { width: 8, height: 8 }, "a drawing keeps the size it was drawn at");
  assert.deepEqual({ x: result.icons.figma.elements[0].x, y: result.icons.figma.elements[0].y }, { x: 0, y: 0 }, "an icon's bounds start at the origin");
  assert.deepEqual(result.problems.map((problem) => problem.scope), ["icon"]);
  assert.equal(result.problems[0].name, "broken");
});

test("every accepted image format is read for the size its own header declares", () => {
  const png = readMapImageIcon("worktree", pngIconBytes({ width: 96, height: 48 }), ".png");
  assert.equal(png.problem, undefined);
  assert.deepEqual({ kind: png.icon.kind, mimeType: png.icon.mimeType, width: png.icon.width, height: png.icon.height }, { kind: "image", mimeType: "image/png", width: 96, height: 48 });
  assert.match(png.icon.dataURL, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  assert.match(png.icon.contentHash, /^[0-9a-f]{16}$/);

  const jpeg = readMapImageIcon("commit", jpegIconBytes({ width: 320, height: 200 }), ".jpeg");
  assert.deepEqual({ mimeType: jpeg.icon.mimeType, width: jpeg.icon.width, height: jpeg.icon.height }, { mimeType: "image/jpeg", width: 320, height: 200 });
  assert.equal(readMapImageIcon("commit", jpegIconBytes({ width: 12, height: 8 }), ".jpg").icon.mimeType, "image/jpeg", "both spellings of the extension are the same type");

  const webp = readMapImageIcon("link", webpIconBytes({ width: 500, height: 400 }), ".webp");
  assert.deepEqual({ mimeType: webp.icon.mimeType, width: webp.icon.width, height: webp.icon.height }, { mimeType: "image/webp", width: 500, height: 400 });

  const svg = readMapImageIcon("revision", Buffer.from(svgIconText({ width: 240, height: 120 })), ".svg");
  assert.deepEqual({ mimeType: svg.icon.mimeType, width: svg.icon.width, height: svg.icon.height }, { mimeType: "image/svg+xml", width: 240, height: 120 });
  const boxed = readMapImageIcon("revision", Buffer.from(svgIconText({ width: 64, height: 32, sized: false })), ".svg");
  assert.deepEqual({ width: boxed.icon.width, height: boxed.icon.height }, { width: 64, height: 32 }, "a viewBox alone still gives the drawn size");
  const inches = readMapImageIcon("revision", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="0.5in"></svg>'), ".svg");
  assert.deepEqual({ width: inches.icon.width, height: inches.icon.height }, { width: 96, height: 48 }, "a length in real units is read in pixels");

  // The same bytes always name the same file, and different bytes never do.
  assert.equal(readMapImageIcon("worktree", pngIconBytes({ width: 96, height: 48 }), ".png").icon.contentHash, png.icon.contentHash);
  assert.notEqual(readMapImageIcon("worktree", pngIconBytes({ width: 96, height: 49 }), ".png").icon.contentHash, png.icon.contentHash);
});

test("an image that is truncated, or is not the type its extension claims, is a problem", () => {
  assert.match(readMapImageIcon("worktree", pngIconBytes().subarray(0, 20), ".png").problem, /not a readable PNG image/);
  assert.match(readMapImageIcon("worktree", Buffer.from(svgIconText()), ".png").problem, /not a readable PNG image/, "an SVG that calls itself a PNG is refused");
  assert.match(readMapImageIcon("worktree", pngIconBytes(), ".svg").problem, /not a readable SVG image/, "a PNG that calls itself an SVG is refused");
  assert.match(readMapImageIcon("worktree", webpIconBytes().subarray(0, 18), ".webp").problem, /not a readable WEBP image/);
  assert.match(readMapImageIcon("worktree", jpegIconBytes().subarray(0, 6), ".jpg").problem, /not a readable JPEG image/, "a JPEG with no frame header has no size");
  assert.match(readMapImageIcon("worktree", Buffer.from("<svg><rect></svg>"), ".svg").problem, /not a readable SVG image/, "an SVG has to be well-formed XML");
  assert.match(readMapImageIcon("worktree", Buffer.from('<html><body>no</body></html>'), ".svg").problem, /not a readable SVG image/, "the root element has to be svg");
  assert.match(readMapImageIcon("worktree", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>'), ".svg").problem, /not a readable SVG image/, "a percentage is no drawn size");
  assert.match(readMapImageIcon("worktree", pngIconBytes(), ".gif").problem, /is not an icon file type/);
});

test("an image icon and a drawing of one name are an ambiguity the image wins", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root });
  await catalog.read();
  await mkdir(path.join(root, "map-icons"), { recursive: true });
  await writeFile(path.join(root, "map-icons", "worktree.excalidraw"), drawing(), "utf8");
  await writeFile(path.join(root, "map-icons", "worktree-dirty.excalidraw"), drawing(), "utf8");
  await writeFile(path.join(root, "map-icons", "worktree.png"), pngIconBytes({ width: 128, height: 128 }));
  const result = await catalog.read();
  assert.equal(result.icons.worktree.kind, "image", "the picture Julian dropped in wins over the drawing");
  assert.equal(result.icons["worktree-dirty"].kind, "drawing", "every other drawing keeps working");
  const ambiguity = result.problems.find((problem) => problem.name === "worktree");
  assert.match(ambiguity.message, /worktree\.png and worktree\.excalidraw share this icon name, so the Map draws worktree\.png/);
  const named = MAP_KINDS_STARTER_TEXT.replace('{ "id": "worktree", "label": "Worktree", "click": "copy-path" }', '{ "id": "worktree", "label": "Worktree", "icon": "worktree", "click": "copy-path" }');
  assert.deepEqual(parseMapKinds(named, new Set(Object.keys(result.icons))).kinds.find((entry) => entry.id === "worktree").problems, [], "the kind still resolves its icon");
});

test("an unreadable image is a problem and its kind falls back to a card", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root });
  await catalog.read();
  await mkdir(path.join(root, "map-icons"), { recursive: true });
  await writeFile(path.join(root, "map-icons", "design-file.png"), pngIconBytes().subarray(0, 20));
  const result = await catalog.read();
  assert.equal(result.icons["design-file"], undefined, "an icon with no readable size never reaches the Map");
  assert.equal(result.problems.some((problem) => problem.name === "design-file" && /not a readable PNG image/.test(problem.message)), true);
});

test("an image icon changes the revision the Map watches, and reads without a restart", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root });
  const first = await catalog.read();
  await mkdir(path.join(root, "map-icons"), { recursive: true });
  await writeFile(path.join(root, "map-icons", "design-file.svg"), svgIconText({ width: 200, height: 200 }), "utf8");
  const second = await catalog.read();
  assert.equal(second.icons["design-file"].kind, "image");
  assert.notEqual(second.revision, first.revision);
  assert.equal((await catalog.read()).revision, second.revision, "an unchanged image keeps one revision");
});
