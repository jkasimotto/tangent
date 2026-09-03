// The Resources panel: the Area's resource inventory. It is the registered `resources` surface,
// rendered through the kit as a retained side panel on a wide Map and as a modal sheet on a narrow
// one. It holds no state: every control reads the one state record and calls one named command.
// Details and the draft form open over it as their own back-step surfaces, so Escape steps back
// through them instead of closing the whole panel (audit defect 6).

import type { ReactNode } from "react";
import { RESOURCES_PANEL, RESOURCE_CONTROLS, RESOURCE_EDITOR } from "../../copy.ts";
import type { ResourceKind } from "../../copy.ts";
import type { ResourcePanelRow } from "../../kernel/kernel-types.ts";
import { Button } from "../../ui/Button.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { Discovery } from "./Discovery.tsx";
import { MutationRecovery } from "./MutationRecovery.tsx";
import { ResourceDetails } from "./ResourceDetails.tsx";
import { ResourceEditor } from "./ResourceEditor.tsx";
import { ResourceRow } from "./ResourceRow.tsx";
import { LegacyReview, Suggestions } from "./Suggestions.tsx";
import { discardResourceDraft, filterResources, holdResourceDraft, refreshAllRowFacts, retryResourceLoad, viewResourceArea } from "./resource-actions.ts";
import { groupPanelResourceRows } from "./resource-rows.ts";
import { discoverResources } from "./resources-effects.ts";
import { editResource } from "./resources-mutations.ts";
import { undoResourceChange } from "./resources-scene-mutations.ts";
import type { ResourcesState } from "./resources-state.ts";
import { inventoryMessage, matchingResourceRows, panelControlFlags, panelFrameClass, resourceBreadcrumb, resourceFocusSelector, rowForLocator } from "./resources-views.ts";
import type { ResourcePanelPorts } from "./resources-views.ts";

export type ResourcesPanelProps = {
  readonly state: ResourcesState;
  readonly ports: ResourcePanelPorts;
};

/** The heading the panel is named and labelled by. */
const TITLE_ID = "tangent-map-resources-title";

/** The three kinds a person can add, in the order the buttons stand. */
const ADD_BUTTONS: readonly { readonly kind: ResourceKind; readonly label: string }[] = [
  { kind: "worktree", label: RESOURCE_CONTROLS.addWorktree },
  { kind: "repository", label: RESOURCE_CONTROLS.addRepository },
  { kind: "link", label: RESOURCE_CONTROLS.addLink },
];

/** The Area path as one button per ancestor, the viewed Area marked as the current page. */
function Breadcrumb(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  return (
    <nav aria-label={RESOURCES_PANEL.breadcrumbName}>
      {resourceBreadcrumb(state.area).map((area) => (
        <Button
          key={area}
          aria-current={area === state.area ? "page" : undefined}
          onActivate={() => { viewResourceArea(ports.effects, area); }}
        >
          {ports.areaName(area)}
        </Button>
      ))}
    </nav>
  );
}

/** The transport problem block: what failed, in what words, and the read that may fix it. */
function TransportProblem(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  if (!state.transport.error) return null;
  const headline = state.transport.state === "last-known" ? RESOURCES_PANEL.couldNotRefresh : RESOURCES_PANEL.didNotLoad;
  return (
    <div className="tangent-map-resource-problem" role="alert">
      <strong>{headline}</strong>
      <span>{state.transport.error}</span>
      <Button onActivate={() => { retryResourceLoad(ports.effects); }}>{RESOURCES_PANEL.retry}</Button>
    </div>
  );
}

/** The strip that offers the way back from the last accepted change. */
function UndoStrip(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  if (!state.undo) return null;
  return (
    <div className="tangent-map-resource-undo" role="status">
      <span>{RESOURCES_PANEL.changeSaved}</span>
      <Button
        disabled={!panelControlFlags(state, ports.effects).writable}
        onActivate={() => { void undoResourceChange(ports.effects); }}
      >
        {RESOURCES_PANEL.undo}
      </Button>
    </div>
  );
}

