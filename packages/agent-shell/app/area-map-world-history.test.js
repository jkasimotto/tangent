import test from "node:test";
import assert from "node:assert/strict";
import { createAreaMapWorldHistory } from "./public/area-map-world-history.js";

/** Builds source mutations grouped by their owning shards. */
const mutations = (...owners) => new Map(owners.map(([owner, value]) => [owner, [{ id: "shape", value }]]));

test("groups pointer, text, paste, and toolbar actions at their real boundaries", async () => {
  const saved = [];
  /** Records one command after the save queue releases it. */
  async function save(command) { saved.push(command); }
  const history = createAreaMapWorldHistory({ save });
  history.begin("pointer", mutations(["root", 0]));
  history.update(mutations(["root", 1]));
  history.update(mutations(["root", 2]));
  history.finish();
  history.begin("text", mutations(["root", 2]));
  history.update(mutations(["root", 3]));
  history.finish();
  history.record("paste", mutations(["root", 3]), mutations(["root", 4]));
  history.record("toolbar", mutations(["root", 4]), mutations(["root", 5]));
  await history.flush();
  assert.deepEqual(saved.map((command) => command.kind), ["pointer", "text", "paste", "toolbar"]);
  assert.equal(saved[0].after.get("root")[0].value, 2);
});

test("undoes and redoes one multi-shard command with source selections", async () => {
  const applied = [];
  /** Records the source changes that history applies. */
  function apply(changes, selection) { applied.push({ changes, selection }); }
  const history = createAreaMapWorldHistory({ apply });
  const before = mutations(["root", 1], ["root/child", 2]);
  const after = mutations(["root", 3], ["root/child", 4]);
  history.record("pointer", before, after, [{ owner: "root", sourceId: "a" }], [{ owner: "root/child", sourceId: "b" }]);
  assert.equal(history.undo(), true);
  assert.deepEqual(applied.at(-1), { changes: before, selection: [{ owner: "root", sourceId: "a" }] });
  assert.equal(history.redo(), true);
  assert.deepEqual(applied.at(-1), { changes: after, selection: [{ owner: "root/child", sourceId: "b" }] });
  await history.flush();
});

test("cancels an unsent command when undo runs before the save microtask", async () => {
  const saved = [];
  /** Records one save direction. */
  async function save(_command, direction) { saved.push(direction); }
  const history = createAreaMapWorldHistory({ save });
  history.record("paste", mutations(["root", 1]), mutations(["root", 2]));
  history.undo();
  await history.flush();
  assert.deepEqual(saved, []);
});

test("queues an inverse after an active save", async () => {
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const saved = [];
  /** Holds the first save so undo must queue its inverse. */
  async function save(_command, direction) { saved.push(direction); if (saved.length === 1) await first; }
  const history = createAreaMapWorldHistory({ save });
  history.record("pointer", mutations(["root", 1]), mutations(["root", 2]));
  await new Promise((resolve) => queueMicrotask(resolve));
  history.undo();
  assert.deepEqual(saved, ["after"]);
  release();
  await history.flush();
  assert.deepEqual(saved, ["after", "before"]);
});

test("excludes camera, Focus, fold, loading, and facts from world history", () => {
  const history = createAreaMapWorldHistory();
  for (const kind of ["camera", "focus", "fold", "loading", "facts"]) assert.equal(history.record(kind, mutations(["root", 1]), mutations(["root", 2])), null);
  assert.equal(history.state.undo.length, 0);
  assert.equal(history.state.queue.length, 0);
});
