// Which shard a new element belongs to, and which elements an arrow binds.
//
// Excalidraw mints an element with an id of its own and no idea which Area file owns it. Every
// element the composition does not already know has to be claimed for a shard before it can be
// split back out, and the claim has to be recorded under every id that element has been known
// under, so a later publish, a text edit or a selection still finds it. That bookkeeping is here,
// with the arrow-endpoint search that decides which Blocks a new arrow joins, because an arrow can
// only be claimed once its start Block's owner is known.

import { elementRect } from "../input/hit-test.ts";
import { resolveClaimedId } from "../input/pointer-session.ts";
import { ownerForNewAreaMapElement, runtimeId as mintRuntimeId } from "../kernel/kernel-boundary.ts";
import type { ArrowBinding, ComposedOrigin, SceneElement, WorldEndpoint } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";
import { point } from "../units/frames.ts";
import type { Point } from "../units/frames.ts";
import { sourceId as mintSourceId } from "../units/ids.ts";
import type { RuntimeId, ShardOwner, SourceId } from "../units/ids.ts";
import { add, distance, half, rectCenter, rectContains } from "../units/scalar-math.ts";
import { scenePx } from "../units/units.ts";
import type { MapSession, PastePlacement } from "./map-session.ts";

/** The prefix the kernel gives a composed runtime id, which a source id must never reuse. */
const RUNTIME_PREFIX = "tw-";

/** The shapes an arrow endpoint may bind to. */
const BINDABLE_TYPES: ReadonlySet<SceneElement["type"]> = new Set<SceneElement["type"]>(["rectangle", "diamond", "ellipse"]);

/** Which end of an arrow a binding belongs to. */
type ArrowSide = "start" | "end";

/** Everything a claim needs to decide an owner and record it. */
export type ClaimContext = {
  readonly session: MapSession;
  readonly origins: Map<RuntimeId, ComposedOrigin>;
  /** Every source id already used per owner, so a claim never collides with one. */
  readonly sourceIds: Map<ShardOwner, Set<SourceId>>;
  /** The ids claimed inside this publish, which the caller remaps its selection through. */
  readonly claimedIds: Map<RuntimeId, RuntimeId>;
  /** The owners whose shards this publish may rewrite. */
  readonly candidateOwners: Set<ShardOwner>;
  /** The Areas the world holds, so a claim never names one that is not there. */
  readonly owners: ReadonlySet<ShardOwner>;
  /** The Area a claim falls back to: the one the Map is viewed from. */
  readonly fallbackOwner: ShardOwner;
  /** Where a paste asked to land, or null. */
  readonly paste: PastePlacement | null;
  /** The deepest visible Area at a scene point, or the fallback owner. */
  readonly ownerAt: (at: Point<"scene">) => ShardOwner;
};

/** Returns a source id that cannot reuse a copied world identity. */
export function freshSourceId(element: SceneElement, used: Set<SourceId>): SourceId {
  let candidate = element.id.startsWith(RUNTIME_PREFIX) ? mintSourceId(`area-map-${crypto.randomUUID()}`) : mintSourceId(element.id);
  while (used.has(candidate)) candidate = mintSourceId(`area-map-${crypto.randomUUID()}`);
  used.add(candidate);
  return candidate;
}

/** The centre of one element, which is where a claim looks for an owning Area when nothing else says. */
function elementCentre(element: SceneElement): Point<"scene"> {
  const box = elementRect(element);
  return point("scene", add(box.x, half(box.width)), add(box.y, half(box.height)));
}

/** Records one claimed identity under every alias the element has been known by. */
function recordClaim(context: ClaimContext, incomingId: RuntimeId, claimed: RuntimeId, origin: ComposedOrigin): void {
  for (const mapping of [context.claimedIds, context.session.claimedIds]) {
    for (const [alias] of [...mapping]) {
      if (resolveClaimedId(mapping, alias) !== incomingId) continue;
      mapping.set(alias, claimed);
      context.session.claimedOrigins.set(alias, origin);
    }
    mapping.set(incomingId, claimed);
  }
  context.session.claimedOrigins.set(incomingId, origin);
  context.session.claimedOrigins.set(claimed, origin);
}

/** Claims one new runtime element for a shard without trusting a copied source identity. */
export function claimElement(context: ClaimContext, element: SceneElement, requested: ShardOwner | null): ComposedOrigin {
  const owner = requested !== null && context.owners.has(requested) ? requested : context.fallbackOwner;
  const used = context.sourceIds.get(owner) ?? new Set<SourceId>();
  context.sourceIds.set(owner, used);
  const origin: ComposedOrigin = { owner, sourceId: freshSourceId(element, used) };
  context.origins.set(element.id, origin);
  recordClaim(context, element.id, mintRuntimeId(owner, origin.sourceId), origin);
  context.candidateOwners.add(owner);
  element.customData = { ...(element.customData ?? {}), tangentWorld: origin };
  return origin;
}

/** Claims every new Block and free-ink element, so a new bound arrow can inherit its start Block's owner. */
export function claimNonArrows(context: ClaimContext, elements: readonly SceneElement[], pointer: Point<"scene"> | null): void {
  for (const element of elements) {
    if (element.type === "arrow" || context.origins.has(element.id)) continue;
    const at = pointer ?? elementCentre(element);
    claimElement(context, element, ownerForNewAreaMapElement({
      copiedOwner: element.customData?.tangentWorld?.owner ?? null,
      pasteOwner: context.paste?.area ?? null,
      pointOwner: context.ownerAt(at),
    }));
  }
}

