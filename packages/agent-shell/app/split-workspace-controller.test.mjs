import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createSplitLayout } from "./public/split-workspace-core.js";
import { createSplitWorkspaceController } from "./public/split-workspace-controller.js";

test("the split preserves exact roots and mounts once through layout changes", async () => {
  const { window } = new JSDOM('<main id="host"></main>');
  const host = window.document.querySelector("#host");
  Object.defineProperty(host, "clientWidth", { value: 1200, configurable: true });
  const calls = { map: { mount: 0, fit: 0, dispose: [] }, brain: { mount: 0, fit: 0, dispose: [] } };
  /** Creates one counted test pane descriptor. */
  const descriptor = (id, minimum) => ({
    id, label: id === "map" ? "Map" : "Brain", minSizePx: minimum,
    /** Mounts one counted pane instance. */
    mount({ host: root }) {
      calls[id].mount += 1;
      root.append(window.document.createElement("article"));
      return {
        /** Counts visible fitting. */
        fit: () => calls[id].fit += 1,
        /** Focuses this test root. */
        focus: () => root.focus(),
        /** Records the disposal reason. */
        dispose: (reason) => calls[id].dispose.push(reason),
      };
    },
  });
  const layout = createSplitLayout({ paneIds: ["map", "brain"], entryPane: "map", preference: { order: ["map", "brain"], sizePx: { map: 560, brain: 560 } }, minSizePx: { map: 560, brain: 420 } });
  const controller = createSplitWorkspaceController({ host, descriptors: [descriptor("map", 560), descriptor("brain", 420)], layout, ResizeObserverClass: null });
  const mapRoot = controller.root("map");
  controller.show("brain");
  const brainRoot = controller.root("brain");
  controller.focus("brain");
  controller.setSize("brain", 520);
  controller.setOrder(["brain", "map"]);
  controller.measure(800);
  assert.equal(controller.root("brain").hasAttribute("inert"), true, "the inactive narrow pane is inert without being disposed");
  controller.measure(1200);
  assert.equal(controller.root("map"), mapRoot);
  assert.equal(controller.root("brain"), brainRoot);
  assert.deepEqual([calls.map.mount, calls.brain.mount], [1, 1]);
  controller.setOrder(["map", "brain"]);
  controller.measure(1000);
  assert.match(host.style.gridTemplateColumns, /434px$/, "a remembered width clamps without forcing the Map below its minimum");
  controller.measure(1200);
  assert.match(host.style.gridTemplateColumns, /520px$/, "the remembered width returns when the container grows");
  assert.equal(controller.separator.getAttribute("role"), "separator");
  const focusedBeforeResize = controller.snapshot().focused;
  controller.separator.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.notEqual(controller.snapshot().sizePx.brain, 560, "the separator resizes the pane that follows it");
  assert.equal(controller.snapshot().focused, focusedBeforeResize, "separator resize does not change pane focus");
  await controller.replace(descriptor("brain", 420));
  assert.deepEqual(calls.brain.dispose, ["retarget"]);
  assert.equal(calls.brain.mount, 2);
  await controller.destroy();
  assert.deepEqual(calls.map.dispose, ["leave"]);
  assert.deepEqual(calls.brain.dispose, ["retarget", "leave"]);
});
