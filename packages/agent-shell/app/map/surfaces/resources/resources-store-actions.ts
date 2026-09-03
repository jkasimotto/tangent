// The closed set of things that can happen to the Resources panel. Every action carries data
// only: the effects mint operation ids and read the clock before they dispatch, so the reducer
// never does. Grouped by what the person or the server did.

import type { InspectedTarget, ResourceDiscovery } from "./resources-wire.ts";
import type { MapEntityAction, MapEntityActionResult, ResourceLocator, ResourceLocatorKey, ResourcePanelProjection, ResourceResolution, ResourceSuggestion } from "../../kernel/kernel-types.ts";
import type { ResourceKind } from "../../copy.ts";
import type { AreaKey, OperationId } from "../../units/ids.ts";
import type { LegacyCandidateKey, ResourceActionRecovery, ResourceBusy, ResourceDraft, ResourceFocusRequest, ResourceMutationRecovery, ResourceSceneBusy, ResourceSceneRecovery, ResourceUndo } from "./resources-state.ts";

/** Opening, closing and moving the panel between Areas. */
export type ResourcePanelAction =
  | { readonly type: "open"; readonly area: AreaKey }
  | { readonly type: "close" }
  | { readonly type: "change-area"; readonly area: AreaKey }
  | { readonly type: "set-filter"; readonly value: string }
  | { readonly type: "set-details"; readonly locator: ResourceLocator | null }
  | { readonly type: "set-narrow"; readonly narrow: boolean }
  | { readonly type: "cadence-tick" }
  | { readonly type: "request-focus"; readonly focus: ResourceFocusRequest | null };

/** The inventory read: its start, its answer, its failure, and the draft it may have moved. */
export type ResourceLoadAction =
  | { readonly type: "load-started" }
  | { readonly type: "load-failed"; readonly message: string }
  | { readonly type: "install-projection"; readonly projection: ResourcePanelProjection; readonly area: AreaKey | null }
  | { readonly type: "reconcile-editor"; readonly projection: ResourcePanelProjection; readonly area: AreaKey; readonly rebaseDraft: boolean }
  | { readonly type: "set-suggestions"; readonly suggestions: readonly ResourceSuggestion[] };

/** The cached facts per Resource and the rows a refresh is checking. */
export type ResourceFactsAction =
  | { readonly type: "install-resolutions"; readonly resolutions: readonly ResourceResolution[]; readonly dropKeys: readonly ResourceLocatorKey[] }
  | { readonly type: "refresh-started"; readonly keys: readonly ResourceLocatorKey[]; readonly checking: readonly ResourceResolution[] }
  | { readonly type: "refresh-finished"; readonly keys: readonly ResourceLocatorKey[]; readonly resolutions: readonly ResourceResolution[] };

/** The Add, Edit and Suggestion draft. */
export type ResourceEditorAction =
  | { readonly type: "open-editor"; readonly draft: ResourceDraft }
  | { readonly type: "discard-editor" }
  | { readonly type: "editor-hidden"; readonly hidden: boolean }
  | { readonly type: "editor-kind"; readonly kind: ResourceKind }
  | { readonly type: "editor-target"; readonly value: string }
  | { readonly type: "editor-label"; readonly value: string }
  | { readonly type: "editor-confirm-missing"; readonly confirmed: boolean }
  | { readonly type: "editor-inspected"; readonly inspection: InspectedTarget; readonly message: string }
  | { readonly type: "editor-failed"; readonly message: string; readonly operationId: OperationId | null; readonly inspection: InspectedTarget | null };

/** Mutations, their busy state, their undo, and their recovery. */
export type ResourceMutationAction =
  | { readonly type: "set-busy"; readonly busy: ResourceBusy | null }
  | { readonly type: "set-undo"; readonly undo: ResourceUndo | null }
  | { readonly type: "set-mutation-recovery"; readonly recovery: ResourceMutationRecovery | null }
  | { readonly type: "set-discovery"; readonly discovery: ResourceDiscovery | null }
  | { readonly type: "set-scene-busy"; readonly busy: ResourceSceneBusy | null }
  | { readonly type: "set-scene-recovery"; readonly recovery: ResourceSceneRecovery | null }
  | { readonly type: "toggle-legacy"; readonly key: LegacyCandidateKey; readonly selected: boolean }
  | { readonly type: "clear-legacy-selection" }
  | { readonly type: "legacy-review-hidden"; readonly hidden: boolean };

/** A copy or open the browser blocked, and the retry from inside its dialog. */
export type ResourceRecoveryAction =
  | { readonly type: "set-recovery"; readonly recovery: ResourceActionRecovery | null }
  | { readonly type: "recovery-result"; readonly result: MapEntityActionResult }
  | { readonly type: "recovery-action"; readonly action: MapEntityAction; readonly message: string };

/** Every action the reducer accepts. */
export type ResourcesAction = ResourcePanelAction | ResourceLoadAction | ResourceFactsAction | ResourceEditorAction | ResourceMutationAction | ResourceRecoveryAction;
