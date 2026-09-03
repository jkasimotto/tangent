// The details of one resource, shown over the inventory as the registered `resourceDetails`
// surface. Escape is a back-step, so it returns to the panel instead of closing it. Every fact is
// a term and a value read through `resource-rows.ts`; the exact target is a selectable field so it
// can be copied in one keystroke even when the clipboard is refused.

import type { ReactNode } from "react";
import { RESOURCES_PANEL, RESOURCE_DETAILS, RESOURCE_ROW } from "../../copy.ts";
import type { MapEntityFacts, ResourceEntity, ResourcePanelRow } from "../../kernel/kernel-types.ts";
import { areaLeaf } from "../../canvas/area-label-model.ts";
import { Button } from "../../ui/Button.tsx";
import { Surface } from "../../ui/Surface.tsx";
import { TextArea } from "../../ui/TextArea.tsx";
import { closeResourceDetails, runResourceAction } from "./resource-actions.ts";
import { resourceDetailsFacts, rowIsDirect, rowProvenance, rowTargetText } from "./resource-rows.ts";
import type { ResourceDetailsFacts } from "./resource-rows.ts";
import { representationForRow } from "./resources-scene-mutations.ts";
import type { ResourcesState } from "./resources-state.ts";
import { panelControlFlags, resourceControlValue, rowFactsFor, rowForLocator } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type ResourceDetailsProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The heading id the surface is labelled by. */
const TITLE_ID = "tangent-map-resource-details-title";

/** One line of the fact list: its term, the value beside it, and the key it renders under. */
type DetailField = { readonly key: string; readonly term: string; readonly value: ReactNode };

/** The launch binding answer: the Area that starts workers here, or No. */
function launchField(row: ResourcePanelRow, owner: string): DetailField[] {
  if (row.launchMatch.state !== "current") return [];
  const value = row.launchMatch.value ? RESOURCE_DETAILS.launchYes(owner) : RESOURCE_DETAILS.no;
  return [{ key: "launch", term: RESOURCE_DETAILS.launchDefault, value }];
}

/** The observed facts that are only shown when the observation found them. */
function observedFields(details: ResourceDetailsFacts): DetailField[] {
  const fields: DetailField[] = [];
  if (details.branch) fields.push({ key: "branch", term: RESOURCE_DETAILS.branch, value: details.branch });
  if (details.repositoryPath) fields.push({ key: "repository", term: RESOURCE_DETAILS.repositoryPath, value: <code>{details.repositoryPath}</code> });
  if (details.checkedAt) fields.push({ key: "checked", term: RESOURCE_DETAILS.checked, value: <time dateTime={details.checkedAt}>{details.checkedAt}</time> });
  if (details.providerUpdatedAt) {
    fields.push({ key: "provider", term: RESOURCE_DETAILS.providerUpdated, value: <time dateTime={details.providerUpdatedAt}>{details.providerUpdatedAt}</time> });
  }
  if (details.observationError) fields.push({ key: "status-error", term: RESOURCE_DETAILS.statusError, value: details.observationError });
  return fields;
}

/** Every fact of one resource, in the order the details page reads them. */
function detailFields(row: ResourcePanelRow, entity: ResourceEntity, facts: MapEntityFacts, mapState: string, target: string, details: ResourceDetailsFacts): DetailField[] {
  const owner = entity.locator.owner;
  const exactTarget = <TextArea ariaLabel={RESOURCE_DETAILS.exactTarget} value={target} readOnly selectOnFocus />;
  return [
    { key: "kind", term: RESOURCE_DETAILS.kind, value: facts.display.kindLabel },
    { key: "target", term: RESOURCE_DETAILS.exactTarget, value: exactTarget },
    { key: "owner", term: RESOURCE_DETAILS.owningArea, value: owner },
    { key: "source", term: RESOURCE_DETAILS.source, value: rowProvenance(row) },
    { key: "state", term: RESOURCE_DETAILS.state, value: facts.display.stateText.join(RESOURCE_DETAILS.stateSeparator) || RESOURCE_DETAILS.current },
    { key: "map", term: RESOURCE_DETAILS.map, value: mapState },
    ...observedFields(details),
    ...launchField(row, owner),
    ...(details.legacyOrigin ? [{ key: "legacy", term: RESOURCE_DETAILS.legacyOrigin, value: details.legacyOrigin }] : []),
    ...details.warnings.map((warning) => ({ key: warning, term: RESOURCE_DETAILS.warning, value: warning })),
  ];
}

/** Renders the details of the resource the panel points at, or nothing when it names no loaded row. */
export function ResourceDetails(props: ResourceDetailsProps): ReactNode {
  const { state, ports } = props;
  const row = rowForLocator(state.projection, state.details ?? undefined);
  const { resolution, facts } = row ? rowFactsFor(state, ports, row) : { resolution: null, facts: null };
  if (!row || !facts) return null;
  const entity = row.entity;
  const observed = resolution?.value ?? entity;
  const representation = representationForRow(ports.world, row);
  const target = facts.primaryAction?.kind === "copy-path" ? facts.primaryAction.path : rowTargetText(observed);
  const placementLabel = RESOURCE_ROW.placementLabel(representation, rowIsDirect(row), areaLeaf(entity.locator.owner));
  const onMap = representation === "on-map";
  const value = resourceControlValue(entity.locator);

  /** Steps back to the inventory. The kit returns focus to the row control that opened this view. */
  function back(): void {
    closeResourceDetails(ports.effects);
  }

  return (
    <Surface id="resourceDetails" className="tangent-map-resource-details" labelledBy={TITLE_ID} onClose={back} onBackStep={back}>
      <Button className="tangent-map-resource-back" onActivate={back}>{RESOURCE_DETAILS.back}</Button>
      <h3 id={TITLE_ID}>{facts.display.label}</h3>
      <dl>
        {detailFields(row, entity, facts, RESOURCES_PANEL.representationLabel(representation), target, resourceDetailsFacts(row, resolution)).map((field) => (
          <div key={field.key}>
            <dt>{field.term}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="tangent-map-resource-actions">
        {facts.primaryAction && facts.display.actionLabel && (
          <Button
            aria-label={RESOURCE_DETAILS.actionName(facts.display.actionLabel, facts.accessibleName)}
            onActivate={() => { void runResourceAction(ports.effects, facts, facts.primaryAction); }}
          >
            {facts.display.actionLabel}
          </Button>
        )}
        <Button
          aria-label={RESOURCE_DETAILS.actionName(placementLabel, facts.accessibleName)}
          disabled={!onMap && !panelControlFlags(state, ports.effects).writable}
          data={onMap ? { "resource-show": value } : { "resource-place": value }}
          onActivate={() => { ports.placeOnMap(row); }}
        >
          {placementLabel}
        </Button>
      </div>
    </Surface>
  );
}
