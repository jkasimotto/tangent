// The Add, Edit and Suggestion draft as data: how one opens from a row or a Suggestion, which
// catalog revisions fence it, and the mutation it becomes once its target is inspected. Pure, so
// the store rebases a draft and the mutations save one without either owning the other.

import type { ResourceCatalogRevision, ResourcePanelProjection, ResourcePanelRow, ResourceSuggestion, ResourceTarget } from "../../kernel/kernel-types.ts";
import type { ResourceKind } from "../../copy.ts";
import { areaKey, shardOwner } from "../../units/ids.ts";
import type { AreaKey, OperationId, ShardOwner } from "../../units/ids.ts";
import { resourceEntityForRow } from "./resource-rows.ts";
import type { ResourceDraft, ResourceDraftMode } from "./resources-state.ts";
import { suggestionReference } from "./resources-wire.ts";
import type { InspectedTarget, ResourceMutation, ResourceTargetInput } from "./resources-wire.ts";

/** What opens a draft: its mode, an explicit kind, the row it edits, or the Suggestion it accepts. */
export type ResourceDraftRequest = {
  readonly mode?: ResourceDraftMode;
  readonly kind?: ResourceKind | null;
  readonly row?: ResourcePanelRow | null;
  readonly suggestion?: ResourceSuggestion | null;
};

/** The kinds a draft may record. */
const DRAFT_KINDS: readonly ResourceKind[] = ["worktree", "repository", "link"];

/** The draft kind a target's kind maps to: a Suggestion's `local-path` is a worktree until the person says otherwise. */
function draftKindOf(targetKind: string | undefined): ResourceKind {
  if (targetKind === "local-path") return "worktree";
  return DRAFT_KINDS.find((kind) => kind === targetKind) ?? "worktree";
}

/** The target a draft starts from: the existing one when its kind matches, else an empty target of the requested kind. */
function startingTarget(existing: ResourceTarget | null, kind: ResourceKind): ResourceTarget {
  if (existing && kind === draftKindOf(existing.kind)) return existing;
  return kind === "link" ? { kind: "link", url: existing?.url ?? "" } : { kind, path: existing?.path ?? "" };
}

/** Builds the draft one request opens. The area is the panel's Area for an add; the operation id is minted by the caller. */
export function newResourceDraft(request: ResourceDraftRequest, area: AreaKey | null, operationId: OperationId, projection: ResourcePanelProjection | null): ResourceDraft {
  const mode = request.mode ?? "add";
  const row = request.row ?? null;
  const suggestion = request.suggestion ?? null;
  const entity = row ? resourceEntityForRow(row) : null;
  const existing = entity?.target ?? suggestion?.target ?? null;
  const kind = request.kind ?? draftKindOf(existing?.kind);
  const target = startingTarget(existing, kind);
  const draft: ResourceDraft = {
    mode,
    owner: mode === "add" ? area : null,
    kind,
    label: entity?.label ?? suggestion?.proposedLabel ?? "",
    target: target.url ?? target.path ?? "",
    row,
    suggestion,
    inspection: null,
    confirmMissing: false,
    error: "",
    operationId,
    expectedCatalogs: [],
    stale: false,
    hidden: false,
  };
  return { ...draft, expectedCatalogs: draftCatalogExpectations(draft, projection) };
}

/** The Area one shard owner names, or null when there is no owner. Every catalog owner is an Area. */
function ownerArea(owner: ShardOwner | null | undefined): AreaKey | null {
  return owner ? areaKey(owner) : null;
}

/** The Area whose catalog a draft writes: the edited row's owner, the Suggestion's owner, or the add target. */
export function draftOwner(draft: ResourceDraft): AreaKey | null {
  if (draft.mode === "edit") return ownerArea(resourceEntityForRow(draft.row)?.locator.owner);
  if (draft.mode === "suggestion") return ownerArea(draft.suggestion?.owner);
  return draft.owner;
}

/** The catalog revisions a draft is fenced to: the owner's, as the projection showed them when the draft opened or was rebased. */
export function draftCatalogExpectations(draft: ResourceDraft, projection: ResourcePanelProjection | null): ResourceCatalogRevision[] {
  const owner = draftOwner(draft);
  return (projection?.catalogs ?? []).filter((catalog) => ownerArea(catalog.owner) === owner).map((catalog) => ({ owner: catalog.owner, revision: catalog.revision }));
}

/** True when two fences name the same owners at the same revisions in the same order. */
export function sameCatalogRevisions(left: readonly ResourceCatalogRevision[], right: readonly ResourceCatalogRevision[]): boolean {
  return left.length === right.length && left.every((catalog, position) => catalog.owner === right[position]?.owner && catalog.revision === right[position]?.revision);
}

/** The inspect request a draft sends: a URL for a link, a path otherwise. */
export function draftInspectRequest(draft: ResourceDraft): { kind: ResourceKind; url?: string; path?: string } {
  return draft.kind === "link" ? { kind: "link", url: draft.target } : { kind: draft.kind, path: draft.target };
}

/** True when the inspection found a missing path the person has not confirmed yet. */
export function draftNeedsMissingConfirmation(draft: ResourceDraft, inspected: InspectedTarget): boolean {
  return inspected.kind === "local" && inspected.state === "missing" && !draft.confirmMissing;
}

/** The target input a mutation records from an inspection, with the missing confirmation when the path is missing. */
export function targetInputFrom(inspected: InspectedTarget): ResourceTargetInput {
  if (inspected.kind === "link") return { target: inspected.normalized };
  const missing = inspected.state === "missing" && inspected.targetFingerprint ? { targetFingerprint: inspected.targetFingerprint } : null;
  return { target: inspected.normalized, missingConfirmation: missing };
}

/** The mutation a draft becomes once its target is inspected, or null when an edit lost its row or an add has no Area. */
export function draftMutation(draft: ResourceDraft, input: ResourceTargetInput, area: AreaKey | null): ResourceMutation | null {
  const label = draft.label.trim() || null;
  if (draft.mode === "edit") {
    const locator = resourceEntityForRow(draft.row)?.locator;
    return locator ? { kind: "edit", resource: locator, input, label } : null;
  }
  if (draft.mode === "suggestion") {
    return draft.suggestion ? { kind: "add-suggestion", selection: { suggestion: suggestionReference(draft.suggestion), input }, labelForNewRecord: label } : null;
  }
  return area ? { kind: "add", owner: shardOwner(area), input, label } : null;
}
