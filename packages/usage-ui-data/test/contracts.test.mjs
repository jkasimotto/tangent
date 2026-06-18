import assert from "node:assert/strict";
import test from "node:test";

import { buildSparkline, buildUsageCockpitView, buildUsageConversationView, buildUsageSessionTimelineView, createUsageApiClient, createUsageUiClient } from "../dist/index.js";

test("maps usage sessions into list view models", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists list. */
      list: async () => ({
        data: [{
          id: "s1",
          provider: "codex",
          title: "Implement UI",
          models: ["gpt"],
          metrics: { tokens: { total: 10, context: 8 }, durationMs: 25 },
          counts: { toolCalls: 2 },
          availability: { notes: ["partial"] }
        }],
        meta: { warnings: [] }
      })
    }
  });
  const view = await client.listSessions();
  assert.equal(view.sessions[0].title, "Implement UI");
  assert.equal(view.sessions[0].peakContext, 8, "list cards show peak context, not the cumulative token sum");
});

test("attaches a per-session flame series to list items from the timeline", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists one session for the flame-series test. */
      list: async () => ({ data: [{ id: "s1", provider: "codex", title: "Implement UI", models: ["gpt"], metrics: {}, counts: { messages: 2 }, availability: { notes: [] } }], meta: { warnings: [] } }),
      /** Returns a timeline with model, tool, and compaction steps. */
      timeline: async () => ({
        data: {
          items: [
            { id: "model", kind: "model_call", label: "Model call", durationMs: 10_000, metrics: { tokens: { total: 4_000 } } },
            { id: "tool", kind: "tool_call", label: "Tool", durationMs: 30_000, metrics: { tokens: { total: 200 } } },
            { id: "comp", kind: "compaction", label: "Compaction", durationMs: 1_000, metrics: {} }
          ]
        },
        meta: { warnings: [] }
      })
    }
  });
  const view = await client.listSessions();
  assert.ok(view.sessions[0].flame, "expected a flame series on the list item");
  assert.equal(view.sessions[0].flame.compactions, 1);
  assert.ok(view.sessions[0].flame.buckets.length > 0);
});

test("tolerates a missing timeline endpoint when listing sessions", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists one session without a timeline endpoint. */
      list: async () => ({ data: [{ id: "s1", provider: "codex", title: "Implement UI", metrics: {}, counts: { messages: 2 }, availability: { notes: [] } }], meta: { warnings: [] } })
    }
  });
  const view = await client.listSessions();
  assert.equal(view.sessions[0].flame, undefined);
});

test("drops empty placeholder sessions but keeps sessions with messages or tokens", async () => {
  const client = createUsageUiClient({
    sessions: {
      /** Lists a real session alongside an empty Claude title-stub. */
      list: async () => ({
        data: [
          { id: "real", provider: "claude", title: "Real work", metrics: { tokens: { total: 1200 } }, counts: { messages: 4 }, availability: { notes: [] } },
          { id: "stub", provider: "claude", title: "claude:abc-123", metrics: {}, counts: { messages: 0 }, availability: { notes: [] } }
        ],
        meta: { warnings: [] }
      })
    }
  });
  const view = await client.listSessions();
  assert.deepEqual(view.sessions.map((session) => session.id), ["real"]);
});

test("packs steps end-to-end and colours buckets by dominant kind", () => {
  const flame = buildSparkline([
    { id: "model", kind: "model_call", label: "Model", durationMs: 100_000, metrics: { tokens: { total: 5_000 } } },
    { id: "tool", kind: "tool_call", label: "Tool", durationMs: 100_000, metrics: { tokens: { total: 0 } } }
  ], 4);
  assert.equal(flame.buckets.length, 4);
  assert.equal(flame.buckets[0].kind, "model");
  assert.equal(flame.buckets[3].kind, "tool");
  assert.equal(flame.tokensTotal, 5_000);
});

