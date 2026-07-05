import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readMark } from "../dist/marks/store.js";
import {
  buildScanCandidates,
  buildScanPrompt,
  draftFromIncident,
  normalizeScanIncidents,
  rankScanCandidates,
  scanForSuggestedMarks
} from "../dist/marks/scan.js";

/** Builds a minimal NormalizedConversation fixture, overriding only what a test cares about. */
function conversation(overrides) {
  return {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId: "claude:conv-default",
    providerSessionId: "session-default",
    transcriptPath: "/home/user/.claude/projects/repo/session-default.jsonl",
    repo: { root: "/Users/me/Projects/example" },
    messages: [],
    totals: { userMessages: 0, assistantMessages: 0, toolCalls: 0 },
    caveats: [],
    ...overrides
  };
}

/** Builds a user-role message fixture. */
function userMessage(text) {
  return { id: `u-${text}`, role: "user", text, confidence: "exact" };
}

/** Builds an assistant-role message fixture carrying the given tool calls. */
function assistantMessage(toolCalls) {
  return { id: "a-1", role: "assistant", text: "", toolCalls, confidence: "exact" };
}

/** Builds a tool-call fixture in the given category. */
function toolCall(category, name = "Tool") {
  return { id: `t-${category}`, name, category, targetPaths: [], evidenceEventIds: [] };
}

/** Builds a Finding fixture, overriding only what a test cares about. */
function finding(overrides) {
  return {
    generator: "info-finding-heavy-sessions",
    subject: "conv-default",
    title: "A deterministic finding",
    costMs: 60000,
    costTokens: 0,
    costTokensEstimated: true,
    evidence: [{ conversationId: "claude:conv-default" }],
    remedy: "missing-map",
    fingerprint: "fp-default",
    ...overrides
  };
}

// --- buildScanCandidates: the seeding and anchorability rules. ---

test("buildScanCandidates seeds a conversation with a user message even when no finding flagged it, at cost 0", () => {
  const conv = conversation({ conversationId: "claude:conv-b", messages: [userMessage("hello")] });
  const candidates = buildScanCandidates([conv], []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].costMs, 0);
  assert.deepEqual(candidates[0].findingTitles, []);
  assert.deepEqual(candidates[0].userMessages, ["hello"]);
});

test("buildScanCandidates seeds a finding's evidence conversation even with no user messages", () => {
  const conv = conversation({ conversationId: "claude:conv-c", messages: [assistantMessage([toolCall("search")])] });
  const findingC = finding({ subject: "conv-c", title: "Info-finding-heavy", costMs: 50000, evidence: [{ conversationId: "claude:conv-c" }] });
  const candidates = buildScanCandidates([conv], [findingC]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].costMs, 50000);
  assert.deepEqual(candidates[0].findingTitles, ["Info-finding-heavy"]);
  assert.deepEqual(candidates[0].userMessages, []);
});

test("buildScanCandidates excludes a conversation with no user messages and no finding evidence", () => {
  const conv = conversation({ conversationId: "claude:conv-f", messages: [assistantMessage([])] });
  const candidates = buildScanCandidates([conv], []);
  assert.equal(candidates.length, 0);
});

test("buildScanCandidates drops a conversation missing a repo root, even when seeded by a user message", () => {
  const conv = conversation({ conversationId: "claude:conv-no-repo", repo: undefined, messages: [userMessage("hi")] });
  assert.equal(buildScanCandidates([conv], []).length, 0);
});

test("buildScanCandidates drops a conversation missing a transcript path", () => {
  const conv = conversation({ conversationId: "claude:conv-no-transcript", transcriptPath: undefined, messages: [userMessage("hi")] });
  assert.equal(buildScanCandidates([conv], []).length, 0);
});

test("buildScanCandidates drops a non-claude provider conversation", () => {
  const conv = conversation({ provider: "codex", conversationId: "codex:conv-e", messages: [userMessage("hi")] });
  assert.equal(buildScanCandidates([conv], []).length, 0);
});

test("buildScanCandidates derives the session id from the conversation id when providerSessionId is absent", () => {
  const conv = conversation({ conversationId: "claude:derived-session", providerSessionId: undefined, messages: [userMessage("hi")] });
  const candidates = buildScanCandidates([conv], []);
  assert.equal(candidates[0].sessionId, "derived-session");
});

