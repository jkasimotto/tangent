// The projection fence under a fake Excalidraw api and a hand-stepped scheduler.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { authoredFingerprint } from "../kernel/kernel-boundary.ts";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { runtimeId } from "../units/ids.ts";
import type { RuntimeId } from "../units/ids.ts";
import { milliseconds, scenePx } from "../units/units.ts";
import type { Milliseconds, ScenePx } from "../units/units.ts";
import { Projection, asExcalidrawElements, selectedIds, selectionAppState, selectionKey } from "./projection.ts";
import type { ProjectionApi, ProjectionScheduler } from "./projection.ts";

/** One rectangle in the composed scene, as the fingerprint reads it. */
function element(id: string, x: ScenePx): SceneElement {
  return { id: runtimeId(id), type: "rectangle", x, y: 0, width: 10, height: 10, isDeleted: false, version: 1 } as unknown as SceneElement;
}

/** An appState carrying only the selection, as the fence reads it. */
function appStateWith(ids: readonly string[]): AppState {
  return selectionAppState(ids.map(runtimeId)) as AppState;
}

/** A fake api that records every updateScene call and holds a scene and a selection. */
function fakeApi(elements: SceneElement[], selected: string[]) {
  const updates: unknown[] = [];
  const api: ProjectionApi = {
    /** Records one push instead of applying it. */
    updateScene: (update) => { updates.push(update); },
    /** Hands back the scene the fake holds. */
    getSceneElements: () => asExcalidrawElements(elements) as never,
    /** Hands back the selection the fake holds. */
    getAppState: () => appStateWith(selected),
  };
  return { api, updates };
}

/** A scheduler the test steps by hand. */
function fakeScheduler() {
  const microtasks: (() => void)[] = [];
  const timeouts: { run: () => void; delay: Milliseconds }[] = [];
  const scheduler: ProjectionScheduler = {
    /** Queues one microtask for the test to flush. */
    microtask: (run) => { microtasks.push(run); },
    /** Queues one timeout with its delay for the test to flush. */
    timeout: (run, delay) => { timeouts.push({ run, delay }); },
  };
  /** Runs every queued microtask. */
  const flushMicrotasks = () => { for (const run of microtasks.splice(0)) run(); };
  /** Runs every queued timeout. */
  const flushTimeouts = () => { for (const entry of timeouts.splice(0)) entry.run(); };
  return { scheduler, microtasks, timeouts, flushMicrotasks, flushTimeouts };
}

/** A fence over the fakes with a recorded event log and a clock the test advances. */
function fence(elements: SceneElement[], selected: string[]) {
  const { api, updates } = fakeApi(elements, selected);
  const timing = fakeScheduler();
  const events: Record<string, unknown>[] = [];
  const clock = { now: milliseconds(0) };
  const projection = new Projection({
    /** Hands the fence the fake api. */
    api: () => api,
    /** Records one diagnostic's fields. */
    recordEvent: (_name, fields) => { events.push(fields); },
    scheduler: timing.scheduler,
    /** Reads the clock the test advances. */
    now: () => clock.now,
  });
  return { projection, updates, events, clock, ...timing };
}

test("selectedIds reads the ids Excalidraw holds and selectionKey ignores order", () => {
  assert.deepEqual(selectedIds(appStateWith(["b", "a"])), ["b", "a"]);
  assert.deepEqual(selectedIds(null), []);
  assert.equal(selectionKey([runtimeId("b"), runtimeId("a")]), selectionKey([runtimeId("a"), runtimeId("b"), runtimeId("a")]));
});

test("project pushes elements with NEVER capture, records the request and fences until the window passes", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection, updates, events, timeouts, flushTimeouts } = fence(scene, []);
  const token = projection.project({ elements: scene, selection: [runtimeId("r1")] }, "projection");
  assert.ok(token !== null);
  assert.equal(token.includesElements, true);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { elements: scene, appState: selectionAppState([runtimeId("r1")]), captureUpdate: "NEVER" });
  assert.deepEqual(events[0], { projectionId: 1, phase: "request", projectionKind: "projection", affectedCount: 1, elementCount: 1 });
  assert.equal(projection.appliedFingerprint(), authoredFingerprint(scene));
  assert.equal(projection.hasFence(), true);
  assert.equal(timeouts[0]?.delay, LAYOUT.projectionFenceWindow);
  flushTimeouts();
  assert.equal(projection.hasFence(), false);
});

