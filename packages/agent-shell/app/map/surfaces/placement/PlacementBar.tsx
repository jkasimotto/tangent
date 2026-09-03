// The placement bar: the status strip under the canvas while a resource Block waits for its point.
// It names the resource and the Area it lands in, prints the keys, and offers Place and Cancel.
// It is a registered transient surface, so it renders through the kit with `role="status"` and
// takes no focus: the canvas keeps the keyboard and the pointer while it shows.

import type { ReactNode } from "react";
import { PLACEMENT } from "../../copy.ts";
import { Button } from "../../ui/Button.tsx";
import { KeyedSentence } from "../../ui/KeyedSentence.tsx";
import { Surface } from "../../ui/Surface.tsx";
import type { Placement } from "./placement-store.ts";

export type PlacementBarProps = {
  readonly placement: Placement;
  /** The display name of the Area the Block lands in. */
  readonly areaName: string;
  /** Commits at the preview's current point. */
  readonly onPlace: () => void;
  readonly onCancel: () => void;
};

/** The bar shown while a resource Block waits for its point. */
export function PlacementBar({ placement, areaName, onPlace, onCancel }: PlacementBarProps): ReactNode {
  const label = placement.entity.label;
  return (
    <Surface id="placement" className="tangent-map-resource-placement" role="status" label={PLACEMENT.name(label)} onClose={onCancel} onBackStep={onCancel}>
      <strong>{PLACEMENT.title(label, areaName)}</strong>
      <span><KeyedSentence parts={PLACEMENT.move} /></span>
      <span><KeyedSentence parts={PLACEMENT.commit} /></span>
      <Button label={PLACEMENT.place} onActivate={onPlace} />
      <Button label={PLACEMENT.cancel} onActivate={onCancel} />
    </Surface>
  );
}
