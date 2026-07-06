import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeAgentTimeDistribution,
  extractCommandText,
  failureRetryLoops,
  findingFingerprint,
  globalInsightsParkStatePath,
  infoFindingHeavySessions,
  isEvalRunConversation,
  isParked,
  loadParkState,
  normalizeCommandHead,
  parkFinding,
  PARK_RESURFACE_GROWTH_THRESHOLD,
  recurringLongCommands,
  reReadChurnAndHotFiles,
  repoInsightsParkStatePath,
  runInsightGenerators,
  saveParkState,
  unparkFinding
} from "../dist/core/insights/index.js";

/** Builds a minimal NormalizedToolCall fixture. */
function toolCall(overrides) {
  return {
    id: overrides.id || "call",
    name: overrides.name || "Tool",
    category: overrides.category,
    input: overrides.input,
    targetPaths: overrides.targetPaths || [],
    evidenceEventIds: [],
    result: overrides.result
  };
}

/** Builds a minimal assistant NormalizedConversationMessage fixture with the given tool calls. */
function assistantMessage(id, overrides = {}) {
  return {
    id,
    role: "assistant",
    at: overrides.at,
    text: overrides.text || "",
    toolCalls: overrides.toolCalls || [],
    confidence: "exact"
  };
}

/** Builds a minimal NormalizedConversation fixture from a list of assistant messages. */
function conversation(conversationId, messages, overrides = {}) {
  return {
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId,
    providerSessionId: overrides.providerSessionId || conversationId,
    transcriptPath: overrides.transcriptPath,
    repo: { root: overrides.repo ?? "/repo/polez", cwd: overrides.cwd },
    messages,
    totals: { userMessages: 0, assistantMessages: messages.length, toolCalls: 0 },
    caveats: []
  };
}

test("infoFindingHeavySessions ranks a session by read+search time before its first write", () => {
  const heavySession = conversation("conv-1", [
    assistantMessage("m1", {
      toolCalls: [
        toolCall({ id: "r1", category: "read", targetPaths: ["src/a.ts"], result: { status: "success", durationMs: 40_000, outputPreview: "x".repeat(400) } }),
        toolCall({ id: "r2", category: "read", targetPaths: ["src/util.ts"], result: { status: "success", durationMs: 20_000, outputPreview: "y".repeat(200) } }),
        toolCall({ id: "s1", category: "search", targetPaths: [], result: { status: "success", durationMs: 10_000, outputPreview: "z".repeat(80) } })
      ]
    }),
    assistantMessage("m2", {
      toolCalls: [toolCall({ id: "w1", category: "write", targetPaths: ["src/util.ts"], result: { status: "success", durationMs: 5_000 } })]
    }),
    assistantMessage("m3", {
      text: "Done, updated src/util.ts.",
      toolCalls: [toolCall({ id: "r3", category: "read", targetPaths: ["src/should-not-count.ts"], result: { status: "success", durationMs: 999_999 } })]
    })
  ]);

  const findings = infoFindingHeavySessions([heavySession]);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.generator, "info-finding-heavy-sessions");
  assert.equal(finding.costMs, 70_000, "reads after the first write must not count");
  assert.equal(finding.costTokens, 170);
  assert.equal(finding.costTokensEstimated, true);
  assert.equal(finding.remedy, "missing-map", "mostly-read sessions point at a missing map, not a search tool");
  assert.match(finding.title, /before the first write/);
  assert.equal(finding.projectLabel, "polez", "projectLabel is the basename of the conversation's repo root");
  assert.match(finding.title, /^One session in polez spent/, "title leads with a project-scoped session phrase, not a raw id");
  assert.ok(!finding.title.includes("conv-1"), "title must never leak the conversation id");
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].conversationId, "conv-1");

  const files = finding.detail.files;
  assert.equal(files.length, 2, "the write-target file and the search call (no target path) do not both count as a third file");
  const util = files.find((file) => file.path === "src/util.ts");
  const a = files.find((file) => file.path === "src/a.ts");
  assert.equal(util.downstreamUse, true, "later written -> downstream use");
  assert.equal(a.downstreamUse, false, "never written or referenced again -> no downstream use");
});