test("buildScanCandidates sums cost and dedupes finding titles across multiple findings on the same conversation", () => {
  const conv = conversation({ conversationId: "claude:conv-a", messages: [userMessage("hi")] });
  const findings = [
    finding({ subject: "conv-a", title: "Recurring long command", costMs: 30000, evidence: [{ conversationId: "claude:conv-a" }] }),
    finding({ subject: "conv-a", title: "Recurring long command", costMs: 40000, evidence: [{ conversationId: "claude:conv-a" }] })
  ];
  const candidates = buildScanCandidates([conv], findings);
  assert.equal(candidates[0].costMs, 70000);
  assert.deepEqual(candidates[0].findingTitles, ["Recurring long command"]);
});

test("buildScanCandidates summarizes tool calls by category, sorted alphabetically regardless of call order", () => {
  const conv = conversation({
    conversationId: "claude:conv-tools",
    messages: [
      userMessage("hi"),
      assistantMessage([toolCall("write"), toolCall("read"), toolCall("read"), toolCall("command")])
    ]
  });
  const candidates = buildScanCandidates([conv], []);
  assert.equal(candidates[0].toolCallSummary, "command: 1, read: 2, write: 1");
});

test("buildScanCandidates reports no tool calls for a conversation with none", () => {
  const conv = conversation({ conversationId: "claude:conv-no-tools", messages: [userMessage("hi")] });
  assert.equal(buildScanCandidates([conv], [])[0].toolCallSummary, "(no tool calls)");
});

// --- rankScanCandidates: cost-descending order with a deterministic tie-break. ---

test("rankScanCandidates sorts by cost descending", () => {
  const candidates = [
    { conversationId: "claude:low", costMs: 10 },
    { conversationId: "claude:high", costMs: 30 },
    { conversationId: "claude:mid", costMs: 20 }
  ];
  assert.deepEqual(rankScanCandidates(candidates).map((c) => c.conversationId), ["claude:high", "claude:mid", "claude:low"]);
});

test("rankScanCandidates breaks cost ties by conversation id ascending, for deterministic output", () => {
  const candidates = [
    { conversationId: "claude:conv-c", costMs: 0 },
    { conversationId: "claude:conv-a", costMs: 0 },
    { conversationId: "claude:conv-b", costMs: 0 }
  ];
  assert.deepEqual(rankScanCandidates(candidates).map((c) => c.conversationId), ["claude:conv-a", "claude:conv-b", "claude:conv-c"]);
});

// --- normalizeScanIncidents: the model-response contract. ---

test("normalizeScanIncidents accepts a well-formed response", () => {
  const result = normalizeScanIncidents({
    incidents: [{ quote: "no, revert that", why: "user rejected the change", category: "user-correction", confidence: "high" }]
  });
  assert.deepEqual(result.incidents, [{ quote: "no, revert that", why: "user rejected the change", category: "user-correction", confidence: "high" }]);
});

test("normalizeScanIncidents caps incidents at 3, keeping the first 3 in order", () => {
  const incidents = ["one", "two", "three", "four"].map((quote) => ({ quote, why: "why", category: "wrong-pattern", confidence: "low" }));
  const result = normalizeScanIncidents({ incidents });
  assert.equal(result.incidents.length, 3);
  assert.deepEqual(result.incidents.map((i) => i.quote), ["one", "two", "three"]);
});

test("normalizeScanIncidents drops individually malformed entries but keeps the valid ones", () => {
  const result = normalizeScanIncidents({
    incidents: [
      { quote: "valid quote", why: "valid why", category: "ignored-instruction", confidence: "high" },
      { quote: "", why: "empty quote is invalid", category: "ignored-instruction", confidence: "high" },
      { quote: "bad category", why: "why", category: "not-a-real-category", confidence: "high" },
      { quote: "bad confidence", why: "why", category: "ignored-instruction", confidence: "medium" },
      "not even an object"
    ]
  });
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].quote, "valid quote");
});

test("normalizeScanIncidents throws when the top-level value is not an object", () => {
  assert.throws(() => normalizeScanIncidents("not an object"), /must be an object/);
  assert.throws(() => normalizeScanIncidents(null), /must be an object/);
});

