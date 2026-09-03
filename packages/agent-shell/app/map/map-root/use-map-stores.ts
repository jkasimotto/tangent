// One `useReducer` per surface store, in one hook.
//
// Every surface owns a pure reducer over a typed state and a closed action union. The Map root
// holds them all, so the surface stack, the announcements, Find, the picker, the placement layers
// and the Resources panel change in one React update and no surface keeps state of its own.

import { useReducer } from "react";
import { EMPTY_ANNOUNCE_STATE, announceReducer } from "../surfaces/announce/announce-store.ts";
import type { AnnounceAction, AnnounceState } from "../surfaces/announce/announce-store.ts";
import { EMPTY_FIND_STATE, findReducer } from "../surfaces/find/find-store.ts";
import type { FindAction, FindState } from "../surfaces/find/find-store.ts";
import { EMPTY_PICKER_STATE, pickerReducer } from "../surfaces/picker/picker-store.ts";
import type { PickerAction, PickerState } from "../surfaces/picker/picker-store.ts";
import { EMPTY_PLACEMENT_STATE, placementReducer } from "../surfaces/placement/placement-store.ts";
import type { PlacementAction, PlacementState } from "../surfaces/placement/placement-store.ts";
import { INITIAL_RESOURCES_STATE, resourcesReducer } from "../surfaces/resources/resources-store.ts";
import type { ResourcesAction } from "../surfaces/resources/resources-store-actions.ts";
import type { ResourcesState } from "../surfaces/resources/resources-state.ts";
import { EMPTY_SURFACE_STACK, reduceSurfaceStack } from "../surfaces/surface-stack.ts";
import type { SurfaceStack, SurfaceStackAction } from "../surfaces/surface-stack.ts";

/** Every store's state and its dispatcher, in the shape the root passes down. */
export type MapStores = {
  readonly stack: SurfaceStack;
  readonly dispatchStack: (action: SurfaceStackAction) => void;
  readonly announce: AnnounceState;
  readonly dispatchAnnounce: (action: AnnounceAction) => void;
  readonly find: FindState;
  readonly dispatchFind: (action: FindAction) => void;
  readonly picker: PickerState;
  readonly dispatchPicker: (action: PickerAction) => void;
  readonly placement: PlacementState;
  readonly dispatchPlacement: (action: PlacementAction) => void;
  readonly resources: ResourcesState;
  readonly dispatchResources: (action: ResourcesAction) => void;
};

/** Builds every surface store the Map root holds. */
export function useMapStores(): MapStores {
  const [stack, dispatchStack] = useReducer(reduceSurfaceStack, EMPTY_SURFACE_STACK);
  const [announce, dispatchAnnounce] = useReducer(announceReducer, EMPTY_ANNOUNCE_STATE);
  const [find, dispatchFind] = useReducer(findReducer, EMPTY_FIND_STATE);
  const [picker, dispatchPicker] = useReducer(pickerReducer, EMPTY_PICKER_STATE);
  const [placement, dispatchPlacement] = useReducer(placementReducer, EMPTY_PLACEMENT_STATE);
  const [resources, dispatchResources] = useReducer(resourcesReducer, INITIAL_RESOURCES_STATE);
  return {
    stack, dispatchStack,
    announce, dispatchAnnounce,
    find, dispatchFind,
    picker, dispatchPicker,
    placement, dispatchPlacement,
    resources, dispatchResources,
  };
}