test("infoFindingHeavySessions points at structural search when the time was mostly search calls", () => {
  const searchHeavy = conversation("conv-2", [
    assistantMessage("m1", {
      toolCalls: [
        toolCall({ id: "s1", category: "search", targetPaths: [], result: { status: "success", durationMs: 50_000 } }),
        toolCall({ id: "r1", category: "read", targetPaths: ["src/b.ts"], result: { status: "success", durationMs: 10_000 } })
      ]
    })
  ]);
  const [finding] = infoFindingHeavySessions([searchHeavy]);
  assert.equal(finding.remedy, "structural-search");
  assert.match(finding.title, /no write ever happened/);
});

test("infoFindingHeavySessions drops sessions under the cost floor", () => {
  const light = conversation("conv-3", [
    assistantMessage("m1", { toolCalls: [toolCall({ id: "r1", category: "read", targetPaths: ["src/c.ts"], result: { status: "success", durationMs: 5_000 } })] })
  ]);
  assert.deepEqual(infoFindingHeavySessions([light]), []);
});

test("recurringLongCommands groups execute calls by normalized command head and drops one-off runs", () => {
  const runs = [300_000, 200_000, 500_000].map((durationMs, index) =>
    conversation(`conv-cmd-${index}`, [
      assistantMessage("m1", {
        toolCalls: [toolCall({
          id: `c${index}`,
          category: "command",
          input: { command: "dart analyze lib/client --fatal-infos" },
          result: { status: "success", durationMs }
        })]
      })
    ])
  );
  const oneOff = conversation("conv-cmd-oneoff", [
    assistantMessage("m1", {
      toolCalls: [toolCall({ id: "c-oneoff", category: "command", input: { command: "ls -la" }, result: { status: "success", durationMs: 1_000 } })]
    })
  ]);

  const findings = recurringLongCommands([...runs, oneOff]);
  assert.equal(findings.length, 1, "the one-off ls run must not clear the noise floor");
  const [finding] = findings;
  assert.equal(finding.subject, "dart analyze");
  assert.equal(finding.costMs, 1_000_000);
  assert.equal(finding.detail.count, 3);
  assert.equal(finding.detail.medianMs, 300_000);
  assert.equal(finding.detail.maxMs, 500_000);
  assert.equal(finding.evidence.length, 3);
  assert.equal(finding.remedy, "document-command");
  assert.equal(finding.projectLabel, "polez", "cross-conversation findings get a projectLabel when every run shares one repo root");
});

test("recurringLongCommands renders sub-minute medians in seconds and omits a sub-1s median clause entirely", () => {
  const secondsMedian = conversation("conv-cmd-seconds", [
    assistantMessage("m1", {
      toolCalls: [45_000, 46_000, 47_000].map((durationMs, index) =>
        toolCall({ id: `sec-${index}`, category: "command", input: { command: "dart analyze lib/client" }, result: { status: "success", durationMs } })
      )
    })
  ]);
  const [secondsFinding] = recurringLongCommands([secondsMedian]);
  assert.equal(secondsFinding.title, "dart analyze ran 3x, median 46s, total 2m", "a sub-minute median renders in seconds, not a rounded-down 0m");

  const tinyMedian = conversation("conv-cmd-tiny", [
    assistantMessage("m1", {
      toolCalls: [200, 200, 5_000].map((durationMs, index) =>
        toolCall({ id: `tiny-${index}`, category: "command", input: { command: "git status" }, result: { status: "success", durationMs } })
      )
    })
  ]);
  const [tinyFinding] = recurringLongCommands([tinyMedian]);
  assert.ok(!tinyFinding.title.includes("median"), "a sub-1s median is omitted entirely rather than shown as a rounded-down 0m");
  assert.equal(tinyFinding.title, "git status ran 3x, total 5s");
});

