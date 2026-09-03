// The wire shapes the Resources panel exchanges with the server: the mutation envelope, what a
// mutation answers, what a refresh or a resolve answers, what inspecting a target answers, what
// discovery answers, and the failure payload a refused request carries. Nothing here is state; the
// store keeps these as retained evidence and the effects send and receive them. The server route
// `/api/areas/map-resources/*` is the other side of every type in this file.

import type {
  LegacyReviewRow, ProjectionError, ResourceCatalogRevision, ResourceEntity, ResourceLocator, ResourcePanelProjection,
  ResourceResolution, ResourceSourceUpdate, ResourceSuggestion, ResourceTarget, ShardHash,
} from "../../kernel/kernel-types.ts";
import type { AreaKey, OperationId, ShardOwner, SourceId } from "../../units/ids.ts";

/** Whether an inspected target exists. A missing path may still be recorded once the person confirms it. */
export type InspectedTargetState = "available" | "missing" | string;

/** What inspecting a target answered: the normalised target and whether it exists, with a fingerprint for a missing path. */
export type InspectedTarget =
  | { readonly kind: "link"; readonly normalized: ResourceTarget; readonly state: InspectedTargetState }
  | { readonly kind: "local"; readonly normalized: ResourceTarget; readonly state: InspectedTargetState; readonly targetFingerprint?: string };

/** The confirmation a mutation carries when it records a path that does not exist yet. */
export type MissingConfirmation = { readonly targetFingerprint: string };

/** The validated target a mutation records, with the missing-path confirmation when the person gave one. */
export type ResourceTargetInput = { readonly target: ResourceTarget; readonly missingConfirmation?: MissingConfirmation | null };

/** The exact evidence fields a Suggestion or legacy candidate mutation sends back, closed to the route contract. */
export type SuggestionReference = {
  readonly owner: ShardOwner;
  readonly target: ResourceTarget | undefined;
  readonly evidence: unknown;
  readonly evidenceHash: string | undefined;
  readonly targetFingerprint: string | undefined;
};

/** One legacy candidate chosen for import, and whether its declared Branch attaches to the imported record. */
export type LegacyImportSelection = { readonly candidate: SuggestionReference; readonly attachDeclaredBranch: boolean };

/** Where a gone Resource's identity comes back from: its tombstone, or its Last-known target confirmed again. */
export type AddBackSource =
  | { readonly kind: "tombstone" }
  | { readonly kind: "confirmed-last-known"; readonly input: ResourceTargetInput; readonly label: string };

/** Every mutation the catalog route accepts. The last two are scene-coupled: they rewrite a Map source as well. */
export type ResourceMutation =
  | { readonly kind: "add"; readonly owner: ShardOwner; readonly input: ResourceTargetInput; readonly label: string | null }
  | { readonly kind: "edit"; readonly resource: ResourceLocator; readonly input: ResourceTargetInput; readonly label: string | null }
  | { readonly kind: "remove"; readonly resource: ResourceLocator }
  | { readonly kind: "add-suggestion"; readonly selection: { readonly suggestion: SuggestionReference; readonly input: ResourceTargetInput }; readonly labelForNewRecord: string | null }
  | { readonly kind: "dismiss-suggestion"; readonly suggestion: SuggestionReference }
  | { readonly kind: "import-legacy"; readonly selections: readonly LegacyImportSelection[] }
  | { readonly kind: "undo"; readonly token: string }
  | { readonly kind: "associate-generic-link"; readonly owner: ShardOwner; readonly sourceElementId: SourceId; readonly labelForNewRecord: string | null }
  | { readonly kind: "add-back-gone"; readonly oldResource: ResourceLocator; readonly source: AddBackSource };

/** The name of one mutation kind. */
export type ResourceMutationKind = ResourceMutation["kind"];

/** The Map source a scene-coupled mutation expects to rewrite, so the server refuses a write over a source that changed. */
export type SceneFence = { readonly owner: ShardOwner; readonly hash: ShardHash };

/** The envelope every mutation is sent in. An undo carries only its retained token and no fences. */
export type ResourceMutationRequest = {
  readonly schema: "area-map-resource-mutation.v1";
  readonly operationId: OperationId;
  readonly viewedFrom: AreaKey;
  readonly mutation: ResourceMutation;
  readonly expectedCatalogs?: readonly ResourceCatalogRevision[];
  readonly expectedScenes?: readonly SceneFence[];
};

/** Whether the server retained a way back from the mutation it just applied. */
export type UndoReceipt = { readonly state: "available"; readonly token: string } | { readonly state: "unavailable" };

/** What an accepted mutation answers. */
export type ResourceMutationResult = {
  readonly effect?: string;
  readonly operationId?: string;
  readonly projection?: ResourcePanelProjection | null;
  readonly sourceUpdates?: readonly ResourceSourceUpdate[];
  readonly resource?: ResourceEntity | null;
  readonly warnings?: readonly unknown[];
  readonly undo?: UndoReceipt;
  readonly idempotent?: boolean;
};

