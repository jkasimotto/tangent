// Pure helpers over one Resources panel row: its entity, its resolution, its Map state, its
// words, its group and its order. The views and the stores read rows only through here, so the
// panel, the picker and the Outline agree on what a row says. Nothing here fetches or dispatches.

import { resolveMapEntity, resourceLocatorKey } from "../../kernel/kernel-boundary.ts";
import type {
  LegacyReviewRow, MapEntityFacts, MapKindsCatalog, ResourceEntity, ResourceLocatorKey, ResourcePanelProjection, ResourcePanelRow,
  ResourceResolution, ResourceSuggestion, ResourceWarning, SuggestionEvidence,
} from "../../kernel/kernel-types.ts";
import { RESOURCES_PANEL, RESOURCE_DETAILS, RESOURCE_ROW } from "../../copy.ts";
import type { Representation } from "../../copy.ts";
import { areaKey, sourceId } from "../../units/ids.ts";
import type { AreaKey } from "../../units/ids.ts";
import type { LegacyCandidateKey } from "./resources-state.ts";

/** The four inventory groups, in the order the panel lists them. */
export type ResourceGroupKey = "local" | "links" | "removed" | "inherited";

/** One inventory group with its rows already sorted. */
export type ResourceRowGroup = { readonly key: ResourceGroupKey; readonly label: string; readonly rows: readonly ResourcePanelRow[] };

/** The facts the details page prints for one row, already reduced to words. */
export type ResourceDetailsFacts = {
  readonly branch: string;
  readonly repositoryPath: string;
  readonly checkedAt: string;
  readonly providerUpdatedAt: string;
  readonly observationError: string;
  readonly legacyOrigin: string;
  readonly warnings: readonly string[];
};

/** The entity a row carries, or null for a row with none. */
export function resourceEntityForRow(row: ResourcePanelRow | null | undefined): ResourceEntity | null {
  return row?.entity ?? null;
}

/** The locator key of a row, or null when the row has no safe locator. */
export function resourceRowKey(row: ResourcePanelRow | null | undefined): ResourceLocatorKey | null {
  return resourceLocatorKey(resourceEntityForRow(row)?.locator);
}

/** Adapts one row to the resolver's current-or-gone authority union. */
export function resourceResolutionForRow(row: ResourcePanelRow | null | undefined): ResourceResolution | null {
  const entity = resourceEntityForRow(row);
  if (!entity) return null;
  return entity.reason ? { state: "gone", value: entity } : { state: "current", value: entity };
}

/** The resolution the panel shows for a row: the cached one when the facts store has it, else the row's own. */
export function resolutionForRow(resolutions: ReadonlyMap<ResourceLocatorKey, ResourceResolution>, row: ResourcePanelRow): ResourceResolution | null {
  const key = resourceRowKey(row);
  return (key ? resolutions.get(key) : undefined) ?? resourceResolutionForRow(row);
}

/** The locator key a resolution is filed under: its entity's locator, else the locator it named. */
export function resolutionKey(resolution: ResourceResolution): ResourceLocatorKey | null {
  return resourceLocatorKey(resolution.value?.locator ?? resolution.locator);
}

/** Projects the observable Checking state onto a current resolution without discarding its last usable fact. */
export function checkingResourceResolution(resolution: ResourceResolution): ResourceResolution {
  if (resolution.state !== "current" || !resolution.value) return resolution;
  const value = resolution.value;
  if (value.target?.kind !== "link" && value.local) {
    return { ...resolution, value: { ...value, local: { state: "checking", value: value.local.value ?? null, checkedAt: value.local.checkedAt ?? null } } };
  }
  if (value.link?.kind && value.link.kind !== "generic" && value.link.lifecycle) {
    const lifecycle = value.link.lifecycle;
    return { ...resolution, value: { ...value, link: { ...value.link, lifecycle: { state: "checking", value: lifecycle.value ?? null, checkedAt: lifecycle.checkedAt ?? null } } } };
  }
  return resolution;
}

/** The provider's state in words, only when one has been observed. */
export function providerLifecycleLabel(resolution: ResourceResolution | null | undefined): string {
  return resolution?.value?.link?.lifecycle?.value?.stateLabel ?? "";
}

