// The long-lived objects the Map root builds once and keeps for its whole life.
//
// The projection fence, the pointer session, the text buffer and the icon registry each hold state
// that must survive every repaint, and each needs a door back into the root that is only decided
// later in the render. That is what the two refs here are for: `publish` is read at call time, so
// the pointer session can be built before the publish dependencies exist, and `session.api` is read
// at call time, so the fence can be built before Excalidraw has mounted.

import { useRef } from "react";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { IconFileRegistry } from "../canvas/icon-files.ts";
import { Projection, browserProjectionScheduler, performanceClock } from "../canvas/projection.ts";
import type { CanvasHandlers } from "../canvas/MapCanvas.tsx";
import { TextEditBuffer } from "../canvas/text-edit.ts";
import { PointerSession, browserPointerScheduler } from "../input/pointer-session.ts";
import type { PublishRequest } from "../input/pointer-session.ts";
import { themeInkColor } from "../kernel/kernel-boundary.ts";
import type { AreaMapController, Snapshot } from "../kernel/kernel-types.ts";
import type { WorldMountOptions } from "../mount-options.ts";
import { createMapSession } from "./map-session.ts";
import { emitAreaMapEvent } from "./map-root-controller.ts";
import type { RuntimeCore } from "./map-runtime.ts";

/** The ink colour a new stroke is authored with, so the dark theme's filter draws the stored colour. */
const DEFAULT_INK = themeInkColor("#1e1e1e");

/** Everything built once, with the two late-bound doors the root fills in as it renders. */
export type MapCore = RuntimeCore & {
  readonly icons: IconFileRegistry;
  /** True when the Map created the controller itself and must destroy it on unmount. */
  readonly owned: boolean;
  /** The scene Excalidraw mounts with. The same reference for the life of the Map, so it never remounts. */
  readonly initialData: ExcalidrawInitialDataState;
  /** The publish the pointer session calls; the root replaces its contents every render. */
  readonly publishRef: { current: (request: PublishRequest) => void };
  /** The canvas callbacks Excalidraw reads at call time, so the root swaps them without a remount. */
  readonly handlersRef: { current: CanvasHandlers };
};

/** Builds the Map's long-lived objects on the first render and returns the same ones after. */
export function useMapCore(host: HTMLElement, options: WorldMountOptions, controller: AreaMapController, first: Snapshot, owned: boolean): MapCore {
  const built = useRef<MapCore | null>(null);
  if (built.current === null) built.current = buildCore(host, options, controller, first, owned);
  return built.current;
}

/** Builds every long-lived object once. */
function buildCore(host: HTMLElement, options: WorldMountOptions, controller: AreaMapController, first: Snapshot, owned: boolean): MapCore {
  const session = createMapSession();
  const publishRef: { current: (request: PublishRequest) => void } = { current: noPublish };
  const projection = new Projection({
    /** Excalidraw's api, read at call time because the fence outlives every mount. */
    api: () => session.api,
    /** Records one projection diagnostic through the controller, which forwards it to the host. */
    recordEvent: (name, fields) => controller.recordEvent(name, fields),
    scheduler: browserProjectionScheduler(),
    now: performanceClock,
  });
  const pointer = new PointerSession({
    controller,
    /** Publishes one release state through whatever the root wired this render. */
    publish: (request) => publishRef.current(request),
    scheduler: browserPointerScheduler(),
    /** Records one pointer diagnostic through the controller. */
    recordEvent: (name, fields) => controller.recordEvent(name, fields),
  });
  const icons = new IconFileRegistry({
    /** Excalidraw's api, read at call time. */
    api: () => session.api,
    /** Forwards the registered icon file ids as the diagnostic the figure suite listens for. */
    emit: (event) => emitAreaMapEvent(options, { ...event }),
    /** The wall clock the diagnostic is stamped with. */
    now: () => Date.now(),
  });
  const handlersRef: { current: CanvasHandlers } = { current: idleHandlers() };
  return { host, options, controller, session, pointer, projection, buffer: new TextEditBuffer(), icons, owned, initialData: initialDataOf(first), publishRef, handlersRef };
}

/** The scene Excalidraw mounts with: the composed scene at the camera the controller restored. */
function initialDataOf(first: Snapshot): ExcalidrawInitialDataState {
  return {
    ...first.scene,
    appState: {
      ...(first.scene.appState ?? {}),
      currentItemStrokeColor: DEFAULT_INK,
      scrollX: first.camera.scrollX,
      scrollY: first.camera.scrollY,
      zoom: { value: first.camera.zoom },
    },
  } as unknown as ExcalidrawInitialDataState;
}

/** The canvas callbacks before the root has wired them, which is only during the first render. */
function idleHandlers(): CanvasHandlers {
  /** Ignores whatever Excalidraw reports before the root has wired its handlers. */
  const ignore = (): undefined => undefined;
  /** Lets Excalidraw paste as it always does until the root wires the picker's claim. */
  const paste = (): boolean => true;
  return { setApi: ignore, onPointerDown: ignore, onPointerUp: ignore, onPointerMove: ignore, onCamera: ignore, onPaste: paste, onChange: ignore };
}

/** The publish before the root has wired one, which happens only on the very first render. */
function noPublish(_request: PublishRequest): void {
  // The root replaces this on its first render, before any pointer event can reach it.
}