/** Resolves one binding id through direct, claimed and source-origin identities. */
function bindingElement(context: ClaimContext, byId: ReadonlyMap<RuntimeId, SceneElement>, id: RuntimeId | null | undefined): SceneElement | null {
  if (!id) return null;
  const direct = byId.get(id);
  if (direct !== undefined) return direct;
  const claimed = resolveClaimedId(context.session.claimedIds, id);
  const viaClaim = byId.get(claimed);
  if (viaClaim !== undefined) return viaClaim;
  const matches = [...context.origins].filter(([, origin]) => mintRuntimeId(origin.owner, origin.sourceId) === claimed || String(origin.sourceId) === String(id));
  const only = matches.length === 1 ? matches[0] : undefined;
  return only === undefined ? null : byId.get(only[0]) ?? null;
}

/** The scene point one end of an arrow reaches, from its own points or from its box. */
function endpointPoint(arrow: SceneElement, side: ArrowSide): Point<"scene"> {
  const offset = side === "start" ? arrow.points?.[0] : arrow.points?.at(-1);
  const fallbackX = side === "start" ? scenePx(0) : arrow.width;
  const fallbackY = side === "start" ? scenePx(0) : arrow.height;
  const dx = offset === undefined ? fallbackX : scenePx(offset[0]);
  const dy = offset === undefined ? fallbackY : scenePx(offset[1]);
  return point("scene", add(arrow.x, dx), add(arrow.y, dy));
}

/** True when one element already carries a binding back to the arrow, which wins over distance. */
function bindsBack(element: SceneElement, arrow: SceneElement): boolean {
  return (element.boundElements ?? []).some((binding) => binding.type === "arrow" && binding.id === arrow.id);
}

/** The connectable element nearest one arrow endpoint, within the binding reach. */
function nearestBindable(context: ClaimContext, elements: readonly SceneElement[], arrow: SceneElement, at: Point<"scene">, exclude: RuntimeId | null): SceneElement | null {
  const candidates = elements.filter((element) => element.id !== arrow.id && element.id !== exclude && !element.isDeleted
    && context.origins.has(element.id) && BINDABLE_TYPES.has(element.type) && rectContains(elementRect(element), at, LAYOUT.arrowBindingReach));
  /** How far one candidate's centre sits from the endpoint. */
  const reach = (element: SceneElement) => distance(rectCenter(elementRect(element)), at);
  return [...candidates].sort((left, right) => (Number(bindsBack(right, arrow)) - Number(bindsBack(left, arrow))) || (reach(left) - reach(right)))[0] ?? null;
}

/** The element one arrow endpoint binds to: the one it names, else the nearest connectable shape. */
function endpointTarget(context: ClaimContext, byId: ReadonlyMap<RuntimeId, SceneElement>, elements: readonly SceneElement[], arrow: SceneElement, side: ArrowSide, exclude: RuntimeId | null): SceneElement | null {
  const named = bindingElement(context, byId, side === "start" ? arrow.startBinding?.elementId : arrow.endBinding?.elementId);
  return named ?? nearestBindable(context, elements, arrow, endpointPoint(arrow, side), exclude);
}

/** An arrow binding pointed at a new element. Excalidraw fills in focus and gap when it next measures the arrow. */
function bindingTo(existing: ArrowBinding<"scene"> | null | undefined, id: RuntimeId): ArrowBinding<"scene"> {
  return { ...(existing ?? {}), elementId: id } as ArrowBinding<"scene">;
}

/** Writes one arrow endpoint into both the arrow and the element it joins. */
function bindEndpoint(context: ClaimContext, arrow: SceneElement, side: ArrowSide, target: SceneElement | null, endpoints: { start?: WorldEndpoint; end?: WorldEndpoint }): void {
  if (target === null) return;
  const origin = context.origins.get(target.id) ?? target.customData?.tangentWorld;
  if (origin === undefined) return;
  endpoints[side] = { owner: origin.owner, sourceId: origin.sourceId };
  if (side === "start") arrow.startBinding = bindingTo(arrow.startBinding, target.id);
  else arrow.endBinding = bindingTo(arrow.endBinding, target.id);
  target.boundElements = [...(target.boundElements ?? []).filter((binding) => binding.id !== arrow.id), { id: arrow.id, type: "arrow" }];
}

/** Claims every new arrow and records the shards its two endpoints belong to. */
export function claimArrows(context: ClaimContext, elements: readonly SceneElement[], pointer: Point<"scene"> | null): void {
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const arrow of elements) {
    if (arrow.type !== "arrow") continue;
    const start = endpointTarget(context, byId, elements, arrow, "start", null);
    const end = endpointTarget(context, byId, elements, arrow, "end", start?.id ?? null);
    if (!context.origins.has(arrow.id)) {
      const startOrigin = start === null ? undefined : context.origins.get(start.id) ?? start.customData?.tangentWorld;
      claimElement(context, arrow, ownerForNewAreaMapElement({
        copiedOwner: arrow.customData?.tangentWorld?.owner ?? null,
        pasteOwner: context.paste?.area ?? null,
        startOwner: startOrigin?.owner ?? null,
        pointOwner: context.ownerAt(pointer ?? point("scene", arrow.x, arrow.y)),
      }));
    }
    const endpoints: { start?: WorldEndpoint; end?: WorldEndpoint } = { ...(arrow.customData?.tangentWorldEndpoints ?? {}) };
    bindEndpoint(context, arrow, "start", start, endpoints);
    bindEndpoint(context, arrow, "end", end, endpoints);
    if (Object.keys(endpoints).length) arrow.customData = { ...(arrow.customData ?? {}), tangentWorldEndpoints: endpoints };
  }
}