test("browser API client fetches usage session views", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ sessions: [{ id: "s1", title: "Implement UI" }], caveats: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = createUsageApiClient("http://local");
    const view = await client.listSessions({ limit: 5 });
    assert.deepEqual(requests, ["http://local/api/usage/sessions?limit=5"]);
    assert.equal(view.sessions[0].title, "Implement UI");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("browser API client fetches minimal session timeline views", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      selected: { id: "s1", title: "Implement UI", provider: "codex", status: "complete", summaryLabel: "codex · complete" },
      picker: { query: "ui", results: [] },
      chart: { totalDurationMs: 1000, maxTokens: 10, widthPx: 1200, heightPx: 420, steps: [] }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = createUsageApiClient("http://local");
    const view = await client.getSessionTimelineView("s1", { query: "ui", limit: 5 });
    assert.deepEqual(requests, ["http://local/api/usage/sessions/s1/timeline-view?query=ui&limit=5"]);
    assert.equal(view.selected.title, "Implement UI");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("builds minimal timeline view with horizontal time semantics", () => {
  const view = buildUsageSessionTimelineView(
    {
      id: "s1",
      provider: "codex",
      title: "Implement UI",
      status: "completed",
      startedAt: "2026-06-15T10:00:00.000Z",
      endedAt: "2026-06-15T10:01:00.000Z",
      metrics: { durationMs: 60_000, tokens: { total: 1200, confidence: "provider-reported" } }
    },
    [
      { id: "later", kind: "command", label: "Command", offsetMs: 30_000, durationMs: 10_000, metrics: { tokens: { total: 200 } } },
      { id: "first", kind: "assistant_response", label: "Assistant response", offsetMs: 0, durationMs: 20_000, metrics: { tokens: { total: 1000 } } }
    ],
    { range: { durationMs: 60_000 }, items: [] }
  );

  assert.equal(view.selected.status, "complete");
  assert.equal(view.chart.totalDurationMs, 60_000);
  assert.equal(view.chart.maxTokens, 1000);
  assert.deepEqual(view.chart.steps.map((step) => step.id), ["first", "later"]);
  assert.equal(view.chart.steps[0].offsetMs, 0);
  assert.equal(view.chart.steps[1].durationMs, 10_000);
  assert.equal(view.chart.steps[1].tokens, 200);
});

test("builds minimal timeline warnings for partial timing and missing tokens", () => {
  const partialTiming = buildUsageSessionTimelineView(
    { id: "s1", provider: "codex", title: "Partial", metrics: {}, availability: { notes: [] } },
    [{ id: "step1", kind: "assistant_response", label: "Assistant response", metrics: { tokens: { total: 10 } } }]
  );
  const missingTokens = buildUsageSessionTimelineView(
    { id: "s2", provider: "codex", title: "No tokens", metrics: {}, availability: { notes: [] } },
    [{ id: "step1", kind: "command", label: "Command", durationMs: 10_000, metrics: {} }]
  );

  assert.equal(partialTiming.selected.warning, "Step timing is partial; bar positions are estimated.");
  assert.equal(missingTokens.selected.warning, "Token data is unavailable for this provider/session.");
  assert.equal(missingTokens.chart.steps[0].tokens, undefined);
});

test("builds conversation chart rows from assistant messages with internal step segments", () => {
  const view = buildUsageConversationView(
    {
      id: "s1",
      provider: "codex",
      title: "Implement UI",
      status: "completed",
      project: "otto-tangent",
      metrics: { durationMs: 60_000, tokens: { total: 1200 } },
      availability: { notes: [] }
    },
    [{
      id: "s1",
      provider: "codex",
      title: "Implement UI",
      status: "completed",
      project: "otto-tangent",
      metrics: { durationMs: 60_000, tokens: { total: 1200 } },
      availability: { notes: [] }
    }],
    [{
      id: "m1",
      role: "assistant",
      turnId: "turn1",
      stepId: "assistant",
      model: "gpt",
      textPreview: "Done",
      tokenUsage: { total: 1200, confidence: "provider-reported" },
      toolCalls: [{ id: "tool1", stepId: "tool", toolName: "exec", status: "success", result: { durationMs: 20_000 } }]
    }],
    [
      { id: "assistant", turnId: "turn1", kind: "assistant_response", label: "Assistant response", durationMs: 40_000, order: 1, metrics: {} },
      { id: "tool", turnId: "turn1", kind: "command", label: "exec", durationMs: 20_000, order: 2, metrics: {} }
    ]
  );

  assert.equal(view.projects[0].label, "otto-tangent");
  assert.equal(view.messages[0].tokenLabel, "1.2K");
  assert.equal(view.chart.rows[0].tokens, 1200);
  assert.equal(view.chart.rows[0].segments.length, 2);
  assert.equal(view.chart.rows[0].segments[0].heightShare > view.chart.rows[0].segments[1].heightShare, true);
});

test("labels command segments with the command that ran", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Commands", endedAt: "2026-06-16T10:01:00.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", turnId: "turn1", textPreview: "Working", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "slow", turnId: "turn1", kind: "command", label: "exec_command", startedAt: "2026-06-16T10:00:08.000Z", durationMs: 40_000, order: 1, metrics: {} }
    ],
    { toolCalls: [{ id: "tool1", stepId: "slow", toolName: "exec_command", status: "success", input: { cmd: "npm run build" }, result: { durationMs: 40_000 } }] }
  );

  const segment = view.chart.rows[0].segments.find((entry) => entry.stepId === "slow");
  assert.equal(segment.detail, "npm run build");
});

