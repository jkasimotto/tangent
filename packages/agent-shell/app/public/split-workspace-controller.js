import {
  enterSplitPane,
  focusSplitPane,
  hideSplitPane,
  orderSplitPanes,
  reconcileSplitPresentation,
  showSplitPane,
  sizeSplitPane,
} from "./split-workspace-core.js";

/** Mounts two stable pane roots inside one reusable split container. */
export function createSplitWorkspaceController({
  host,
  descriptors,
  layout,
  separatorPx = 6,
  onLayoutChange = () => {},
  ResizeObserverClass = globalThis.ResizeObserver,
}) {
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const minSizePx = Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, descriptor.minSizePx]));
  const roots = new Map();
  const instances = new Map();
  const portals = new Map();
  let availableWidth = host.clientWidth || globalThis.innerWidth || 0;
  let current = reconcileSplitPresentation(layout, availableWidth, minSizePx, separatorPx);
  let destroyed = false;

  host.replaceChildren();
  host.classList.add("split-workspace");
  const separator = host.ownerDocument.createElement("div");
  separator.className = "split-workspace-separator";
  separator.dataset.splitSeparator = "";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-orientation", "vertical");

  /** Creates one stable pane root and mounts its content at most once. */
  function ensureMounted(id) {
    if (instances.has(id)) return instances.get(id);
    const descriptor = descriptorById.get(id);
    if (!descriptor) return null;
    const root = host.ownerDocument.createElement("section");
    root.className = "split-workspace-pane";
    root.dataset.splitPane = id;
    root.dataset.paneLabel = descriptor.label;
    root.tabIndex = -1;
    roots.set(id, root);
    const instance = descriptor.mount({
      host: root,
      paneId: id,
      /** Requests logical pane focus without naming a sibling. */
      requestFocus: () => focus(id),
    });
    instances.set(id, instance ?? {});
    return instances.get(id);
  }

  /** Applies state by moving the same pane roots. It never remounts content. */
  function apply({ fit = true, reorder = true } = {}) {
    if (destroyed) return;
    const active = host.ownerDocument.activeElement;
    const restoreActive = reorder && host.contains(active) ? active : null;
    for (const id of current.open) ensureMounted(id);
    if (reorder) host.replaceChildren();
    const visible = current.presentation.kind === "wide"
      ? current.order.filter((id) => current.open.has(id))
      : [current.presentation.active];
    for (const id of current.order) {
      const root = roots.get(id);
      if (!root) continue;
      const portal = portals.get(id);
      const shown = Boolean(portal) || visible.includes(id);
      root.hidden = !shown;
      root.toggleAttribute("inert", !shown);
      root.classList.toggle("focused", shown && current.focused === id);
      root.setAttribute("aria-label", descriptorById.get(id).label);
      if (portal) portal.append(root);
      else if (reorder) {
        const hostVisible = current.order.filter((paneId) => visible.includes(paneId) && !portals.has(paneId));
        if (hostVisible.indexOf(id) > 0 && hostVisible.length === 2) host.append(separator);
        host.append(root);
      }
    }
    host.dataset.presentation = current.presentation.kind;
    const visibleOrder = current.order.filter((id) => visible.includes(id) && !portals.has(id));
    if (visibleOrder.length === 2) {
      const fixed = visibleOrder[1];
      const maximum = Math.max(minSizePx[fixed], availableWidth - minSizePx[visibleOrder[0]] - separatorPx);
      const renderedSize = Math.min(current.sizePx[fixed], maximum);
      host.style.gridTemplateColumns = `minmax(${minSizePx[visibleOrder[0]]}px, 1fr) ${separatorPx}px ${renderedSize}px`;
      separator.hidden = false;
      separator.dataset.fixedPane = fixed;
      separator.setAttribute("aria-label", `Resize ${descriptorById.get(fixed).label}`);
      separator.setAttribute("aria-valuemin", String(minSizePx[fixed]));
      separator.setAttribute("aria-valuemax", String(maximum));
      separator.setAttribute("aria-valuenow", String(renderedSize));
    } else {
      host.style.gridTemplateColumns = "minmax(0, 1fr)";
      separator.hidden = true;
    }
    if (restoreActive?.isConnected && !restoreActive.closest?.("[inert]")) restoreActive.focus?.({ preventScroll: true });
    if (fit) for (const id of visible) instances.get(id)?.fit?.();
    onLayoutChange(snapshot());
  }

  /** Returns a detached state copy for callers and tests. */
  function snapshot() {
    return {
      ...current,
      order: [...current.order],
      open: new Set(current.open),
      sizePx: { ...current.sizePx },
      presentation: { ...current.presentation },
      canSplit: availableWidth >= current.order.reduce((sum, id) => sum + minSizePx[id], separatorPx),
    };
  }

  /** Measures this container and changes presentation without changing panes. */
  function measure(width = host.clientWidth || availableWidth) {
    availableWidth = Number(width) || availableWidth;
    current = reconcileSplitPresentation(current, availableWidth, minSizePx, separatorPx);
    apply();
  }

  /** Opens one pane without remounting an existing instance. */
  function show(id, options = {}) {
    const { moveDomFocus = false, ...layoutOptions } = options;
    current = showSplitPane(current, id, { ...layoutOptions, availableWidth, minSizePx, separatorPx });
    apply();
    if (moveDomFocus) instances.get(id)?.focus?.();
  }
  /** Enters one pane alone without disposing the sibling's instance. */
  function enter(id, { moveDomFocus = false } = {}) {
    current = enterSplitPane(current, id, { availableWidth, minSizePx, separatorPx });
    apply();
    if (moveDomFocus) instances.get(id)?.focus?.();
  }
  /** Hides one companion without disposing its instance. */
  function hide(id) {
    current = hideSplitPane(current, id, { availableWidth, minSizePx, separatorPx });
    apply();
  }
  /** Changes logical focus and optionally moves DOM focus into the pane. */
  function focus(id, { moveDomFocus = false } = {}) {
    current = focusSplitPane(current, id);
    apply({ fit: false, reorder: false });
    if (moveDomFocus) instances.get(id)?.focus?.();
  }
  /** Reorders the same pane roots. */
  function setOrder(order) {
    current = orderSplitPanes(current, order);
    apply();
  }
  /** Changes one remembered pane size within current constraints. */
  function setSize(id, value) {
    current = sizeSplitPane(current, id, value, { availableWidth, minSizePx, separatorPx });
    apply();
  }
  /** Changes visit prominence without changing focus or order. */
  function setPrimary(id) {
    if (!current.open.has(id)) return;
    current = { ...current, primary: id };
    apply({ fit: false });
  }
  /** Sends one projection snapshot to every mounted pane. */
  function update(value) {
    for (const instance of instances.values()) instance.update?.(value);
  }
  /** Restores one previously captured visit layout around the same pane roots. */
  function restore(layout) {
    if (!layout) return false;
    current = reconcileSplitPresentation({ ...layout, open: new Set(layout.open), order: [...layout.order], sizePx: { ...layout.sizePx }, presentation: { ...layout.presentation } }, availableWidth, minSizePx, separatorPx);
    apply();
    return true;
  }
  /** Moves one stable pane root into a temporary context without remounting it. */
  function portal(id, target) {
    if (!target || !descriptorById.has(id)) return null;
    ensureMounted(id);
    portals.set(id, target);
    apply({ fit: false });
    return instances.get(id) ?? null;
  }
  /** Returns one portaled pane to the retained workspace. */
  function unportal(id) {
    if (!portals.delete(id)) return false;
    apply({ fit: false });
    return true;
  }
  /** Replaces one pane instance for an explicit domain retarget. */
  async function replace(descriptor) {
    const previous = descriptorById.get(descriptor.id);
    if (!previous) return;
    await instances.get(descriptor.id)?.dispose?.("retarget");
    instances.delete(descriptor.id);
    roots.get(descriptor.id)?.remove();
    roots.delete(descriptor.id);
    descriptorById.set(descriptor.id, descriptor);
    minSizePx[descriptor.id] = descriptor.minSizePx;
    if (current.open.has(descriptor.id)) ensureMounted(descriptor.id);
    apply();
  }
  /** Disposes each mounted pane exactly once. */
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect?.();
    separator.removeEventListener("keydown", onSeparatorKeydown);
    for (const instance of instances.values()) await instance.dispose?.("leave");
    instances.clear();
    roots.clear();
    portals.clear();
    host.replaceChildren();
  }

  /** Resizes the fixed adjacent pane after the separator receives focus. */
  function onSeparatorKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || separator.hidden) return;
    event.preventDefault();
    const id = separator.dataset.fixedPane;
    const direction = current.order.indexOf(id) === 1 ? (event.key === "ArrowLeft" ? 1 : -1) : (event.key === "ArrowRight" ? 1 : -1);
    setSize(id, current.sizePx[id] + direction * (event.shiftKey ? 40 : 10));
  }
  separator.addEventListener("keydown", onSeparatorKeydown);
  host.addEventListener("focusin", (event) => {
    const root = event.target.closest?.("[data-split-pane]");
    if (root && current.focused !== root.dataset.splitPane) focus(root.dataset.splitPane);
  });
  host.addEventListener("pointerdown", (event) => {
    const root = event.target.closest?.("[data-split-pane]");
    if (root) focus(root.dataset.splitPane);
  });

  const observer = ResizeObserverClass ? new ResizeObserverClass((entries) => {
    const width = entries?.[0]?.contentRect?.width;
    measure(width);
  }) : null;
  observer?.observe?.(host);
  apply();
  instances.get(current.focused)?.focus?.();

  return {
    show, enter, hide, focus, setOrder, setSize, setPrimary, update, restore, replace, portal, unportal, measure, snapshot,
    /** Returns one stable pane root for integration and tests. */
    root: (id) => roots.get(id) ?? null,
    /** Returns one mounted content instance for domain actions. */
    instance: (id) => instances.get(id) ?? null,
    separator,
    destroy,
  };
}

export default { createSplitWorkspaceController };
