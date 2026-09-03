// The announcement store: every notice the Map speaks or shows, each with a
// time to live. The old component kept one visible toast that never cleared
// (audit defect 8) and one live-region node that was replaced on the next
// message. Here both come from one list. An announcement enters with a TTL
// from the caller (the layout tokens own the number), `expire` advances the
// clock by an elapsed duration and drops what has run out, and `clear` empties
// the list. The reducer is pure: the effect that owns the timer dispatches
// `expire` with how much time passed, so the store never reads a clock.

import type { Count, Index, Milliseconds } from "../../units/units.ts";
import { count, index, milliseconds } from "../../units/units.ts";
import { subtract } from "../../units/scalar-math.ts";

/** One message the Map said. `visible` means it is also shown as the toast, not only spoken. */
export type Announcement = {
  readonly id: Index;
  readonly text: string;
  readonly visible: boolean;
  readonly ttl: Milliseconds;
  readonly remaining: Milliseconds;
};

/** The store: how many announcements were ever issued (the next id) and the ones still alive. */
export type AnnounceState = {
  readonly issued: Count;
  readonly announcements: readonly Announcement[];
};

/** The closed set of things that can happen to the store. */
export type AnnounceAction =
  | { readonly kind: "announce"; readonly text: string; readonly visible: boolean; readonly ttl: Milliseconds }
  | { readonly kind: "expire"; readonly elapsed: Milliseconds }
  | { readonly kind: "clear" };

/** The store before anything was announced. */
export const EMPTY_ANNOUNCE_STATE: AnnounceState = Object.freeze({ issued: count(0), announcements: Object.freeze([]) });

/** Appends one announcement with the id the store hands out next. An empty text is not an announcement. */
function announce(state: AnnounceState, text: string, visible: boolean, ttl: Milliseconds): AnnounceState {
  if (!text) return state;
  const entry: Announcement = { id: index(state.issued), text, visible, ttl, remaining: ttl };
  return { issued: count(state.issued + 1), announcements: [...state.announcements, entry] };
}

/** Moves the clock forward by `elapsed` and drops every announcement whose time has run out. */
function expire(state: AnnounceState, elapsed: Milliseconds): AnnounceState {
  if (elapsed <= 0 || !state.announcements.length) return state;
  const announcements = state.announcements
    .map((entry) => ({ ...entry, remaining: subtract(entry.remaining, elapsed) }))
    .filter((entry) => entry.remaining > 0);
  return { issued: state.issued, announcements };
}

/** The pure reducer: (state, action) -> state. */
export function announceReducer(state: AnnounceState, action: AnnounceAction): AnnounceState {
  switch (action.kind) {
    case "announce": return announce(state, action.text, action.visible, action.ttl);
    case "expire": return expire(state, action.elapsed);
    case "clear": return state.announcements.length ? { issued: state.issued, announcements: [] } : state;
  }
}

/** The newest live announcement, the one the live region speaks, or null when the store is empty. */
export function latestAnnouncement(state: AnnounceState): Announcement | null {
  return state.announcements.at(-1) ?? null;
}

/** The newest live announcement that is also shown as the toast, or null when none is visible. */
export function latestNotice(state: AnnounceState): Announcement | null {
  for (let position = state.announcements.length - 1; position >= 0; position -= 1) {
    const entry = state.announcements[position];
    if (entry?.visible) return entry;
  }
  return null;
}

/** The longest remaining time in the store: advancing the clock by this much empties it. Zero when empty. */
export function longestRemaining(state: AnnounceState): Milliseconds {
  return milliseconds(Math.max(0, ...state.announcements.map((entry) => entry.remaining)));
}
