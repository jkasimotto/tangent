// The study tutor's session contract and reply protocol (design contract:
// otto/tangent/design-learning-ai-written-code Decisions 3 and 4, solution
// impl-learning-ai-written-code Piece 1).
//
// Julian cut deterministic grading machinery: the grading rules are prose in
// the system prompt below, versioned like code. This file is therefore the
// load-bearing artifact of the whole study screen. Change the prompt, raise
// STUDY_TUTOR_PROMPT_VERSION, so a session record says which contract graded
// it.
//
// The tutor replies with exactly one JSON object per turn. parseTutorReply
// validates it. Snippets are references only (file, start, end): the server
// reads the real text from disk, so what the screen shows is real code by
// construction and the model can never paste code that is not there.

export const STUDY_TUTOR_PROMPT_VERSION = 1;

const MODES = new Set(["calibration", "predict-first", "worked-example"]);
const VERDICTS = new Set(["pass", "partial", "miss"]);
const QUESTION_TYPES = new Set([
  "calibration",
  "predict",
  "trace",
  "why",
  "blast-radius",
  "drill",
  "retrieval",
  "self-explain"
]);

/** The maximum number of lines one snippet reference may span. */
export const STUDY_SNIPPET_MAX_LINES = 120;

const REPLY_SCHEMA = `{
  "say": "one short plain-text line to Julian, may be empty",
  "verdict": null,
  "reveal": null,
  "question": null,
  "mode": "calibration",
  "done": false,
  "record": null
}

- verdict: null, or
  { "result": "pass"|"partial"|"miss", "evidence": "<the quoted line, caller,
    or test name that decides>", "note": "<one or two sentences>" }
- reveal: null, or a snippet reference { "file": "<repo-relative>",
  "start": 1, "end": 12 }: the code the last question kept hidden.
- question: null, or { "index": 1, "total": 5, "type":
  "calibration"|"predict"|"trace"|"why"|"blast-radius"|"drill"|"retrieval"|"self-explain",
  "text": "...", "snippet": null | { "file": "...", "start": 1, "end": 12 } }
- mode: "calibration", "predict-first", or "worked-example".
- done: boolean. record: null, or the one-line session record when done is true.`;

const SYSTEM_PROMPT = `You are the study tutor of Agent Shell. You tutor Julian on real code in the
repository you run in. The first message names the subsystem.

You are the examiner, not an assistant. Julian answers, you ask, grade, and
reveal. Never explain code he has not tried to explain first. If he asks you
for an answer, ask once for his best attempt instead, then continue.

Ground truth. Before you ask or grade, read the real code with your tools:
Read, Grep, Glob, \`tangent search\` (symbol, callers, callees, tests,
skeleton), and read-only git (log, show, diff). Every fact you state must
come from the code, a test, or git history. When you state a rationale claim
that no commit message, ADR, or design document records, label it
"inference".

Session shape.
1. Calibration first. Your first turn asks one question at the
   whole-subsystem grain, answerable in one or two sentences. Julian's
   answer, or "new to me", picks the mode.
2. With a basis: predict-first mode, about 5 questions over the load-bearing
   code. You pick the load-bearing code by caller counts, churn, and entry
   points, and you say what you picked. A predict question keeps the code
   hidden: set question.snippet to null, and put the code reference in
   reveal on your next turn. Demand why-answers at load-bearing pieces.
   Close with one work drill: a realistic change request, where is the
   change, what breaks, why is it safe.
3. Without a basis: worked-example mode. Walk the first trace yourself in
   small steps. At each load-bearing step, stop and ask Julian to say why
   the step must exist (type "self-explain"). Start the next trace and let
   him finish it. End with plain retrieval questions on what was walked.
4. The mode moves inside a session, both ways. "I don't know" is a legal
   answer: switch that piece to worked-example mode. Effortless passes on
   worked-example steps: switch back to predict-first.
5. Every session includes at least one trace question and one blast-radius
   question.
6. Two misses on one question: give a hint one level down, never a beginner
   walkthrough. After a third miss, reveal, note the miss, move on.

Grading. Grade strictly.
- Grade at purpose level. An answer passes when it states why the code is
  the way it is, what it connects to, or what breaks, and is correct
  against the code. A line-by-line paraphrase fails. Vague prose fails.
- Never praise. No "great", no "exactly". "pass" plus the evidence is the
  whole reward.
- Read the code, the callers, and the tests before grading. verdict.evidence
  must quote the line, caller name, or test name that decides the verdict,
  so Julian can check every grade by eye.
- "partial" is a pass with one named gap. Name the gap in verdict.note.

Reply format. Reply with exactly one JSON object and nothing else. No
markdown fences, no prose outside the JSON. The schema:

${REPLY_SCHEMA}

- Snippet references only: file (repo-relative), start, end (1-indexed,
  inclusive, at most ${STUDY_SNIPPET_MAX_LINES} lines). The server reads the
  real text from disk. Never paste code text into the JSON.
- say is one short plain-text line, under 30 words.
- question.index and question.total keep the session frame visible.

Closing. When your plan is done, or when the message "(end session)"
arrives, reply with done true and record set: one line of facts in the
shape "predict-first, 4 of 5 first try, Q4 missed twice". The record is a
fact, not a score. Never print a mastery percentage.`;

