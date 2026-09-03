import { regionId, runtimeId } from "./area-map-world-core.js";

// The wire registry. Every value the Map mints and later guards is one entry
// here: the minter beside the guard the server or the browser applies to the
// same value. area-map-wire-values.property.test.js walks every entry and
// proves the guard accepts everything the minter produces. Routes and browser
// modules import their guards from here, never from a regex of their own; the
// wire-guard-confinement lint bans an id-shaped regex literal anywhere else.
//
// This module is plain ESM shared by the server and the browser. It has no
// node: import. The one host-only capability, sha256 for revision digests, is
// detected at load through process.getBuiltinModule and is absent in a browser,
// where nothing ever mints a revision.

/**
 * The one alphabet for an opaque machine identifier on the Map wire: a letter
 * or digit first, then up to 127 letters, digits, underscores, dots, colons or
 * hyphens. Operation IDs, gesture IDs, revisions, resource IDs and element IDs
 * all pass through this guard on the server or in the browser.
 */
export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** A world ID names one private view-state file, so it carries no dot or colon and is shorter. */
export const WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A saved shard's revision is its canvas hash, sha256 as hex, minted by canvasHash in area-canvas.mjs. */
export const CANVAS_HASH = /^[0-9a-f]{64}$/;
const OPAQUE_ID_MAX_LENGTH = 128;
const WORLD_ID_MAX_LENGTH = 64;
const DIGEST_LENGTH = 16;
const SHARD_REVISION_PREFIXES = new Set(["legacy", "unreadable"]);
const MISSING_SHARD_REVISION = "missing";
const SHARD_REVISION_MAX_LENGTH = "unreadable:".length + OPAQUE_ID_MAX_LENGTH;

/**
 * Returns the host's synchronous sha256 hasher as base64url, or null in a browser.
 *
 * process.getBuiltinModule is a plain function call, so no bundler and no
 * browser ever sees a node: import. In the browser globalThis.process has no
 * such function and the hasher is null; that is fine because only the server
 * mints a revision.
 */
function hostSha256() {
  const crypto = globalThis.process?.getBuiltinModule?.("node:crypto");
  if (typeof crypto?.createHash !== "function") return null;
  /** Hashes one string with the host's sha256 and returns unpadded base64url. */
  return (value) => crypto.createHash("sha256").update(String(value)).digest("base64url");
}
const sha256 = hostSha256();

/**
 * Returns a compact revision digest that always satisfies OPAQUE_ID.
 *
 * The base64url alphabet includes "-" and "_", so about one digest in thirty-two
 * began with a character OPAQUE_ID rejects. The world revision round-trips
 * through the browser and back into applyGesture, so those digests made the
 * server reject its own value with 400 "a safe world revision is required",
 * which failed the save, queued every later edit behind it, and left the next
 * reload asking whether to restore or discard. The leading letter keeps every
 * minted identifier inside the alphabet this module validates. The world ID
 * and the tree revision are minted the same way.
 */
export const digest = (value) => {
  if (!sha256) throw new Error("digest needs the server's sha256 hasher; the browser never mints a revision");
  return `r${sha256(value).slice(0, DIGEST_LENGTH)}`;
};

/** Reports whether one value is a bounded opaque machine identifier. */
export function isOpaqueId(value) {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

/** Reports whether one value is safe to use as a catalog-local opaque identity. */
export function isSafeResourceId(value) {
  return isOpaqueId(value);
}

/** Reports whether a world ID is safe to name one private state file. */
export function isSafeWorldId(value) {
  return typeof value === "string" && WORLD_ID.test(value);
}

/**
 * Returns one Area shard's revision token: the saved canvas hash, a digest of
 * the legacy text or of the read errors behind its prefix, or "missing".
 */
export const shardRevision = (shard) => shard.hash ?? (shard.legacy?.text ? `legacy:${digest(shard.legacy.text)}` : shard.ok === false ? `unreadable:${digest(shard.errors?.join("\n"))}` : MISSING_SHARD_REVISION);

/** Reports whether one value has the shape shardRevision mints and nothing else. */
export function isShardRevision(value) {
  if (typeof value !== "string") return false;
  if (value === MISSING_SHARD_REVISION || CANVAS_HASH.test(value)) return true;
  const separator = value.indexOf(":");
  return separator > 0 && SHARD_REVISION_PREFIXES.has(value.slice(0, separator)) && isOpaqueId(value.slice(separator + 1));
}

/** Mints one random version 4 UUID; globalThis.crypto exists in Node 26 and in every browser. */
const randomUuid = () => globalThis.crypto.randomUUID();

/** Pairs one minter with the guard applied to its values and the guard's length cap. */
function wireValue(mint, accepts, maxLength) {
  return Object.freeze({ mint, accepts, maxLength });
}

/**
 * Every minted-then-guarded Map value. The key names the value as it travels
 * on the wire; `mint` produces it, `accepts` is the guard the server or the
 * browser applies, and `maxLength` is the longest string `accepts` allows.
 */
export const WIRE_VALUES = Object.freeze({
  worldRevision: wireValue(digest, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  treeRevision: wireValue(digest, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  worldId: wireValue(digest, isSafeWorldId, WORLD_ID_MAX_LENGTH),
  resourceId: wireValue(randomUuid, isSafeResourceId, OPAQUE_ID_MAX_LENGTH),
  runtimeId: wireValue(runtimeId, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  regionId: wireValue(regionId, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  operationId: wireValue(randomUuid, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  gestureId: wireValue(randomUuid, isOpaqueId, OPAQUE_ID_MAX_LENGTH),
  shardRevision: wireValue(shardRevision, isShardRevision, SHARD_REVISION_MAX_LENGTH),
});

export default { CANVAS_HASH, OPAQUE_ID, WIRE_VALUES, WORLD_ID, digest, isOpaqueId, isSafeResourceId, isSafeWorldId, isShardRevision, shardRevision };