/** The Map state the catalog recorded for a row, without treating an unavailable source read as Never placed. */
export function savedRepresentationForRow(row: ResourcePanelRow | null | undefined): Representation {
  const value = resourceEntityForRow(row)?.representation;
  if (typeof value === "string") return value;
  return value?.state === "current" ? value.value : "unavailable";
}

/** The label a row sorts and reads by: its own, or the last known one of a gone row. */
export function resourceRowLabel(row: ResourcePanelRow | null | undefined): string {
  const entity = resourceEntityForRow(row);
  return entity?.label || entity?.lastKnown?.label || "";
}

/** Ranks launch rows first, placed rows second, and the rest last. */
function rowPriority(row: ResourcePanelRow): "launch" | "placed" | "other" {
  if (row.launchMatch.state === "current" && row.launchMatch.value) return "launch";
  return savedRepresentationForRow(row) === "on-map" ? "placed" : "other";
}

const PRIORITY_ORDER: readonly ("launch" | "placed" | "other")[] = ["launch", "placed", "other"];

/** Orders rows within a group: launch binding first, placed second, then by label. Returns a new array. */
export function sortPanelResourceRows(rows: readonly ResourcePanelRow[]): ResourcePanelRow[] {
  return [...rows].sort((left, right) => (PRIORITY_ORDER.indexOf(rowPriority(left)) - PRIORITY_ORDER.indexOf(rowPriority(right)))
    || resourceRowLabel(left).localeCompare(resourceRowLabel(right), undefined, { sensitivity: "base" }));
}

/** True when the row is the viewed Area's own, not inherited from an ancestor. */
export function rowIsDirect(row: ResourcePanelRow): boolean {
  return row.relation.kind !== "inherited";
}

/** The inventory group a row belongs to. */
export function resourceGroupForRow(row: ResourcePanelRow): ResourceGroupKey {
  if (!rowIsDirect(row)) return "inherited";
  const entity = resourceEntityForRow(row);
  if (entity?.reason) return "removed";
  return entity?.target?.kind === "link" ? "links" : "local";
}

/** The four groups with their rows sorted, empty groups dropped. */
export function groupPanelResourceRows(rows: readonly ResourcePanelRow[]): ResourceRowGroup[] {
  const keys: readonly ResourceGroupKey[] = ["local", "links", "removed", "inherited"];
  return keys
    .map((key) => ({ key, label: RESOURCES_PANEL.groups[key], rows: sortPanelResourceRows(rows.filter((row) => resourceGroupForRow(row) === key)) }))
    .filter((group) => group.rows.length > 0);
}

/** One identity warning in words. An unknown kind prints nothing. */
export function resourceWarningText(warning: ResourceWarning): string {
  if (warning.kind === "path-alias") return RESOURCES_PANEL.pathAliasWarning(warning.other?.id ?? null, warning.other?.owner ?? null);
  if (warning.kind === "cross-kind-target") return RESOURCES_PANEL.crossKindWarning(warning.other?.owner ?? null);
  return "";
}

/** Every warning of an entity in words, silent kinds dropped. */
export function resourceWarningTexts(entity: ResourceEntity | null | undefined): string[] {
  return (entity?.warnings ?? []).map(resourceWarningText).filter((text) => text !== "");
}

/** The separator inside a legacy candidate key, one a field or a fingerprint can never contain. */
const NUL = String.fromCharCode(0);

/** Gives one legacy review row a stable panel identity without making it resource authority. */
export function legacyCandidateKey(candidate: LegacyReviewRow): LegacyCandidateKey {
  return [candidate.owner, candidate.field, candidate.targetFingerprint ?? candidate.evidenceHash ?? ""].join(NUL);
}

/** The words for where a row came from: its own Area, or the ancestor it is inherited from. */
export function rowProvenance(row: ResourcePanelRow): string {
  return rowIsDirect(row) ? RESOURCE_ROW.direct : RESOURCE_ROW.from(row.relation.sourceArea ?? row.relation.from ?? "");
}

/** The exact target a row shows: its target, else its last known one, else the unavailable words. */
export function rowTargetText(entity: ResourceEntity | null | undefined): string {
  const target = entity?.target ?? entity?.lastKnown?.target;
  return target?.url ?? target?.path ?? RESOURCE_ROW.targetUnavailable;
}

