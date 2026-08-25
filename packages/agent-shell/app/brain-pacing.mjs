// Pacing for a brain that has nothing to do. On 2026-08-25 the otto/tangent
// brain replaced itself about every 50 seconds while it waited: 170
// generations between 14:07 and 17:59, each reporting the same unchanged
// state and doing nothing, 3.9 hours of tokens for no work. A waiting
// handover now has to wait, on a ladder that grows with the streak, the way
// ScheduleWakeup paces an idle dynamic loop.
//
// The per-session state here is deliberately in memory, not on the brain
// record. It is advisory: losing it at a restart costs at most one extra
// generation, while a second writer of `brain.json` could undo a status the
// reconcile sweep just wrote. Only `waitingStreak` is durable, and only
// handoverBrain writes it, on the record write it already made.

/**
 * How long a generation that has done nothing must live before it may hand
 * over, by the count of waiting handovers already made in a row. Any real
 * action resets a lineage to the first rung.
 */
export const WAITING_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000];

/** The minimum life of a waiting generation after `streak` waiting handovers. */
export function waitingBackoffMs(streak, ladder = WAITING_BACKOFF_MS) {
  const rungs = ladder?.length ? ladder : WAITING_BACKOFF_MS;
  const at = Math.min(Math.max(Number(streak) || 0, 0), rungs.length - 1);
  return rungs[at];
}

/**
 * Keeps what each live brain session did and how long it must sleep. One
 * instance per server process; the server owns it.
 */
export function createBrainPacing({ ladder = WAITING_BACKOFF_MS } = {}) {
  const acted = new Set();
  const held = new Map();

  /** Records that this session made one mutation, so it is not merely waiting. */
  function noteAction(session) {
    if (!session) return;
    acted.add(session);
    held.delete(session);
  }

  /**
   * Judges one handover attempt for a brain record. A generation that acted
   * hands over at once. A generation that only waited must first live out the
   * rung its lineage has reached; `waitMs` is what is left of it.
   */
  function judge(record, generation, now = Date.now()) {
    const streak = Math.max(Number(record?.waitingStreak) || 0, 0);
    if (!generation) return { acted: true, waitMs: 0, until: null, streak };
    if (acted.has(record.session)) return { acted: true, waitMs: 0, until: null, streak };
    const required = waitingBackoffMs(streak, ladder);
    const age = now - Date.parse(generation.startedAt);
    const waitMs = Math.max(0, required - (Number.isFinite(age) ? age : required));
    return { acted: false, waitMs, until: waitMs > 0 ? new Date(now + waitMs).toISOString() : null, streak, required };
  }

  /** Holds one refused session asleep until its deadline. */
  function hold(session, until) {
    held.set(session, Date.parse(until));
  }

  /** True once a held session's pause has ended; the hold is then released. */
  function due(session, now = Date.now()) {
    const deadline = held.get(session);
    if (deadline === undefined || deadline > now) return false;
    held.delete(session);
    return true;
  }

  /** Drops every trace of a session that is gone. */
  function forget(session) {
    acted.delete(session);
    held.delete(session);
  }

  return { noteAction, judge, hold, due, forget };
}