test("normalizeScanIncidents throws when incidents is missing or not an array", () => {
  assert.throws(() => normalizeScanIncidents({}), /"incidents" array/);
  assert.throws(() => normalizeScanIncidents({ incidents: "nope" }), /"incidents" array/);
});

// --- buildScanPrompt: golden test for prompt composition. ---

test("buildScanPrompt golden: renders findings, tool summary, and numbered user messages", () => {
  const candidate = {
    conversationId: "claude:conv-a",
    sessionId: "session-a",
    transcriptPath: "/home/user/.claude/projects/repo/session-a.jsonl",
    repoRoot: "/Users/me/Projects/example",
    userMessages: ["please add a feature flag", "no, that broke the build"],
    toolCallSummary: "read: 2, search: 1",
    findingTitles: ["3.2h dart analyze ran on the whole client 41x"]
  };
  const prompt = buildScanPrompt(candidate);
  assert.equal(
    prompt,
    [
      "You are scanning ONE coding-agent conversation for moments worth a human's attention.",
      "You are given the user's messages in order, a one-line tool-call summary, and any deterministic findings that already flagged this conversation as costly.",
      "",
      "Flag an incident only when you can quote the exact moment and explain why a human should look at it. Categories:",
      "- user-correction: the user rejected, redirected, or restated a constraint the agent ignored.",
      "- wasted-exploration: the agent spent effort finding information it could have found faster.",
      "- ignored-instruction: context available to the agent (an earlier message, a stated constraint) said do X and it did not.",
      "- wrong-pattern: the agent used an approach that conflicts with how this codebase is supposed to work.",
      "",
      "Return at most 3 incidents. If nothing rises to a real incident, return an empty list. Do not invent an incident to fill the list.",
      'Return JSON matching the schema: { incidents: [{ quote, why, category, confidence }] }. "quote" must be verbatim from the messages or summary given below. "confidence" is "high" only when the quote alone makes the problem obvious to a stranger.',
      "",
      "Tool calls: read: 2, search: 1",
      "",
      "Deterministic findings for this conversation:",
      "- 3.2h dart analyze ran on the whole client 41x",
      "",
      "User messages:",
      "[1] please add a feature flag\n\n[2] no, that broke the build"
    ].join("\n")
  );
});

test("buildScanPrompt falls back to placeholder text when there are no findings or user messages", () => {
  const candidate = {
    conversationId: "claude:conv-empty",
    sessionId: "session-empty",
    transcriptPath: "/x/session-empty.jsonl",
    repoRoot: "/repo",
    userMessages: [],
    toolCallSummary: "(no tool calls)",
    findingTitles: []
  };
  const prompt = buildScanPrompt(candidate);
  assert.match(prompt, /\(no deterministic finding flagged this conversation; look only for user corrections\.\)/);
  assert.match(prompt, /User messages:\n\(no user messages\)$/);
});

// --- draftFromIncident: mark-kind mapping and field mapping. ---

test("draftFromIncident maps wasted-exploration to a candidate mark", () => {
  const candidate = { conversationId: "claude:conv-a", sessionId: "session-a", transcriptPath: "/x/a.jsonl", repoRoot: "/repo" };
  const incident = { quote: "spent 11 min searching", why: "should have used structural search", category: "wasted-exploration", confidence: "high" };
  const draft = draftFromIncident(candidate, incident);
  assert.equal(draft.kind, "candidate");
  assert.equal(draft.status, "suggested");
  assert.equal(draft.observed, "should have used structural search");
  assert.equal(draft.quote, "spent 11 min searching");
  assert.deepEqual(draft.anchor, { provider: "claude", sessionId: "session-a", conversationId: "claude:conv-a", transcriptPath: "/x/a.jsonl" });
  assert.deepEqual(draft.repo, { root: "/repo" });
});

for (const category of ["user-correction", "ignored-instruction", "wrong-pattern"]) {
  test(`draftFromIncident maps ${category} to a failure mark`, () => {
    const candidate = { conversationId: "claude:conv-a", sessionId: "session-a", transcriptPath: "/x/a.jsonl", repoRoot: "/repo" };
    const draft = draftFromIncident(candidate, { quote: "q", why: "w", category, confidence: "low" });
    assert.equal(draft.kind, "failure");
  });
}

