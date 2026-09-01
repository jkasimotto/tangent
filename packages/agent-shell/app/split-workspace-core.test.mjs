import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_WORKSPACE_LAYOUT_KEY,
  createSplitLayout,
  focusSplitPane,
  hideSplitPane,
  orderSplitPanes,
  readSplitLayoutPreference,
  reconcileSplitPresentation,
  showSplitPane,
  sizeSplitPane,
  writeSplitLayoutPreference,
} from "./public/split-workspace-core.js";

const panes = ["map", "brain"];
const minimums = { map: 560, brain: 420 };
const preference = { order: panes, sizePx: { map: 560, brain: 560 } };

test("entry direction changes primary and focus without changing pane order", () => {
  const map = createSplitLayout({ paneIds: panes, entryPane: "map", preference, minSizePx: minimums });
  const brain = createSplitLayout({ paneIds: panes, entryPane: "brain", preference, minSizePx: minimums });
  assert.deepEqual([map.primary, map.focused, [...map.open]], ["map", "map", ["map"]]);
  assert.deepEqual([brain.primary, brain.focused, [...brain.open]], ["brain", "brain", ["brain"]]);
  assert.deepEqual(map.order, brain.order);
});

test("show, hide, focus, order, and responsive changes preserve independent facts", () => {
  let layout = createSplitLayout({ paneIds: panes, entryPane: "brain", preference, minSizePx: minimums });
  layout = showSplitPane(layout, "map", { availableWidth: 1200, minSizePx: minimums });
  assert.deepEqual([layout.primary, layout.focused, layout.presentation.kind], ["brain", "brain", "wide"]);
  layout = focusSplitPane(layout, "map");
  layout = orderSplitPanes(layout, ["brain", "map"]);
  layout = sizeSplitPane(layout, "map", 720, { availableWidth: 1200, minSizePx: minimums });
  assert.deepEqual([layout.primary, layout.focused, layout.order, layout.sizePx.map], ["brain", "map", ["brain", "map"], 720]);
  layout = reconcileSplitPresentation(layout, 900, minimums);
  assert.deepEqual(layout.presentation, { kind: "single", active: "brain" }, "the last single-pane choice remains the narrow default");
  layout = reconcileSplitPresentation(layout, 1200, minimums);
  assert.equal(layout.presentation.kind, "wide");
  layout = reconcileSplitPresentation(layout, 900, minimums);
  assert.deepEqual(layout.presentation, { kind: "single", active: "brain" }, "wide mode restores the last narrow pane for this visit");
  layout = focusSplitPane(layout, "map");
  layout = reconcileSplitPresentation(layout, 1200, minimums);
  layout = reconcileSplitPresentation(layout, 900, minimums);
  assert.deepEqual(layout.presentation, { kind: "single", active: "map" }, "a later narrow choice survives another wide interval");
  layout = reconcileSplitPresentation(layout, 1200, minimums);
  layout = hideSplitPane(layout, "map", { availableWidth: 1200, minSizePx: minimums });
  assert.deepEqual([...layout.open], ["brain"]);
  assert.equal(hideSplitPane(layout, "brain", { availableWidth: 1200, minSizePx: minimums }), layout, "the primary pane cannot be hidden");
});

test("narrow companion opening selects it without changing primary", () => {
  const initial = createSplitLayout({ paneIds: panes, entryPane: "brain", preference, minSizePx: minimums });
  const shown = showSplitPane(initial, "map", { availableWidth: 800, minSizePx: minimums });
  assert.deepEqual([shown.primary, shown.focused, shown.presentation], ["brain", "map", { kind: "single", active: "map" }]);
});

test("layout preference validates new records and migrates the old Brain width", () => {
  const values = new Map([["agent-shell.map-brain-width", "615"]]);
  const storage = {
    /** Reads one in-memory preference. */
    getItem: (key) => values.get(key) ?? null,
    /** Writes one in-memory preference. */
    setItem: (key, value) => values.set(key, value),
  };
  assert.deepEqual(readSplitLayoutPreference(storage), { order: panes, sizePx: { map: 560, brain: 615 } });
  const layout = createSplitLayout({ paneIds: panes, entryPane: "map", preference: readSplitLayoutPreference(storage), minSizePx: minimums });
  writeSplitLayoutPreference(storage, layout);
  assert.deepEqual(JSON.parse(values.get(AREA_WORKSPACE_LAYOUT_KEY)), { schema: "area-workspace-layout.v1", order: panes, sizePx: { brain: 615 } });
  values.set(AREA_WORKSPACE_LAYOUT_KEY, '{"schema":"wrong","order":["brain","brain"],"sizePx":{"brain":"bad"}}');
  assert.deepEqual(readSplitLayoutPreference(storage), { order: panes, sizePx: { map: 560, brain: 615 } });
  values.set(AREA_WORKSPACE_LAYOUT_KEY, '{"schema":"area-workspace-layout.v1","order":["map","brain"],"sizePx":{"brain":"bad"}}');
  assert.deepEqual(readSplitLayoutPreference(storage), { order: panes, sizePx: { map: 560, brain: 615 } }, "a corrupt new width falls back to the valid legacy preference");
});
