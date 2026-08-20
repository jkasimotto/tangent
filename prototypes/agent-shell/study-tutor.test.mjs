import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDY_TUTOR_PROMPT_VERSION,
  parseTutorReply,
  studyAnswerMessage,
  studyEndMessage,
  studyOpeningMessage,
  studyRetryMessage,
  studyTutorSystemPrompt
} from "./study-tutor.mjs";

/** One well-formed tutor reply, as a JSON string, with the given fields merged in. */
function reply(fields) {
  return JSON.stringify({ say: "", verdict: null, reveal: null, question: null, mode: "calibration", done: false, record: null, ...fields });
}

test("the prompt carries the session contract Julian decided", () => {
  const prompt = studyTutorSystemPrompt();
  assert.match(prompt, /Calibration first/);
  assert.match(prompt, /predict-first mode/);
  assert.match(prompt, /worked-example mode/);
  assert.match(prompt, /label it\s+"inference"/);
  assert.match(prompt, /Never praise/);
  assert.match(prompt, /must quote the line, caller name, or test name/);
  assert.match(prompt, /exactly one JSON object and nothing else/);
  assert.match(prompt, /Never print a mastery percentage/);
  assert.equal(STUDY_TUTOR_PROMPT_VERSION, 1);
});

test("the opening message names the subsystem, the repo, and orders the calibration probe", () => {
  const message = studyOpeningMessage({ subsystem: "the search indexer", repo: "/repo" });
  assert.match(message, /Study session on: the search indexer/);
  assert.match(message, /Repository: \/repo/);
  assert.match(message, /calibration probe now/);
});

test("the answer message is verbatim, the end message is the fixed marker", () => {
  assert.equal(studyAnswerMessage("  it caches by HEAD  "), "  it caches by HEAD  ");
  assert.equal(studyEndMessage(), "(end session)");
  assert.match(studyRetryMessage("mode is missing"), /^Your last reply was not one valid JSON object \(mode is missing\)\./);
});

test("parseTutorReply accepts a bare object, a fenced object, and leading prose", () => {
  const body = reply({ say: "Start here.", mode: "predict-first" });
  assert.equal(parseTutorReply(body).say, "Start here.");
  assert.equal(parseTutorReply("```json\n" + body + "\n```").mode, "predict-first");
  assert.equal(parseTutorReply("Here is my reply:\n" + body).say, "Start here.");
});

test("parseTutorReply normalizes absent fields to null", () => {
  const parsed = parseTutorReply(JSON.stringify({ mode: "calibration" }));
  assert.deepEqual(parsed, { say: "", verdict: null, reveal: null, question: null, mode: "calibration", done: false, record: null });
});

test("parseTutorReply keeps a verdict, a reveal, and a question", () => {
  const parsed = parseTutorReply(reply({
    mode: "predict-first",
    verdict: { result: "partial", evidence: "server.mjs:130 MAP_STATE_ROOT", note: "You missed the env override." },
    reveal: { file: "server.mjs", start: "130", end: 134 },
    question: { index: 2, total: 5, type: "blast-radius", text: "What breaks?", snippet: null }
  }));
  assert.deepEqual(parsed.verdict, { result: "partial", evidence: "server.mjs:130 MAP_STATE_ROOT", note: "You missed the env override." });
  assert.deepEqual(parsed.reveal, { file: "server.mjs", start: 130, end: 134 });
  assert.equal(parsed.question.type, "blast-radius");
  assert.equal(parsed.question.snippet, null);
});

test("parseTutorReply closes a session with its one-line record", () => {
  const parsed = parseTutorReply(reply({ mode: "predict-first", done: true, record: "predict-first, 4 of 5 first try, Q4 missed twice" }));
  assert.equal(parsed.done, true);
  assert.equal(parsed.record, "predict-first, 4 of 5 first try, Q4 missed twice");
});

test("parseTutorReply throws with the failing field named", () => {
  assert.throws(() => parseTutorReply("no json here"), /holds no JSON object/);
  assert.throws(() => parseTutorReply(JSON.stringify({ say: "hi" })), /mode must be calibration/);
  assert.throws(() => parseTutorReply(reply({ mode: "quiz" })), /mode must be calibration/);
  assert.throws(() => parseTutorReply(reply({ verdict: { result: "good", evidence: "x" } })), /verdict\.result must be pass/);
  assert.throws(() => parseTutorReply(reply({ verdict: { result: "pass", evidence: "  " } })), /verdict\.evidence is empty/);
  assert.throws(() => parseTutorReply(reply({ reveal: { file: "a.js", start: 12, end: 3 } })), /reveal\.end is before reveal\.start/);
  assert.throws(() => parseTutorReply(reply({ reveal: { file: "a.js", start: 1.5, end: 3 } })), /reveal\.start must be a whole number/);
  assert.throws(() => parseTutorReply(reply({ reveal: { file: "", start: 1, end: 3 } })), /reveal\.file is empty/);
  assert.throws(() => parseTutorReply(reply({ question: { type: "guess", text: "x" } })), /question\.type is unknown/);
  assert.throws(() => parseTutorReply(reply({ question: { type: "why", text: " " } })), /question\.text is empty/);
  assert.throws(() => parseTutorReply(reply({ done: "yes" })), /done must be a boolean/);
});