// --- scanForSuggestedMarks: orchestration with injected conversations, model runner, and marks store. ---

/** Builds a fake ScanModelRunner whose `analyze` is driven by a conversationId-keyed map, recording every call it receives. */
function fakeRunner(byConversationId) {
  const calls = [];
  return {
    calls,
    /** Returns the canned result (or throws the canned error) for the candidate's conversation id. */
    async analyze(input) {
      calls.push(input.candidate.conversationId);
      const outcome = byConversationId[input.candidate.conversationId];
      if (outcome instanceof Error) throw outcome;
      return outcome || { incidents: [] };
    }
  };
}

test("scanForSuggestedMarks seeds every conversation with a user message and excludes ones already anchored by a non-dismissed mark", async () => {
  const conversations = [
    conversation({ conversationId: "claude:conv-a", messages: [userMessage("already marked")] }),
    conversation({ conversationId: "claude:conv-b", messages: [userMessage("not yet marked")] }),
    conversation({ conversationId: "claude:conv-dismissed", messages: [userMessage("dismissed mark does not block")] }),
    conversation({ conversationId: "claude:conv-none", messages: [assistantMessage([])] })
  ];
  const existingMarks = [
    { anchor: { conversationId: "claude:conv-a" }, status: "triaged" },
    { anchor: { conversationId: "claude:conv-dismissed" }, status: "dismissed" }
  ];
  const runner = fakeRunner({});

  /** Stub conversation loader returning the fixture window directly, ignoring the requested days/repo. */
  const loadConversations = async () => conversations;
  /** Stub mark lister returning the fixture existing marks, ignoring the filter and marksDir. */
  const listMarksFn = async () => existingMarks;
  /** Stub mark writer that must never run: this scenario has no incidents to write. */
  const writeMarkFn = async () => { throw new Error("writeMarkFn must not be called when there are no incidents"); };

  const result = await scanForSuggestedMarks(
    { model: "test-model", limit: 10 },
    { loadConversations, runner, listMarksFn, writeMarkFn }
  );

  assert.deepEqual(runner.calls.sort(), ["claude:conv-b", "claude:conv-dismissed"]);
  assert.equal(result.summary.conversationsScanned, 2);
  assert.equal(result.summary.modelCalls, 2);
  assert.equal(result.summary.marksWritten, 0);
});

test("scanForSuggestedMarks caps model calls at options.limit, in rank order", async () => {
  const conversations = ["claude:conv-a", "claude:conv-b", "claude:conv-c"].map((conversationId) =>
    conversation({ conversationId, messages: [userMessage("hi")] })
  );
  const runner = fakeRunner({});
  /** Stub conversation loader returning the fixture window directly. */
  const loadConversations = async () => conversations;
  /** Stub mark lister with no existing marks, so nothing is deduplicated. */
  const listMarksFn = async () => [];

  const result = await scanForSuggestedMarks(
    { model: "test-model", limit: 2 },
    { loadConversations, runner, listMarksFn }
  );

  assert.deepEqual(runner.calls, ["claude:conv-a", "claude:conv-b"], "cost ties break alphabetically, so a and b are scanned before c");
  assert.equal(result.summary.conversationsScanned, 2);
});

test("scanForSuggestedMarks writes one suggested mark per validated incident, mapping categories to mark kinds and counting them", async () => {
  const conversations = [
    conversation({ conversationId: "claude:conv-b", messages: [userMessage("that broke it, revert")] }),
    conversation({ conversationId: "claude:conv-c", messages: [userMessage("hi")] })
  ];
  const runner = fakeRunner({
    "claude:conv-b": { incidents: [{ quote: "that broke it, revert", why: "user rejected the change", category: "user-correction", confidence: "high" }] },
    "claude:conv-c": {
      incidents: [
        { quote: "spent 8 minutes grepping", why: "should have used structural search", category: "wasted-exploration", confidence: "high" },
        { quote: "used a for-loop mutation", why: "conflicts with the immutable-state convention", category: "wrong-pattern", confidence: "low" }
      ]
    }
  });
  const written = [];
  /** Stub conversation loader returning the fixture window directly. */
  const loadConversations = async () => conversations;
  /** Stub mark lister with no existing marks, so nothing is deduplicated. */
  const listMarksFn = async () => [];
  /** Stub mark writer that records every mark it is asked to persist. */
  const writeMarkFn = async (mark) => { written.push(mark); return mark; };

  const result = await scanForSuggestedMarks(
    { model: "test-model", limit: 10 },
    { loadConversations, runner, listMarksFn, writeMarkFn }
  );

  assert.equal(result.summary.marksWritten, 3);
  assert.deepEqual(result.summary.byCategory, { "user-correction": 1, "wasted-exploration": 1, "ignored-instruction": 0, "wrong-pattern": 1 });
  assert.equal(written.length, 3, "writeMarkFn is called once per written mark");
  assert.ok(result.marks.every((mark) => mark.status === "suggested"));
  assert.deepEqual(result.marks.map((mark) => mark.kind), ["failure", "candidate", "failure"]);
});

