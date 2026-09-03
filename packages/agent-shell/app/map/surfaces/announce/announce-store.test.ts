import { strict as assert } from "node:assert";
import { test } from "node:test";
import { milliseconds } from "../../units/units.ts";
import { EMPTY_ANNOUNCE_STATE, announceReducer, latestAnnouncement, latestNotice, longestRemaining } from "./announce-store.ts";
import type { AnnounceState } from "./announce-store.ts";

const TTL = milliseconds(4000);

/** Announces one message with the test TTL. */
function say(state: AnnounceState, text: string, visible = true): AnnounceState {
  return announceReducer(state, { kind: "announce", text, visible, ttl: TTL });
}

test("announce appends with increasing ids and keeps the visible flag", () => {
  const state = say(say(EMPTY_ANNOUNCE_STATE, "Map saved."), "Saving map…", false);
  assert.equal(state.announcements.length, 2);
  assert.deepEqual(state.announcements.map((entry) => entry.id), [0, 1]);
  assert.equal(state.announcements[0]?.visible, true);
  assert.equal(state.announcements[1]?.visible, false);
  assert.equal(state.announcements[1]?.remaining, TTL);
});

test("an empty text is not announced", () => {
  assert.equal(say(EMPTY_ANNOUNCE_STATE, ""), EMPTY_ANNOUNCE_STATE);
});

test("the live region speaks the newest announcement and the toast shows the newest visible one", () => {
  const state = say(say(EMPTY_ANNOUNCE_STATE, "Map saved."), "3 matches, Otto in view", false);
  assert.equal(latestAnnouncement(state)?.text, "3 matches, Otto in view");
  assert.equal(latestNotice(state)?.text, "Map saved.");
  assert.equal(latestAnnouncement(EMPTY_ANNOUNCE_STATE), null);
  assert.equal(latestNotice(EMPTY_ANNOUNCE_STATE), null);
});

test("expire drops only what has run out and leaves the rest with less time", () => {
  let state = say(EMPTY_ANNOUNCE_STATE, "first");
  state = announceReducer(state, { kind: "expire", elapsed: milliseconds(1000) });
  state = say(state, "second");
  state = announceReducer(state, { kind: "expire", elapsed: milliseconds(3000) });
  assert.deepEqual(state.announcements.map((entry) => entry.text), ["second"]);
  assert.equal(state.announcements[0]?.remaining, milliseconds(1000));
});

test("expire with no elapsed time or an empty store returns the same state", () => {
  const state = say(EMPTY_ANNOUNCE_STATE, "first");
  assert.equal(announceReducer(state, { kind: "expire", elapsed: milliseconds(0) }), state);
  assert.equal(announceReducer(EMPTY_ANNOUNCE_STATE, { kind: "expire", elapsed: milliseconds(10) }), EMPTY_ANNOUNCE_STATE);
});

test("clear empties the store but keeps handing out fresh ids", () => {
  const cleared = announceReducer(say(EMPTY_ANNOUNCE_STATE, "first"), { kind: "clear" });
  assert.equal(cleared.announcements.length, 0);
  assert.equal(say(cleared, "second").announcements[0]?.id, 1);
  assert.equal(announceReducer(EMPTY_ANNOUNCE_STATE, { kind: "clear" }), EMPTY_ANNOUNCE_STATE);
});

test("longestRemaining is the time until the store is empty", () => {
  assert.equal(longestRemaining(EMPTY_ANNOUNCE_STATE), 0);
  let state = say(EMPTY_ANNOUNCE_STATE, "first");
  state = announceReducer(state, { kind: "expire", elapsed: milliseconds(1500) });
  state = say(state, "second");
  assert.equal(longestRemaining(state), TTL);
});