test("backfills timeline command steps into conversation tool events", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Commands", endedAt: "2026-06-16T10:00:10.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", textPreview: "Working", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "cmd", kind: "command", label: "exec_command", startedAt: "2026-06-16T10:00:02.000Z", durationMs: 2_000, order: 1, metrics: {} },
      { id: "result", kind: "tool_result", label: "exec_command result", startedAt: "2026-06-16T10:00:04.000Z", durationMs: 1_000, order: 2, metrics: {} }
    ],
    {
      toolCalls: [{
        id: "tool1",
        stepId: "cmd",
        resultStepId: "result",
        toolName: "exec_command",
        status: "success",
        input: { cmd: "git status --short", workdir: "/repo" },
        result: {
          durationMs: 1_000,
          outputPreview: "Chunk ID: abc123 Wall time: 0.0000 seconds Process exited with code 0 Original token count: 12 Output: M packages/usage-ui/src/App.svelte"
        }
      }]
    }
  );

  assert.deepEqual(view.messages[1].toolCalls.map((call) => call.name), ["exec_command"]);
  assert.equal(view.messages[1].toolCalls[0].preview, "git status --short");
  assert.equal(view.messages[1].toolCalls[0].commandPreview, "git status --short");
  assert.equal(view.messages[1].toolCalls[0].workdir, "/repo");
  assert.equal(view.messages[1].toolCalls[0].resultDisplayPreview, "M packages/usage-ui/src/App.svelte");
  assert.match(view.messages[1].toolCalls[0].resultPreview, /Chunk ID/);
  assert.equal(view.messages[1].toolCalls[0].durationLabel, "1s");
});

test("sizes paired command chart segments by tool wall time", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Commands", endedAt: "2026-06-16T10:00:20.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", textPreview: "Working", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "cmd1", kind: "command", label: "exec_command", startedAt: "2026-06-16T10:00:02.000Z", order: 1, metrics: {} },
      { id: "result1", kind: "tool_result", label: "exec_command result", startedAt: "2026-06-16T10:00:03.000Z", order: 2, metrics: {} },
      { id: "cmd2", kind: "command", label: "exec_command", startedAt: "2026-06-16T10:00:04.000Z", order: 3, metrics: {} },
      { id: "result2", kind: "tool_result", label: "exec_command result", startedAt: "2026-06-16T10:00:05.000Z", order: 4, metrics: {} }
    ],
    {
      toolCalls: [{
        id: "tool1",
        stepId: "cmd1",
        resultStepId: "result1",
        toolName: "exec_command",
        status: "success",
        result: { outputPreview: "Chunk ID: a Wall time: 0.2500 seconds Process exited with code 0 Output:" }
      }, {
        id: "tool2",
        stepId: "cmd2",
        resultStepId: "result2",
        toolName: "exec_command",
        status: "success",
        result: { outputPreview: "Chunk ID: b Wall time: 1.0000 seconds Process exited with code 0 Output:" }
      }]
    }
  );

  assert.deepEqual(view.chart.rows[0].segments.map((segment) => segment.stepId), ["cmd1", "cmd2"]);
  assert.equal(view.chart.rows[0].segments[0].durationMs, 250);
  assert.equal(view.chart.rows[0].segments[1].durationMs, 1000);
  assert.equal(view.chart.rows[0].segments[0].heightShare, 0.2);
  assert.equal(view.chart.rows[0].segments[1].heightShare, 0.8);
});

