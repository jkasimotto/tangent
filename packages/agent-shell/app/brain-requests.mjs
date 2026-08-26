import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readJsonObject, writeJsonObject } from "./json-store.mjs";

export const BRAIN_REQUESTS_SCHEMA = "area-brain-requests.v1";
export const REQUEST_KINDS = new Set(["plan", "decision", "test", "approval"]);

/** Returns the durable request-record path for one Area brain. */
export function brainRequestsPath(root, area) {
  return path.join(root, area, "requests.json");
}

/** Reads one Area's requests, or returns an empty valid record. */
export async function readBrainRequests(root, area) {
  const value = await readJsonObject(brainRequestsPath(root, area));
  return value?.schema === BRAIN_REQUESTS_SCHEMA
    ? { ...value, area, requests: Array.isArray(value.requests) ? value.requests.map((request) => normalizeRequestSubject(request, area)) : [] }
    : { schema: BRAIN_REQUESTS_SCHEMA, area, requests: [] };
}

/** Adds lifecycle identity to a stored pre-lifecycle Request without changing its answer contract. */
function normalizeRequestSubject(request, area) {
  const generation = Number.isInteger(request?.brainGeneration) ? request.brainGeneration : null;
  const ownerRef = request?.ownerRef?.area ? request.ownerRef : { type: "brain", area, generation };
  if (request?.subjectRef?.type === "goal" && request.subjectRef.goal) return { ...request, ownerRef };
  if (request?.subjectRef?.type === "brain" && request.subjectRef.area) return { ...request, ownerRef };
  return {
    ...request,
    ownerRef,
    subjectRef: request?.goal
      ? { type: "goal", goal: request.goal }
      : { type: "brain", area, generation },
  };
}

/** Writes one Area's request record atomically. */
export async function writeBrainRequests(root, record) {
  return writeJsonObject(brainRequestsPath(root, record.area), record);
}

