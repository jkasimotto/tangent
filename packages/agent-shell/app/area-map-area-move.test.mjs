import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { moveArea } from "./area-operations.mjs";
import { parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";
import { provisionalRegions } from "./public/area-map-world-core.js";

/** Writes one valid scene at its canonical Area path. */
async function writeScene(root, area, scene) {
  await mkdir(path.join(root, area), { recursive: true });
  await writeFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), serializeAreaCanvas(scene));
}

/** Reads one valid canonical Area scene. */
async function readScene(root, area) {
  const text = await readFile(path.join(root, area, `${path.posix.basename(area)}.excalidraw`), "utf8");
  const parsed = parseAreaCanvas(text);
  assert.equal(parsed.ok, true);
  return parsed.scene;
}

test("an explicit Area move preserves source IDs and remaps every map owner and reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-map-move-"));
  for (const area of ["neara", "neara/source", "neara/source/child", "otto"]) {
    await mkdir(path.join(root, area), { recursive: true });
    await writeFile(path.join(root, area, `${path.posix.basename(area)}.md`), `# ${path.posix.basename(area)}\n`);
  }
  const source = createEmptyScene();
  const sourceBlock = createTextElement({ id: "source-id", text: "kept", x: 10, y: 20, width: 80, height: 30 });
  sourceBlock.customData = {
    tangent: { kind: "document", ref: "neara/source/child/note.md#part" },
    endpoint: { owner: "neara/source/child", sourceId: "child-id" },
  };
  source.elements.push(sourceBlock);
  await writeScene(root, "neara/source", source);
  const child = createEmptyScene(); child.elements.push(createTextElement({ id: "child-id", text: "child", x: 30, y: 40, width: 80, height: 30 }));
  await writeScene(root, "neara/source/child", child);
  const oldParent = createEmptyScene(); oldParent.elements.push(...createRegionElements({ id: "old-region", ref: "neara/source/source.md", title: "Source" }));
  await writeScene(root, "neara", oldParent);
  const outside = createEmptyScene();
  const endpoint = createTextElement({ id: "outside-id", text: "outside" });
  endpoint.customData = { endpoint: { owner: "neara/source", sourceId: "source-id" } };
  outside.elements.push(endpoint);
  await writeScene(root, "otto", outside);

  const moved = await moveArea({
    treesRoot: root, area: "neara/source", parent: "otto", name: "Renamed",
    /** Uses filesystem fallbacks in this isolated vault. */
    runGit: async (_args, fallback) => fallback(),
  });

  assert.equal(moved.destination, "otto/renamed");
  await assert.rejects(access(path.join(root, "otto/renamed/source.excalidraw")), { code: "ENOENT" });
  const movedSource = await readScene(root, "otto/renamed");
  assert.equal(movedSource.elements[0].id, "source-id");
  assert.deepEqual({ x: movedSource.elements[0].x, y: movedSource.elements[0].y }, { x: 10, y: 20 });
  assert.equal(movedSource.elements[0].customData.tangent.ref, "otto/renamed/child/note.md#part");
  assert.equal(movedSource.elements[0].customData.endpoint.owner, "otto/renamed/child");
  assert.equal((await readScene(root, "otto/renamed/child")).elements[0].id, "child-id");
  assert.equal((await readScene(root, "otto")).elements[0].customData.endpoint.owner, "otto/renamed");
  assert.equal((await readScene(root, "neara")).elements[0].customData.tangent.ref, "otto/renamed/renamed.md");
  assert.ok(moved.mapChangedPaths.includes("otto/renamed/renamed.excalidraw"));
  assert.ok(moved.mapChangedPaths.includes("otto/otto.excalidraw"));

  const regions = provisionalRegions(["neara", "otto", "otto/renamed", "otto/renamed/child"]);
  assert.equal(regions.has("neara/source"), false, "the old Area key has no structural authority");
  assert.equal(regions.get("otto/renamed").owner, "otto", "the new parent supplies the structural region");
  assert.equal(regions.get("otto/renamed").source, "provisional");
});
