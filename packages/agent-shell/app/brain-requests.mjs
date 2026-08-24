import path from "node:path";
import { randomUUID } from "node:crypto";
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
    ? { ...value, area, requests: Array.isArray(value.requests) ? value.requests : [] }
    : { schema: BRAIN_REQUESTS_SCHEMA, area, requests: [] };
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
  if (!REQUEST_KINDS.has(kind)) throw new Error("kind must be plan, decision, test, or approval");
  if (!subject) throw new Error("subject is required");
  if (subject.length > 80) throw new Error("subject must be 80 characters or fewer");
  if (!question.endsWith("?")) throw new Error("question must end with ?");
  if (question.length > 160) throw new Error("question must be 160 characters or fewer");
  if (detail.length > 300) throw new Error("detail must be 300 characters or fewer; put full evidence in the plan");
  if (!proposal) throw new Error("proposal is required");
  if (proposal.length > 200) throw new Error("proposal must be 200 characters or fewer");
  const request = { id: randomUUID(), kind, subject, question, proposal, detail, options, goal, status: "open", createdAt: now, answeredAt: null, answer: null, note: null, response: null };
  record.requests.push(request);
  return request;
}

/** Validates and records Julian's answer to one open request. */
export function answerBrainRequest(record, id, answer, note = "", now = new Date().toISOString()) {
  const request = record.requests.find((item) => item.id === id);
  if (!request) throw new Error("request not found");
  if (request.status !== "open") throw new Error("request is already answered");
  const value = String(answer ?? "").trim();
  const responseNote = String(note ?? "").trim();
  const legacyChoices = !request.proposal && request.kind === "decision" ? request.options ?? [] : [];
  if (!["approve", "changes", ...legacyChoices].includes(value)) throw new Error("answer must approve, request changes, or select a listed legacy choice");
  if (value === "changes" && !responseNote) throw new Error("requested changes need text");
  request.status = "answered";
  request.answer = value;
  request.note = responseNote || null;
  request.answeredAt = now;
  request.response = { answer: value, text: responseNote || null, answeredAt: now };
  return request;
}

/** Returns the requests that still need Julian's answer. */
export function openBrainRequests(record) {
  return record.requests.filter((request) => request.status === "open");
}

/** True only when the newest plan request has an approval answer. */
export function hasApprovedPlan(record) {
  const plans = record.requests.filter((request) => request.kind === "plan");
  const latest = plans[plans.length - 1];
  return Boolean(latest && latest.status === "answered" && latest.answer === "approve");
}
