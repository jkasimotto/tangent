import test from "node:test";
import assert from "node:assert/strict";
import { parseAreaCanvas, serializeAreaCanvas } from "./area-canvas.mjs";
import { createAreaMapWorldIndex } from "./area-map-world-index.mjs";
import { composeAreaMapWorld } from "./public/area-map-world-core.js";
import { createAreaBoundary, createBlockElements, createEmptyScene, createRegionElements, createTextElement } from "./public/area-board-core.js";
import { areaMapWorldEnabled, loadAreaMapAuthority } from "./public/area-map-rollout.js";

/** Adds one stored direct-child region to a source scene. */
function addRegion(scene, options) {
  const elements = createRegionElements(options);
  scene.elements.push(...elements);
  return elements;
}

/** Creates the representative 41-Area legacy migration fixture. */
function migrationFixture() {
  const coreAreas = ["neara", "neara/delivery", "neara/delivery/standards", "neara/hackathon", "neara/hackathon/proof", "otto", "otto/tangent"];
  const areas = [...coreAreas, ...Array.from({ length: 34 }, (_, index) => `otto/area-${String(index + 1).padStart(2, "0")}`)].sort();
  const scenes = new Map(areas.map((area) => [area, createEmptyScene()]));
  scenes.set("@root", createEmptyScene());

  addRegion(scenes.get("@root"), { id: "root-neara", ref: "neara/neara.md", title: "Neara", x: 60, y: 60, width: 1120, height: 820 });
  addRegion(scenes.get("@root"), { id: "root-otto", ref: "otto/otto.md", title: "Otto", x: 60, y: 60, width: 980, height: 720 });
  addRegion(scenes.get("neara"), { id: "delivery-region", ref: "neara/delivery/delivery.md", title: "Delivery", x: 100, y: 100, width: 900, height: 620 });
  addRegion(scenes.get("neara"), { id: "hackathon-region", ref: "neara/hackathon/hackathon.md", title: "Hackathon", x: 1120, y: 100, width: 560, height: 400 });
  addRegion(scenes.get("neara/delivery"), { id: "standards-region", ref: "neara/delivery/standards/standards.md", title: "Standards", x: 120, y: 120, width: 620, height: 420 });

  const standards = scenes.get("neara/delivery/standards");
  standards.elements.push(createAreaBoundary("neara/delivery/standards", { x: 0, y: 0, width: 1000, height: 700 }));
  standards.elements.push(...createBlockElements({ id: "standards-document", kind: "document", ref: "neara/delivery/standards/design-proof.md", title: "Proof", x: 140, y: 160, width: 220, height: 100 }));

  const otto = scenes.get("otto");
  delete otto.tangent;
  otto.elements.push(createAreaBoundary("otto", { x: -40, y: -40, width: 1800, height: 1100 }));
  const [older, olderLabel] = createRegionElements({ id: "tangent-older", ref: "otto/tangent/tangent.md", title: "Tangent old", x: 80, y: 80, width: 620, height: 440 });
  older.version = 2; older.updated = 90;
  const [newer, newerLabel] = createRegionElements({ id: "tangent-newer", ref: "otto/tangent/tangent.md", title: "Tangent", x: 760, y: 80, width: 680, height: 460 });
  newer.version = 3; newer.updated = 50;
  otto.elements.push(older, olderLabel, newer, newerLabel);
  otto.elements.push(...createBlockElements({ id: "moved-card", kind: "area", ref: "otto/area-01/area-01.md", title: "Moved", x: 520, y: 640 }));
  otto.elements.push(...createBlockElements({ id: "untouched-card", kind: "area", ref: "otto/area-02/area-02.md", title: "Untouched", x: 100, y: 640 }));

  const baseline = createEmptyScene(); delete baseline.tangent;
  baseline.elements.push(...createBlockElements({ id: "moved-card", kind: "area", ref: "otto/area-01/area-01.md", title: "Moved", x: 100, y: 640 }));
  baseline.elements.push(...createBlockElements({ id: "untouched-card", kind: "area", ref: "otto/area-02/area-02.md", title: "Untouched", x: 100, y: 640 }));

  const committedHackathon = createEmptyScene();
  addRegion(committedHackathon, { id: "proof-region", ref: "neara/hackathon/proof/proof.md", title: "Proof", x: 90, y: 90, width: 480, height: 340 });
  const hashes = new Map(["@root", ...areas].map((area) => [area, `hash:${area}`]));
  hashes.set("neara/hackathon", "broken:hackathon");
  const gitCalls = [];
  const reads = [];
  const repository = {
    /** Reads source bytes without any migration write. */
    async read(area) {
      reads.push(area);
      if (area === "neara/hackathon") return { area, file: "neara/hackathon/hackathon.excalidraw", exists: true, ok: false, hash: hashes.get(area), scene: null, errors: ["invalid JSON"] };
      return { area, file: `${area}/${area.split("/").at(-1)}.excalidraw`, exists: true, ok: true, hash: hashes.get(area), scene: scenes.get(area), errors: [] };
    },
  };
  /** Serves only read-only history used by migration. */
  async function runGit(args) {
    gitCalls.push(args);
    const command = args[2]; const file = args.at(-1);
    if (command === "log" && args.includes("--diff-filter=A") && file === "otto/otto.excalidraw") return { stdout: "first-otto\n" };
    if (command === "show" && file === "first-otto:otto/otto.excalidraw") return { stdout: JSON.stringify(baseline) };
    if (command === "log" && !args.includes("--diff-filter=A") && file === "neara/hackathon/hackathon.excalidraw") return { stdout: "valid-hackathon\n" };
    if (command === "show" && file === "valid-hackathon:neara/hackathon/hackathon.excalidraw") return { stdout: JSON.stringify(committedHackathon) };
    return { stdout: "" };
  }
  /** Lists the complete fixture Area hierarchy. */
  async function listAreas() { return areas; }
  const index = createAreaMapWorldIndex({ root: "/vault", repository, runGit, listAreas });
  return { areas, gitCalls, index, reads, scenes };
}

