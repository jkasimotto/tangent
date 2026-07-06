import assert from "node:assert/strict";
import test from "node:test";

import {
  FINDING_REMEDY_TAGS,
  renderFindingDetail,
  renderInsightsList,
  resolveFindingRef
} from "../dist/cli/insights.js";
import { partitionEvalRunConversations } from "../dist/core/insights-window.js";
import { createInsightsComputationCache, insightsComputationCacheKey } from "../dist/server/insights-cache.js";

/** Strips ANSI escape sequences so assertions see the plain text a non-TTY consumer would. */
function stripAnsi(text) {
  return text.replace(/\[[0-9;]*m/g, "");
}

/** Builds a Finding fixture with sensible defaults, overridable per test. */
function finding(overrides = {}) {
  return {
    generator: "recurring-long-commands",
    subject: "npm run test",
    title: "npm run test ran 153x, median 32s, total 1.7h",
    costMs: 1.7 * 60 * 60_000,
    costTokens: 210_340,
    costTokensEstimated: true,
    evidence: [{ conversationId: "conv-1", sessionId: "sess-1" }],
    remedy: "document-command",
    fingerprint: "aaaa000000000001",
    repo: "/Users/x/Projects/otto-tangent",
    projectLabel: "otto-tangent",
    ...overrides
  };
}

/** Builds a list of `count` findings with descending cost and unique hex fingerprints. */
function findingList(count) {
  return Array.from({ length: count }, (_, index) => finding({
    title: `command-${index + 1} ran ${100 - index}x`,
    costMs: (count - index) * 60_000,
    fingerprint: `f${String(index + 1).padStart(3, "0")}${"0".repeat(12)}`
  }));
}

/** Builds a minimal AgentTimeDistribution fixture from label/ms pairs. */
function distribution(pairs) {
  const totalMs = pairs.reduce((total, [, ms]) => total + ms, 0);
  return {
    totalMs,
    categories: pairs.map(([key, ms, label]) => ({ key, label: label || key, ms, fraction: totalMs ? ms / totalMs : 0 }))
  };
}

/** Default render options for list tests: plain output, fixed width, default limit. */
function listOptions(overrides = {}) {
  return {
    scopeLabel: "all projects",
    windowDays: 30,
    limit: 10,
    excludedEvalRuns: 0,
    columns: 100,
    color: false,
    ...overrides
  };
}

/** Builds a minimal NormalizedConversation fixture whose repo cwd can be pointed at an eval sandbox. */
function conversationAt(conversationId, cwd) {
  return {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId,
    repo: { root: cwd, cwd },
    messages: [],
    totals: { userMessages: 0, assistantMessages: 0, toolCalls: 0 },
    caveats: []
  };
}

test("renderInsightsList caps rows at the limit and points to --all in the footer", () => {
  const findings = findingList(34);
  const output = renderInsightsList(findings, distribution([["executing", 60_000]]), listOptions());
  const lines = output.split("\n");

  assert.match(lines[0], /^INSIGHTS {2}all projects · last 30 days · agent time 1m \(executing 100%\)$/);
  assert.equal(lines[1], "Estimates, not measurements.");
  assert.equal(lines[2], "");
  const rows = lines.slice(3, lines.length - 2);
  assert.equal(rows.length, 10, "the default view shows exactly 10 rows");
  assert.match(rows[0], /^ 1 {2}34m {2}command-1 ran 100x/);
  assert.match(rows[9], /^10 {2}25m {2}command-10 ran 91x/);
  assert.equal(lines.at(-1), "10 of 34 findings · tangent usage insights show 1 · park 1 · --all");
});

test("renderInsightsList with no limit shows every finding and drops the --all hint", () => {
  const findings = findingList(12);
  const output = renderInsightsList(findings, distribution([["executing", 60_000]]), listOptions({ limit: undefined }));
  const lines = output.split("\n");
  assert.equal(lines.length - 5, 12, "all 12 findings render");
  assert.equal(lines.at(-1), "12 findings · tangent usage insights show 1 · park 1");
});

test("renderInsightsList rows carry remedy tag and project label but never fingerprints, evidence, or remedy sentences", () => {
  const output = renderInsightsList([finding()], distribution([["executing", 60_000]]), listOptions({ limit: 10 }));
  assert.match(output, /document command/);
  assert.match(output, /otto-tangent/);
  assert.doesNotMatch(output, /aaaa000000000001/, "fingerprints stay out of the list view");
  assert.doesNotMatch(output, /tangent mark --session/, "evidence stays out of the list view");
  assert.doesNotMatch(output, /cache the result/, "the full remedy sentence stays out of the list view");
});

test("renderInsightsList notes the eval sandbox exclusion count only when sessions were excluded", () => {
  const findings = [finding()];
  const dist = distribution([["executing", 60_000]]);
  const withExcluded = renderInsightsList(findings, dist, listOptions({ excludedEvalRuns: 12 }));
  assert.match(withExcluded, /12 eval sandbox sessions excluded\. Estimates, not measurements\./);
  const withoutExcluded = renderInsightsList(findings, dist, listOptions({ excludedEvalRuns: 0 }));
  assert.doesNotMatch(withoutExcluded, /eval sandbox/);
  assert.match(withoutExcluded, /Estimates, not measurements\./);
});

test("renderInsightsList orders header distribution shares by size and only includes served categories", () => {
  const dist = distribution([
    ["findingInfo", 17_000, "finding info"],
    ["executing", 38_000, "executing"],
    ["other", 34_000, "other tools"],
    ["writing", 11_000, "writing"]
  ]);
  const header = renderInsightsList([finding()], dist, listOptions()).split("\n")[0];
  assert.match(header, /\(executing 38% · other tools 34% · finding info 17% · writing 11%\)$/);
});

test("renderInsightsList truncates titles to the terminal width", () => {
  const long = finding({ title: `neara push ${"x".repeat(200)} end` });
  const output = renderInsightsList([long], distribution([["executing", 60_000]]), listOptions({ columns: 80 }));
  const row = output.split("\n")[3];
  assert.ok(row.length <= 80, `row must fit in 80 columns, got ${row.length}`);
  assert.match(row, /…/);
  assert.doesNotMatch(row, /end/, "the tail of an over-long title is cut, not wrapped");
});

test("renderInsightsList colors only when asked, and the colored output strips back to the plain one", () => {
  const findings = findingList(3);
  const dist = distribution([["executing", 60_000]]);
  const plain = renderInsightsList(findings, dist, listOptions());
  const colored = renderInsightsList(findings, dist, listOptions({ color: true }));
  assert.doesNotMatch(plain, /\[/, "non-TTY output carries no ANSI codes");
  assert.match(colored, /\[1m/, "TTY output bolds the cost column");
  assert.match(colored, /\[2m/, "TTY output dims the meta");
  assert.equal(stripAnsi(colored).replace(/ +$/gm, ""), plain.replace(/ +$/gm, ""));
});

test("renderFindingDetail prints the full remedy sentence, est-labeled tokens, capped evidence, and the fingerprint last", () => {
  const evidence = Array.from({ length: 13 }, (_, index) => ({ conversationId: `conv-${index}`, sessionId: `sess-${index}` }));
  const detail = renderFindingDetail(finding({ evidence }), { color: false });
  const lines = detail.split("\n");

  assert.equal(lines[0], "npm run test ran 153x, median 32s, total 1.7h");
  assert.match(detail, /cost {7}1\.7h · est\. 210,340 tokens/);
  assert.match(detail, /remedy {5}document the correct scoped invocation in CLAUDE\.md, or cache the result/);
  assert.match(detail, /project {4}otto-tangent/);
  assert.match(detail, /generator {2}recurring-long-commands/);
  assert.equal(detail.match(/tangent mark --session /g).length, 10, "evidence is capped at 10 sessions");
  assert.match(detail, /\+3 more sessions/);
  assert.equal(lines.at(-1), "aaaa000000000001", "the fingerprint closes the detail view for scripting");
});

test("resolveFindingRef resolves 1-based indexes against the visible ordering and rejects out-of-range ones", () => {
  const visible = findingList(3);
  assert.equal(resolveFindingRef("1", visible, visible), visible[0]);
  assert.equal(resolveFindingRef("3", visible, visible), visible[2]);
  assert.throws(() => resolveFindingRef("0", visible, visible), /out of range/);
  assert.throws(() => resolveFindingRef("4", visible, visible), /out of range/);
});

test("resolveFindingRef resolves full and unique-prefix fingerprints against all findings, including parked ones", () => {
  const parked = finding({ fingerprint: "beef000000000001" });
  const visible = findingList(2);
  const all = [...visible, parked];
  assert.equal(resolveFindingRef("beef000000000001", visible, all), parked);
  assert.equal(resolveFindingRef("beef", visible, all), parked);
  assert.equal(resolveFindingRef("f001", visible, all), visible[0]);
  assert.throws(() => resolveFindingRef("f0", visible, all), /ambiguous/);
  assert.throws(() => resolveFindingRef("dead", visible, all), /No finding matches/);
});

test("partitionEvalRunConversations drops and counts eval sandbox sessions, and --include-eval-runs opts back in", () => {
  const real = conversationAt("real-1", "/Users/x/Projects/otto-tangent");
  const evalRunA = conversationAt("eval-1", "/Users/x/.tangent/eval/runs/r1/worktree");
  const evalRunB = conversationAt("eval-2", "/Users/x/.tangent/eval/runs/r2/worktree");

  const filtered = partitionEvalRunConversations([real, evalRunA, evalRunB], { includeEvalRuns: false });
  assert.deepEqual(filtered.conversations.map((c) => c.conversationId), ["real-1"]);
  assert.equal(filtered.excludedEvalRuns, 2);

  const included = partitionEvalRunConversations([real, evalRunA, evalRunB], { includeEvalRuns: true });
  assert.equal(included.conversations.length, 3);
  assert.equal(included.excludedEvalRuns, 0, "nothing was hidden, so nothing is reported as excluded");
});

test("insights computation cache serves entries within the TTL and recomputes after it, keyed on every window input", () => {
  let clock = 1_000_000;
  /** Reads the test's fake clock, injected so the test drives TTL expiry without sleeping. */
  const now = () => clock;
  const cache = createInsightsComputationCache({ ttlMs: 120_000, now });
  const key = insightsComputationCacheKey({ repo: ".", scope: "all", days: 30, includeEvalRuns: false });
  const value = { findings: [], distribution: { totalMs: 0, categories: [] }, computedAt: "2026-07-06T10:00:00.000Z", excludedEvalRuns: 0 };

  assert.equal(cache.get(key), undefined, "a cold cache misses");
  cache.set(key, value);
  clock += 119_999;
  assert.equal(cache.get(key), value, "an entry just inside the TTL is served");
  clock += 1;
  assert.equal(cache.get(key), undefined, "an entry at the TTL boundary expires");

  cache.set(key, value);
  const otherKeys = [
    insightsComputationCacheKey({ repo: "/some/repo", scope: "repo", days: 30, includeEvalRuns: false }),
    insightsComputationCacheKey({ repo: ".", scope: "all", days: 7, includeEvalRuns: false }),
    insightsComputationCacheKey({ repo: ".", scope: "all", days: 30, includeEvalRuns: true })
  ];
  for (const otherKey of otherKeys) {
    assert.notEqual(otherKey, key, "each window input participates in the key");
    assert.equal(cache.get(otherKey), undefined, "a different window never reuses another window's computation");
  }
});

test("FINDING_REMEDY_TAGS covers every remedy with a compact tag", () => {
  const remedies = ["missing-map", "split-or-map-file", "structural-search", "document-command", "document-invocation"];
  for (const remedy of remedies) {
    const tag = FINDING_REMEDY_TAGS[remedy];
    assert.equal(typeof tag, "string");
    assert.ok(tag.length > 0 && tag.split(" ").length <= 2, `tag for ${remedy} must be one or two words`);
  }
});