test("scanForSuggestedMarks dry-run computes marks without calling writeMarkFn", async () => {
  const conversations = [conversation({ conversationId: "claude:conv-b", messages: [userMessage("that broke it, revert")] })];
  const runner = fakeRunner({
    "claude:conv-b": { incidents: [{ quote: "that broke it, revert", why: "user rejected the change", category: "user-correction", confidence: "high" }] }
  });

  /** Stub conversation loader returning the fixture window directly. */
  const loadConversations = async () => conversations;
  /** Stub mark lister with no existing marks, so nothing is deduplicated. */
  const listMarksFn = async () => [];
  /** Stub mark writer that must never run: dry-run mode must not persist anything. */
  const writeMarkFn = async () => { throw new Error("writeMarkFn must not be called in dry-run mode"); };

  const result = await scanForSuggestedMarks(
    { model: "test-model", limit: 10, dryRun: true },
    { loadConversations, runner, listMarksFn, writeMarkFn }
  );

  assert.equal(result.summary.marksWritten, 1, "the summary still reports the would-be mark");
  assert.equal(result.marks.length, 1);
  assert.equal(result.marks[0].status, "suggested");
});

test("scanForSuggestedMarks counts a thrown model response as skipped and keeps scanning the rest", async () => {
  const conversations = [
    conversation({ conversationId: "claude:conv-bad", messages: [userMessage("hi")] }),
    conversation({ conversationId: "claude:conv-good", messages: [userMessage("that broke it, revert")] })
  ];
  const runner = fakeRunner({
    "claude:conv-bad": new Error("malformed model JSON"),
    "claude:conv-good": { incidents: [{ quote: "that broke it, revert", why: "user rejected the change", category: "user-correction", confidence: "high" }] }
  });

  /** Stub conversation loader returning the fixture window directly. */
  const loadConversations = async () => conversations;
  /** Stub mark lister with no existing marks, so nothing is deduplicated. */
  const listMarksFn = async () => [];

  const result = await scanForSuggestedMarks(
    { model: "test-model", limit: 10 },
    { loadConversations, runner, listMarksFn }
  );

  assert.equal(result.summary.modelCalls, 2);
  assert.equal(result.summary.skippedResponses, 1);
  assert.equal(result.summary.marksWritten, 1);
  assert.equal(result.marks[0].observed, "user rejected the change");
});

test("scanForSuggestedMarks persists suggested marks through the real store when not a dry run", async () => {
  const marksDir = await mkdtemp(path.join(tmpdir(), "tangent-marks-scan-"));
  try {
    const conversations = [conversation({ conversationId: "claude:conv-b", messages: [userMessage("that broke it, revert")] })];
    const runner = fakeRunner({
      "claude:conv-b": { incidents: [{ quote: "that broke it, revert", why: "user rejected the change", category: "user-correction", confidence: "high" }] }
    });

    /** Stub conversation loader returning the fixture window directly; listMarks/writeMark stay the real store, pointed at marksDir. */
    const loadConversations = async () => conversations;

    const result = await scanForSuggestedMarks(
      { model: "test-model", limit: 10, marksDir },
      { loadConversations, runner }
    );

    assert.equal(result.marks.length, 1);
    const persisted = await readMark(result.marks[0].id, marksDir);
    assert.equal(persisted.status, "suggested");
    assert.equal(persisted.observed, "user rejected the change");
  } finally {
    await rm(marksDir, { recursive: true, force: true });
  }
});