/** Reports strict rectangle overlap. */
function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

test("migrates 41 Areas in memory with deterministic stored, recovered, and provisional regions", async () => {
  const fixture = migrationFixture();
  const before = JSON.stringify([...fixture.scenes].map(([area, scene]) => [area, scene]));
  const world = await fixture.index.snapshot("otto/tangent");
  assert.equal(world.areas.length, 41);
  assert.ok(world.areas.every((node) => node.region), "every Area receives one structural region");

  const tangent = world.areas.find((node) => node.key === "otto/tangent");
  assert.equal(tangent.region.sourceId, "tangent-newer", "the highest source version wins a duplicate");
  const moved = world.areas.find((node) => node.key === "otto/area-01");
  const untouched = world.areas.find((node) => node.key === "otto/area-02");
  assert.equal(moved.region.sourceId, "moved-card");
  assert.equal(moved.region.source, "recovered");
  assert.match(untouched.region.sourceId, /^tangent-region-/);
  assert.equal(untouched.region.source, "provisional");

  const neara = world.areas.find((node) => node.key === "neara").region;
  const otto = world.areas.find((node) => node.key === "otto").region;
  assert.equal(otto.source, "recovered", "an overlapping stored region stays visible at a recovered placement");
  assert.equal(overlaps(neara.storedRect, otto.storedRect), false);
  const proof = world.areas.find((node) => node.key === "neara/hackathon/proof");
  assert.equal(proof.region.sourceId, "proof-region", "last committed valid geometry keeps children of an unreadable shard");
  assert.equal(world.areas.find((node) => node.key === "neara/hackathon").shard.state, "unreadable");

  const composed = composeAreaMapWorld(world);
  const sourceIds = [...composed.origins.values()].map((origin) => origin.sourceId);
  assert.equal(sourceIds.some((sourceId) => String(sourceId).startsWith("tangent-boundary-")), false, "legacy boundaries never render");
  assert.equal(sourceIds.includes("untouched-card"), false, "an untouched grid card retires in memory");
  assert.equal(sourceIds.includes("moved-card"), true, "a moved direct-child card becomes the live region preview");
  assert.equal(sourceIds.includes("tangent-older"), true, "the losing duplicate remains ordinary authored content");
  assert.equal(JSON.stringify([...fixture.scenes].map(([area, scene]) => [area, scene])), before, "opening does not change source bytes");

  await fixture.index.snapshot("neara/delivery/standards");
  assert.equal(fixture.gitCalls.filter((args) => args[2] === "show" && args.at(-1).startsWith("first-otto:")).length, 1, "the baseline summary is cached by source hash");
  assert.equal(fixture.gitCalls.filter((args) => args[2] === "show" && args.at(-1).startsWith("valid-hackathon:")).length, 1, "the unreadable fallback is cached by source hash");
  assert.ok(fixture.gitCalls.every((args) => ["log", "show"].includes(args[2])), "read migration runs no Git write command");
});

