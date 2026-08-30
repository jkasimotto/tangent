import { createHash } from "node:crypto";
import { areaForBlock, isAreaRegion } from "./public/area-board-core.js";
import { provisionalRegions, regionKey } from "./public/area-map-world-core.js";

/** Returns a compact revision digest. */
const digest = (value) => createHash("sha256").update(value).digest("base64url").slice(0, 16);
/** Copies one element rectangle. */
const rectangle = (element) => ({ x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height) });

/** Builds complete structural world snapshots over the existing per-Area shard repository. */
export function createAreaMapWorldIndex({ root, repository, listAreas }) {
  /** Reads one complete structural world snapshot. */
  async function snapshot(locatedArea) {
    const areaKeys = [...new Set(await listAreas())].filter((area) => area && area !== "@root").sort();
    if (!areaKeys.includes(locatedArea)) return null;
    const reads = await Promise.all(areaKeys.map(async (area) => {
      try { return [area, await repository.read(area)]; }
      catch (error) { return [area, { area, exists: true, ok: false, hash: null, errors: [error.message], scene: null }]; }
    }));
    const shards = new Map(reads);
    const stored = new Map();
    for (const [owner, shard] of reads) for (const element of shard.scene?.elements ?? []) {
      if (element.isDeleted || !isAreaRegion(element)) continue;
      const child = areaForBlock(element);
      if (child && child.startsWith(`${owner}/`) && !child.slice(owner.length + 1).includes("/")) stored.set(regionKey(owner, child), rectangle(element));
    }
    const regions = provisionalRegions(areaKeys, stored);
    const treeRevision = digest(areaKeys.map((area) => `${area}>${regions.get(area)?.owner}`).join("\n"));
    const worldRevision = digest(`${treeRevision}\n${reads.map(([area, shard]) => `${area}:${shard.hash ?? shard.ok}`).join("\n")}`);
    const locatedDepth = locatedArea.split("/").length;
    /** Reports whether an Area is on the located ancestor path. */
    const onPath = (area) => locatedArea === area || locatedArea.startsWith(`${area}/`);
    /** Reports whether an Area is in the first two descendant levels. */
    const inEagerSubtree = (area) => area === locatedArea || area.startsWith(`${locatedArea}/`) && area.split("/").length <= locatedDepth + 2;
    const areas = areaKeys.map((key) => {
      const shard = shards.get(key); const region = regions.get(key);
      const eager = onPath(key) || inEagerSubtree(key);
      const elements = shard.scene?.elements?.filter((element) => !element.isDeleted) ?? [];
      return {
        key, parent: region.owner, children: areaKeys.filter((candidate) => regions.get(candidate)?.owner === key), depth: key.split("/").length - 1,
        region,
        shard: {
          owner: key, file: shard.file ?? null, hash: shard.hash ?? null,
          state: shard.ok === false ? "unreadable" : eager ? (shard.exists ? "ready" : "missing") : "deferred",
          elementCount: elements.length,
          ...(eager && shard.ok !== false ? { scene: shard.scene } : {}),
          ...(shard.errors?.length ? { errors: shard.errors } : {}),
        },
      };
    });
    return { schema: "area-map-world.v1", worldId: digest(root), treeRevision, worldRevision, locatedArea, areas };
  }

  /** Reads one deferred shard against its structural revision. */
  async function shard(area, worldRevision, locatedArea) {
    const world = await snapshot(locatedArea);
    if (!world || world.worldRevision !== worldRevision) return { status: 409, error: "map world changed", worldRevision: world?.worldRevision ?? null };
    const node = world.areas.find((entry) => entry.key === area);
    if (!node) return { status: 404, error: `no Area ${area}` };
    const current = await repository.read(area);
    return { status: 200, area, worldRevision, hash: current.hash, state: current.ok === false ? "unreadable" : current.exists ? "ready" : "missing", scene: current.ok === false ? undefined : current.scene, errors: current.errors ?? [] };
  }
  return { snapshot, shard };
}
