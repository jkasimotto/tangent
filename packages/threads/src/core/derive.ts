import { daysSince, isoDate, formatMinutes } from "./time.js";
import type { DerivedThread, ParsedThread, SessionState } from "./types.js";

const blockedIdleThresholdMs = 5 * 60 * 1000;

export type ThreadDerivationInput = {
  thread: ParsedThread;
  /** Resolved session telemetry for a registered thread, if any. Undefined for human-owned threads or threads with no matching session yet. */
  sessionState?: SessionState;
  /** Newest dated-note date (YYYY-MM-DD) captured in the thread's node, for check-in cadence; falls back to the thread's `opened` date when no note exists yet. */
  latestNoteDateInNode?: string;
  /** Additional deadline dates pulled from owned overview "## On me" items, merged with the thread's own body-prose deadline. */
  extraDeadlines?: string[];
  /** True when the thread's wake condition was deterministically evaluated as met this sweep. */
  wakeMet?: boolean;
  /** Registered branch has already merged into its base. Suppresses stale timers and asks for closure. */
  landed?: boolean;
  /** Stage-for-validation evidence recorded by `threads validate`. */
  validationReady?: boolean;
};

/**
 * Deterministically derives every thread's state from parsed vault facts and already-resolved
 * session telemetry. This is the one place state is decided: no model call is involved here, and no
 * caller may override a result. A model may later describe a derived state in prose (haiku
 * why-lines), but it never decides one (see WhyLineRunner).
 *
 * Precedence, most urgent first, documented here because a thread can in principle satisfy more than
 * one condition at once: done (terminal) > blocked-on-you (an interactive question is waiting right
 * now) > needs-you (a wake condition just fired, or a deadline or check-in timer just fired) >
 * ready-for-you (an async deliverable is waiting) > parked (an explicit wake condition not yet met) >
 * working (the default).
 */
export function deriveThreadStates(inputs: ThreadDerivationInput[], now: Date): DerivedThread[] {
  return inputs.map((input) => deriveOne(input, now));
}

/** Applies the state-precedence chain documented on deriveThreadStates to a single thread's facts. */
function deriveOne(input: ThreadDerivationInput, now: Date): DerivedThread {
  const { thread, sessionState, latestNoteDateInNode, extraDeadlines } = input;
  const base = {
    slug: thread.slug,
    node: thread.node,
    owner: thread.owner || "you",
    outcome: thread.outcome,
    openedAt: thread.opened,
    batch: thread.batch
  };

  if (thread.status === "done" || thread.status === "dropped") {
    return { ...base, state: "done", templateWhy: "closed." };
  }

  if (sessionState) {
    const waitingSignal = sessionState.lastStepKind === "permission" || sessionState.lastStepKind === "assistant_response";
    if (sessionState.status === "active" && waitingSignal && sessionState.idleMs > blockedIdleThresholdMs) {
      return { ...base, state: "blocked-on-you", templateWhy: `idle ${formatMinutes(sessionState.idleMs)}, waiting on you at a ${sessionState.lastStepKind === "permission" ? "permission prompt" : "question"}.` };
    }
  }

  if (input.landed) {
    return { ...base, state: "needs-you", templateWhy: "branch looks landed; close this thread?" };
  }

  if (thread.wakeCondition && input.wakeMet) {
    return { ...base, state: "needs-you", templateWhy: `wake condition met: ${thread.wakeCondition}.` };
  }

  const deadline = earliestOf([thread.deadline, ...(extraDeadlines || [])]);
  if (deadline && deadline <= isoDate(now)) {
    return { ...base, state: "needs-you", templateWhy: `deadline ${deadline} is today or past.` };
  }

  const referenceDate = latestNoteDateInNode || thread.opened;
  const elapsedDays = daysSince(referenceDate, now);
  if (thread.cadenceDays && elapsedDays !== undefined && elapsedDays >= thread.cadenceDays) {
    return { ...base, state: "needs-you", templateWhy: `check-in overdue; nothing captured since ${referenceDate}.` };
  }

  if (input.validationReady) {
    return { ...base, state: "ready-for-you", templateWhy: "reviewed deliverable staged; verdict needed." };
  }

  if (sessionState?.status === "ended") {
    return { ...base, state: "finishing", templateWhy: "worker ended; validation staging in progress." };
  }

  if (thread.wakeCondition) {
    return { ...base, state: "parked", templateWhy: `parked: ${thread.wakeCondition}` };
  }

  if (sessionState?.status === "active") {
    return { ...base, state: "working", templateWhy: "session active." };
  }

  if (thread.cadenceDays) {
    const remaining = elapsedDays === undefined ? thread.cadenceDays : Math.max(0, thread.cadenceDays - elapsedDays);
    return { ...base, state: "working", templateWhy: `check-in due in ${remaining}d.` };
  }

  return { ...base, state: "working", templateWhy: "in progress." };
}

/** Returns the earliest (lexically smallest) YYYY-MM-DD date among the given values, ignoring undefined entries. */
function earliestOf(dates: Array<string | undefined>): string | undefined {
  const present = dates.filter((date): date is string => Boolean(date));
  return present.length ? present.sort()[0] : undefined;
}
