import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAreaMapPane } from "./public/area-map-pane.js";
import { createAreaWorkspaceController } from "./public/area-workspace-controller.js";

/** Lets promise callbacks update the mounted test DOM. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Map recovery keeps the Brain pane and split instance available", async () => {
  const { window } = new JSDOM('<main id="host"></main>', { url: "http://agent-shell.test/" });
  const host = window.document.querySelector("#host");
  Object.defineProperty(host, "clientWidth", { value: 1200, configurable: true });
  let loadCount = 0;
  let mapMountCount = 0;
  let mapDestroyCount = 0;
  let brainDisposeCount = 0;
  /** Supplies a no-effect pane dependency for this focused test. */
  const noop = () => {};
  /** Returns no projected Documents. */
  const noDocuments = () => [];
  /** Returns an empty focus projection. */
  const noFocus = () => ({});
  /** Returns an unused API result. */
  const api = async () => ({});
  const mapPane = createAreaMapPane({
    area: "otto/tangent",
    areaBoardView: {
      /** Fails the first authority load and recovers on Retry. */
      async loadAreaMapAuthority() {
        loadCount += 1;
        if (loadCount === 1) throw new Error("map fixture unavailable");
        return { mode: "world", world: { schema: "area-map-world.v1" } };
      },
      /** Mounts one counted Map controller after recovery. */
      mount(mapHost) {
        mapMountCount += 1;
        mapHost.append(window.document.createElement("canvas"));
        return {
          refreshFacts: noop,
          /** Records Map controller disposal. */
          async destroy() { mapDestroyCount += 1; },
        };
      },
    },
    api, documents: noDocuments, getDocuments: noDocuments, focus: noFocus,
    onEvent: noop, onEntityVerb: noop, onBack: noop, onNavigation: noop, onViewState: noop,
  });
  const brainPane = {
    id: "brain", label: "Brain", minSizePx: 420,
    /** Mounts the stable sibling pane. */
    mount({ host: brainHost }) {
      brainHost.textContent = "Brain remains usable";
      return {
        update: noop, focus: noop, fit: noop,
        /** Records Brain pane disposal. */
        dispose() { brainDisposeCount += 1; },
      };
    },
  };
  const workspace = createAreaWorkspaceController({
    host, area: "otto/tangent", entryPane: "brain", returnPoint: { view: "work" }, mapPane, brainPane, storage: window.localStorage,
  });
  const brainRoot = workspace.root("brain");
  workspace.show("map");
  await settle();
  const alert = workspace.root("map").querySelector('[role="alert"]');
  assert.match(alert.textContent, /map fixture unavailable/);
  assert.equal(workspace.root("brain"), brainRoot, "a Map load error keeps the exact Brain root");
  assert.equal(brainRoot.textContent, "Brain remains usable");
  alert.querySelector("button").click();
  await settle();
  assert.equal(mapMountCount, 1, "Retry mounts one Map controller after authority recovers");
  assert.equal(workspace.root("brain"), brainRoot, "Map Retry does not replace the Brain pane");
  await workspace.destroy();
  assert.deepEqual([mapDestroyCount, brainDisposeCount], [1, 1]);
});
