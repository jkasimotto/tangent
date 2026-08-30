import assert from "node:assert/strict";
import test from "node:test";

import { runGoalCli, runHandoverCli } from "../dist/cli/index.js";

const report = {
  type: "implementation-result",
  status: "complete",
  summary: "The production path is complete.",
  evidenceRefs: ["commit:abc123"],
  problems: [],
  nextNeed: null,
};

/** Runs either public handover command with the same worker identity. */
function runCommand(kind, extra) {
  return kind === "handover"
    ? runHandoverCli(["Finished the assignment.", "--session", "worker-portland", ...extra])
    : runGoalCli(["handover", "Finished the assignment.", "--session", "worker-portland", ...extra]);
}

const hint = 'tangent handover is now tangent send brain "<note>" [--done|--blocked]';

test("both worker handover commands submit the same typed report, print the send hint, then the durable destination", async (context) => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const lines = [];
  console.log = (line) => lines.push(String(line));
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init.body)) });
    return Response.json({
      status: "reported",
      receipt: {
        destinationArea: "neara/portland",
        queue: { revisionAfter: 7 },
        notice: { id: "notice-7" },
      },
    });
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });

  for (const kind of ["handover", "goal-handover"]) {
    await runCommand(kind, ["--report", JSON.stringify(report)]);
  }

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.path, "/api/goals/handover");
    assert.deepEqual(request.body, {
      session: "worker-portland",
      text: "Finished the assignment.",
      report,
    });
  }
  assert.deepEqual(lines, [
    hint,
    "reported to neara/portland brain; queue revision 7; notice notice-7",
    hint,
    "reported to neara/portland brain; queue revision 7; notice notice-7",
  ]);
});

test("both worker handover commands reject missing, truncated, and shell-quoted reports before HTTP", async (context) => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("HTTP must not run for a damaged report");
  };
  context.after(() => { globalThis.fetch = previousFetch; });
  const damaged = [
    ["--report"],
    ["--report", ""],
    ["--report", '{"type":"implementation-result"'],
    ["--report", `'${JSON.stringify(report)}'`],
  ];

  for (const kind of ["handover", "goal-handover"]) {
    for (const args of damaged) {
      await assert.rejects(
        () => runCommand(kind, args),
        /Retry with --report '<one complete JSON object>'.*Nothing was submitted\./,
      );
    }
  }
  assert.equal(requests, 0);
});

test("both worker handover commands surface a server rejection as a failed command", async (context) => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "The typed report was rejected (report-summary-required). Correct --report and retry the same handover. Tangent recorded no report or brain notice.",
  }, { status: 409 });
  context.after(() => { globalThis.fetch = previousFetch; });

  for (const kind of ["handover", "goal-handover"]) {
    await assert.rejects(
      () => runCommand(kind, ["--report", JSON.stringify(report)]),
      /report-summary-required.*recorded no report or brain notice/,
    );
  }
});
