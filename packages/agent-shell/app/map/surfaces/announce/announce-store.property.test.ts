import { strict as assert } from "node:assert";
import { test } from "node:test";
import { milliseconds } from "../../units/units.ts";
import { EMPTY_ANNOUNCE_STATE, announceReducer, longestRemaining } from "./announce-store.ts";
import type { AnnounceAction, AnnounceState } from "./announce-store.ts";

const RUNS = 500;
const STEPS = 40;
const MAX_TTL = 60_000;

/** A small seeded generator so a failing run can be replayed by seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  /** Returns the next number in [0, 1) (mulberry32). */
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws one random action: mostly announces, some expires, the odd clear. */
function randomAction(next: () => number): AnnounceAction {
  const roll = next();
  if (roll < 0.6) return { kind: "announce", text: `notice ${Math.floor(next() * 1000)}`, visible: next() < 0.5, ttl: milliseconds(1 + Math.floor(next() * MAX_TTL)) };
  if (roll < 0.95) return { kind: "expire", elapsed: milliseconds(Math.floor(next() * MAX_TTL)) };
  return { kind: "clear" };
}

/** Builds one random store by replaying random actions from a seed. */
function randomState(seed: number): AnnounceState {
  const next = random(seed);
  let state = EMPTY_ANNOUNCE_STATE;
  for (let step = 0; step < STEPS; step += 1) state = announceReducer(state, randomAction(next));
  return state;
}

test("after advancing time by the longest remaining ttl the store is empty", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const state = randomState(seed);
    const drained = announceReducer(state, { kind: "expire", elapsed: longestRemaining(state) });
    assert.equal(drained.announcements.length, 0, `seed ${seed} left ${drained.announcements.length} announcements`);
  }
});

test("advancing by less than the shortest remaining ttl drops nothing", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const state = randomState(seed);
    if (!state.announcements.length) continue;
    const shortest = Math.min(...state.announcements.map((entry) => entry.remaining));
    const kept = announceReducer(state, { kind: "expire", elapsed: milliseconds(shortest - 1) });
    assert.equal(kept.announcements.length, state.announcements.length, `seed ${seed} dropped an announcement early`);
  }
});

test("every live announcement has time left, a unique id, and its own ttl as the ceiling", () => {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const state = randomState(seed);
    const ids = new Set(state.announcements.map((entry) => entry.id));
    assert.equal(ids.size, state.announcements.length, `seed ${seed} repeated an id`);
    for (const entry of state.announcements) {
      assert.ok(entry.remaining > 0, `seed ${seed} kept an expired announcement`);
      assert.ok(entry.remaining <= entry.ttl, `seed ${seed} let remaining exceed ttl`);
    }
  }
});