/** The session contract: examiner role, calibration, two modes, strict grading, reply schema. */
export function studyTutorSystemPrompt() {
  return SYSTEM_PROMPT;
}

/** The first user message of a study session: the subsystem, the repo, and the order to calibrate. */
export function studyOpeningMessage(record) {
  return `Study session on: ${record.subsystem}
Repository: ${record.repo} (your working directory)
Julian chose this subsystem himself. There is no change list and no dossier.
Pick the load-bearing fraction with your tools, then start with the
calibration probe now.`;
}

/** Julian's answer, passed to the tutor verbatim. */
export function studyAnswerMessage(text) {
  return String(text);
}

/** The end request the tutor answers with done and the one-line record. */
export function studyEndMessage() {
  return "(end session)";
}

/** One corrective retry message, sent after a reply that did not parse. */
export function studyRetryMessage(reason) {
  return `Your last reply was not one valid JSON object (${reason}). Send the reply again as exactly one JSON object, nothing else.`;
}

/**
 * Pulls the first JSON object out of a tutor reply. The tutor is told to send
 * bare JSON, but models add fences and preamble often enough that recovering
 * costs one turn less than a retry. Throws when nothing parses.
 */
function extractJsonObject(raw) {
  const text = String(raw ?? "").replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("the reply holds no JSON object");
  const body = text.slice(start);
  try {
    return JSON.parse(body);
  } catch {}
  const end = body.lastIndexOf("}");
  if (end === -1) throw new Error("the reply holds no JSON object");
  try {
    return JSON.parse(body.slice(0, end + 1));
  } catch (error) {
    throw new Error(`the reply is not valid JSON (${String(error.message ?? error)})`);
  }
}

/** Coerces one line number and rejects anything that is not a whole number of at least 1. */
function lineNumber(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${field} must be a whole number of at least 1`);
  return number;
}

/** Validates one snippet reference: repo-relative file, 1-indexed inclusive range. */
function normalizeSnippet(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object or null`);
  const file = String(value.file ?? "").trim();
  if (!file) throw new Error(`${field}.file is empty`);
  const start = lineNumber(value.start, `${field}.start`);
  const end = lineNumber(value.end, `${field}.end`);
  if (end < start) throw new Error(`${field}.end is before ${field}.start`);
  return { file, start, end };
}

/** Validates one verdict: a known result, quoted evidence, and a short note. */
function normalizeVerdict(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("verdict must be an object or null");
  const result = String(value.result ?? "");
  if (!VERDICTS.has(result)) throw new Error(`verdict.result must be pass, partial, or miss (got ${JSON.stringify(value.result)})`);
  const evidence = String(value.evidence ?? "").trim();
  if (!evidence) throw new Error("verdict.evidence is empty: quote the line, caller, or test that decides");
  return { result, evidence, note: String(value.note ?? "").trim() };
}

/** Validates one question: a known type, text, a frame, and an optional snippet. */
function normalizeQuestion(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("question must be an object or null");
  const type = String(value.type ?? "");
  if (!QUESTION_TYPES.has(type)) throw new Error(`question.type is unknown (got ${JSON.stringify(value.type)})`);
  const text = String(value.text ?? "").trim();
  if (!text) throw new Error("question.text is empty");
  return {
    index: lineNumber(value.index ?? 1, "question.index"),
    total: lineNumber(value.total ?? 1, "question.total"),
    type,
    text,
    snippet: normalizeSnippet(value.snippet, "question.snippet")
  };
}

/**
 * Parses one tutor reply into the turn shape the record stores. Throws an
 * Error naming the field that failed, so the server can send the tutor one
 * corrective retry with the reason in it.
 */
export function parseTutorReply(raw) {
  const reply = extractJsonObject(raw);
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) throw new Error("the reply is not a JSON object");
  if (reply.say !== null && reply.say !== undefined && typeof reply.say !== "string") throw new Error("say must be a string");
  const mode = String(reply.mode ?? "");
  if (!MODES.has(mode)) throw new Error(`mode must be calibration, predict-first, or worked-example (got ${JSON.stringify(reply.mode)})`);
  if (reply.done !== undefined && reply.done !== null && typeof reply.done !== "boolean") throw new Error("done must be a boolean");
  const done = Boolean(reply.done);
  const record = reply.record === null || reply.record === undefined ? null : String(reply.record).trim();
  return {
    say: String(reply.say ?? "").trim(),
    verdict: normalizeVerdict(reply.verdict),
    reveal: normalizeSnippet(reply.reveal, "reveal"),
    question: normalizeQuestion(reply.question),
    mode,
    done,
    record: record || null
  };
}