test("reReadChurnAndHotFiles flags same-session re-reads as churn and cross-session reads as hot files", () => {
  const churnCalls = Array.from({ length: 4 }, (_, index) =>
    toolCall({ id: `churn-${index}`, category: "read", targetPaths: ["src/big.ts"], result: { status: "success", durationMs: 10_000 } })
  );
  /** Builds two reads of the same doc file for the given session, to simulate a cross-session hot file. */
  const hotFileCallsFor = (sessionIndex) => Array.from({ length: 2 }, (_, index) =>
    toolCall({ id: `hot-${sessionIndex}-${index}`, category: "read", targetPaths: ["docs/index.md"], result: { status: "success", durationMs: 1_000 } })
  );

  const conversations = [
    conversation("conv-churn", [assistantMessage("m1", { toolCalls: [...churnCalls, ...hotFileCallsFor("a")] })]),
    conversation("conv-hot-b", [assistantMessage("m1", { toolCalls: hotFileCallsFor("b") })]),
    conversation("conv-hot-c", [assistantMessage("m1", { toolCalls: hotFileCallsFor("c") })])
  ];

  const findings = reReadChurnAndHotFiles(conversations);
  const churn = findings.find((finding) => finding.detail.path === "src/big.ts");
  const hot = findings.find((finding) => finding.subject === "docs/index.md");

  assert.ok(churn, "4 reads of the same file in one session must produce a churn finding");
  assert.equal(churn.costMs, 40_000);
  assert.equal(churn.remedy, "split-or-map-file");
  assert.equal(churn.evidence.length, 1);
  assert.equal(churn.projectLabel, "polez", "projectLabel is the basename of the conversation's repo root");
  assert.match(churn.title, /^A polez session re-read src\/big\.ts/, "title uses a project-scoped session phrase, not a raw id");
  assert.ok(!churn.title.includes("conv-churn"), "title must never leak the conversation id");

  assert.ok(hot, "docs/index.md read 6x across 3 sessions must produce a hot-file finding");
  assert.equal(hot.detail.readCount, 6);
  assert.equal(hot.detail.sessionCount, 3);
  assert.equal(hot.remedy, "missing-map");
  assert.equal(hot.evidence.length, 3);
  assert.equal(hot.projectLabel, "polez", "cross-session findings get a projectLabel when all evidence shares one repo root");
});

test("reReadChurnAndHotFiles relativizes absolute paths against the repo root and ellipsis-truncates paths outside it", () => {
  const insideRoot = conversation("conv-inside", [
    assistantMessage("m1", {
      toolCalls: Array.from({ length: 3 }, (_, index) =>
        toolCall({ id: `in-${index}`, category: "read", targetPaths: ["/repo/polez/src/deep/nested/util.ts"], result: { status: "success", durationMs: 1_000 } })
      )
    })
  ], { repo: "/repo/polez" });
  const [insideFinding] = reReadChurnAndHotFiles([insideRoot]);
  assert.equal(insideFinding.title.includes("/repo/polez"), false, "absolute repo-root prefix must never appear in the title");
  assert.match(insideFinding.title, /re-read src\/deep\/nested\/util\.ts /, "a path inside the repo root renders relative to it");

  const outsideRoot = conversation("conv-outside", [
    assistantMessage("m1", {
      toolCalls: Array.from({ length: 3 }, (_, index) =>
        toolCall({ id: `out-${index}`, category: "read", targetPaths: ["/Users/other/somewhere/deep/file.ts"], result: { status: "success", durationMs: 1_000 } })
      )
    })
  ], { repo: "/repo/polez" });
  const [outsideFinding] = reReadChurnAndHotFiles([outsideRoot]);
  assert.ok(!outsideFinding.title.includes("/Users/other"), "an absolute path outside the repo root must not leak in full");
  assert.match(outsideFinding.title, /re-read …\/somewhere\/deep\/file\.ts /, "a path outside the repo root shows only its last three segments, ellipsis-prefixed");
});

