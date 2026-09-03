// An Area's name pill, floated over the canvas at the Area's top-left corner.
//
// It is a real button so the keyboard can reach it: Tab lands on it, Enter selects the Area. It
// carries the class map.css gives `pointer-events: none`, so a wheel or a pointer over the name
// falls through to the canvas instead of stopping on the pill (audit defect 5). The pill is the one
// kit part positioned by a value from a feature, because the corner comes from the camera; the
// feature supplies a screen point and the kit writes the style.

import type { ReactNode } from "react";
import type { Point } from "../units/frames.ts";
import type { AreaKey } from "../units/ids.ts";

export type CanvasLabelProps = {
  readonly areaKey: AreaKey;
  /** The Area's display name. */
  readonly name: string;
  /** The full accessible name, with the state the pill shows in words. */
  readonly accessibleName: string;
  /** The pill's top-left corner on screen. */
  readonly at: Point<"screen">;
  /** True when Find's current match is this Area. */
  readonly current?: boolean;
  /** The state notes after the name: folded, loading, block count. */
  readonly children?: ReactNode;
  /** What activating the pill does, normally selecting the Area. Reached by keyboard only. */
  readonly onActivate: () => void;
};

const PILL_CLASS = "tangent-map-canvas-label";
const CURRENT_CLASS = "find-match-current";

/** An Area name pill: keyboard focusable, transparent to the pointer, positioned at a screen point. */
export function CanvasLabel(props: CanvasLabelProps): ReactNode {
  const { areaKey, name, accessibleName, at, current, children, onActivate } = props;
  return (
    <button
      type="button"
      className={current ? `${PILL_CLASS} ${CURRENT_CLASS}` : PILL_CLASS}
      data-area-map-label={areaKey}
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
      aria-label={accessibleName}
      onClick={onActivate}
    >
      <strong>{name}</strong>
      {children}
    </button>
  );
}