/** What a resolve or a refresh answers: the resolutions under one of two names, optionally with a fresh projection. */
export type ResourceResolutionsResult =
  | { readonly resolutions?: readonly ResourceResolution[]; readonly results?: readonly ResourceResolution[]; readonly projection?: ResourcePanelProjection | null }
  | readonly ResourceResolution[];

/** One problem discovery hit while inspecting a source. */
export type DiscoveryProblem = { readonly code: string; readonly message: string; readonly retryable?: boolean; readonly path?: string };

/** One place discovery looked: a recorded repository or a recent Attempt folder. */
export type DiscoverySource = {
  readonly source?: { readonly kind?: string; readonly resource?: ResourceLocator; readonly jobSlug?: string; readonly file?: string };
  readonly state?: "complete" | "partial" | "error" | string;
  readonly suggestions?: readonly ResourceSuggestion[];
  readonly diagnostics?: readonly DiscoveryProblem[];
};

/** What discovery answers, and the shape the panel keeps while it runs or after it failed. */
export type ResourceDiscovery = {
  readonly state: "checking" | "partial" | "complete" | "unavailable" | string;
  readonly area?: AreaKey;
  readonly suggestions?: readonly ResourceSuggestion[];
  readonly sources: readonly DiscoverySource[];
  readonly problems: readonly DiscoveryProblem[];
  readonly projection?: ResourcePanelProjection | null;
};

/** One imported target the server offers as the owner of a legacy Branch, when more than one could own it. */
export type LegacyBranchChoice = {
  readonly owner: ShardOwner;
  readonly targetFingerprint?: string;
  readonly field: string;
  readonly label: string;
};

/** The evidence a refused mutation hands back so the panel can recover without guessing. */
export type RecoveryEvidence = {
  readonly code?: string;
  readonly projection?: ResourcePanelProjection | null;
  readonly inspection?: InspectedTarget;
  readonly existing?: ResourceLocator;
  readonly owner?: ShardOwner;
  /** The owners a `legacy-branch-choice-required` refusal offers, one button each. */
  readonly choices?: readonly LegacyBranchChoice[];
};

/** The payload the api client attaches to a refused request. */
export type ResourceFailurePayload = {
  readonly code?: string;
  readonly error?: string;
  readonly recovery?: RecoveryEvidence;
  readonly projection?: ResourcePanelProjection | null;
};

/** One refused or failed request, read into the fields the panel acts on. */
export type ResourceFailure = {
  readonly code: string | null;
  readonly message: string;
  readonly recovery: RecoveryEvidence;
  readonly projection: ResourcePanelProjection | null;
  readonly aborted: boolean;
};

/** The parts of a thrown value the api client may have set. */
type ThrownRequest = { readonly name?: unknown; readonly message?: unknown; readonly code?: unknown; readonly payload?: ResourceFailurePayload | null };

/** Reads a thrown value as a request failure: its code, its words, and any recovery evidence or projection it carried. */
export function readResourceFailure(error: unknown, fallbackMessage: string): ResourceFailure {
  const thrown: ThrownRequest = typeof error === "object" && error !== null ? (error as ThrownRequest) : {};
  const payload = thrown.payload ?? {};
  const recovery = payload.recovery ?? {};
  const code = typeof payload.code === "string" ? payload.code : typeof thrown.code === "string" ? thrown.code : null;
  const message = typeof payload.error === "string" ? payload.error : typeof thrown.message === "string" && thrown.message ? thrown.message : fallbackMessage;
  return { code, message, recovery, projection: recovery.projection ?? payload.projection ?? null, aborted: thrown.name === "AbortError" };
}

/** Keeps mutation evidence closed to the exact fields the route contract accepts. */
export function suggestionReference(value: ResourceSuggestion | LegacyReviewRow): SuggestionReference {
  return { owner: value.owner, target: value.target, evidence: value.evidence, evidenceHash: value.evidenceHash, targetFingerprint: value.targetFingerprint };
}

/** The catalog owners one mutation is fenced against: the Areas whose catalogs it writes. */
export function resourceMutationOwners(mutation: ResourceMutation | null | undefined): ShardOwner[] {
  switch (mutation?.kind) {
    case "add": return [mutation.owner];
    case "edit": case "remove": return [mutation.resource.owner];
    case "add-suggestion": return [mutation.selection.suggestion.owner];
    case "dismiss-suggestion": return [mutation.suggestion.owner];
    case "import-legacy": return mutation.selections.map((selection) => selection.candidate.owner);
    default: return [];
  }
}

/** The catalog revisions of the named owners, the fence a catalog mutation sends. */
export function catalogFencesFor(catalogs: readonly ResourceCatalogRevision[] | undefined, owners: readonly ShardOwner[]): ResourceCatalogRevision[] {
  return (catalogs ?? []).filter((catalog) => owners.includes(catalog.owner)).map((catalog) => ({ owner: catalog.owner, revision: catalog.revision }));
}

/** The words of a projection error, or the fallback when the server sent none. */
export function projectionErrorMessage(error: ProjectionError | undefined, fallback: string): string {
  return error?.message ? error.message : fallback;
}
