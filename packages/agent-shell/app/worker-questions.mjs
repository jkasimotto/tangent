import { createHash } from "node:crypto";

/** Stable identity for one question report, including reports written before question state existed. */
export function workerQuestionId(report) {
  const source = String(report?.idempotencyKey ?? report?.question ?? report?.summary ?? "").trim();
  if (!source || report?.type !== "question-needed") return null;
  return `worker-question:${createHash("sha256").update(source).digest("hex")}`;
}

/** Adds the initial durable state to a new question report. */
export function openWorkerQuestion(report, { attempt = null, session = "", now = new Date().toISOString() } = {}) {
  if (report?.type !== "question-needed") return report;
  const id = workerQuestionId(report);
  report.questionState = normalizeQuestionState(report, attempt, {
    id,
    status: "open",
    askedAttemptId: attempt?.id ?? null,
    askedSession: String(session || attempt?.session || "") || null,
    askedAt: report.reportedAt ?? now,
    answer: null,
    recipient: attempt ? { attemptId: attempt.id, session: attempt.session ?? session ?? null, transferredAt: null } : null,
    acknowledgedAt: null,
  });
  return report;
}

/** Returns the latest question on one assignment with normalized compatibility state. */
export function latestWorkerQuestion(assignment) {
  const report = [...(assignment?.reports ?? [])].reverse().find((item) => item?.type === "question-needed") ?? null;
  if (!report) return null;
  const askedAttempt = attemptForQuestion(assignment, report);
  return { report, state: normalizeQuestionState(report, askedAttempt), askedAttempt };
}

/** Finds the assignment whose current or historical attempt has the target session. */
export function workerQuestionTarget(queue, targetSession) {
  const target = String(targetSession ?? "").trim();
  if (!target) return null;
  for (const assignment of queue?.steps ?? queue?.assignments ?? []) {
    const targetedAttempt = [...(assignment.attempts ?? [])].reverse().find((attempt) => attempt?.session === target) ?? null;
    if (assignment.session !== target && !targetedAttempt) continue;
    const question = latestWorkerQuestion(assignment);
    if (question) return { assignment, targetedAttempt, ...question };
  }
  return null;
}

/**
 * Commits one brain answer to the exact question addressed through a worker
 * session. The caller owns brain authority and per-Goal serialization.
 */
export function answerWorkerQuestion(queue, {
  targetSession,
  text,
  brainSession,
  operationId,
  now = new Date().toISOString(),
} = {}) {
  const found = workerQuestionTarget(queue, targetSession);
  if (!found) return { state: "not-question" };
  const answerText = oneLine(text, 4000);
  const operation = key(operationId);
  if (!answerText || !operation || !key(brainSession)) throw questionError("answer-invalid", "a worker answer needs text, a brain session, and an operation ID");
  const existing = found.state.answer;
  if (existing) {
    if (existing.operationId === operation || (existing.text === answerText && existing.brainSession === brainSession)) {
      return { state: "repeated", repeated: true, pipeline: queue, assignment: found.assignment, question: found.state };
    }
    if (found.state.status !== "acknowledged") {
      throw questionError("question-already-answered", `question ${found.state.id} already has a different unacknowledged answer`);
    }
    return { state: "not-question" };
  }

  const draft = structuredClone(queue);
  const target = workerQuestionTarget(draft, targetSession);
  if (!target || target.state.answer) throw questionError("question-stale", "the worker question changed before the answer committed");
  const recipientAttempt = currentAttempt(draft, target.assignment);
  const question = {
    ...target.state,
    status: "answered",
    answer: { text: answerText, operationId: operation, brainSession: key(brainSession), answeredAt: now },
    recipient: recipientAttempt ? {
      attemptId: recipientAttempt.id,
      session: recipientAttempt.session ?? target.assignment.session ?? null,
      transferredAt: recipientAttempt.id === target.state.askedAttemptId ? null : now,
    } : null,
    acknowledgedAt: null,
  };
  applyQuestionState(target.assignment, target.report, question);
  if (recipientAttempt && draft.status === "open") {
    target.assignment.status = "running";
    target.assignment.endedAt = null;
    draft.currentAssignmentId = target.assignment.id;
    // A question report ended the source attempt as a reporting artifact.
    // The same live attempt resumes when it is still the current recipient.
    if (recipientAttempt.id === question.askedAttemptId && recipientAttempt.result?.type === "question-needed") {
      recipientAttempt.endedAt = null;
      recipientAttempt.result = { ...recipientAttempt.result, questionState: structuredClone(question) };
      recipientAttempt.report = recipientAttempt.report ? { ...recipientAttempt.report, questionState: structuredClone(question) } : recipientAttempt.report;
    }
  }
  commitQueueMutation(draft, operation, now);
  replaceQueue(queue, draft);
  const committed = workerQuestionTarget(queue, targetSession);
  return { state: "answered", repeated: false, pipeline: queue, assignment: committed.assignment, question: committed.state };
}

