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
  // Julian owns the split. Reaching a surface never opens its sibling: only
  // this remembered choice does, and it survives navigation and a restart.
  let companion = preference.companion === true;
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

  /** Writes the reusable layout preference with Julian's current split choice. */
  function rememberLayout() {
    writeSplitLayoutPreference(storage, { ...controller.snapshot(), companion });
  }
  /**
   * Arrives at one pane. It fills the workspace alone unless Julian asked for
   * a split, in which case both panes stay open and this one takes focus.
   */
  function enter(id, options = {}) {
    if (companion) return controller.show(id, { focus: true, ...options });
    return controller.enter(id, options);
  }
  /** Opens or closes the sibling pane. This is the one split control. */
  function toggleCompanion() {
    const current = controller.snapshot();
    const active = current.presentation.kind === "single" ? current.presentation.active : current.focused;
    companion = !companion;
    rememberLayout();
    if (companion) controller.show(current.order.find((id) => id !== active) ?? active);
    else controller.enter(active, { moveDomFocus: false });
  }
  /** True when Julian is holding both panes open. */
  function splitOpen() { return companion; }
  /** Persists only reusable layout preference after an explicit resize. */
  function setSize(id, value) {
    controller.setSize(id, value);
    rememberLayout();
  }
  /** Persists a future order control without changing pane or route ownership. */
  function setOrder(order) {
    controller.setOrder(order);
    rememberLayout();
  }

  return {
    area,
    entryPane,
    returnPoint,
    show: controller.show,
    enter,
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
    toggleCompanion,
    splitOpen,
    destroy: controller.destroy,
  };
}

export default { createAreaWorkspaceController };