test("builds conversation token labels from context and output usage", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Tokens", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "m1", role: "assistant", turnId: "turn1", textPreview: "Working", tokenUsage: { input: 103_100, output: 1_500, total: 104_600 }, toolCalls: [] },
      { id: "m2", role: "assistant", turnId: "turn1", textPreview: "Done", tokenUsage: { total: 1_200 }, toolCalls: [] }
    ],
    []
  );

  assert.equal(view.messages[0].tokenLabel, "103.1k ctx / 1.5k out");
  assert.equal(view.chart.rows[0].tokenLabel, "103.1k ctx");
  assert.equal(view.chart.rows[0].tokens, 103_100);
  assert.equal(view.chart.rows[0].tokenModes.cumulative.tokenLabel, "103.1k ctx");
  assert.equal(view.chart.rows[0].tokenModes.added.tokenLabel, "103.1k added");
  assert.equal(view.messages[1].tokenLabel, "1.2K");
});

test("scales cumulative work-turn widths by displayed context tokens", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Tokens", endedAt: "2026-06-16T10:00:30.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "First", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", textPreview: "First answer", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { input: 100_000, output: 30_000, total: 130_000 }, toolCalls: [] },
      { id: "user2", role: "user", textPreview: "Second", createdAt: "2026-06-16T10:00:10.000Z", toolCalls: [] },
      { id: "m2", role: "assistant", textPreview: "Second answer", createdAt: "2026-06-16T10:00:11.000Z", tokenUsage: { input: 110_000, output: 1_000, total: 111_000 }, toolCalls: [] }
    ],
    []
  );

  assert.equal(view.chart.maxTokens, 110_000);
  assert.equal(view.chart.rows[0].tokenLabel, "100k ctx");
  assert.equal(view.chart.rows[1].tokenLabel, "110k ctx");
  assert.equal(view.chart.rows[0].widthShare, 100_000 / 110_000);
  assert.equal(view.chart.rows[1].widthShare, 1);
});

test("builds added token mode from context deltas and compaction drops", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Deltas", endedAt: "2026-06-16T10:00:40.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "First", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", textPreview: "First answer", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { input: 100_000, output: 1_000 }, toolCalls: [] },
      { id: "user2", role: "user", textPreview: "Second", createdAt: "2026-06-16T10:00:10.000Z", toolCalls: [] },
      { id: "m2", role: "assistant", textPreview: "Second answer", createdAt: "2026-06-16T10:00:11.000Z", tokenUsage: { input: 150_000, output: 1_000 }, toolCalls: [] },
      { id: "user3", role: "user", textPreview: "Third", createdAt: "2026-06-16T10:00:20.000Z", toolCalls: [] },
      { id: "m3", role: "assistant", textPreview: "Third answer", createdAt: "2026-06-16T10:00:21.000Z", tokenUsage: { input: 50_000, output: 1_000 }, toolCalls: [] }
    ],
    []
  );

  assert.deepEqual(view.chart.rows.map((row) => row.tokenModes.added.tokens), [100_000, 50_000, 50_000]);
  assert.deepEqual(view.chart.rows.map((row) => row.tokenModes.added.tokenLabel), ["100k added", "50k added", "50k added"]);
  assert.equal(view.chart.maxAddedTokens, 100_000);
  assert.equal(view.chart.rows[0].tokenModes.added.widthShare, 1);
  assert.equal(view.chart.rows[1].tokenModes.added.widthShare, 0.5);
  assert.equal(view.chart.rows[2].tokenModes.added.widthShare, 0.5);
});