/** Records that the exact current recipient read one answer. */
export function acknowledgeWorkerQuestion(queue, {
  questionId,
  attemptId,
  session,
  operationId,
  now = new Date().toISOString(),
} = {}) {
  const found = findQuestion(queue, questionId);
  if (!found) throw questionError("question-not-found", `no worker question ${questionId}`);
  if (!found.state.answer) throw questionError("question-open", `worker question ${questionId} is not answered`);
  const recipient = found.state.recipient;
  if (!recipient || recipient.attemptId !== key(attemptId) || recipient.session !== key(session)) {
    throw questionError("question-transferred", `worker question ${questionId} belongs to ${recipient?.session ?? "a future attempt"}`, { recipient });
  }
  if (found.state.status === "acknowledged") return { state: "repeated", repeated: true, pipeline: queue, question: found.state };
  const draft = structuredClone(queue);
  const target = findQuestion(draft, questionId);
  const question = { ...target.state, status: "acknowledged", acknowledgedAt: now };
  applyQuestionState(target.assignment, target.report, question);
  commitQueueMutation(draft, key(operationId) || `question-ack:${questionId}:${attemptId}`, now);
  replaceQueue(queue, draft);
  return { state: "acknowledged", repeated: false, pipeline: queue, question: findQuestion(queue, questionId).state };
}

/** Gives every open or unacknowledged question to a newly current attempt. */
export function transferWorkerQuestions(assignment, attempt, now = new Date().toISOString()) {
  if (!assignment || !attempt?.id) return [];
  const transferred = [];
  for (const report of assignment.reports ?? []) {
    if (report?.type !== "question-needed") continue;
    const state = normalizeQuestionState(report, attemptForQuestion(assignment, report));
    if (state.status === "acknowledged") continue;
    const next = {
      ...state,
      recipient: { attemptId: attempt.id, session: attempt.session ?? assignment.session ?? null, transferredAt: now },
    };
    applyQuestionState(assignment, report, next);
    transferred.push(next);
  }
  return transferred;
}

/** Read result for the worker wait channel. */
export function workerQuestionDelivery(queue, { questionId, attemptId, session } = {}) {
  const found = findQuestion(queue, questionId);
  if (!found) return null;
  const recipient = found.state.recipient;
  if (!recipient || recipient.attemptId !== key(attemptId) || recipient.session !== key(session)) {
    return { status: "transferred", question: found.state, recipient };
  }
  if (!found.state.answer) return { status: "open", question: found.state };
  return { status: found.state.status, question: found.state, answer: found.state.answer };
}

/** Markdown that makes durable question history part of every rebuilt or replacement prompt. */
export function workerQuestionPrompt(assignment) {
  const questions = (assignment?.reports ?? []).filter((report) => report?.type === "question-needed").map((report) => ({ report, state: normalizeQuestionState(report, attemptForQuestion(assignment, report)) }));
  if (!questions.length) return "";
  const rows = questions.map(({ report, state }, index) => {
    const question = String(report.question ?? report.summary ?? "").trim();
    if (!state.answer) {
      return `### Open question ${index + 1} (${state.id})\n\n${question}\n\nThis question still waits for the brain. Run \`tangent send brain --question ${JSON.stringify(question)}\` to attach this attempt and wait.`;
    }
    return `### Answered question ${index + 1} (${state.id})\n\nQuestion: ${question}\n\nAnswer from ${state.answer.brainSession}: ${state.answer.text}`;
  });
  return `## Worker questions\n\n${rows.join("\n\n")}`;
}

