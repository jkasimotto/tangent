// Where the Map's controller comes from, and where its diagnostics go.
//
// The host may hand the Map a controller it already owns, which is what `public/area-board.js`
// does. When it does not, the Map builds one from the mount options and owns its life: it flushes
// and destroys it on unmount. Either way every coordinate-free diagnostic the Map records reaches
// two places, the host's `onEvent` and a `tangent:area-map` custom event on the window, because the
// browser suites listen for the second and the shell reads the first.

import { createAreaMapWorldController } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, ControllerEvent, World } from "../kernel/kernel-types.ts";
import { INTERNAL_ERRORS } from "../copy.ts";
import type { WorldMountOptions } from "../mount-options.ts";

/** The custom event the browser suites listen for on the window. */
const EVENT_NAME = "tangent:area-map";

/** Forwards one coordinate-free Map diagnostic to the host and to browser listeners. */
export function emitAreaMapEvent(options: WorldMountOptions, event: ControllerEvent): void {
  options.onEvent?.(event);
  try {
    globalThis.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
  } catch {
    // Diagnostics never block the Map.
  }
}

/** The controller the Map runs on, and whether the Map is the one that has to destroy it. */
export type ControllerLease = {
  readonly controller: AreaMapController;
  readonly owned: boolean;
};

/** The world the options carry, or a failure the error boundary shows as words. */
function worldOf(options: WorldMountOptions): World {
  if (options.world === undefined) throw new Error(INTERNAL_ERRORS.worldUnavailable);
  return options.world;
}

/**
 * Returns the controller the Map runs on. A controller the host passed is used as it is; otherwise
 * one is created from the mount options, exactly as the old component's `controllerRef` did, with
 * every diagnostic routed through `emitAreaMapEvent` so a direct mount emits what the suites read.
 */
export function leaseController(options: WorldMountOptions): ControllerLease {
  if (options.controller !== undefined) return { controller: options.controller, owned: false };
  const controller = createAreaMapWorldController({
    world: worldOf(options),
    ...(options.getDocuments ? { getDocuments: options.getDocuments } : {}),
    ...(options.focus ? { focus: options.focus } : {}),
    ...(options.loadShard ? { loadShard: options.loadShard } : {}),
    ...(options.reloadWorld ? { reloadWorld: options.reloadWorld } : {}),
    ...(options.persistWorld ?? options.onWorldChange ? { persistWorld: options.persistWorld ?? options.onWorldChange } : {}),
    ...(options.persistView ? { persistView: options.persistView } : {}),
    ...(options.onBack ? { onBack: options.onBack } : {}),
    ...(options.onNavigation ? { onNavigation: options.onNavigation } : {}),
    /** Forwards coordinate-free diagnostics to the host and to browser listeners. */
    onEvent(event: ControllerEvent) {
      emitAreaMapEvent(options, event);
    },
  });
  return { controller, owned: true };
}
