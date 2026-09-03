import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMapKindsCatalog, parseMapKinds, readMapIcon } from "./map-kinds.mjs";
import { MAP_KINDS_STARTER_TEXT, starterMapIconFiles } from "./map-kind-starters.mjs";

const STARTER_ICON_NAMES = new Set(starterMapIconFiles().map((file) => file.name));

/** Wraps one JSON body in the fenced definition block, after some prose. */
function definition(body) {
  return `# Map kinds\n\nProse first.\n\n\`\`\`tangent.map-kinds.v1\n${body}\n\`\`\`\n`;
}

/** Returns the problems one entry carries, by kind id. */
function problemsById(parsed) {
  return Object.fromEntries(parsed.kinds.map((entry) => [entry.id, entry.problems]));
}

/** Creates one temporary vault root for a catalog reader. */
async function vaultRoot() {
  return mkdtemp(path.join(os.tmpdir(), "tangent-map-kinds-"));
}

test("the starter definition parses with no problem and names only starter icons", () => {
  const parsed = parseMapKinds(MAP_KINDS_STARTER_TEXT, STARTER_ICON_NAMES);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.kinds.map((entry) => entry.id), ["worktree", "repository", "link", "github-pr", "phabricator-revision", "commit"]);
  for (const entry of parsed.kinds) assert.deepEqual(entry.problems, [], `${entry.id} has a problem`);
  const worktree = parsed.kinds[0];
  assert.deepEqual(worktree.icons, [{ when: "missing", icon: "worktree-missing" }, { when: "dirty", icon: "worktree-dirty" }]);
  assert.equal(worktree.click, "copy-path");
  assert.equal(worktree.target, "path");
  assert.equal(parsed.kinds.find((entry) => entry.id === "commit").click, null, "a commit has an icon and no click action");
});

test("every starter icon reads into the normal form", () => {
  for (const file of starterMapIconFiles()) {
    const read = readMapIcon(file.name, file.text, ".excalidraw");
    assert.equal(read.problem, undefined, `${file.name}: ${read.problem}`);
    assert.ok(read.icon.width > 0 && read.icon.height > 0);
    assert.equal(read.icon.warning, null);
    const minimum = Math.min(...read.icon.elements.map((element) => element.x));
    assert.equal(Math.round(minimum), 0, "an icon's bounds start at the origin");
  }
});

test("a broken definition block names its line and every kind falls back to a card", () => {
  const parsed = parseMapKinds(definition('{\n  "version": 1,\n  "kinds": [ { "id": "worktree" ]\n}'), STARTER_ICON_NAMES);
  assert.match(parsed.error, /^map-kinds\.md line \d+: /);
  assert.deepEqual(parsed.kinds, []);
  assert.match(parseMapKinds(definition('{ "version": 1 }'), STARTER_ICON_NAMES).error, /needs a kinds list/);
  assert.deepEqual(parseMapKinds("# No block here", STARTER_ICON_NAMES), { kinds: [] });
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
  }, null, 2)), STARTER_ICON_NAMES);
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
  assert.equal(Object.keys(first.icons).length, starterMapIconFiles().length);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, "add: machine map kinds starter");
  assert.equal(staged.length, starterMapIconFiles().length + 1);
  assert.equal(commits[0].paths[0], "map-kinds.md");

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
  for (const entry of result.kinds) {
    assert.deepEqual(entry.problems.filter((problem) => !problem.includes("not found")), [], `${entry.id} has an unexpected problem`);
  }
});

test("an icon file Julian drops in is read without a restart, and a broken one names itself", async () => {
  const root = await vaultRoot();
  const catalog = createMapKindsCatalog({ root });
  await catalog.read();
  await mkdir(path.join(root, "map-icons"), { recursive: true });
  await writeFile(path.join(root, "map-icons", "figma.excalidraw"), JSON.stringify({
    type: "excalidraw", version: 2, elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 8, height: 8, angle: 0, opacity: 100, strokeWidth: 2, roughness: 1 }], appState: {}, files: {},
  }), "utf8");
  await writeFile(path.join(root, "map-icons", "broken.excalidraw"), "{ not json", "utf8");
  const result = await catalog.read();
  assert.ok(result.icons.figma, "a new drawing needs no restart");
  assert.deepEqual(result.problems.map((problem) => problem.scope), ["icon"]);
  assert.equal(result.problems[0].name, "broken");
});