test("reReadChurnAndHotFiles does not flag a file read only twice in one session and nowhere else", () => {
  const conversations = [
    conversation("conv-quiet", [
      assistantMessage("m1", {
        toolCalls: [
          toolCall({ id: "q1", category: "read", targetPaths: ["src/quiet.ts"], result: { status: "success", durationMs: 1_000 } }),
          toolCall({ id: "q2", category: "read", targetPaths: ["src/quiet.ts"], result: { status: "success", durationMs: 1_000 } })
        ]
      })
    ])
  ];
  assert.deepEqual(reReadChurnAndHotFiles(conversations), []);
});

test("failureRetryLoops detects an error-then-retry chain grouped by command head", () => {
  const failing = conversation("conv-retry", [
    assistantMessage("m1", {
      at: "2026-07-05T10:00:00.000Z",
      toolCalls: [toolCall({ id: "f1", category: "command", input: { command: "dart test foo" }, result: { status: "error", durationMs: 5_000 } })]
    }),
    assistantMessage("m2", {
      at: "2026-07-05T10:01:00.000Z",
      toolCalls: [toolCall({ id: "f2", category: "command", input: { command: "dart test foo" }, result: { status: "error", durationMs: 6_000 } })]
    }),
    assistantMessage("m3", {
      at: "2026-07-05T10:02:00.000Z",
      toolCalls: [toolCall({ id: "f3", category: "command", input: { command: "dart test foo" }, result: { status: "success", durationMs: 4_000 } })]
    })
  ]);
  const noRetry = conversation("conv-single-fail", [
    assistantMessage("m1", {
      at: "2026-07-05T10:00:00.000Z",
      toolCalls: [toolCall({ id: "g1", category: "command", input: { command: "npm run lint" }, result: { status: "error", durationMs: 2_000 } })]
    })
  ]);

  const findings = failureRetryLoops([failing, noRetry]);
  assert.equal(findings.length, 1, "a single unretried failure must not produce a finding");
  const [finding] = findings;
  assert.equal(finding.subject, "dart test", "command head keeps only the first two meaningful tokens");
  assert.equal(finding.detail.failures, 2);
  assert.equal(finding.detail.retries, 2);
  assert.equal(finding.costMs, 15_000);
  assert.equal(finding.remedy, "document-invocation");
  assert.equal(finding.projectLabel, "polez", "cross-conversation findings get a projectLabel when every retry loop shares one repo root");
});

test("failureRetryLoops omits a sub-1s median burn clause and renders sub-minute medians in seconds otherwise", () => {
  const tinyBurn = conversation("conv-retry-tiny", [
    assistantMessage("m1", {
      at: "2026-07-05T10:00:00.000Z",
      toolCalls: [toolCall({ id: "t1", category: "command", input: { command: "npm test" }, result: { status: "error", durationMs: 200 } })]
    }),
    assistantMessage("m2", {
      at: "2026-07-05T10:00:05.000Z",
      toolCalls: [toolCall({ id: "t2", category: "command", input: { command: "npm test" }, result: { status: "error", durationMs: 200 } })]
    }),
    assistantMessage("m3", {
      at: "2026-07-05T10:00:10.000Z",
      toolCalls: [toolCall({ id: "t3", category: "command", input: { command: "npm test" }, result: { status: "success", durationMs: 300 } })]
    })
  ]);
  const [tinyFinding] = failureRetryLoops([tinyBurn]);
  assert.ok(!tinyFinding.title.includes("median"), "a sub-1s median burn is omitted rather than shown as a rounded-down 0m");
  assert.match(tinyFinding.title, /burning <1s$/);

  const secondsBurn = conversation("conv-retry-seconds", [
    assistantMessage("m1", {
      at: "2026-07-05T10:00:00.000Z",
      toolCalls: [toolCall({ id: "s1", category: "command", input: { command: "dart test foo" }, result: { status: "error", durationMs: 20_000 } })]
    }),
    assistantMessage("m2", {
      at: "2026-07-05T10:00:10.000Z",
      toolCalls: [toolCall({ id: "s2", category: "command", input: { command: "dart test foo" }, result: { status: "success", durationMs: 25_000 } })]
    })
  ]);
  const [secondsFinding] = failureRetryLoops([secondsBurn]);
  assert.match(secondsFinding.title, /median 45s, burning 45s$/, "a single retry loop's median equals its own cost, rendered in seconds");
});