test("a selection-only push leaves the elements alone and a clear pushes editingTextElement null", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection, updates } = fence(scene, ["r1"]);
  projection.project({ selection: [] }, "pointer-release-selection");
  projection.project({ elements: scene, selection: [runtimeId("r1")], clearEditingText: true }, "stale-text-repair");
  projection.project({ elements: scene }, "area-pointer-preview");
  assert.deepEqual(updates[0], { appState: selectionAppState([]), captureUpdate: "NEVER" });
  assert.deepEqual(updates[1], { elements: scene, appState: { ...selectionAppState([runtimeId("r1")]), editingTextElement: null }, captureUpdate: "NEVER" });
  assert.deepEqual(updates[2], { elements: scene, captureUpdate: "NEVER" });
});

test("consume swallows the echo of a push once and reports its duration", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection, events, clock } = fence(scene, []);
  projection.project({ elements: scene, selection: [runtimeId("r1")] }, "projection");
  clock.now = milliseconds(7);
  const echo = asExcalidrawElements(scene) as readonly ExcalidrawElement[];
  assert.equal(projection.consume(echo, appStateWith(["r1"])), true);
  assert.equal(projection.consume(echo, appStateWith(["r1"])), false, "an echo is consumed once");
  assert.equal(projection.consume(echo, appStateWith([])), false, "a different selection is a real change");
  assert.deepEqual(events[1], { projectionId: 1, phase: "consumed", projectionKind: "projection", affectedCount: 1, elementCount: 1, duration: 7 });
  assert.equal(projection.lastFingerprint(), authoredFingerprint(scene));
});

test("project returns null and pushes nothing while Excalidraw is not mounted", () => {
  const timing = fakeScheduler();
  const projection = new Projection({
    /** Reports Excalidraw as not mounted. */
    api: () => null,
    /** Drops every diagnostic. */
    recordEvent: () => {},
    scheduler: timing.scheduler,
    /** A clock that never advances. */
    now: () => milliseconds(0),
  });
  assert.equal(projection.project({ selection: [] }, "claim"), null);
});

test("defer runs the last request after the microtask and cancel drops it", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection, updates, flushMicrotasks } = fence(scene, []);
  projection.defer({ selection: [runtimeId("r1")] }, "claim");
  projection.defer({ selection: [] }, "claim");
  flushMicrotasks();
  assert.equal(updates.length, 1, "a later defer supersedes an earlier one");
  assert.deepEqual(updates[0], { appState: selectionAppState([]), captureUpdate: "NEVER" });
  projection.defer({ selection: [] }, "claim");
  projection.cancel();
  flushMicrotasks();
  assert.equal(updates.length, 1, "cancel drops the queued push");
});

test("cancel forgets every expected echo and lifts the fence", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection } = fence(scene, []);
  projection.project({ elements: scene, selection: [] }, "projection");
  projection.cancel();
  assert.equal(projection.hasFence(), false);
  assert.equal(projection.consume(asExcalidrawElements(scene) as readonly ExcalidrawElement[], appStateWith([])), false);
});

test("absorbFencedChange settles a change under a pending element push and drops the tokens it covers", () => {
  const scene = [element("r1", scenePx(0))];
  const moved = [element("r1", scenePx(5))];
  const { projection } = fence(scene, []);
  assert.equal(projection.absorbFencedChange(asExcalidrawElements(scene) as readonly ExcalidrawElement[]), false, "nothing pending");
  projection.project({ elements: scene, selection: [] }, "projection");
  projection.project({ selection: [runtimeId("r1")] }, "claim");
  assert.equal(projection.absorbFencedChange(asExcalidrawElements(moved) as readonly ExcalidrawElement[]), true);
  assert.equal(projection.appliedFingerprint(), authoredFingerprint(moved));
  assert.equal(projection.consume(asExcalidrawElements(scene) as readonly ExcalidrawElement[], appStateWith([])), false, "the element token was dropped");
  assert.equal(projection.consume(asExcalidrawElements(scene) as readonly ExcalidrawElement[], appStateWith(["r1"])), true, "the later selection token survives");
});

test("the fence remembers at most the token cap", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection } = fence(scene, []);
  const cap = LAYOUT.projectionTokenCap;
  for (let step = 0; step < cap + 1; step += 1) projection.project({ selection: [runtimeId(`r${step}`)] }, "claim");
  assert.equal(projection.consume(asExcalidrawElements(scene) as readonly ExcalidrawElement[], appStateWith(["r0"])), false, "the oldest token was forgotten");
  assert.equal(projection.consume(asExcalidrawElements(scene) as readonly ExcalidrawElement[], appStateWith(["r1"])), true);
});

test("noteFingerprint records what the change handler published", () => {
  const scene = [element("r1", scenePx(0))];
  const { projection } = fence(scene, []);
  const fingerprint = authoredFingerprint(scene);
  projection.noteFingerprint(fingerprint);
  assert.equal(projection.lastFingerprint(), fingerprint);
  assert.equal(projection.appliedFingerprint(), null);
  const ids: RuntimeId[] = selectedIds(appStateWith(["r1"]));
  assert.deepEqual(ids, ["r1"]);
});
