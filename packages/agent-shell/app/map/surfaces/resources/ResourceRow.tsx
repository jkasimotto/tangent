// One row of the resource inventory. It reads the same facts as the row's Map Block, so the panel
// and the canvas never disagree about what a resource is called or what it points at. Its buttons
// are data: one list of labels, states and commands, rendered through the kit's Button, each named
// with the action and the whole row so a screen reader hears which resource it acts on.

import type { ReactNode } from "react";
import { RESOURCES_PANEL, RESOURCE_ROW } from "../../copy.ts";
import type { MapEntityFacts, ResourceEntity, ResourcePanelRow } from "../../kernel/kernel-types.ts";
import type { Representation } from "../../copy.ts";
import { areaLeaf } from "../../canvas/area-label-model.ts";
import { Button } from "../../ui/Button.tsx";
import { refreshRowFacts, runResourceAction, showResourceDetails, viewResourceArea } from "./resource-actions.ts";
import { resourceRowKey, resourceWarningTexts, rowCanAddBack, rowIsDirect, rowIsLaunchDefault, rowIsWrongKind, rowProvenance, rowRefreshLabel, rowTargetText } from "./resource-rows.ts";
import { editResource, removeResource } from "./resources-mutations.ts";
import { hideResourceOnMap, representationForRow, requestAddBack } from "./resources-scene-mutations.ts";
import type { ResourcesState } from "./resources-state.ts";
import { panelControlFlags, resourceControlValue, rowFactsFor } from "./resources-views.ts";
import type { PanelControlFlags, ResourcePanelPorts } from "./resources-views.ts";
import { areaKey } from "../../units/ids.ts";

