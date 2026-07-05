import assert from "node:assert/strict";
import test from "node:test";

import { buildInsightsFeedView } from "../dist/index.js";

/** Builds a minimal Insights API finding fixture. */
function apiFinding(overrides = {}) {
  return {
    generator: "recurring-long-commands",
    subject: "dart analyze",
    title: "dart analyze ran 41x, median 4m38s",
    costMs: 3 * 60 * 60_000 + 12 * 60_000,
    costTokens: 1200,
    costTokensEstimated: true,
    evidence: [{ conversationId: "claude:c1", sessionId: "s1" }],
    remedyLabel: "document the correct scoped invocation in CLAUDE.md, or cache the result",
    fingerprint: "fp-1",
    repo: "/repo/polez",
    parked: false,
    ...overrides
  };
}

/** Builds a minimal Insights API response fixture with the given findings. */
function apiResponse(findings, overrides = {}) {
  return {
    scopeLabel: "all projects",
    windowDays: 30,
    totalMs: 10 * 60 * 60_000,
    categories: [
      { key: "findingInfo", label: "finding info", ms: 3_400_000, fraction: 0.34 },
      { key: "executing", label: "executing", ms: 2_200_000, fraction: 0.22 },
      { key: "writing", label: "writing", ms: 1_900_000, fraction: 0.19 }
    ],
    findings,
    ...overrides
  };
}

test("buildInsightsFeedView formats the header and splits findings into visible and parked", () => {
  const view = buildInsightsFeedView(apiResponse([
    apiFinding({ fingerprint: "fp-1", parked: false }),
    apiFinding({ fingerprint: "fp-2", parked: true, title: "old finding" })
  ]));

  assert.equal(view.scopeLabel, "all projects");
  assert.equal(view.windowDays, 30);
  assert.equal(view.totalLabel, "10.0h");
  assert.deepEqual(view.categories.map((category) => category.percentLabel), ["34%", "22%", "19%"]);
  assert.equal(view.findings.length, 1, "parked findings are excluded from the visible feed");
  assert.equal(view.findings[0].fingerprint, "fp-1");
  assert.equal(view.parkedFindings.length, 1);
  assert.equal(view.parkedFindings[0].fingerprint, "fp-2");
  assert.equal(view.parkedCount, 1);
  assert.equal(view.isEmpty, false);
});

test("buildInsightsFeedView marks the empty state only when there is no agent time and no findings", () => {
  const empty = buildInsightsFeedView(apiResponse([], { totalMs: 0 }));
  assert.equal(empty.isEmpty, true);

  const quiet = buildInsightsFeedView(apiResponse([], { totalMs: 500_000 }));
  assert.equal(quiet.isEmpty, false, "a populated window with no findings above the noise floor is not the empty state");
});

test("buildInsightsFeedView builds the mark command from the session id, falling back to the conversation id", () => {
  const withSession = buildInsightsFeedView(apiResponse([
    apiFinding({ evidence: [{ conversationId: "claude:c1", sessionId: "s1" }, { conversationId: "claude:c2", sessionId: "s2" }] })
  ]));
  assert.equal(withSession.findings[0].primaryMarkCommand, "tangent mark --session s1");
  assert.equal(withSession.findings[0].evidence[1].markCommand, "tangent mark --session s2");
  assert.equal(withSession.findings[0].evidence[0].conversationId, "claude:c1", "the conversation id is kept for the view-sessions link");

  const withoutSession = buildInsightsFeedView(apiResponse([
    apiFinding({ evidence: [{ conversationId: "claude:c3" }] })
  ]));
  assert.equal(withoutSession.findings[0].primaryMarkCommand, "tangent mark --session claude:c3");
});

test("buildInsightsFeedView labels token cost with an 'est.' prefix and omits it when zero", () => {
  const withTokens = buildInsightsFeedView(apiResponse([apiFinding({ costTokens: 12_345 })]));
  assert.equal(withTokens.findings[0].tokenLabel, "est. 12,345 tokens");

  const withoutTokens = buildInsightsFeedView(apiResponse([apiFinding({ costTokens: 0 })]));
  assert.equal(withoutTokens.findings[0].tokenLabel, undefined);
});
