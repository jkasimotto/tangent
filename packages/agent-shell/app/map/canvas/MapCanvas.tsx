// The one component that renders Excalidraw.
//
// It is memoised over two stable references, the initial data and a handlers ref, so the Map root
// can repaint its overlays as often as it likes while Excalidraw stays mounted (the browser suites
// count one mount). Excalidraw's pointer props are wired here and nowhere else; each callback is
// forwarded to whatever the handlers ref holds now, so the root swaps handlers without a remount.
// The scroll callback is branded into a Camera and the pointer update into a scene point on the
// way out, so no other module reads Excalidraw's raw numbers.
//
// Excalidraw's `autoFocus` is not passed: only the kit may move focus, and the host focuses the
// canvas through the bridge when it needs to.

import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, ExcalidrawProps, UIOptions } from "@excalidraw/excalidraw/types";
import { memo } from "react";
import type { ReactNode } from "react";
import { AREA_LABELS } from "../copy.ts";
import { point } from "../units/frames.ts";
import type { Camera, Point } from "../units/frames.ts";
import { scenePx, zoom as zoomFactor } from "../units/units.ts";
import { MAP_THEME } from "./icon-files.ts";

/** Which button state the pointer moved with. */
export type PointerButton = "down" | "up";

/** The callbacks the root hands the canvas. Excalidraw's own signatures where the raw state is the contract, branded values elsewhere. */
export type CanvasHandlers = {
  readonly setApi: (api: ExcalidrawImperativeAPI) => void;
  readonly onPointerDown: NonNullable<ExcalidrawProps["onPointerDown"]>;
  readonly onPointerUp: NonNullable<ExcalidrawProps["onPointerUp"]>;
  readonly onPointerMove: (pointer: Point<"scene">, button: PointerButton) => void;
  readonly onCamera: (camera: Camera) => void;
  readonly onPaste: NonNullable<ExcalidrawProps["onPaste"]>;
  readonly onChange: NonNullable<ExcalidrawProps["onChange"]>;
};

/** A ref whose current value is read at call time, so the root may replace the handlers freely. */
export type CanvasHandlersRef = { readonly current: CanvasHandlers };

export type MapCanvasProps = {
  /** The scene Excalidraw mounts with. Must be the same reference for the life of the Map. */
  readonly initialData: ExcalidrawInitialDataState;
  readonly handlers: CanvasHandlersRef;
};

/** Tangent has no image tool, no files and no theme toggle of its own; the Map owns those. */
const EXCALIDRAW_UI_OPTIONS: Partial<UIOptions> = Object.freeze({
  tools: { image: false },
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
} as const);

/** Excalidraw, mounted once, with every callback forwarded to the current handlers. */
export const MapCanvas = memo(
  /** Renders the Excalidraw element. */
  function MapCanvas({ initialData, handlers }: MapCanvasProps): ReactNode {
    return (
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => handlers.current.setApi(api)}
        theme={MAP_THEME}
        name={AREA_LABELS.canvasName}
        handleKeyboardGlobally={false}
        UIOptions={EXCALIDRAW_UI_OPTIONS}
        onPointerDown={(tool, pointerDownState) => handlers.current.onPointerDown(tool, pointerDownState)}
        onPointerUp={(tool, pointerDownState) => handlers.current.onPointerUp(tool, pointerDownState)}
        onPointerUpdate={({ pointer, button }) => handlers.current.onPointerMove(point("scene", scenePx(pointer.x), scenePx(pointer.y)), button)}
        onScrollChange={(scrollX, scrollY, zoom) => handlers.current.onCamera({ scrollX: scenePx(scrollX), scrollY: scenePx(scrollY), zoom: zoomFactor(zoom.value) })}
        onPaste={(data, event) => handlers.current.onPaste(data, event)}
        onChange={(elements, appState, files) => handlers.current.onChange(elements, appState, files)}
      />
    );
  },
);