/** The filter, the three Add buttons, discovery and the whole-inventory refresh. */
function InventoryControls(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  const flags = panelControlFlags(state, ports.effects);
  const rows = state.projection?.rows ?? [];
  const checking = state.refreshing.size > 0;
  return (
    <div className="tangent-map-resource-controls">
      <TextField
        label={RESOURCE_CONTROLS.filter}
        placeholder={RESOURCE_CONTROLS.filterPlaceholder}
        value={state.filter}
        onChange={(value) => { filterResources(ports.effects, value); }}
      />
      <div>
        {ADD_BUTTONS.map((add) => (
          <Button key={add.kind} disabled={!flags.writable} onActivate={() => { editResource(ports.effects, { kind: add.kind }); }}>{add.label}</Button>
        ))}
      </div>
      <div>
        <Button disabled={Boolean(state.busy) || !flags.controls} onActivate={() => { void discoverResources(ports.effects); }}>
          {state.busy === "discover" ? RESOURCE_CONTROLS.discovering : RESOURCE_CONTROLS.discover}
        </Button>
        <Button disabled={Boolean(state.busy) || checking || rows.length === 0 || !flags.controls} onActivate={() => { refreshAllRowFacts(ports.effects, rows); }}>
          {checking ? RESOURCE_CONTROLS.refreshing : RESOURCE_CONTROLS.refresh}
        </Button>
      </div>
      <p>{RESOURCE_CONTROLS.discoveryNote}</p>
    </div>
  );
}

/** The strip that keeps an unsaved draft in sight while the person looks at the inventory. */
function DraftStrip(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  if (!state.editor?.hidden) return null;
  return (
    <div className="tangent-map-resource-draft">
      <span>{RESOURCE_EDITOR.unsavedDraft}</span>
      <Button onActivate={() => { holdResourceDraft(ports.effects, false); }}>{RESOURCE_EDITOR.resume}</Button>
      <Button onActivate={() => { discardResourceDraft(ports.effects); }}>{RESOURCE_EDITOR.discard}</Button>
    </div>
  );
}

/** One inventory group: its name and its rows. */
function RowGroup(props: ResourcesPanelProps & { readonly label: string; readonly rows: readonly ResourcePanelRow[] }): ReactNode {
  const { state, ports, label, rows } = props;
  return (
    <>
      <h3>{label}</h3>
      <ul className="tangent-map-resource-list">
        {rows.map((row) => <ResourceRow key={`${row.entity.locator.owner}/${row.entity.locator.id}`} row={row} state={state} ports={ports} />)}
      </ul>
    </>
  );
}

/** The inventory: the controls, discovery, the grouped rows, and the two review lists. */
function Inventory(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  const matched = matchingResourceRows(state, ports);
  const message = inventoryMessage(state, matched);
  const loading = state.transport.state === "loading" && state.projection === null;
  return (
    <div className="tangent-map-resource-inventory">
      <DraftStrip state={state} ports={ports} />
      <InventoryControls state={state} ports={ports} />
      <Discovery state={state} ports={ports} />
      {loading && <p role="status">{RESOURCES_PANEL.loading}</p>}
      {message && <p>{message}</p>}
      {groupPanelResourceRows(matched).map((group) => (
        <RowGroup key={group.key} label={group.label} rows={group.rows} state={state} ports={ports} />
      ))}
      <LegacyReview state={state} ports={ports} />
      <Suggestions state={state} ports={ports} />
    </div>
  );
}

/** The details view, the draft form, or the inventory: one body at a time, innermost first. */
function PanelBody(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  if (rowForLocator(state.projection, state.details ?? undefined)) return <ResourceDetails state={state} ports={ports} />;
  if (state.editor && !state.editor.hidden) return <ResourceEditor state={state} ports={ports} />;
  return <Inventory state={state} ports={ports} />;
}

/** Renders the Resources panel, or nothing when it is closed. */
export function ResourcesPanel(props: ResourcesPanelProps): ReactNode {
  const { state, ports } = props;
  if (!state.open || !state.area) return null;
  const Frame = state.narrow ? Sheet : Panel;
  return (
    <Frame
      id="resources"
      className="tangent-map-resources"
      frameClassName={panelFrameClass(state.narrow, ports.placementActive)}
      labelledBy={TITLE_ID}
      initialFocus={resourceFocusSelector(state.pendingFocus)}
      onClose={ports.close}
      onBackStep={ports.close}
    >
      <header>
        <div>
          <p>{RESOURCES_PANEL.eyebrow}</p>
          <h2 id={TITLE_ID}>{RESOURCES_PANEL.title(ports.areaName(state.area))}</h2>
        </div>
        <Button onActivate={ports.close}>{RESOURCES_PANEL.close}</Button>
      </header>
      <Breadcrumb state={state} ports={ports} />
      <TransportProblem state={state} ports={ports} />
      {state.projection?.state === "partial" && <div className="tangent-map-resource-problem" role="status">{RESOURCES_PANEL.partial}</div>}
      <MutationRecovery state={state} ports={ports} />
      <UndoStrip state={state} ports={ports} />
      <PanelBody state={state} ports={ports} />
    </Frame>
  );
}
