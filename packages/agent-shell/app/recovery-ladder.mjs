import { createHash } from "node:crypto";

export const RECOVERY_LEASE_MS = 120_000;

/** Returns one stable operation ID for one bounded attempt-recovery step. */
export function recoveryOperationId({ goal, assignment, attempt, kind, ordinal = 1 }) {
  return createHash("sha256").update([goal, assignment, attempt, kind, ordinal].map(String).join("\0")).digest("hex");
}

/** Starts one durable step before its external effect. */
export function beginRecoveryStep({ record, goal, assignment, attempt, kind, ordinal = 1, instanceId, target, now = Date.now(), leaseMs = RECOVERY_LEASE_MS }) {
  const operationId = recoveryOperationId({ goal, assignment, attempt, kind, ordinal });
  const existing = (record.recovery ?? []).find((step) => step.operationId === operationId);
  if (existing) return { step: existing, repeated: true };
  const step = {
    kind,
    ordinal,
    operationId,
    instanceId,
    target,
    leaseUntil: new Date(now + leaseMs).toISOString(),
    startedAt: new Date(now).toISOString(),
    result: null,
  };
  record.recovery = [...(record.recovery ?? []), step];
  return { step, repeated: false };
}

/** Finishes one exact durable recovery step. */
export function finishRecoveryStep(record, operationId, result, { terminal = false } = {}) {
  const step = (record.recovery ?? []).find((item) => item.operationId === operationId);
  if (!step || step.result) return false;
  step.result = result;
  if (terminal) step.terminal = true;
  return true;
}

/** Expires unfinished leases after a controller restart. */
export function expireRecoverySteps(record, now = Date.now()) {
  let changed = false;
  for (const step of record.recovery ?? []) {
    if (!step.result && Date.parse(step.leaseUntil) <= now) {
      step.result = "expired";
      changed = true;
    }
  }
  return changed;
}

/** Selects the next bounded recovery action from durable facts. */
export function nextRecoveryAction({ record, assignment, observation, promptArrived = true, now = Date.now(), idleNudgeMs = 180_000, promptRetryMs = 180_000 } = {}) {
  const attempt = assignment?.attempts?.at?.(-1);
  if (!assignment || !attempt || !["running", "waiting"].includes(assignment.status)) return null;
  const steps = attempt.recovery ?? record?.recovery ?? [];
  /** Returns whether this exact attempt already consumed one ladder step. */
  const used = (kind) => steps.some((step) => step.kind === kind);
  if (observation?.process === "shell" && !used("resume-in-place")) return { kind: "resume-in-place", ordinal: 1 };
  if (!promptArrived && now - Date.parse(attempt.startedAt ?? assignment.startedAt) >= promptRetryMs && !used("re-arm")) return { kind: "re-arm", ordinal: 1 };
  const lastOutputAt = Number(observation?.activity?.lastOutputAt) || Number(observation?.transcript?.lastEventAt) || Date.parse(assignment.startedAt ?? attempt.startedAt);
  if (observation?.composer === "idle" && now - lastOutputAt >= idleNudgeMs && !used("nudge")) return { kind: "nudge", ordinal: 1 };
  return null;
}