test("failureRetryLoops does not chain retries that happen well outside the retry window", () => {
  const farApart = conversation("conv-far", [
    assistantMessage("m1", {
      at: "2026-07-05T10:00:00.000Z",
      toolCalls: [toolCall({ id: "h1", category: "command", input: { command: "dart test bar" }, result: { status: "error", durationMs: 3_000 } })]
    }),
    assistantMessage("m2", {
      at: "2026-07-05T11:00:00.000Z",
      toolCalls: [toolCall({ id: "h2", category: "command", input: { command: "dart test bar" }, result: { status: "error", durationMs: 3_000 } })]
    })
  ]);
  assert.deepEqual(failureRetryLoops([farApart]), []);
});

test("normalizeCommandHead strips flags and paths, keeping runner script names", () => {
  assert.equal(normalizeCommandHead("dart analyze lib/client --fatal-infos"), "dart analyze");
  assert.equal(normalizeCommandHead("npm run build"), "npm run build");
  assert.equal(normalizeCommandHead("git commit -m 'fix bug'"), "git commit");
});

test("normalizeCommandHead strips leading cd-and-chain wrappers so the real command groups correctly", () => {
  assert.equal(normalizeCommandHead("cd /repo/polez && npm run build"), "npm run build");
  assert.equal(normalizeCommandHead("cd /repo/polez && dart analyze lib/client"), "dart analyze");
  assert.equal(normalizeCommandHead("cd /a && cd /b && dart analyze"), "dart analyze", "chained cd wrappers all strip");
  assert.equal(normalizeCommandHead("cd /repo/polez"), "cd", "a bare cd with no chained command is not stripped, but its path argument still is");
  assert.equal(normalizeCommandHead("cd /repo/polez; echo done"), "echo done", "semicolon-chained cd wrappers strip like && ones");
  assert.equal(normalizeCommandHead('cd "/My Repos/polez" && npm run test'), "npm run test", "quoted cd paths with spaces strip too");
});

test("normalizeCommandHead strips newline-separated leading cd wrappers so multi-line scripts group correctly", () => {
  assert.equal(normalizeCommandHead("cd /repo/polez\necho hi"), "echo hi", "a bare newline separates the cd from the real command in multi-line scripts");
  assert.equal(normalizeCommandHead("cd /repo/polez\r\nnpm run build"), "npm run build", "CRLF newlines strip too");
  assert.equal(normalizeCommandHead('cd "/My Repos/polez"\ndart analyze lib/client'), "dart analyze", "quoted cd paths followed by a newline strip too");
  assert.equal(normalizeCommandHead("cd /a\ncd /b && dart test integration"), "dart test", "mixed newline and && cd chains all strip");
  assert.equal(normalizeCommandHead("cd '/My Repos/polez'\ngit status"), "git status", "single-quoted cd paths followed by a newline strip too");
});

test("extractCommandText reads common provider input shapes", () => {
  assert.equal(extractCommandText("raw string"), "raw string");
  assert.equal(extractCommandText({ command: "ls -la" }), "ls -la");
  assert.equal(extractCommandText({ cmd: ["dart", "analyze"] }), "dart analyze");
  assert.equal(extractCommandText({ unrelated: true }), undefined);
});

test("findingFingerprint is stable for the same inputs and differs when any input changes", () => {
  const a = findingFingerprint("recurring-long-commands", "dart analyze", "/repo/polez");
  const b = findingFingerprint("recurring-long-commands", "dart analyze", "/repo/polez");
  const differentRepo = findingFingerprint("recurring-long-commands", "dart analyze", "/repo/other");
  const differentSubject = findingFingerprint("recurring-long-commands", "npm run build", "/repo/polez");
  assert.equal(a, b);
  assert.notEqual(a, differentRepo);
  assert.notEqual(a, differentSubject);
});