/** Validates and appends one open request. */
export function createBrainRequest(record, input, now = new Date().toISOString()) {
  const kind = String(input.kind ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const question = String(input.question ?? "").trim();
  const detail = String(input.detail ?? "").trim();
  const proposal = String(input.proposal ?? "").trim();
  const options = Array.isArray(input.options) ? input.options.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const goal = String(input.goal ?? "").trim() || null;
  const effect = input.effect && typeof input.effect === "object" ? structuredClone(input.effect) : null;
  if (!REQUEST_KINDS.has(kind)) throw new Error("kind must be plan, decision, test, or approval");
  if (!subject) throw new Error("subject is required");
  if (subject.length > 80) throw new Error("subject must be 80 characters or fewer");
  if (!question.endsWith("?")) throw new Error("question must end with ?");
  if (question.length > 160) throw new Error("question must be 160 characters or fewer");
  if (detail.length > 300) throw new Error("detail must be 300 characters or fewer; put full evidence in the plan");
  if (!proposal) throw new Error("proposal is required");
  if (proposal.length > 200) throw new Error("proposal must be 200 characters or fewer");
  const brainGeneration = Number.isInteger(input.brainGeneration) ? input.brainGeneration : null;
  const subjectRef = goal
    ? { type: "goal", goal }
    : { type: "brain", area: record.area, generation: null };
  const ownerRef = { type: "brain", area: record.area, generation: brainGeneration };
  const effectRevision = effect ? createHash("sha256").update(JSON.stringify(effect)).digest("hex") : null;
  const request = { id: randomUUID(), kind, subject, question, proposal, detail, options, goal, effect, effectRevision, brainGeneration, ownerRef: { ...ownerRef, generation: null }, subjectRef, status: "open", createdAt: now, answeredAt: null, answer: null, note: null, response: null };
  record.requests.push(request);
  return request;
}

/** Closes one open Request because its subject ended. */
function closeRequest(request, reason, actor, now) {
  request.status = "closed";
  request.closedAt = now;
  request.closedReason = reason;
  request.closedBy = actor;
  return request;
}

/** Closes every open Request linked to one Goal. */
export function closeGoalRequests(record, goal, reason = "goal-ended", now = new Date().toISOString()) {
  return record.requests
    .filter((request) => request.status === "open" && (request.subjectRef?.type === "goal" ? request.subjectRef.goal === goal : request.goal === goal))
    .map((request) => closeRequest(request, reason, "subject", now));
}

/** Closes every open Request owned by one brain generation. Legacy Requests close with that brain. */
export function closeBrainRequests(record, area, generation, reason = "brain-ended", now = new Date().toISOString()) {
  return record.requests
    .filter((request) => request.status === "open" && request.ownerRef?.area === area
      && (request.ownerRef.generation === null || request.ownerRef.generation === generation))
    .map((request) => closeRequest(request, reason, "subject", now));
}

/** Hands open brain-subject Requests from one generation to its deliberate replacement. */
export function handoverBrainRequests(record, area, fromGeneration, toGeneration) {
  const moved = record.requests.filter((request) => request.status === "open" && request.ownerRef?.area === area
    && (request.ownerRef.generation === null || request.ownerRef.generation === fromGeneration));
  // The logical Area brain owns the Request. Runtime replacement does not change its author or subject.
  for (const request of moved) request.brainGeneration = toGeneration;
  return moved;
}

/** Lets the creating brain take back an obsolete open Request. */
export function withdrawBrainRequest(record, id, note = "", now = new Date().toISOString()) {
  const request = record.requests.find((item) => item.id === id);
  if (!request) throw new Error("request not found");
  if (request.status !== "open") throw new Error("request is not open");
  closeRequest(request, "withdrawn", "brain", now);
  request.note = String(note ?? "").trim() || null;
  return request;
}

/** Records Julian's durable dismissal so the brain does not wait for an answer. */
export function dismissBrainRequest(record, id, now = new Date().toISOString()) {
  const request = record.requests.find((item) => item.id === id);
  if (!request) throw new Error("request not found");
  if (request.status !== "open") throw new Error("request is not open");
  return closeRequest(request, "dismissed", "julian", now);
}

/** Validates and records Julian's answer to one open request. */
export function answerBrainRequest(record, id, answer, note = "", now = new Date().toISOString(), effectRevision = null) {
  const request = record.requests.find((item) => item.id === id);
  if (!request) throw new Error("request not found");
  if (request.status !== "open") throw new Error("request is already answered");
  const value = String(answer ?? "").trim();
  const responseNote = String(note ?? "").trim();
  const legacyChoices = !request.proposal && request.kind === "decision" ? request.options ?? [] : [];
  if (!["approve", "changes", "reply", "authorize", ...legacyChoices].includes(value)) throw new Error("answer must reply, authorize an exact effect, approve a legacy request, or select a listed legacy choice");
  if (value === "changes" && !responseNote) throw new Error("requested changes need text");
  if (value === "reply" && !responseNote) throw new Error("a reply needs text");
  if (value === "authorize" && (!request.effectRevision || effectRevision !== request.effectRevision)) throw new Error("the Request effect revision is stale");
  request.status = "answered";
  request.answer = value;
  request.note = responseNote || null;
  request.answeredAt = now;
  request.response = { answer: value, text: responseNote || null, answeredAt: now };
  return request;
}

/**
 * Clips Julian's own words and says where the rest is. A caller that clips the
 * finished sentence instead would cut the subject off the end of it, and the
 * brain would read an answer without knowing which Request it answers.
 */
function clipAnswerText(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const tail = " … (clipped; the Request on Julian's desk holds his full answer)";
  return `${value.slice(0, Math.max(1, max - tail.length)).trimEnd()}${tail}`;
}

/**
 * Builds the complete durable answer that the work owner receives next.
 * `answerChars` clips Julian's pasted text, and only that: a generation's
 * first message repeats every answer given while the last one read, and one
 * pasted answer of 4,000 characters took a quarter of that whole message. The
 * notice path passes nothing and keeps every word.
 */
export function brainRequestAnswerNotice(request, { answerChars = 0 } = {}) {
  if (!request?.response) throw new Error("request has no response");
  const changes = answerChars ? clipAnswerText(request.response.text, answerChars) : request.response.text;
  const answer = request.response.answer === "reply"
    ? `replied: ${changes}`
    : request.response.answer === "authorize"
      ? `authorized exact effect revision ${request.effectRevision}`
      : request.response.answer === "approve"
    ? "approved"
    : request.response.answer === "changes"
      ? `wants these changes: ${changes}`
      : `selected "${request.response.answer}"`;
  return `Julian ${answer} for "${request.subject}".`;
}

/** Returns the requests that still need Julian's answer. */
export function openBrainRequests(record) {
  return record.requests.filter((request) => request.status === "open");
}

/** True only when the named Request has its own approval answer. */
export function requestIsApproved(record, id) {
  const request = record.requests.find((item) => item.id === id);
  return Boolean(request && request.status === "answered" && request.answer === "approve");
}
