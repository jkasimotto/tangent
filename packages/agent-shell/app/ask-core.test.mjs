// The ask constructor is the whole invariant of the For you card: a row is a
// stated ask, or it does not exist (design-the-for-you-row-shows-only-direct-
// asks, Decision 1). These tests pin what it refuses, what each source
// builds, and that no machine state alone reaches a row.

import test from "node:test";
import assert from "node:assert/strict";

await import("./public/ask-core.js");

const core = globalThis.AgentShellAsk;

/** The brain payload shape the desk reads, with the fields a test needs. */
function brain(overrides = {}) {
  return { area: "otto/tangent", session: "tangent-brain-g1", live: true, stateDetail: null, stateQuestion: "", ...overrides };
}

/** One resolved plan row, in the shape `forJulianItems` returns. */
function row(overrides = {}) {
  return { kind: "decide", target: "design-x", text: "Which one?", unblocks: null, line: "- Decide [[design-x]]: Which one?", index: 1, file: "otto/tangent/design-x.md", title: "Design X", commentCount: 0, missing: false, goalStatus: null, ...overrides };
}

/** The verbs of one ask, in the order it draws them. */
function kinds(ask) {
  return ask.actions.map((action) => action.kind);
}

test("the exports are the constructor, the five builders, and the three fixed questions", () => {
  assert.deepEqual(Object.keys(core), [
    "makeAsk",
    "askFromPlanRow",
    "askFromBrainDialog",
    "askFromStoppedStep",
    "askFromDialogSession",
    "askFromWaitingOn",
    "TEST_QUESTION",
    "DIALOG_QUESTION",
    "RESULT_QUESTION",
  ]);
});

test("makeAsk refuses anything that is not a direct ask", () => {
  const good = { area: "otto/tangent", subject: "design-x", question: "Which one?", actions: [{ kind: "accept", label: "Accept", arg: {} }] };
  assert.ok(core.makeAsk(good), "the good shape builds");
  assert.equal(core.makeAsk({ ...good, area: " " }), null, "no Area");
  assert.equal(core.makeAsk({ ...good, subject: "" }), null, "no subject");
  assert.equal(core.makeAsk({ ...good, question: "" }), null, "no question");
  assert.equal(core.makeAsk({ ...good, question: "This one is best." }), null, "a statement is not a question");
  assert.equal(core.makeAsk({ ...good, actions: [] }), null, "no way to answer");
  assert.equal(core.makeAsk({ ...good, actions: [{ kind: "explode", label: "Go", arg: {} }] }), null, "an unknown verb");
  assert.equal(core.makeAsk({ ...good, actions: [{ kind: "accept", label: "", arg: {} }] }), null, "an unlabelled verb");
  assert.equal(core.makeAsk({ ...good, actions: [{ kind: "accept", label: "Accept" }] }), null, "a verb with no argument");
});

test("makeAsk freezes what it builds, so no caller can widen a row later", () => {
  const ask = core.makeAsk({ area: "otto/tangent", subject: "x", question: "Which?", actions: [{ kind: "accept", label: "Accept", arg: {} }] });
  assert.throws(() => { "use strict"; ask.question = "Anything?"; }, TypeError);
});

test("a Test row asks the fixed question and carries both verdicts", () => {
  const ask = core.askFromPlanRow(brain(), row({ kind: "test", target: "find-a-document", title: "Find a document", text: "press Cmd+K, type a title.", goalStatus: "done", file: "otto/tangent/goal-find-a-document.md" }));
  assert.equal(ask.question, core.TEST_QUESTION);
  assert.equal(ask.subject, "Find a document");
  assert.equal(ask.detail, "press Cmd+K, type a title.");
  assert.deepEqual(kinds(ask), ["accept", "reject", "reply"]);
  assert.equal(ask.source, "plan");
});

test("a Test row stops asking when its Goal is no longer done", () => {
  const done = row({ kind: "test", goalStatus: "done", title: "Find a document" });
  assert.ok(core.askFromPlanRow(brain(), done));
  assert.equal(core.askFromPlanRow(brain(), { ...done, goalStatus: "open" }), null);
  assert.equal(core.askFromPlanRow(brain(), { ...done, goalStatus: null }), null);
});

test("a row whose target does not resolve is not shown", () => {
  assert.equal(core.askFromPlanRow(brain(), row({ missing: true })), null);
  assert.equal(core.askFromPlanRow(brain(), row({ kind: "test", goalStatus: "done", missing: true })), null);
});

test("a targeted Decide leads with its Document, and its facts read as one line", () => {
  const ask = core.askFromPlanRow(brain(), row({ unblocks: "the audit", commentCount: 2 }));
  assert.equal(ask.subject, "design-x");
  assert.equal(ask.detail, "Unblocks: the audit · 2 comments left");
  assert.equal(ask.question, "Which one?");
  assert.deepEqual(kinds(ask), ["open-document", "accept", "reject", "reply"]);
  assert.equal(ask.actions[0].arg.file, "otto/tangent/design-x.md");
});

