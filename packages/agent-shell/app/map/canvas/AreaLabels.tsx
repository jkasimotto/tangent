// The Area name pills floated over the canvas, with the runtime facts under them.
//
// Every visible Area gets one pill at its region's top-left corner, from the kit's CanvasLabel:
// keyboard focusable, transparent to the pointer, so a wheel or a drag over a name reaches the
// canvas (audit defect 5). An Area that publishes runtime facts gets a row of them under the pill,
// from the kit's CanvasFacts, whose buttons open Work. The models come from area-label-model.ts;
// this file only renders them.

import { Fragment } from "react";
import type { ReactNode } from "react";
import { AREA_LABELS } from "../copy.ts";
import { Button } from "../ui/Button.tsx";
import { CanvasFacts, CanvasLabel } from "../ui/CanvasLabel.tsx";
import type { AreaKey } from "../units/ids.ts";
import type { AreaLabelModel, AreaRuntimeVerbAction, RuntimeFact } from "./area-label-model.ts";

export type AreaLabelsProps = {
  readonly labels: readonly AreaLabelModel[];
  /** Activating a pill selects its Area. */
  readonly onSelectArea: (area: AreaKey) => void;
  /** A runtime fact opens the Area in Work, For you or Problems. */
  readonly onRuntimeVerb: (action: AreaRuntimeVerbAction) => void;
};

/** The class map.css dashes the border of: a note from facts that are no longer fresh. */
const STALE_CLASS = "stale";

/** One runtime fact as a button that opens Work. */
function RuntimeFactButton({ label, fact, onRuntimeVerb }: { label: AreaLabelModel; fact: RuntimeFact; onRuntimeVerb: AreaLabelsProps["onRuntimeVerb"] }): ReactNode {
  const runtime = label.runtime;
  if (runtime === null) return null;
  return (
    <Button
      label={fact.label}
      data={{ "area-runtime-action": fact.verb }}
      aria-label={AREA_LABELS.runtimeActionName(fact.verb, label.name, fact.label)}
      onActivate={() => onRuntimeVerb({ kind: "area", area: label.areaKey, ref: runtime.ref, verb: fact.verb })}
    />
  );
}

/** The facts row under one pill: the fact buttons, then Ready, then Last known. */
function RuntimeFactsRow({ label, onRuntimeVerb }: { label: AreaLabelModel; onRuntimeVerb: AreaLabelsProps["onRuntimeVerb"] }): ReactNode {
  const runtime = label.runtime;
  if (runtime === null) return null;
  return (
    <CanvasFacts areaKey={label.areaKey} accessibleName={runtime.groupName} at={runtime.at}>
      {runtime.facts.map((fact) => <RuntimeFactButton key={fact.verb} label={label} fact={fact} onRuntimeVerb={onRuntimeVerb} />)}
      {runtime.ready ? <span>{AREA_LABELS.ready}</span> : null}
      {runtime.stale ? <span className={STALE_CLASS}>{AREA_LABELS.lastKnown}</span> : null}
    </CanvasFacts>
  );
}

/** The layer of pills and facts over the canvas. */
export function AreaLabels({ labels, onSelectArea, onRuntimeVerb }: AreaLabelsProps): ReactNode {
  return (
    <div className="tangent-map-ancestry" aria-label={AREA_LABELS.ancestryName}>
      {labels.map((label) => (
        <Fragment key={label.areaKey}>
          <CanvasLabel
            areaKey={label.areaKey}
            name={label.name}
            accessibleName={label.accessibleName}
            at={label.at}
            current={label.current}
            onActivate={() => onSelectArea(label.areaKey)}
          >
            {label.notes.map((note) => <span key={note}>{note}</span>)}
          </CanvasLabel>
          <RuntimeFactsRow label={label} onRuntimeVerb={onRuntimeVerb} />
        </Fragment>
      ))}
    </div>
  );
}
