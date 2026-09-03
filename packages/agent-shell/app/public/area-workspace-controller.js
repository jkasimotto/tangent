import { createSplitLayout, readSplitLayoutPreference, writeSplitLayoutPreference } from "./split-workspace-core.js";
import { createSplitWorkspaceController } from "./split-workspace-controller.js";

/** Composes the exact Area's reusable Map and Brain panes into one visit. */
export function createAreaWorkspaceController({
  host,
  area,
  entryPane,
  returnPoint,
  mapPane,
  brainPane,
  storage = globalThis.localStorage,
  onLayoutChange = () => {},
}) {
  const minSizePx = { map: mapPane.minSizePx, brain: brainPane.minSizePx };
  const preference = readSplitLayoutPreference(storage, { minSizePx });
  const layout = createSplitLayout({ paneIds: ["map", "brain"], entryPane, preference, minSizePx });
  let controller = null;
  controller = createSplitWorkspaceController({
    host,
    descriptors: [mapPane, brainPane],
    layout,
    /** Reconciles pane-local chrome after each split transition. */
    onLayoutChange(next) {
      onLayoutChange(next);
      controller?.update?.({ layout: next });
    },
  });

  /** Opens or selects Map without changing this visit's return point. */
  function toggleMap() {
    const current = controller.snapshot();
    if (current.open.has("map") && current.presentation.kind === "single" && current.presentation.active !== "map") controller.focus("map", { moveDomFocus: true });
    else if (current.open.has("map") && current.primary !== "map") controller.hide("map");
    else if (!current.open.has("map")) controller.show("map");
    else controller.focus("map", { moveDomFocus: true });
  }
  /** Opens or hides Brain without stopping its logical session. */
  function toggleBrain() {
    const current = controller.snapshot();
    if (current.open.has("brain") && current.presentation.kind === "single" && current.presentation.active !== "brain") controller.focus("brain", { moveDomFocus: true });
    else if (current.open.has("brain") && current.primary !== "brain") controller.hide("brain");
    else if (!current.open.has("brain")) controller.show("brain", { focus: true, moveDomFocus: true });
    else controller.focus("brain", { moveDomFocus: true });
  }
  /** Persists only reusable layout preference after an explicit resize. */
  function setSize(id, value) {
    controller.setSize(id, value);
    writeSplitLayoutPreference(storage, controller.snapshot());
  }
  /** Persists a future order control without changing pane or route ownership. */
  function setOrder(order) {
    controller.setOrder(order);
    writeSplitLayoutPreference(storage, controller.snapshot());
  }

  return {
    area,
    entryPane,
    returnPoint,
    show: controller.show,
    hide: controller.hide,
    focus: controller.focus,
    setOrder,
    setPrimary: controller.setPrimary,
    setSize,
    update: controller.update,
    restore: controller.restore,
    replace: controller.replace,
    portal: controller.portal,
    unportal: controller.unportal,
    measure: controller.measure,
    snapshot: controller.snapshot,
    root: controller.root,
    instance: controller.instance,
    separator: controller.separator,
    toggleMap,
    toggleBrain,
    destroy: controller.destroy,
  };
}

export default { createAreaWorkspaceController };
