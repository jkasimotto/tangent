import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPAQUE_ID, WIRE_VALUES, digest, isSafeResourceId } from "./public/area-map-wire-values.js";
import { regionId, runtimeId } from "./public/area-map-world-core.js";

const MINTS_PER_ENTRY = 10_000;
const SEED = 0x5eed_2026;
/** Characters a hostile or merely unlucky input can carry: the guard alphabet, its edges, and things outside it. */
const ALPHABET = "abcXYZ019-_.:/>\\ \t\n\0é中😀\"'<&%";

/** Creates one repeatable unsigned pseudo-random stream. */
function random(seed) {
  let state = seed >>> 0;
  return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 0x1_0000_0000);
}

/** Draws one string of random length, empty allowed, over the hostile alphabet. */
function randomText(next) {
  const length = Math.floor(next() * 40);
  let text = "";
  for (let index = 0; index < length; index += 1) text += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return text;
}

/** Draws one Area-path-shaped string, since owners and parents are Area paths. */
function randomArea(next) {
  const depth = 1 + Math.floor(next() * 4);
  return Array.from({ length: depth }, () => randomText(next)).join("/");
}

/**
 * The arguments each minter takes, drawn from the seeded stream. Every registry
 * key must appear here and nothing else may, so a new entry cannot land without
 * its generator.
 */
const ARGUMENTS = {
  /** A world revision digests any joined text. */
  worldRevision: (next) => [randomText(next)],
  /** A tree revision digests any joined text. */
  treeRevision: (next) => [randomText(next)],
  /** A world ID digests the vault root's real path. */
  worldId: (next) => [randomArea(next)],
  /** A resource ID takes nothing. */
  resourceId: () => [],
  /** A runtime ID takes the owning Area and the source element ID. */
  runtimeId: (next) => [randomArea(next), randomText(next)],
  /** A region ID takes the parent and child Area paths. */
  regionId: (next) => [randomArea(next), randomArea(next)],
  /** An operation ID takes nothing. */
  operationId: () => [],
  /** A gesture ID takes nothing. */
  gestureId: () => [],
  /** A shard revision takes one shard read record. */
  shardRevision: (next) => [randomShard(next)],
};

/** Draws one shard read record in each of the four states shardRevision distinguishes. */
function randomShard(next) {
  const state = Math.floor(next() * 4);
  if (state === 0) return { hash: createHash("sha256").update(randomText(next)).digest("hex") };
  if (state === 1) return { legacy: { text: randomText(next) } };
  if (state === 2) return { ok: false, errors: [randomText(next), randomText(next)] };
  return { exists: false };
}

test("every registry entry has a generator and every generator has an entry", () => {
  assert.deepEqual(Object.keys(WIRE_VALUES).sort(), Object.keys(ARGUMENTS).sort());
  for (const [name, entry] of Object.entries(WIRE_VALUES)) {
    assert.equal(typeof entry.mint, "function", `${name} has a minter`);
    assert.equal(typeof entry.accepts, "function", `${name} has a guard`);
    assert.ok(Number.isSafeInteger(entry.maxLength) && entry.maxLength > 0, `${name} names its length cap`);
  }
});

for (const [name, entry] of Object.entries(WIRE_VALUES)) {
  test(`${name}: the guard accepts ${MINTS_PER_ENTRY} minted values`, () => {
    const next = random(SEED ^ name.length);
    for (let index = 0; index < MINTS_PER_ENTRY; index += 1) {
      const minted = entry.mint(...ARGUMENTS[name](next));
      assert.ok(entry.accepts(minted), `${name} rejected its own value ${JSON.stringify(minted)}`);
      assert.ok(minted.length <= entry.maxLength, `${name} minted ${minted.length} characters over its cap of ${entry.maxLength}`);
    }
  });

  test(`${name}: the guard rejects the empty string, a leading dash or underscore, and a value over its cap`, () => {
    assert.equal(entry.accepts(""), false, `${name} accepted the empty string`);
    assert.equal(entry.accepts("-abc"), false, `${name} accepted a leading dash`);
    assert.equal(entry.accepts("_abc"), false, `${name} accepted a leading underscore`);
    assert.equal(entry.accepts("a".repeat(entry.maxLength + 1)), false, `${name} accepted a value over its cap`);
    assert.equal(entry.accepts(null), false, `${name} accepted null`);
    assert.equal(entry.accepts(42), false, `${name} accepted a number`);
  });
}

test("digest is the server's sha256 as base64url behind a leading letter", () => {
  const expected = `r${createHash("sha256").update("hello").digest("base64url").slice(0, 16)}`;
  assert.equal(digest("hello"), expected);
  assert.equal(digest("hello"), digest("hello"), "digest is deterministic");
  assert.notEqual(digest("hello"), digest("hello "), "digest separates inputs");
});

test("the moved guards keep their old names and shapes", () => {
  assert.equal(isSafeResourceId("abc"), true);
  assert.equal(isSafeResourceId("../etc"), false);
  assert.equal(OPAQUE_ID.test("r0123456789abcdef"), true);
  assert.equal(WIRE_VALUES.shardRevision.accepts("missing"), true);
  assert.equal(WIRE_VALUES.shardRevision.accepts(`legacy:${digest("x")}`), true);
  assert.equal(WIRE_VALUES.shardRevision.accepts("legacy:../x"), false, "a shard revision digest stays opaque");
  assert.equal(WIRE_VALUES.shardRevision.accepts("private:abc"), false, "only the two minted prefixes pass");
  assert.equal(WIRE_VALUES.runtimeId.mint, runtimeId, "runtimeId is minted by the kernel");
  assert.equal(WIRE_VALUES.regionId.mint, regionId, "regionId is minted by the kernel");
});
