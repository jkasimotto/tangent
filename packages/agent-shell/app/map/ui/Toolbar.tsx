// The Map's top-right control row: Block, Resources, the Block verbs, Outline and Keys. map.css
// positions it and, with the Resources panel open, insets it from the panel; the narrow layout
// collapses its buttons to glyphs through the classes Button renders.

import type { ReactNode } from "react";

export type ToolbarProps = {
  readonly children: ReactNode;
};

/** The row of controls in the Map's top-right corner. */
export function Toolbar({ children }: ToolbarProps): ReactNode {
  return <div className="tangent-map-top-right">{children}</div>;
}
