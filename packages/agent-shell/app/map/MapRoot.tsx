// The Map, composed.
//
// This component owns the controller, one `useReducer` per surface store, and the long-lived
// objects the canvas needs; everything else is a module it wires together. The render is the whole
// Map in one place: Excalidraw, the Area name pills over it, the control row, the save island, the
// kinds notice, the live region, and every registered surface.
//
// Design: docs/design/area-map-rebuild/code.md.

import { useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { AreaLabels } from "./canvas/AreaLabels.tsx";
import { MapCanvas } from "./canvas/MapCanvas.tsx";
import { LAYOUT, layoutCssVariables } from "./layout/layout-tokens.ts";
import { leaseController } from "./map-root/map-root-controller.ts";
import type { ControllerLease } from "./map-root/map-root-controller.ts";
import { buildMapView, mergedDocuments } from "./map-root/map-root-view.ts";
import { changeFold, fitArea, selectedBlock } from "./map-root/map-root-commands.ts";
import { MapSurfaces } from "./map-root/MapSurfaces.tsx";
import { MapToolbar } from "./map-root/MapToolbar.tsx";
import { useMapCore } from "./map-root/use-map-core.ts";
import { useMapEffects } from "./map-root/use-map-effects.ts";
import { useMapStores } from "./map-root/use-map-stores.ts";
import { findRowsOf, useMapWiring } from "./map-root/use-map-wiring.ts";
import { buildFindEnvironment, buildPickerEnvironment } from "./map-root/map-runtime-surfaces.ts";
import type { AreaBoardBridge, WorldMountOptions } from "./mount-options.ts";
import { mapCanvasElement } from "./ui/canvas-focus.ts";
import { LiveRegion } from "./surfaces/announce/LiveRegion.tsx";
import { KindsNotice } from "./surfaces/kinds/KindsNotice.tsx";
import { SaveStatus } from "./surfaces/save/SaveStatus.tsx";
import { recoverMap } from "./surfaces/save/save-effects.ts";
import { associateGenericLink } from "./surfaces/resources/resources-scene-mutations.ts";
import type { MapEntityFacts } from "./kernel/kernel-types.ts";
import type { AreaKey } from "./units/ids.ts";

export type MapRootProps = {
  readonly host: HTMLElement;
  readonly bridge: AreaBoardBridge;
  readonly options: WorldMountOptions;
};

/** Renders the controller-owned world in one Excalidraw instance. */
export function MapRoot({ host, bridge, options }: MapRootProps): React.ReactNode {
  const lease = useRef<ControllerLease | null>(null);
  if (lease.current === null) lease.current = leaseController(options);
  const controller = lease.current.controller;
  const [snapshot, setSnapshot] = useState(() => controller.snapshot());
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const stores = useMapStores();
  const core = useMapCore(host, options, controller, snapshot, lease.current.owned);

  const documents = useMemo(() => mergedDocuments(options.getDocuments?.() ?? [], stores.picker.entities), [options, stores.picker.entities, snapshot.factsRevision]);
  const view = useMemo(
    () => buildMapView(snapshot, documents, stores.resources.resolutions, null),
    [snapshot, documents, stores.resources.resolutions],
  );
  const wiring = useMapWiring({
    core, stores, snapshot, view,
    /** Records Excalidraw's api on the session and on React state, so the effects re-run with it. */
    setApi: (next: ExcalidrawImperativeAPI) => {
      core.session.api = next;
      setApi(next);
    },
  });
  core.handlersRef.current = wiring.handlers;
  useMapEffects({ core, stores, wiring, snapshot, api, bridge, applySnapshot: setSnapshot });

  return <MapBody core={core} stores={stores} wiring={wiring} snapshot={snapshot} view={view} options={options} controller={controller} />;
}

/** What the Map renders for one snapshot. */
type MapBodyProps = {
  readonly core: ReturnType<typeof useMapCore>;
  readonly stores: ReturnType<typeof useMapStores>;
  readonly wiring: ReturnType<typeof useMapWiring>;
  readonly snapshot: ReturnType<ReturnType<typeof leaseController>["controller"]["snapshot"]>;
  readonly view: ReturnType<typeof buildMapView>;
  readonly options: WorldMountOptions;
  readonly controller: ReturnType<typeof leaseController>["controller"];
};

/** Renders the canvas, the overlays and every surface. */
function MapBody({ core, stores, wiring, snapshot, view, options, controller }: MapBodyProps): React.ReactNode {
  const block = selectedBlock(wiring.commands);
  const blockFacts = block === null ? null : view.resolveBlock(block);
  const panelOpen = stores.resources.open && !stores.resources.narrow;
  const rootClass = `TangentAreaMap theme--dark${panelOpen ? " resources-panel-open" : ""}`;
  return (
    <div
      className={rootClass}
      style={layoutCssVariables(LAYOUT)}
      data-tangent-area-map={snapshot.locatedArea}
      data-tangent-area-map-world={snapshot.world.worldId}
      aria-busy={stores.resources.sceneBusy === null ? undefined : "true"}
    >
      <MapCanvas initialData={core.initialData} handlers={core.handlersRef} />
      <AreaLabels
        labels={view.labels}
        onSelectArea={(area: AreaKey) => wiring.surfaces.selectArea(area)}
        onRuntimeVerb={(action) => options.onEntityVerb?.(action)}
      />
      <MapToolbar
        block={blockFacts}
        resourcesOpen={stores.resources.open}
        outlineOpen={stores.stack.includes("outline")}
        writesAvailable={wiring.surfaces.writesAvailable()}
        onPlaceBlock={() => wiring.commands.openPicker()}
        onOpenResources={(opener) => wiring.openResources(snapshot.locatedArea, opener)}
        onToggleOutline={() => wiring.commands.toggleOutline()}
        onOpenHelp={() => wiring.openSurface("help", mapCanvasElement(core.host))}
        onRunAction={(facts, action, opener) => wiring.reads.runAction(facts, action, opener)}
        onAddToArea={(facts) => { associateGenericLink(wiring.surfaces.resourceEffects, facts); }}
        onShowDetails={(_facts, opener) => wiring.openResources(snapshot.locatedArea, opener)}
        onHideBlock={() => { if (block !== null) wiring.reads.hideBlock(block); }}
      />
      <SaveStatus status={snapshot.save.state} draft={snapshot.draft} onRecover={(action) => void recoverMap(controller, action, wiring.reads.announce)} />
      <KindsNotice catalog={snapshot.mapKinds} />
      <LiveRegion state={stores.announce} noticeHidden={stores.placement.placing !== null} />
      <MapSurfaces
        stack={stores.stack}
        openers={core.session.openers}
        find={{ state: stores.find, rows: findRowsOf(wiring.surfaces, stores.find.query), env: buildFindEnvironment(wiring.surfaces) }}
        picker={{ state: stores.picker, env: buildPickerEnvironment(wiring.surfaces) }}
        outline={view.outline}
        placement={stores.placement}
        resources={{ state: stores.resources, ports: wiring.surfaces.resourcePorts }}
        draft={snapshot.draft}
        areaName={view.areaName}
        areaPathName={view.areaPathName}
        onCloseSurface={wiring.closeSurface}
        onBackStep={() => stores.dispatchStack({ type: "back-step" })}
        onSelectArea={(area) => wiring.surfaces.selectArea(area)}
        onFitArea={(area) => fitArea(wiring.commands, area, true, true)}
        onToggleFold={(area) => changeFold(wiring.commands, area)}
        onSelectBlock={(row) => controller.setSelection([row.id])}
        onRunBlock={(row, element) => runPrimary(wiring, row.facts, element)}
        onPlaceBlock={() => wiring.commands.openPicker()}
        onOpenResources={(opener) => wiring.openResources(snapshot.locatedArea, opener)}
        onCommitPlacement={() => wiring.commands.commitPlacement()}
        onCancelPlacement={() => wiring.escape()}
        onRestoreDraft={() => controller.restoreDraft()}
        onDiscardDraft={() => controller.discardDraft()}
      />
    </div>
  );
}

/** Runs one Block's primary action, when it has one. */
function runPrimary(wiring: ReturnType<typeof useMapWiring>, facts: MapEntityFacts, opener: HTMLElement | null): void {
  const action = facts.primaryAction;
  if (action === null || action === undefined) return;
  wiring.reads.runAction(facts, action, opener);
}