test("scales conversation chart row heights by work turn duration", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Durations", endedAt: "2026-06-16T10:00:50.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "short", role: "assistant", turnId: "turn1", textPreview: "Short", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] },
      { id: "user2", role: "user", textPreview: "Again", createdAt: "2026-06-16T10:00:10.000Z", toolCalls: [] },
      { id: "long", role: "assistant", turnId: "turn2", textPreview: "Long", createdAt: "2026-06-16T10:00:11.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    []
  );

  assert.equal(view.chart.rows.length, 2);
  assert.deepEqual(view.chart.rows[0].messageIds, ["user1", "short"]);
  assert.deepEqual(view.chart.rows[1].messageIds, ["user2", "long"]);
  assert.equal(view.chart.rows[0].durationMs, 10_000);
  assert.equal(view.chart.rows[1].durationMs, 40_000);
  assert.equal(view.chart.rows[0].heightShare, 0.25);
  assert.equal(view.chart.rows[1].heightShare, 1);
});

test("links unowned steps to the work turn whose timestamp window contains them", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Step windows", endedAt: "2026-06-16T10:00:30.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", turnId: "turn1", textPreview: "First", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] },
      { id: "user2", role: "user", textPreview: "Next", createdAt: "2026-06-16T10:00:20.000Z", toolCalls: [] },
      { id: "m2", role: "assistant", turnId: "turn2", textPreview: "Second", createdAt: "2026-06-16T10:00:21.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "inside", turnId: "turn1", kind: "command", label: "inside command", startedAt: "2026-06-16T10:00:05.000Z", durationMs: 8_000, order: 1, metrics: {} },
      { id: "outside", turnId: "turn1", kind: "command", label: "outside command", startedAt: "2026-06-16T10:00:25.000Z", durationMs: 4_000, order: 2, metrics: {} }
    ]
  );

  assert.deepEqual(view.chart.rows[0].segments.map((segment) => segment.label), ["inside command"]);
  assert.deepEqual(view.chart.rows[1].segments.map((segment) => segment.label), ["outside command"]);
});

test("uses equal internal segment heights when step durations are unavailable", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Partial", metrics: {}, availability: { notes: [] } },
    [],
    [{ id: "m1", role: "assistant", turnId: "turn1", stepId: "a", textPreview: "Done", tokenUsage: { total: 10 }, toolCalls: [{ id: "tool", stepId: "b" }] }],
    [
      { id: "a", turnId: "turn1", kind: "assistant_response", label: "Assistant", order: 1, metrics: {} },
      { id: "b", turnId: "turn1", kind: "command", label: "Command", order: 2, metrics: {} }
    ]
  );

  assert.equal(view.chart.rows[0].segments[0].heightShare, 0.5);
  assert.equal(view.chart.rows[0].segments[1].heightShare, 0.5);
  assert.match(view.caveats.join("\n"), /evenly sized/);
});

test("ranks the slowest step segments as bottlenecks", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Bottlenecks", endedAt: "2026-06-16T10:01:00.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", turnId: "turn1", textPreview: "Working", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "fast", turnId: "turn1", kind: "model_call", label: "Quick model call", startedAt: "2026-06-16T10:00:02.000Z", durationMs: 5_000, order: 1, metrics: {} },
      { id: "slow", turnId: "turn1", kind: "command", label: "Slow build", startedAt: "2026-06-16T10:00:08.000Z", durationMs: 40_000, order: 2, metrics: {} }
    ]
  );

  assert.equal(view.bottlenecks.length, 2);
  assert.equal(view.bottlenecks[0].rank, 1);
  assert.equal(view.bottlenecks[0].label, "Slow build");
  assert.equal(view.bottlenecks[0].durationMs, 40_000);
  assert.equal(view.bottlenecks[0].stepId, "slow");
  assert.equal(view.bottlenecks[0].messageId, "m1");
  assert.equal(view.bottlenecks[1].label, "Quick model call");
});

