// The identifiers of the Map, each its own brand so an id of one kind cannot stand in for another.
//
// The kernel keeps every one of these as a plain string or number. The kernel boundary brands them
// on the way in with the constructors here, and no consumer ever spells the raw type.

import type { Brand } from "./brand.ts";

/** The vault path of an Area, such as `otto/tangent`. What a shard is keyed by and what a region names. */
export type AreaKey = Brand<string, "AreaKey">;

/** The id of an element inside Excalidraw's composed scene, minted by the kernel from an owner and a source id. */
export type RuntimeId = Brand<string, "RuntimeId">;

/** The id of an element inside one shard, what the vault stores. */
export type SourceId = Brand<string, "SourceId">;

/** The owner of a shard: an Area's key, or the kernel's root owner for the top-level shard. */
export type ShardOwner = Brand<string, "ShardOwner">;

/** The controller's world revision, incremented on every committed change. Compared, never measured. */
export type WorldRevision = Brand<number, "WorldRevision">;

/** The opaque id of a Resource, as the wire registry guards it. */
export type ResourceId = Brand<string, "ResourceId">;

/** The id of one resource mutation attempt, minted in the browser and reused on retry so the server can replay its receipt. */
export type OperationId = Brand<string, "OperationId">;

/** The eight handles an Area region can be resized from, named by compass direction as the kernel names them. */
export type ResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

/** Every resize handle, in the kernel's order. */
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

/** Tags a raw string as an Area key. */
export function areaKey(value: string): AreaKey {
  return value as AreaKey;
}

/** Tags a raw string as a composed-scene element id. */
export function runtimeId(value: string): RuntimeId {
  return value as RuntimeId;
}

/** Tags a raw string as a shard-local element id. */
export function sourceId(value: string): SourceId {
  return value as SourceId;
}

/** Tags a raw string as a shard owner. */
export function shardOwner(value: string): ShardOwner {
  return value as ShardOwner;
}

/** Tags a raw number as a world revision. */
export function worldRevision(value: number): WorldRevision {
  return value as WorldRevision;
}

/** Tags a raw string as a Resource id. */
export function resourceId(value: string): ResourceId {
  return value as ResourceId;
}

/** Tags a raw string as a resource mutation operation id. */
export function operationId(value: string): OperationId {
  return value as OperationId;
}

/** True when a string names one of the eight resize handles. */
export function isResizeHandle(value: string): value is ResizeHandle {
  return (RESIZE_HANDLES as readonly string[]).includes(value);
}