/** Finds one question by stable identity. */
function findQuestion(queue, questionId) {
  const id = key(questionId);
  for (const assignment of queue?.steps ?? queue?.assignments ?? []) {
    for (const report of assignment.reports ?? []) {
      if (report?.type !== "question-needed" || workerQuestionId(report) !== id) continue;
      return { assignment, report, state: normalizeQuestionState(report, attemptForQuestion(assignment, report)) };
    }
  }
  return null;
}

/** Returns the attempt currently responsible for one assignment. */
function currentAttempt(queue, assignment) {
  if (queue.currentAssignmentId !== assignment.id || !["running", "waiting"].includes(assignment.status)) return null;
  return assignment.attempts?.at(-1) ?? null;
}

/** Finds the attempt that first submitted a report. */
function attemptForQuestion(assignment, report) {
  return (assignment?.attempts ?? []).find((attempt) => attempt?.result?.idempotencyKey === report?.idempotencyKey || attempt?.report?.idempotencyKey === report?.idempotencyKey)
    ?? (assignment?.attempts ?? []).find((attempt) => attempt?.session === report?.questionState?.askedSession)
    ?? assignment?.attempts?.[0]
    ?? null;
}

/** Normalizes an explicit or legacy question state without changing the source. */
function normalizeQuestionState(report, askedAttempt, override = null) {
  const source = override ?? report?.questionState ?? {};
  const id = workerQuestionId(report);
  const answer = source.answer && typeof source.answer === "object" ? {
    text: oneLine(source.answer.text, 4000),
    operationId: key(source.answer.operationId),
    brainSession: key(source.answer.brainSession),
    answeredAt: String(source.answer.answeredAt ?? "") || null,
  } : null;
  const recipient = source.recipient && typeof source.recipient === "object" ? {
    attemptId: key(source.recipient.attemptId) || null,
    session: key(source.recipient.session) || null,
    transferredAt: String(source.recipient.transferredAt ?? "") || null,
  } : Object.hasOwn(source, "recipient") ? null : askedAttempt ? { attemptId: askedAttempt.id ?? null, session: askedAttempt.session ?? null, transferredAt: null } : null;
  return {
    id,
    status: source.status === "acknowledged" ? "acknowledged" : answer ? "answered" : "open",
    askedAttemptId: key(source.askedAttemptId) || askedAttempt?.id || null,
    askedSession: key(source.askedSession) || askedAttempt?.session || null,
    askedAt: String(source.askedAt ?? report?.reportedAt ?? "") || null,
    answer,
    recipient,
    acknowledgedAt: String(source.acknowledgedAt ?? "") || null,
  };
}

/** Updates the assignment report and its historical attempt copy together. */
function applyQuestionState(assignment, report, state) {
  report.questionState = structuredClone(state);
  for (const attempt of assignment.attempts ?? []) {
    if (attempt?.result?.idempotencyKey === report.idempotencyKey) attempt.result = { ...attempt.result, questionState: structuredClone(state) };
    if (attempt?.report?.idempotencyKey === report.idempotencyKey) attempt.report = { ...attempt.report, questionState: structuredClone(state) };
  }
}

/** Applies the standard queue revision and operation identity. */
function commitQueueMutation(queue, operationId, now) {
  queue.revision = Math.max(1, Number(queue.revision) || 1) + 1;
  queue.idempotencyKeys = [...new Set([...(queue.idempotencyKeys ?? []), operationId])];
  queue.updatedAt = now;
  queue.assignments = queue.steps ?? queue.assignments;
}

/** Replaces a queue only after a cloned transition succeeds. */
function replaceQueue(target, source) {
  for (const property of Object.keys(target)) delete target[property];
  Object.assign(target, source);
  target.assignments = target.steps ?? target.assignments;
}

/** One bounded identifier. */
function key(value) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

/** One normalized bounded line. */
function oneLine(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/** Structured transition error. */
function questionError(code, message, fields = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, fields);
  return error;
}
