import assert from "node:assert/strict";
import test from "node:test";
import { filterGoalSummaries, hasGoalQueryFilters, goalQueryFilters, queryTerms, recencyBound } from "./goal-query-filters.mjs";

const NOW = Date.parse("2026-08-27T00:00:00.000Z");

test("a recency bound reads a window or a date, and refuses anything else", () => {
  assert.equal(recencyBound("", NOW), null);
  assert.equal(recencyBound("30d", NOW), NOW - 30 * 86_400_000);
  assert.equal(recencyBound("12h", NOW), NOW - 12 * 3_600_000);
  assert.equal(recencyBound("2w", NOW), NOW - 14 * 86_400_000);
  assert.equal(recencyBound("90m", NOW), NOW - 90 * 60_000);
  assert.equal(recencyBound("2026-08-01", NOW), Date.parse("2026-08-01"));
  // A filter that silently matched everything would report the opposite of
  // what it was asked, so unreadable text is an error.
  assert.throws(() => recencyBound("soon", NOW), /not a recency window/);
});

test("query words are alternatives, deduplicated and lowercased", () => {
  assert.deepEqual(queryTerms("241 250 241"), ["241", "250"]);
  assert.deepEqual(queryTerms("  Rules  24X "), ["rules", "24x"]);
  assert.deepEqual(queryTerms(""), []);
});

test("the three filters narrow one Goal listing", () => {
  const goals = [
    { slug: "rules-241", title: "Rules 241", doneWhen: "It ships", area: "neara/portland", status: "done", changedAt: NOW - 86_400_000 },
    { slug: "rules-250", title: "Rules 250", doneWhen: "It ships", area: "neara/portland", status: "open", changedAt: NOW - 60 * 86_400_000 },
    { slug: "other", title: "Something else", doneWhen: "It ships", area: "neara/portland", status: "open", changedAt: NOW - 3_600_000 },
  ];
  assert.deepEqual(filterGoalSummaries(goals, { status: ["done"] }, NOW).map((goal) => goal.slug), ["rules-241"]);
  assert.deepEqual(filterGoalSummaries(goals, { status: ["Open"] }, NOW).map((goal) => goal.slug), ["rules-250", "other"]);
  assert.deepEqual(filterGoalSummaries(goals, { changedSince: "30d" }, NOW).map((goal) => goal.slug), ["rules-241", "other"]);
  assert.deepEqual(filterGoalSummaries(goals, { query: "241 250" }, NOW).map((goal) => goal.slug), ["rules-241", "rules-250"]);
  // The filters combine: recent, open, and about 250.
  assert.deepEqual(filterGoalSummaries(goals, { status: ["open"], changedSince: "30d", query: "250 else" }, NOW).map((goal) => goal.slug), ["other"]);
  assert.equal(filterGoalSummaries(goals, {}, NOW).length, 3);
  // A Goal with no recorded change time never satisfies a recency bound.
  assert.equal(filterGoalSummaries([{ slug: "unknown", status: "open" }], { changedSince: "30d" }, NOW).length, 0);
});

test("the shared filter record reports whether it narrows", () => {
  assert.equal(hasGoalQueryFilters(goalQueryFilters({})), false);
  assert.equal(hasGoalQueryFilters(goalQueryFilters({ status: ["  "] })), false);
  assert.equal(hasGoalQueryFilters(goalQueryFilters({ query: " 241 " })), true);
  assert.deepEqual(goalQueryFilters({ status: [" done ", ""], changedSince: " 30d ", query: " 241 " }), {
    status: ["done"], changedSince: "30d", query: "241",
  });
});