/** Resolves one row into the same facts as its Map Block: words, accessible name and actions. */
export function resourceRowFacts(row: ResourcePanelRow, resolution: ResourceResolution | null, kinds: MapKindsCatalog | null): MapEntityFacts | null {
  const entity = resourceEntityForRow(row);
  if (!entity) return null;
  return resolveMapEntity({
    source: { owner: entity.locator.owner, sourceId: sourceId(entity.locator.id) },
    tangent: { kind: "resource", ref: entity.locator.id },
    resource: resolution,
    kinds,
  });
}

/** True when a row's facts match the filter text. An empty filter matches every row; a row with no facts matches none. */
export function rowMatchesFilter(facts: MapEntityFacts | null, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return facts?.searchText.toLowerCase().includes(needle) ?? false;
}

/** True when the Area launch binding starts workers from this row. */
export function rowIsLaunchDefault(row: ResourcePanelRow): boolean {
  return row.launchMatch.state === "current" && row.launchMatch.value;
}

/** The refresh button's label for a row: an unchecked path, a link, or a path. */
export function rowRefreshLabel(entity: ResourceEntity | null | undefined): string {
  return RESOURCE_ROW.refreshLabel(entity?.local?.state === "not-checked", entity?.target?.kind === "link");
}

/** True when a gone row still has a safe Last-known target the person may add back. */
export function rowCanAddBack(row: ResourcePanelRow): boolean {
  const entity = resourceEntityForRow(row);
  if (!entity || !rowIsDirect(row) || row.viewedFrom !== areaKey(entity.locator.owner)) return false;
  return Boolean(entity.lastKnown?.target) && (entity.reason === "removed" || entity.reason === "missing-record");
}

/** True when a direct worktree row was found not to be a worktree, so Change to Repository applies. */
export function rowIsWrongKind(row: ResourcePanelRow): boolean {
  const entity = resourceEntityForRow(row);
  return rowIsDirect(row) && !entity?.reason && entity?.target?.kind === "worktree" && entity.local?.value?.state === "not-a-worktree";
}

/** The details facts of one row in words, read from the observed entity when a resolution has one. */
export function resourceDetailsFacts(row: ResourcePanelRow, resolution: ResourceResolution | null): ResourceDetailsFacts {
  const entity = resourceEntityForRow(row);
  const observed = resolution?.value ?? entity;
  const checkout = observed?.local?.value?.checkout ?? null;
  const origin = entity?.origin?.kind === "legacy-area-binding" ? entity.origin : null;
  return {
    branch: checkout?.kind === "branch" ? (checkout.branchRef ?? "").replace(/^refs\/heads\//, "") : "",
    repositoryPath: observed?.local?.value?.repositoryPath ?? "",
    checkedAt: observed?.local?.checkedAt ?? observed?.link?.lifecycle?.checkedAt ?? "",
    providerUpdatedAt: observed?.link?.lifecycle?.value?.providerUpdatedAt ?? "",
    observationError: observed?.link?.lifecycle?.error?.message ?? observed?.local?.error?.message ?? "",
    legacyOrigin: origin ? RESOURCE_DETAILS.legacyOriginValue(origin.field ?? "", origin.declaredBranch ?? null) : "",
    warnings: resourceWarningTexts(observed),
  };
}

/**
 * True when the panel may say the Area holds no confirmed resources. A partial read, a pending
 * Suggestion and a pending legacy review each make the claim false, because none of them is empty.
 */
export function panelIsConfidentlyEmpty(projection: ResourcePanelProjection | null): boolean {
  if (!projection || projection.state !== "current") return false;
  return projection.rows.length === 0 && projection.suggestions.length === 0 && projection.legacyReview.length === 0;
}

/** True when a Suggestion belongs to the viewed Area, so the panel may write it instead of routing to its owner. */
export function suggestionIsDirect(suggestion: ResourceSuggestion, area: AreaKey | null): boolean {
  return area !== null && areaKey(suggestion.owner) === area;
}

/** The exact target a Suggestion or a legacy candidate proposes, empty when it names none. */
export function suggestionTargetText(candidate: SuggestionEvidence): string {
  return candidate.target?.url ?? candidate.target?.path ?? "";
}

/** The name a Suggestion or a legacy candidate reads by: the label it proposes, else its exact target. */
export function suggestionLabel(candidate: ResourceSuggestion | LegacyReviewRow): string {
  return candidate.proposedLabel || suggestionTargetText(candidate);
}
