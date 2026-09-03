import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RESIZE_HANDLES, areaKey, isResizeHandle, resourceId, runtimeId, shardOwner, sourceId, worldRevision } from "./ids.ts";
import type { AreaKey, RuntimeId, SourceId } from "./ids.ts";

test("every id constructor returns the value it was given", () => {
  assert.equal(areaKey("otto/tangent"), "otto/tangent");
  assert.equal(runtimeId("tw-abc"), "tw-abc");
  assert.equal(sourceId("el-1"), "el-1");
  assert.equal(shardOwner("@root"), "@root");
  assert.equal(worldRevision(3), 3);
  assert.equal(resourceId("r-1"), "r-1");
});

test("ids of different kinds do not mix", () => {
  /** Accepts only a runtime id. */
  const takesRuntime = (value: RuntimeId): RuntimeId => value;
  /** Accepts only an Area key. */
  const takesArea = (value: AreaKey): AreaKey => value;
  const source: SourceId = sourceId("el-1");
  // @ts-expect-error a source id is not a runtime id.
  takesRuntime(source);
  // @ts-expect-error a raw string is not an Area key.
  takesArea("otto/tangent");
  assert.equal(takesRuntime(runtimeId("tw-1")), "tw-1");
});

test("the resize handles are the kernel's eight compass names", () => {
  assert.deepEqual([...RESIZE_HANDLES], ["n", "s", "e", "w", "nw", "ne", "sw", "se"]);
  for (const handle of RESIZE_HANDLES) assert.ok(isResizeHandle(handle));
  assert.equal(isResizeHandle("north"), false);
  assert.equal(isResizeHandle(""), false);
});