test("park state round-trips through disk and filters parked findings out of the feed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-insights-park-"));
  try {
    const filePath = path.join(dir, "park.json");
    const fingerprint = findingFingerprint("recurring-long-commands", "dart analyze", "/repo/polez");

    assert.deepEqual(await loadParkState(filePath), {}, "a missing park file loads as empty state, never throws");

    const parked = await parkFinding(filePath, fingerprint, 1_000_000, new Date("2026-07-05T00:00:00.000Z"));
    assert.equal(parked[fingerprint].costMsAtPark, 1_000_000);

    const reloaded = await loadParkState(filePath);
    assert.deepEqual(reloaded, parked, "state written to disk round-trips exactly");

    assert.equal(isParked(reloaded, fingerprint, 1_000_000), true);
    assert.equal(isParked(reloaded, fingerprint, 1_499_999), true, "just under the resurface threshold stays parked");
    assert.equal(isParked(reloaded, fingerprint, 1_500_000), false, `growth of ${PARK_RESURFACE_GROWTH_THRESHOLD * 100}% or more resurfaces the finding`);
    assert.equal(isParked(reloaded, "unknown-fingerprint", 999), false);

    const unparked = await unparkFinding(filePath, fingerprint);
    assert.equal(fingerprint in unparked, false);
    assert.deepEqual(await loadParkState(filePath), unparked);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runInsightGenerators ranks findings by cost descending and honors park state and generator filters", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "usage-insights-run-"));
  try {
    const heavySession = conversation("conv-run-1", [
      assistantMessage("m1", {
        toolCalls: [toolCall({ id: "r1", category: "read", targetPaths: ["src/a.ts"], result: { status: "success", durationMs: 90_000 } })]
      })
    ]);
    const runs = [300_000, 200_000, 500_000].map((durationMs, index) =>
      conversation(`conv-run-cmd-${index}`, [
        assistantMessage("m1", {
          toolCalls: [toolCall({ id: `c${index}`, category: "command", input: { command: "dart analyze" }, result: { status: "success", durationMs } })]
        })
      ])
    );
    const conversations = [heavySession, ...runs];

    const all = runInsightGenerators(conversations);
    assert.ok(all.length >= 2);
    for (let index = 1; index < all.length; index += 1) assert.ok(all[index - 1].costMs >= all[index].costMs, "findings must be ranked by cost descending");

    const onlyCommands = runInsightGenerators(conversations, { generators: ["recurring-long-commands"] });
    assert.ok(onlyCommands.every((finding) => finding.generator === "recurring-long-commands"));

    const commandFinding = onlyCommands[0];
    const filePath = path.join(dir, "park.json");
    const parkState = await parkFinding(filePath, commandFinding.fingerprint, commandFinding.costMs);

    const withParkFiltered = runInsightGenerators(conversations, { parkState });
    assert.ok(!withParkFiltered.some((finding) => finding.fingerprint === commandFinding.fingerprint), "a parked finding at the same cost must not resurface");

    const withParkIncluded = runInsightGenerators(conversations, { parkState, includeParked: true });
    assert.ok(withParkIncluded.some((finding) => finding.fingerprint === commandFinding.fingerprint));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("park-state paths are scoped correctly and never touch the real usage home", () => {
  const baseDir = "/tmp/fixture-usage-home";
  assert.equal(globalInsightsParkStatePath(baseDir), path.join(baseDir, "global", "insights", "park.json"));
  const repoPath = repoInsightsParkStatePath("/repo/polez", baseDir);
  assert.match(repoPath, /repos[\\/].+[\\/]insights[\\/]park\.json$/);
});

test("isEvalRunConversation detects Tangent eval sandbox sessions by cwd, root, or transcript path", () => {
  const byCwd = conversation("conv-eval-cwd", [], { cwd: "/Users/x/.tangent/eval/runs/r1/worktrees/v1" });
  const byRoot = conversation("conv-eval-root", [], { repo: "/Users/x/.tangent/eval/runs/r1/worktrees/v1" });
  const byTranscript = conversation("conv-eval-transcript", [], { transcriptPath: "/Users/x/.tangent/eval/runs/r1/logs/t.jsonl" });
  const real = conversation("conv-real", [], { repo: "/Users/x/repo/polez", cwd: "/Users/x/repo/polez/packages", transcriptPath: "/Users/x/.claude/projects/p/t.jsonl" });

  assert.equal(isEvalRunConversation(byCwd), true);
  assert.equal(isEvalRunConversation(byRoot), true);
  assert.equal(isEvalRunConversation(byTranscript), true);
  assert.equal(isEvalRunConversation(real), false, "an ordinary repo session is never treated as an eval run");
});

test("runInsightGenerators drops eval-run sandbox conversations before generators see them", () => {
  const evalRun = conversation("conv-eval-heavy", [
    assistantMessage("m1", {
      toolCalls: [toolCall({ id: "r1", category: "read", targetPaths: ["src/a.ts"], result: { status: "success", durationMs: 900_000 } })]
    })
  ], { repo: "/Users/x/.tangent/eval/runs/r1/worktrees/v1" });
  assert.deepEqual(runInsightGenerators([evalRun]), [], "eval sandbox activity must never surface as a finding about the user's workflow");
});

test("computeAgentTimeDistribution includes every nonzero bucket so shares sum to 1 and drops zero-ms categories", () => {
  const mixed = conversation("conv-dist", [
    assistantMessage("m1", {
      toolCalls: [
        toolCall({ id: "d1", category: "read", result: { status: "success", durationMs: 10_000 } }),
        toolCall({ id: "d2", category: "search", result: { status: "success", durationMs: 5_000 } }),
        toolCall({ id: "d3", category: "command", result: { status: "success", durationMs: 25_000 } }),
        toolCall({ id: "d4", category: "task", result: { status: "success", durationMs: 60_000 } })
      ]
    })
  ]);

  const distribution = computeAgentTimeDistribution([mixed]);
  assert.equal(distribution.totalMs, 100_000);

  const keys = distribution.categories.map((category) => category.key);
  assert.deepEqual(keys, ["findingInfo", "executing", "other"], "the zero-ms writing bucket is dropped and the hidden bucket surfaces as other");
  const other = distribution.categories.find((category) => category.key === "other");
  assert.equal(other.label, "other tools");
  assert.equal(other.ms, 60_000);
  const fractionSum = distribution.categories.reduce((total, category) => total + category.fraction, 0);
  assert.ok(Math.abs(fractionSum - 1) < 1e-9, "visible category shares must sum to 1.0, never a partial percentage");
});

test("computeAgentTimeDistribution returns no categories for an empty window", () => {
  const distribution = computeAgentTimeDistribution([]);
  assert.equal(distribution.totalMs, 0);
  assert.deepEqual(distribution.categories, []);
});

test("projectLabel falls back to the cwd basename when the repo root is unknown and stays unset without repo info", () => {
  /** Builds a heavy read-only session fixture with the given repo shape, so projectLabel resolution can be asserted per shape. */
  const heavySessionIn = (conversationId, repoShape) => ({
    schema: "usage.conversation.v1",
    provider: "claude",
    conversationId,
    providerSessionId: conversationId,
    repo: repoShape,
    messages: [
      assistantMessage("m1", {
        toolCalls: [toolCall({ id: "r1", category: "read", targetPaths: ["src/a.ts"], result: { status: "success", durationMs: 90_000 } })]
      })
    ],
    totals: { userMessages: 0, assistantMessages: 1, toolCalls: 1 },
    caveats: []
  });

  const [cwdOnly] = infoFindingHeavySessions([heavySessionIn("conv-cwd-only", { cwd: "/Users/x/repo/polez-pgande" })]);
  assert.equal(cwdOnly.projectLabel, "polez-pgande", "with no repo root the cwd basename is the project label");

  const [noRepo] = infoFindingHeavySessions([heavySessionIn("conv-no-repo", undefined)]);
  assert.equal(noRepo.projectLabel, undefined);
  assert.match(noRepo.title, /^One session spent /, "with no project label the phrase degrades gracefully");
});