test("surfaces the command that ran as bottleneck detail", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Bottlenecks", endedAt: "2026-06-16T10:01:00.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "m1", role: "assistant", turnId: "turn1", textPreview: "Working", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    [
      { id: "slow", turnId: "turn1", kind: "command", label: "exec_command", startedAt: "2026-06-16T10:00:08.000Z", durationMs: 40_000, order: 1, metrics: {} }
    ],
    { toolCalls: [{ id: "tool1", stepId: "slow", toolName: "exec_command", status: "success", input: { command: "npm run build" }, result: { durationMs: 40_000 } }] }
  );

  assert.equal(view.bottlenecks[0].label, "exec_command");
  assert.equal(view.bottlenecks[0].detail, "npm run build");
});

test("falls back to work-turn bottlenecks when no segment carries timing", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "codex", title: "Turn bottlenecks", endedAt: "2026-06-16T10:00:50.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "user1", role: "user", textPreview: "Go", createdAt: "2026-06-16T10:00:00.000Z", toolCalls: [] },
      { id: "short", role: "assistant", turnId: "turn1", textPreview: "Short", createdAt: "2026-06-16T10:00:01.000Z", tokenUsage: { total: 10 }, toolCalls: [] },
      { id: "user2", role: "user", textPreview: "Again", createdAt: "2026-06-16T10:00:10.000Z", toolCalls: [] },
      { id: "long", role: "assistant", turnId: "turn2", textPreview: "Long", createdAt: "2026-06-16T10:00:11.000Z", tokenUsage: { total: 10 }, toolCalls: [] }
    ],
    []
  );

  assert.equal(view.bottlenecks[0].kind, "turn");
  assert.equal(view.bottlenecks[0].durationMs, 40_000);
  assert.equal(view.bottlenecks[0].messageId, "long");
});

test("builds cockpit view without mixing session envelope into trace lanes", () => {
  const view = buildUsageCockpitView(
    {
      id: "s1",
      provider: "codex",
      title: "Implement UI",
      status: "active",
      startedAt: "2026-06-15T10:00:00.000Z",
      endedAt: "2026-06-15T11:00:00.000Z",
      metrics: { durationMs: 3_600_000, durationConfidence: "derived", tokens: { total: 12_000_000, confidence: "exact" } },
      counts: { toolCalls: 2, filesTouched: 1 },
      availability: { notes: ["partial timing"] }
    },
    [
      { id: "session", kind: "session", label: "codex session", durationMs: 3_600_000, selfDurationMs: 1_800_000, status: "success", metrics: {} },
      { id: "read", kind: "file_read", label: "Read app", durationMs: 10_000, selfDurationMs: 10_000, status: "success", targetPaths: ["src/app.ts"], metrics: {} },
      { id: "model", kind: "assistant_response", label: "Implementation plan", durationMs: 20_000, selfDurationMs: 20_000, status: "success", metrics: { tokens: { total: 12_000_000 } } }
    ],
    [
      { id: "m1", role: "user", textPreview: "Please redesign the usage UI." },
      { id: "m2", role: "assistant", textPreview: "I will inspect the current UI first.", tokenUsage: { total: 12_000_000 } }
    ],
    { range: { startedAt: "2026-06-15T10:00:00.000Z", endedAt: "2026-06-15T11:00:00.000Z", durationMs: 3_600_000 }, items: [] }
  );

  assert.equal(view.session.title, "Implement UI");
  assert.equal(view.storyline.chapters.some((chapter) => chapter.title === "Prompt & setup"), true);
  assert.equal(view.trace.lanes.flatMap((lane) => lane.items).some((item) => item.kind === "session"), false);
  assert.equal(view.trace.totals.sessionDurationMs, 3_600_000);
  assert.equal(view.diagnostics.some((card) => card.label === "Tokens" && card.tone === "warning"), true);
});