test("first structural and content gestures write only their exact source owners", async () => {
  const fixture = migrationFixture();
  const world = await fixture.index.snapshot("neara/delivery/standards");
  const writes = [];
  /** Captures a validated transaction without changing the source fixture. */
  async function saveGesture(batch, options) { writes.push({ batch, options }); return { committed: true, operationId: options.operationId, hashes: Object.fromEntries(batch.map((entry) => [entry.area, `saved:${entry.area}`])) }; }

  const standardsNode = world.areas.find((node) => node.key === "neara/delivery/standards");
  const [resized] = createRegionElements({ id: standardsNode.region.sourceId, ref: "neara/delivery/standards/standards.md", title: "Standards", x: 150, y: 130, width: 700, height: 500 });
  const resize = await fixture.index.applyGesture({
    schema: "area-map-gesture.v1", operationId: "resize-standards", worldId: world.worldId, treeRevision: world.treeRevision, reason: "standards extent",
    mutations: [{ owner: "neara/delivery", baseHash: "hash:neara/delivery", put: [resized], remove: [] }],
  }, saveGesture);
  assert.equal(resize.status, 200);
  assert.deepEqual(writes[0].batch.map((entry) => entry.area), ["neara/delivery"]);

  const note = createTextElement({ id: "standards-note", text: "Keep this standard", x: 420, y: 180, width: 180, height: 50 });
  const content = await fixture.index.applyGesture({
    schema: "area-map-gesture.v1", operationId: "edit-standards", worldId: world.worldId, treeRevision: world.treeRevision, reason: "standards content",
    mutations: [{ owner: "neara/delivery/standards", baseHash: "hash:neara/delivery/standards", put: [note], remove: [] }],
  }, saveGesture);
  assert.equal(content.status, 200);
  assert.deepEqual(writes[1].batch.map((entry) => entry.area), ["neara/delivery/standards"]);
  const savedStandards = writes[1].batch[0].canvas;
  assert.equal(savedStandards.elements.some((element) => String(element.id).startsWith("tangent-boundary-")), false, "the touched shard drops its legacy boundary");
  const document = savedStandards.elements.find((element) => element.id === "standards-document");
  assert.deepEqual({ id: document.id, x: document.x, y: document.y }, { id: "standards-document", x: 140, y: 160 });
  assert.equal(parseAreaCanvas(JSON.stringify(savedStandards)).ok, true, "the rollback-window format remains readable by the old parser");
  assert.equal(fixture.scenes.get("neara/delivery/standards").elements.some((element) => String(element.id).startsWith("tangent-boundary-")), true, "the index itself performs no source write");
});

test("disabling areaMapWorld lets the old format-2 reader parse every changed shard", async () => {
  assert.equal(areaMapWorldEnabled(), true, "the composed world rollout defaults on");
  assert.equal(areaMapWorldEnabled("0"), false);
  const fixture = migrationFixture();
  const world = await fixture.index.snapshot("neara/delivery/standards");
  const delivery = structuredClone(fixture.scenes.get("neara/delivery"));
  delivery.elements.find((element) => element.id === "standards-region").width = 740;
  const standards = structuredClone(fixture.scenes.get("neara/delivery/standards"));
  standards.elements.push(createTextElement({ id: "rollback-note", text: "Rollback reader", x: 420, y: 180, width: 180, height: 50 }));
  const changed = new Map([["neara/delivery", delivery], ["neara/delivery/standards", standards]]);
  const requests = [];

  for (const [owner, canvas] of changed) {
    const authority = await loadAreaMapAuthority(async (resource) => {
      requests.push(resource);
      const requested = new URL(resource, "http://tangent.local").searchParams.get("area");
      assert.equal(requested, owner);
      const parsed = parseAreaCanvas(serializeAreaCanvas(canvas));
      assert.equal(parsed.ok, true, `${owner} remains readable as format 2`);
      return { area: owner, exists: true, ok: parsed.ok, hash: world.areas.find((node) => node.key === owner).shard.hash, scene: parsed.scene, canvas: parsed.canvas };
    }, owner, false);
    assert.equal(authority.mode, "legacy");
    assert.equal(authority.legacy, true);
    assert.deepEqual(authority.payload.scene.elements.map((element) => element.id), canvas.elements.map((element) => element.id));
  }

  assert.ok(requests.every((resource) => resource.startsWith("/api/areas/canvas?")), "rollback never requests world authority");
});
