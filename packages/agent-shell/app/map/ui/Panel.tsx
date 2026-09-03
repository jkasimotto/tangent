// The retained side panel: the Resources panel at wide widths. It stays open beside the canvas,
// keeps the canvas live, and takes its width from the layout token the Map root emits. `Sheet.tsx`
// is the same panel shown as a modal at narrow widths, so the shared base lives here.

import type { CSSProperties, ReactNode } from "react";
import { Surface } from "./Surface.tsx";
import type { SurfaceChildren } from "./Surface.tsx";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { Count } from "../units/units.ts";

export interface PanelProps {
  readonly id: SurfaceId;
  /** The class the suites select the panel by, `tangent-map-resources`. */
  readonly className: string;
  /** The class of the frame around it, `tangent-map-resources-backdrop` with `is-panel` or `is-modal`. */
  readonly frameClassName: string;
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly opener?: HTMLElement | null | undefined;
  /** A selector for the control focus lands on instead of the declared target, when it matches. */
  readonly initialFocus?: string | undefined;
  /** A serial that changes when focus is asked for again, even for the same control. */
  readonly focusSerial?: Count | undefined;
  readonly onClose: () => void;
  readonly onBackStep: () => void;
  readonly children: SurfaceChildren;
}

/** The panel is as wide as the layout token says, and every right-anchored surface subtracts it. */
const PANEL_WIDTH_STYLE: CSSProperties = { width: "var(--tangent-map-panel-width)" };

/** The base Panel and Sheet share: a side surface whose only difference is modality. */
export function SidePanel(props: PanelProps & { readonly modal: boolean }): ReactNode {
  return (
    <Surface
      id={props.id}
      className={props.className}
      frameClassName={props.frameClassName}
      modal={props.modal}
      label={props.label}
      labelledBy={props.labelledBy}
      opener={props.opener}
      initialFocus={props.initialFocus}
      focusSerial={props.focusSerial}
      style={PANEL_WIDTH_STYLE}
      onClose={props.onClose}
      onBackStep={props.onBackStep}
    >
      {props.children}
    </Surface>
  );
}

/** The retained side panel: non-modal, the canvas stays live beside it. */
export function Panel(props: PanelProps): ReactNode {
  return <SidePanel {...props} modal={false} />;
}
