// The narrow modal variant of the side panel. At narrow widths the Resources panel cannot sit beside
// the canvas, so it becomes a sheet: the same surface, shown as a dialog behind one backdrop.

import type { ReactNode } from "react";
import { SidePanel } from "./Panel.tsx";
import type { PanelProps } from "./Panel.tsx";

/** The side panel as a modal sheet. */
export function Sheet(props: PanelProps): ReactNode {
  return <SidePanel {...props} modal={true} />;
}
