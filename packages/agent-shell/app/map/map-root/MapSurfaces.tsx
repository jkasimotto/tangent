// Every surface the Map can open, rendered in one place.
//
// The surface stack says which are open; each component decides for itself whether it has anything
// to show, so all of them can be rendered unconditionally and the stack stays the one authority.
// The three Resources views that sit over the canvas rather than inside the panel are rendered
// here beside it, as `surfaces/resources/AGENTS.md` requires.

import type { ReactNode } from "react";
import { Find } from "../surfaces/find/Find.tsx";
import type { FindEnvironment } from "../surfaces/find/find-effects.ts";
import type { FindRow } from "../kernel/kernel-types.ts";
import type { FindState } from "../surfaces/find/find-store.ts";
import { Help } from "../surfaces/help/Help.tsx";
import { Outline } from "../surfaces/outline/Outline.tsx";
import type { OutlineProps } from "../surfaces/outline/Outline.tsx";
import type { OutlineTree } from "../surfaces/outline/outline-model.ts";
import { Picker } from "../surfaces/picker/Picker.tsx";
import type { PickerEnvironment } from "../surfaces/picker/picker-effects.ts";
import type { PickerState } from "../surfaces/picker/picker-store.ts";
import { PlacementBar } from "../surfaces/placement/PlacementBar.tsx";
import type { PlacementState } from "../surfaces/placement/placement-store.ts";
import { RecoveryDialog } from "../surfaces/save/RecoveryDialog.tsx";
import type { DraftRecord } from "../kernel/kernel-types.ts";
import { ResourcesPanel } from "../surfaces/resources/ResourcesPanel.tsx";
import { ResourceActionRecoveryDialog, SceneRecoveryDialog } from "../surfaces/resources/ResourceRecovery.tsx";
import { TransactionStatus } from "../surfaces/resources/TransactionStatus.tsx";
import type { ResourcePanelPorts } from "../surfaces/resources/resources-views.ts";
import type { ResourcesState } from "../surfaces/resources/resources-state.ts";
import type { SurfaceId } from "../surfaces/surface-registry.ts";
import type { SurfaceStack } from "../surfaces/surface-stack.ts";
import { isSurfaceOpen } from "../surfaces/surface-stack.ts";
import type { AreaKey } from "../units/ids.ts";

export type MapSurfacesProps = Pick<OutlineProps, "onSelectArea" | "onFitArea" | "onToggleFold" | "onSelectBlock" | "onRunBlock" | "onPlaceBlock" | "onOpenResources"> & {
  readonly stack: SurfaceStack;
  readonly openers: ReadonlyMap<SurfaceId, HTMLElement | null>;
  readonly find: { readonly state: FindState; readonly rows: readonly FindRow[]; readonly env: FindEnvironment };
  readonly picker: { readonly state: PickerState; readonly env: PickerEnvironment };
  readonly outline: OutlineTree;
  readonly placement: PlacementState;
  readonly resources: { readonly state: ResourcesState; readonly ports: ResourcePanelPorts };
  readonly draft: DraftRecord | null;
  readonly areaName: (area: AreaKey) => string;
  readonly areaPathName: (area: AreaKey) => string;
  readonly onCloseSurface: (id: SurfaceId) => void;
  readonly onBackStep: () => void;
  readonly onCommitPlacement: () => void;
  readonly onCancelPlacement: () => void;
  readonly onRestoreDraft: () => void;
  readonly onDiscardDraft: () => void;
};

/** Renders every surface the Map can open. */
export function MapSurfaces(props: MapSurfacesProps): ReactNode {
  const placing = props.placement.placing;
  return (
    <>
      {isSurfaceOpen(props.stack, "find") && <Find state={props.find.state} rows={props.find.rows} env={props.find.env} areaPathName={props.areaPathName} />}
      {isSurfaceOpen(props.stack, "outline") && (
        <Outline
          tree={props.outline}
          opener={props.openers.get("outline") ?? null}
          onSelectArea={props.onSelectArea}
          onFitArea={props.onFitArea}
          onToggleFold={props.onToggleFold}
          onSelectBlock={props.onSelectBlock}
          onRunBlock={props.onRunBlock}
          onPlaceBlock={props.onPlaceBlock}
          onOpenResources={props.onOpenResources}
          onClose={() => props.onCloseSurface("outline")}
          onBackStep={props.onBackStep}
        />
      )}
      {isSurfaceOpen(props.stack, "help") && (
        <Help opener={props.openers.get("help") ?? null} onClose={() => props.onCloseSurface("help")} onBackStep={props.onBackStep} />
      )}
      <Picker state={props.picker.state} env={props.picker.env} areaName={props.areaName} />
      {placing !== null && (
        <PlacementBar placement={placing} areaName={props.areaName(placing.area)} onPlace={props.onCommitPlacement} onCancel={props.onCancelPlacement} />
      )}
      <ResourcesPanel state={props.resources.state} ports={props.resources.ports} />
      {isSurfaceOpen(props.stack, "resourceRecovery") && <ResourceActionRecoveryDialog state={props.resources.state} ports={props.resources.ports} />}
      {isSurfaceOpen(props.stack, "sceneRecovery") && <SceneRecoveryDialog state={props.resources.state} ports={props.resources.ports} />}
      <TransactionStatus state={props.resources.state} />
      {props.draft !== null && !props.draft.restored && (
        <RecoveryDialog
          draft={props.draft}
          opener={props.openers.get("mapRecovery") ?? null}
          onRestore={props.onRestoreDraft}
          onDiscard={props.onDiscardDraft}
          onClose={() => props.onCloseSurface("mapRecovery")}
          onBackStep={props.onBackStep}
        />
      )}
    </>
  );
}
