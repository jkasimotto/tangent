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

test("buildInsightsFeedView labels token cost compactly with an 'est.' prefix and omits it when zero", () => {
  const withTokens = buildInsightsFeedView(apiResponse([apiFinding({ costTokens: 24_205 })]));
  assert.equal(withTokens.findings[0].tokenLabel, "est. 24k tokens");

  const withoutTokens = buildInsightsFeedView(apiResponse([apiFinding({ costTokens: 0 })]));
  assert.equal(withoutTokens.findings[0].tokenLabel, undefined);
});

test("buildInsightsFeedView derives a short remedy chip from the known remedy sentence, with a generic fallback", () => {
  const known = buildInsightsFeedView(apiResponse([apiFinding()]));
  assert.equal(known.findings[0].remedyChip, "Document/cache command");
  assert.equal(known.findings[0].remedyLabel, "document the correct scoped invocation in CLAUDE.md, or cache the result", "the full sentence is kept for the chip tooltip");

  const unrecognized = buildInsightsFeedView(apiResponse([apiFinding({ remedyLabel: "a brand new remedy sentence nobody has mapped yet" })]));
  assert.equal(unrecognized.findings[0].remedyChip, "A brand new remedy sentence n…");
});

test("buildInsightsFeedView passes through an optional projectLabel and excludedEvalRuns", () => {
  const withProject = buildInsightsFeedView(apiResponse([apiFinding({ projectLabel: "polez-pgande" })]));
  assert.equal(withProject.findings[0].projectLabel, "polez-pgande");

  const withoutProject = buildInsightsFeedView(apiResponse([apiFinding()]));
  assert.equal(withoutProject.findings[0].projectLabel, undefined);

  const withExcluded = buildInsightsFeedView(apiResponse([apiFinding()], { excludedEvalRuns: 74 }));
  assert.equal(withExcluded.excludedEvalRuns, 74);

  const withZeroExcluded = buildInsightsFeedView(apiResponse([apiFinding()], { excludedEvalRuns: 0 }));
  assert.equal(withZeroExcluded.excludedEvalRuns, undefined, "a zero count renders no footnote");
});

test("buildInsightsFeedView drops zero-fraction categories and sorts the rest by share descending", () => {
  const view = buildInsightsFeedView(apiResponse([apiFinding()], {
    categories: [
      { key: "writing", label: "writing", ms: 1_900_000, fraction: 0.19 },
      { key: "other-tools", label: "other tools", ms: 3_400_000, fraction: 0.34 },
      { key: "idle", label: "idle", ms: 0, fraction: 0 }
    ]
  }));

  assert.deepEqual(view.categories.map((category) => category.key), ["other-tools", "writing"]);
});

test("buildInsightsFeedView labels tiny nonzero category shares as <1%", () => {
  const view = buildInsightsFeedView(apiResponse([apiFinding()], {
    categories: [
      { key: "executing", label: "executing", ms: 995_000, fraction: 0.996 },
      { key: "writing", label: "writing", ms: 4_000, fraction: 0.004 }
    ]
  }));

  assert.deepEqual(view.categories.map((category) => category.percentLabel), ["100%", "<1%"]);
});