test("a stopped brain's rows keep their verdicts but lose Reply, which needs a terminal", () => {
  const ask = core.askFromPlanRow(brain({ live: false }), row());
  assert.deepEqual(kinds(ask), ["open-document", "accept", "reject"]);
});

test("a targetless Decide carries only Answer", () => {
  const ask = core.askFromPlanRow(brain(), row({ target: null, file: null, title: null, text: "Should the audit cover the Usage UI too?", line: "- Decide: Should the audit cover the Usage UI too?" }));
  assert.equal(ask.subject, "Brain asks");
  assert.equal(ask.question, "Should the audit cover the Usage UI too?");
  assert.deepEqual(kinds(ask), ["answer"]);
  assert.equal(ask.actions[0].arg.subject, "Should the audit cover the Usage UI too?");
});

test("a live brain at a dialog asks its own question, and falls back when the pane yields none", () => {
  const asked = core.askFromBrainDialog(brain({ stateDetail: "decision", stateQuestion: "Do you want to proceed?" }));
  assert.equal(asked.question, "Do you want to proceed?");
  assert.equal(asked.detail, "");
  assert.deepEqual(kinds(asked), ["open-brain"]);
  const fallback = core.askFromBrainDialog(brain({ stateDetail: "decision", stateQuestion: "Edit file src/app.ts" }));
  assert.equal(fallback.question, core.DIALOG_QUESTION);
  assert.equal(fallback.detail, "Edit file src/app.ts");
  assert.equal(core.askFromBrainDialog(brain({ stateDetail: "decision", stateQuestion: "" })).question, core.DIALOG_QUESTION);
});

test("a brain that is not at a dialog, or is not live, asks nothing", () => {
  assert.equal(core.askFromBrainDialog(brain({ stateDetail: "idle" })), null);
  assert.equal(core.askFromBrainDialog(brain({ stateDetail: "draft" })), null);
  assert.equal(core.askFromBrainDialog(brain({ stateDetail: null })), null);
  assert.equal(core.askFromBrainDialog(brain({ live: false, stateDetail: "decision", stateQuestion: "Which?" })), null);
});

test("a stopped step asks whether to restart or skip it", () => {
  const goal = { area: "otto/tangent", file: "otto/tangent/goal-x.md", title: "Find a document" };
  const ask = core.askFromStoppedStep(goal, { index: 2, status: "stopped" });
  assert.equal(ask.question, "Step 2 stopped. Restart or skip it?");
  assert.equal(ask.subject, "Find a document");
  assert.deepEqual(kinds(ask), ["reveal-goal"]);
});

test("a session at a dialog asks it, under a Goal or while work is being defined", () => {
  const goal = { area: "otto/tangent", file: "otto/tangent/goal-x.md", title: "Find a document" };
  const action = { kind: "open-run", label: "Open Claude", arg: { file: goal.file } };
  const onGoal = core.askFromDialogSession(goal, { stateDetail: "decision", stateQuestion: "Do you want to edit shell.js?" }, { action });
  assert.equal(onGoal.subject, "Find a document");
  assert.equal(onGoal.question, "Do you want to edit shell.js?");
  const defining = core.askFromDialogSession(null, { area: "otto/dnd", workTitle: "Make the scene flow reliable", stateDetail: "decision", stateQuestion: "❯ 1. Yes" }, { action: { kind: "select-definition", label: "Open", arg: { session: "s" } } });
  assert.equal(defining.area, "otto/dnd");
  assert.equal(defining.subject, "Make the scene flow reliable");
  assert.equal(defining.question, core.DIALOG_QUESTION);
});

test("an idle, waiting, draft, or shell session never becomes an ask", () => {
  const action = { kind: "open-run", label: "Open", arg: {} };
  for (const stateDetail of ["idle", "draft", null, undefined]) {
    assert.equal(core.askFromDialogSession(null, { area: "otto/dnd", workTitle: "x", state: "waiting", stateDetail }, { action }), null, String(stateDetail));
  }
});

test("a handover rows a finished Goal, and mid-work only when it asks", () => {
  const goal = { area: "otto/tangent", file: "otto/tangent/goal-x.md", title: "Find a document", waitingOn: "Julian to look at the result" };
  const finished = core.askFromWaitingOn(goal, { finished: true });
  assert.equal(finished.question, core.RESULT_QUESTION);
  assert.equal(finished.detail, "Julian to look at the result");
  assert.equal(core.askFromWaitingOn(goal, { finished: false }), null, "mid-work, a statement is not an ask");
  const asking = core.askFromWaitingOn({ ...goal, waitingOn: "Julian: keep the old key binding?" }, { finished: false });
  assert.equal(asking.question, "Julian: keep the old key binding?");
  assert.equal(core.askFromWaitingOn({ ...goal, waitingOn: "the review agent to finish" }, { finished: true }), null, "a handover that names nobody is not his");
  assert.equal(core.askFromWaitingOn({ ...goal, waitingOn: "" }, { finished: true }), null);
});
