// The state of the Resources panel: one typed record where the old component kept twenty-one
// `useState` calls. Every field is data; no opener elements, no timers, no request handles. The
// effects keep their in-flight fences beside the request function, and the kit restores focus.
// `resources-store.ts` reduces this state; `resources-store-actions.ts` names what can happen to it.

import type { MapEntityAction, MapEntityActionResult, MapEntityFacts, ResourceCatalogRevision, ResourceLocator, ResourceLocatorKey, ResourcePanelProjection, ResourcePanelRow, ResourceResolution, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import type { ResourceKind } from "../../copy.ts";
import type { AreaKey, OperationId } from "../../units/ids.ts";
import type { Count } from "../../units/units.ts";
import { count } from "../../units/units.ts";
import type { InspectedTarget, RecoveryEvidence, ResourceDiscovery, ResourceMutation, ResourceMutationKind, ResourceMutationRequest } from "./resources-wire.ts";

/** Where the inventory read stands. `last-known` keeps the rows it had when a re-read failed. */
export type ResourceTransportState = "idle" | "loading" | "refreshing" | "current" | "partial" | "last-known" | "unavailable";

/** The transport state and the words of its last failure, empty when it succeeded. */
export type ResourceTransport = { readonly state: ResourceTransportState; readonly error: string };

/** What the panel is busy with, so its controls disable together. */
export type ResourceBusy = ResourceMutationKind | "inspect" | "discover";

/** What a draft is for: a new record, a change to one, or a Suggestion being accepted. */
export type ResourceDraftMode = "add" | "edit" | "suggestion";

/** The Add, Edit or Suggestion form, retained across a refused save so a retry reuses its operation id. */
export type ResourceDraft = {
  readonly mode: ResourceDraftMode;
  readonly owner: AreaKey | null;
  readonly kind: ResourceKind;
  readonly label: string;
  readonly target: string;
  readonly row: ResourcePanelRow | null;
  readonly suggestion: ResourceSuggestion | null;
  readonly inspection: InspectedTarget | null;
  readonly confirmMissing: boolean;
  readonly error: string;
  readonly operationId: OperationId;
  /** The catalog revisions the draft was opened over; Save sends them so the server refuses a write over a changed catalog. */
  readonly expectedCatalogs: readonly ResourceCatalogRevision[];
  /** True once the catalog changed under the draft; Save refuses until Reload rebases it. */
  readonly stale: boolean;
  /** True while the person stepped back to the inventory without discarding the draft. */
  readonly hidden: boolean;
};

/** The way back from the last accepted mutation, when the server retained one. */
export type ResourceUndo = {
  readonly token: string;
  readonly owner: AreaKey;
  /** True when the undo rewrites a Map source as well as the catalog, so it runs as a scene mutation. */
  readonly sourceCoupled: boolean;
  readonly operationId: OperationId;
};

/** A refused catalog mutation, retained with its envelope so Retry resends the same bytes. */
export type ResourceMutationRecovery = {
  readonly code: string;
  readonly recovery: RecoveryEvidence;
  readonly mutation: ResourceMutation | null;
  readonly operationId: OperationId;
  readonly success: string;
  readonly request: ResourceMutationRequest | null;
  readonly message: string;
};

/** A copy or open that the browser blocked, with what the person can do by hand. */
export type ResourceActionRecovery = {
  readonly result: MapEntityActionResult;
  readonly entity: MapEntityFacts;
  readonly action: MapEntityAction;
  readonly message: string;
};

/** The veil shown while catalog and Map source save together. */
export type ResourceSceneBusy = { readonly label: string };

/** The Add-back confirmation and the recovery after a scene-coupled mutation failed. */
export type ResourceSceneRecovery =
  | { readonly phase: "confirm-add-back"; readonly operationId: OperationId; readonly row: ResourcePanelRow; readonly label: string; readonly target: string }
  | { readonly phase: "error-add-back"; readonly operationId: OperationId; readonly row: ResourcePanelRow; readonly label: string; readonly target: string; readonly message: string }
  | {
    readonly phase: "error";
    readonly mutation: ResourceMutation;
    readonly operationId: OperationId;
    readonly success: string;
    readonly request: ResourceMutationRequest | null;
    readonly owner: AreaKey;
    readonly code: string;
    readonly message: string;
  };

/** The row control focus should land on once the panel shows it again, after a Show or a cancelled placement. */
export type ResourceFocusRequest = { readonly control: "show" | "place"; readonly key: string };

/** The stable identity of one legacy review row inside the panel. */
export type LegacyCandidateKey = string;

/** The whole Resources panel state. */
export type ResourcesState = {
  readonly open: boolean;
  readonly area: AreaKey | null;
  readonly projection: ResourcePanelProjection | null;
  readonly transport: ResourceTransport;
  readonly busy: ResourceBusy | null;
  readonly filter: string;
  readonly discovery: ResourceDiscovery | null;
  readonly details: ResourceLocator | null;
  readonly editor: ResourceDraft | null;
  readonly undo: ResourceUndo | null;
  readonly mutationRecovery: ResourceMutationRecovery | null;
  readonly recovery: ResourceActionRecovery | null;
  readonly sceneBusy: ResourceSceneBusy | null;
  readonly sceneRecovery: ResourceSceneRecovery | null;
  readonly resolutions: ReadonlyMap<ResourceLocatorKey, ResourceResolution>;
  readonly refreshing: ReadonlySet<ResourceLocatorKey>;
  readonly legacySelected: ReadonlySet<LegacyCandidateKey>;
  readonly legacyReviewHidden: boolean;
  /** How many cadence ticks have passed; the effects re-read facts when it changes. */
  readonly cadence: Count;
  /** True when the Map is narrower than the breakpoint and the panel shows as a modal sheet. */
  readonly narrow: boolean;
  readonly pendingFocus: ResourceFocusRequest | null;
  /**
   * Counts focus requests. A cancelled placement asks for the same control the placement started
   * from, so the request alone does not change; the serial does, and the surface re-applies focus.
   */
  readonly focusSerial: Count;
};

/** The transport before any read. */
export const IDLE_TRANSPORT: ResourceTransport = Object.freeze({ state: "idle", error: "" });

/** The panel before it was ever opened. */
export const INITIAL_RESOURCES_STATE: ResourcesState = Object.freeze({
  open: false,
  area: null,
  projection: null,
  transport: IDLE_TRANSPORT,
  busy: null,
  filter: "",
  discovery: null,
  details: null,
  editor: null,
  undo: null,
  mutationRecovery: null,
  recovery: null,
  sceneBusy: null,
  sceneRecovery: null,
  resolutions: new Map<ResourceLocatorKey, ResourceResolution>(),
  refreshing: new Set<ResourceLocatorKey>(),
  legacySelected: new Set<LegacyCandidateKey>(),
  legacyReviewHidden: false,
  cadence: count(0),
  narrow: false,
  pendingFocus: null,
  focusSerial: count(0),
});

/** True when the panel holds a current projection over current transport and is not busy: a write or a placement may start. */
export function resourceWritesAvailable(state: ResourcesState, writesEnabled: boolean): boolean {
  return writesEnabled && state.projection?.state === "current" && state.transport.state === "current" && state.busy === null;
}

/** True when a modal part of the panel owns the screen: the narrow sheet, a recovery dialog, or the transaction veil. */
export function resourcesHoldModal(state: ResourcesState): boolean {
  return (state.open && state.narrow) || state.recovery !== null || state.sceneRecovery !== null || state.sceneBusy !== null;
}