test("reports Claude per-message context as input+cache and output tokens", () => {
  const session = { id: "s1", provider: "claude", title: "Parity", metrics: {}, availability: { notes: [] } };
  const view = buildUsageConversationView(
    session,
    [session],
    [
      { id: "u1", role: "user", textPreview: "Go", createdAt: "2026-06-18T09:36:40.000Z", toolCalls: [] },
      {
        id: "m1",
        role: "assistant",
        model: "claude",
        textPreview: "Working",
        createdAt: "2026-06-18T09:36:44.673Z",
        // Claude reports input_tokens (uncached) apart from the cache tokens that hold the prompt.
        tokenUsage: { input: 2, cacheCreation: 10441, cacheRead: 15860, output: 1400, confidence: "provider-reported" },
        toolCalls: []
      }
    ],
    []
  );
  const message = view.messages.find((entry) => entry.id === "m1");
  assert.equal(message.contextTokens, 26303, "context = input + cache_creation + cache_read");
  assert.equal(message.outputTokens, 1400);
  assert.match(message.tokenLabel, /26\.3k ctx/);
  assert.match(message.tokenLabel, /1\.4k out/);
});

test("conversation header reports peak context, not the cumulative token sum", () => {
  const session = { id: "s1", provider: "claude", title: "Header", metrics: { durationMs: 60_000, tokens: { total: 11_503_008, context: 78_768 } }, availability: { notes: [] } };
  const view = buildUsageConversationView(session, [session], [
    { id: "m1", role: "assistant", textPreview: "Working", tokenUsage: { total: 10 }, toolCalls: [] }
  ], []);
  assert.equal(view.selected.tokenLabel, "79K ctx", "the 11.5M cumulative total is a cache-read artifact; show the peak working set");
});

test("derives assistant turn duration and a solo tool-call duration from transcript timestamps", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "claude", title: "Timing", endedAt: "2026-06-18T09:38:00.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "u1", role: "user", textPreview: "Go", createdAt: "2026-06-18T09:36:00.000Z", toolCalls: [] },
      {
        id: "m1",
        role: "assistant",
        model: "claude",
        textPreview: "Running",
        createdAt: "2026-06-18T09:36:01.000Z",
        tokenUsage: { input: 2, cacheRead: 100, output: 10 },
        toolCalls: [{ id: "t1", toolName: "Bash", status: "success" }]
      },
      { id: "u2", role: "user", textPreview: "next", createdAt: "2026-06-18T09:36:31.000Z", toolCalls: [] }
    ],
    []
  );
  const message = view.messages.find((entry) => entry.id === "m1");
  assert.equal(message.durationMs, 30_000, "turn = gap to the next record");
  assert.equal(message.callCount, 1);
  assert.equal(message.turnLabel, "turn 30s · 1 call");
  assert.equal(message.toolCalls[0].durationLabel, "30s", "a lone tool call inherits the turn duration");
});

test("leaves parallel tool calls without an inherited per-call duration", () => {
  const view = buildUsageConversationView(
    { id: "s1", provider: "claude", title: "Parallel", endedAt: "2026-06-18T09:38:00.000Z", metrics: {}, availability: { notes: [] } },
    [],
    [
      { id: "u1", role: "user", textPreview: "Go", createdAt: "2026-06-18T09:36:00.000Z", toolCalls: [] },
      {
        id: "m1",
        role: "assistant",
        model: "claude",
        textPreview: "Running",
        createdAt: "2026-06-18T09:36:01.000Z",
        tokenUsage: { input: 2, cacheRead: 100, output: 10 },
        toolCalls: [
          { id: "t1", toolName: "Read", status: "success" },
          { id: "t2", toolName: "Read", status: "success" }
        ]
      },
      { id: "u2", role: "user", textPreview: "next", createdAt: "2026-06-18T09:36:31.000Z", toolCalls: [] }
    ],
    []
  );
  const message = view.messages.find((entry) => entry.id === "m1");
  assert.equal(message.callCount, 2);
  assert.equal(message.turnLabel, "turn 30s · 2 calls");
  assert.equal(message.toolCalls[0].durationLabel, undefined, "parallel siblings have no per-call timing");
  assert.equal(message.toolCalls[1].durationLabel, undefined);
});

test("browser API client explains missing local Usage API", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html><div id=\"root\"></div>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
  try {
    const client = createUsageApiClient("http://local");
    await assert.rejects(
      () => client.listSessions(),
      /Usage API unavailable/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
