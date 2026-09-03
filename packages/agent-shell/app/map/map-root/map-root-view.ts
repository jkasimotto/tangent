// What the Map derives from one controller snapshot before it renders.
//
// The snapshot is world authority. The Area names, the Block facts, the name pills, the Outline
// rows and the selected Block all come from it and from the vault documents the host supplies, and
// every surface must read the same answers or two surfaces would say different words about the same
// Area. That is what this file is: one pure derivation per render, built once and passed down.

import { accessibleAreaName, areaLabelModels, areaName as areaTitle, areaPathName as areaPath, areaRecords } from "../canvas/area-label-model.ts";
import type { AreaLabelModel, AreaRecords } from "../canvas/area-label-model.ts";
import { resolveMapEntity, resourceLocatorKey, tangentOf } from "../kernel/kernel-boundary.ts";
import type { AreaNode, MapEntityFacts, ResourceResolution, SceneElement, Snapshot, VaultDocument } from "../kernel/kernel-types.ts";
import { resourceId } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import { outlineTree } from "../surfaces/outline/outline-model.ts";
import type { OutlineTree } from "../surfaces/outline/outline-model.ts";

/** Everything one render reads from the snapshot, the documents and the resource facts. */
export type MapView = {
  readonly documents: readonly VaultDocument[];
  readonly records: AreaRecords;
  readonly areaName: (area: AreaKey) => string;
  readonly areaPathName: (area: AreaKey) => string;
  readonly accessibleAreaName: (node: AreaNode) => string;
  readonly resolveBlock: (element: SceneElement) => MapEntityFacts | null;
  readonly labels: readonly AreaLabelModel[];
  readonly outline: OutlineTree;
};

/** The documents the Map paints facts from: the picker's search results over what the host knows. */
export function mergedDocuments(hostDocuments: readonly VaultDocument[], searched: readonly VaultDocument[]): VaultDocument[] {
  const byFile = new Map<string, VaultDocument>();
  for (const item of [...searched, ...hostDocuments]) if (item.file) byFile.set(item.file, item);
  return [...byFile.values()];
}

/** Builds every derived value one render needs. */
export function buildMapView(
  snapshot: Snapshot,
  documents: readonly VaultDocument[],
  resolutions: ReadonlyMap<string, ResourceResolution>,
  currentFindArea: AreaKey | null,
): MapView {
  const records = areaRecords(documents);
  /** The document title of one Area, else its leaf name. */
  const areaName = (area: AreaKey): string => areaTitle(records, area);
  /** The resource facts of one composed Block, or null when it is not a resource. */
  const resolutionFor = (element: SceneElement): ResourceResolution | null => {
    const tangent = tangentOf(element);
    const owner = element.customData?.tangentWorld?.owner;
    if (tangent?.kind !== "resource" || owner === undefined) return null;
    const key = resourceLocatorKey({ owner, id: resourceId(tangent.ref) });
    return key === null ? null : resolutions.get(key) ?? null;
  };
  /** Resolves one Block with the kinds catalog every surface agrees on. */
  const resolveBlock = (element: SceneElement): MapEntityFacts | null =>
    resolveMapEntity({ element, documents: [...documents], resource: resolutionFor(element), kinds: snapshot.mapKinds ?? null });
  /** The accessible name of one Area row, shared by the pill and the Outline. */
  const accessible = (node: AreaNode): string => accessibleAreaName(records, node, snapshot.folded);
  return {
    documents,
    records,
    areaName,
    /** The full titled ancestry path of one Area. */
    areaPathName: (area: AreaKey) => areaPath(records, area),
    accessibleAreaName: accessible,
    resolveBlock,
    labels: areaLabelModels({
      areas: snapshot.world.areas,
      scopedAreas: snapshot.scopedAreas,
      folded: snapshot.folded,
      detailAreas: snapshot.detailAreas,
      regionRects: snapshot.composition.regionRects,
      camera: snapshot.camera,
      records,
      currentFindArea,
    }),
    outline: outlineTree({
      areas: snapshot.world.areas,
      elements: snapshot.composition.scene.elements,
      scopedAreas: snapshot.scopedAreas,
      folded: snapshot.folded,
      selection: snapshot.selection,
      areaName,
      accessibleAreaName: accessible,
      resolveBlock,
    }),
  };
}