export type ResourceRowProps = {
  readonly row: ResourcePanelRow;
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** One button of a row: what it is called, what it shows, whether it is available, and what it does. */
type RowAction = {
  readonly label: string;
  readonly text?: string;
  readonly disabled?: boolean;
  readonly data?: Readonly<Record<string, string>> | undefined;
  readonly run: () => void;
};

/** Everything the row's buttons and pills are decided from, resolved once per render. */
type RowContext = {
  readonly row: ResourcePanelRow;
  readonly entity: ResourceEntity;
  readonly observed: ResourceEntity;
  readonly facts: MapEntityFacts;
  readonly representation: Representation;
  readonly direct: boolean;
  readonly refreshing: boolean;
  readonly flags: PanelControlFlags;
  readonly ports: ResourcePanelPorts;
};

/** The Show, Place or Restore button, absent when the Map state itself could not be read. */
function placementActions(context: RowContext): RowAction[] {
  if (context.representation === "unavailable") return [];
  const label = RESOURCE_ROW.placementLabel(context.representation, context.direct, areaLeaf(context.entity.locator.owner));
  const onMap = context.representation === "on-map";
  const value = resourceControlValue(context.entity.locator);
  return [{
    label,
    disabled: !onMap && !context.flags.writable,
    data: onMap ? { "resource-show": value } : { "resource-place": value },
    /** Hands the row to the placement surface, which shows, restores or places it. */
    run: () => { context.ports.placeOnMap(context.row); },
  }];
}

/** The action the Block itself runs, and the way into the details of this one resource. */
function readActions(context: RowContext): RowAction[] {
  const { facts, ports } = context;
  const actions: RowAction[] = [];
  if (facts.primaryAction && facts.display.actionLabel) {
    actions.push({
      label: facts.display.actionLabel,
      /** Copies the path or opens the link, and offers recovery when the browser refuses. */
      run: () => { void runResourceAction(ports.effects, facts, facts.primaryAction); },
    });
  }
  actions.push({
    label: RESOURCE_ROW.details,
    /** Opens the details view over the panel. */
    run: () => { showResourceDetails(ports.effects, context.entity.locator); },
  });
  return actions;
}

/** Hiding the Block, adding a gone resource back, and checking the target again. */
function mapStateActions(context: RowContext): RowAction[] {
  const { row, entity, ports, flags } = context;
  const actions: RowAction[] = [];
  if (context.representation === "on-map") {
    actions.push({
      label: RESOURCE_ROW.hideBlock, disabled: !flags.writable,
      /** Hides the Block on the Map. The Area resource stays. */
      run: () => { hideResourceOnMap(ports.effects, row); },
    });
    if (context.direct && rowCanAddBack(row)) {
      actions.push({
        label: RESOURCE_ROW.addBack, disabled: !flags.writable,
        /** Opens the confirmation that adds a gone resource back under a new identity. */
        run: () => { requestAddBack(ports.effects, row); },
      });
    }
  }
  if (!entity.reason) {
    actions.push({
      label: context.refreshing ? RESOURCE_ROW.checking : rowRefreshLabel(context.observed),
      text: context.refreshing ? RESOURCE_ROW.checkingBusy : rowRefreshLabel(context.observed),
      disabled: context.refreshing || !flags.controls,
      /** Reads the target's facts again without touching Map history or the save state. */
      run: () => { refreshRowFacts(ports.effects, row); },
    });
  }
  return actions;
}

/** Editing, removing, and the two routes an inherited row offers instead of a refused write. */
function catalogActions(context: RowContext): RowAction[] {
  const { row, entity, ports, flags } = context;
  const owner = entity.locator.owner;
  if (!context.direct) {
    const actions: RowAction[] = [{
      label: RESOURCE_ROW.openSourceAreaName(owner),
      text: RESOURCE_ROW.openSourceArea,
      /** Moves the panel to the Area that owns the resource, where writes are accepted. */
      run: () => { viewResourceArea(ports.effects, areaKey(owner)); },
    }];
    if (!entity.reason) {
      actions.push({
        label: RESOURCE_ROW.addToThisArea, disabled: !flags.writable,
        /** Opens an Add draft that records the same target in the viewed Area. */
        run: () => { editResource(ports.effects, { mode: "add", row }); },
      });
    }
    return actions;
  }
  if (entity.reason) return [];
  const actions: RowAction[] = [];
  if (rowIsWrongKind(row)) {
    actions.push({
      label: RESOURCE_ROW.changeToRepository, disabled: !flags.writable,
      /** Opens an Edit draft that corrects the recorded kind to Repository. */
      run: () => { editResource(ports.effects, { mode: "edit", kind: "repository", row }); },
    });
  }
  actions.push({
    label: RESOURCE_ROW.edit, disabled: !flags.writable,
    /** Opens an Edit draft over the row's own record. */
    run: () => { editResource(ports.effects, { mode: "edit", row }); },
  });
  actions.push({
    label: RESOURCE_ROW.remove, disabled: !flags.writable,
    /** Removes the resource from the Area. A Block already on the Map is untouched. */
    run: () => { void removeResource(ports.effects, row); },
  });
  return actions;
}

/** The pills under the summary: where the row came from, its Map state and the words of its facts. */
function RowFactPills(props: { readonly context: RowContext; readonly representationLabel: string }): ReactNode {
  const { context, representationLabel } = props;
  return (
    <div className="tangent-map-resource-facts">
      <span>{rowProvenance(context.row)}</span>
      {(context.row.alsoFrom ?? []).map((area) => <span key={area}>{RESOURCE_ROW.alsoFrom(area)}</span>)}
      <span>{representationLabel}</span>
      {rowIsLaunchDefault(context.row) && <span>{RESOURCE_ROW.launchDefault}</span>}
      {context.facts.display.stateText.map((value) => <span key={value}>{value}</span>)}
    </div>
  );
}

/** Renders one inventory row, or nothing when the row carries no resolvable facts. */
export function ResourceRow(props: ResourceRowProps): ReactNode {
  const { row, state, ports } = props;
  const entity = row.entity;
  const { resolution, facts } = rowFactsFor(state, ports, row);
  const key = resourceRowKey(row);
  if (!facts || !key) return null;
  const observed = resolution?.value ?? entity;
  const context: RowContext = {
    row, entity, observed, facts,
    representation: representationForRow(ports.world, row),
    direct: rowIsDirect(row),
    refreshing: state.refreshing.has(key),
    flags: panelControlFlags(state, ports.effects),
    ports,
  };
  const launch = rowIsLaunchDefault(row);
  const warnings = resourceWarningTexts(observed);
  const representationLabel = RESOURCES_PANEL.representationLabel(context.representation);
  const rowName = RESOURCE_ROW.name({
    accessibleName: facts.accessibleName,
    provenance: rowProvenance(row),
    representationLabel,
    launchOwner: launch ? entity.locator.owner : null,
    warnings,
  });
  const actions = [...readActions(context), ...placementActions(context), ...mapStateActions(context), ...catalogActions(context)];
  const target = rowTargetText(observed);
  return (
    <li role="listitem" aria-label={rowName} className={`tangent-map-resource-row ${facts.display.externalTreatment ?? ""}`}>
      <div className="tangent-map-resource-summary">
        <span className="tangent-map-resource-kind">{facts.display.kindLabel}</span>
        <strong>{facts.display.label}</strong>
        <span>{facts.display.targetClue}</span>
      </div>
      <RowFactPills context={context} representationLabel={representationLabel} />
      {launch && <p className="tangent-map-resource-warning">{RESOURCE_ROW.launchWarning(entity.locator.owner)}</p>}
      {warnings.map((warning) => <p className="tangent-map-resource-warning" key={warning}>{warning}</p>)}
      <code title={target}>{target}</code>
      <div className="tangent-map-resource-actions">
        {actions.map((action) => (
          <Button
            key={action.label}
            aria-label={RESOURCE_ROW.actionName(action.label, rowName)}
            disabled={action.disabled ?? false}
            {...(action.data ? { data: action.data } : {})}
            onActivate={action.run}
          >
            {action.text ?? action.label}
          </Button>
        ))}
      </div>
    </li>
  );
}
