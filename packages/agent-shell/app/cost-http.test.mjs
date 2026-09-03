import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { claudeProjectKey, piProjectKey } from "./harness-transcripts.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const area = "otto/costing";

/** Writes one JSONL transcript, creating the folders it needs. */
async function writeJsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

/**
 * Builds a complete fixture machine: a vault with a harness registry that
 * points at scratch transcript folders, one Job and one brain that ran there,
 * and the transcripts themselves. Nothing here touches the real vault, the
 * real transcript roots, or the real Agent Shell state.
 */
async function buildMachine({ pricingDocument = null, unratedModel = false, brokenRegistry = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cost-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const claudeTranscripts = path.join(root, "transcripts", "claude");
  const piTranscripts = path.join(root, "transcripts", "pi");
  const areaDirectory = path.join(trees, area);
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, "costing.md"), `---\ntype: area\n---\n\n# Costing\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "harnesses.md"), brokenRegistry ? "# Harnesses\n\n```tangent.harnesses.v2\n{ not json\n```\n" : [
    "# Harnesses", "",
    "```tangent.harnesses.v2",
    JSON.stringify({
      version: 2,
      modelSets: { claude: [{ id: "opus-5", label: "Opus 5", args: "--model opus" }] },
      effortSets: {},
      harnesses: [
        { id: "claude-otto", command: "true", modelSet: "claude", provider: "anthropic", sessionIdArg: "--session-id {id}", transcripts: claudeTranscripts },
        { id: "pi-code", command: "true", provider: "resetdata-glm", sessionIdArg: "--session {id}", transcripts: piTranscripts },
        // Declares no transcripts folder, so its attempts are unattributable
        // by construction and must be named rather than dropped.
        { id: "codex-gw", command: "true" },
      ],
    }, null, 2),
    "```", "",
  ].join("\n"), "utf8");
  if (pricingDocument !== null) await writeFile(path.join(trees, "pricing.md"), pricingDocument, "utf8");

  const cwd = workspace;
  const jobConversation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const brainConversation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const piConversation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  // The Job's own conversation, plus a subagent beside it. The ledger is the
  // last word here, so it is what the figure uses.
  await writeJsonl(path.join(claudeTranscripts, claudeProjectKey(cwd), `${jobConversation}.jsonl`), [
    { type: "assistant", message: { id: "m1", role: "assistant", model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 10 } } },
    { type: "cost-state", totalCostUSD: 20, modelUsage: { "claude-opus-5": { inputTokens: 10, outputTokens: 10, costUSD: 20 } } },
  ]);
  await writeJsonl(path.join(claudeTranscripts, claudeProjectKey(cwd), jobConversation, "subagents", "agent-one.jsonl"), [
    { type: "assistant", message: { id: "m2", role: "assistant", model: "claude-opus-5", usage: { input_tokens: 0, output_tokens: 1000 } } },
  ]);
  await writeJsonl(path.join(claudeTranscripts, claudeProjectKey(cwd), `${brainConversation}.jsonl`), [
    { type: "cost-state", totalCostUSD: 5, modelUsage: { "claude-sonnet-5": { inputTokens: 1, outputTokens: 1, costUSD: 5 } } },
  ]);
  // pi, at the path pi actually writes to.
  await writeJsonl(path.join(piTranscripts, piProjectKey(cwd), `2026-09-03T04-00-00_${piConversation}.jsonl`), [
    { type: "session", cwd },
    { type: "message", message: { role: "assistant", provider: "resetdata-glm", model: unratedModel ? "zai/glm-nine" : "zai/glm-5.2", usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  ]);

  const startedAt = new Date(Date.now() - 60_000).toISOString();
  await mkdir(path.join(root, "pipelines", area), { recursive: true });
  await writeFile(path.join(root, "pipelines", area, "thing.json"), JSON.stringify({
    goal: `${area}/goal-thing.md`, area, slug: "thing",
    steps: [{
      id: "step-1",
      attempts: [
        { id: "a1", session: "thing-claude", resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: null, provider: "anthropic" }, command: "true" }, providerSession: { harness: "claude-otto", provider: "claude-otto", id: jobConversation }, cwd, startedAt, endedAt: null },
        // A resume of the same conversation. It must not be charged twice.
        { id: "a2", session: "thing-claude", resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: null, provider: "anthropic" }, command: "true" }, providerSession: { harness: "claude-otto", provider: "claude-otto", id: jobConversation }, cwd, startedAt, endedAt: null },
        { id: "a3", session: "thing-pi", resolvedLaunch: { ref: { harness: "pi-code", model: null, effort: null, provider: "resetdata-glm" }, command: "true" }, providerSession: { harness: "pi-code", provider: "pi-code", id: piConversation }, cwd, startedAt, endedAt: null },
        { id: "a4", session: "thing-codex", resolvedLaunch: { ref: { harness: "codex-gw", model: null, effort: null, provider: null }, command: "true" }, providerSession: null, cwd, startedAt, endedAt: null },
      ],
    }],
  }), "utf8");
  await mkdir(path.join(root, "brains"), { recursive: true });
  await writeFile(path.join(root, "brains", "otto-costing.json"), JSON.stringify({
    area,
    generations: [{ generation: 1, session: "brain-1", resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: null, provider: "anthropic" }, command: "true" }, providerSession: { harness: "claude-otto", provider: "claude-otto", id: brainConversation }, cwd, startedAt, endedAt: null }],
  }), "utf8");

  return { root, trees, workspace };
}

test("the cost endpoint answers from the index it holds instead of walking transcripts again", async (context) => {
  const machine = await buildMachine();
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const first = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  const started = Date.now();
  const second = await (await fetch(`${base}/api/cost/workers`)).json();
  const elapsed = Date.now() - started;
  assert.equal(second.computedAt, first.computedAt);
  assert.ok(elapsed < 500, `a warm read took ${elapsed}ms`);
});

test("the day total the top bar used to read is gone, not left serving a dead route", async (context) => {
  const machine = await buildMachine();
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  assert.equal((await fetch(`${base}/api/cost?days=1`)).status, 404);
});

test("a rate written into the vault pricing Document overrides the seeded one", async (context) => {
  const machine = await buildMachine({
    pricingDocument: [
      "# Pricing", "",
      "```tangent.pricing.v1",
      JSON.stringify({ version: 1, providers: { "resetdata-glm": { models: { "zai/glm-5.2": { input: 10, output: 10, cacheWrite: 10, cacheWrite1h: 10, cacheRead: 10 } } } } }),
      "```", "",
    ].join("\n"),
  });
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  // pi's million input tokens now cost 10 instead of the seeded 1.58.
  assert.equal(Number(index.sessions["thing-pi"].amount.toFixed(4)), 10);
});

test("a broken pricing Document keeps the seeded rates and says what went wrong", async (context) => {
  const machine = await buildMachine({ pricingDocument: "# Pricing\n\n```tangent.pricing.v1\n{ not json\n```\n" });
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  // The seeded rate still prices pi's million input tokens, and the figure
  // says on its own hover that the Document it should have used was broken.
  const worker = index.sessions["thing-pi"];
  assert.equal(Number(worker.amount.toFixed(4)), 1.58);
  assert.equal(worker.floor, true);
  assert.equal(worker.reasons.some((reason) => reason.startsWith("the pricing Document could not be read")), true);
});

test("a broken harness registry is named on every worker rather than reading as free work", async (context) => {
  const machine = await buildMachine({ brokenRegistry: true });
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  const worker = index.sessions["thing-claude"];
  assert.equal(worker.amount, 0);
  assert.equal(worker.conversations, 0);
  assert.equal(worker.floor, true);
  assert.match(worker.reasons[0], /^the harness registry could not be read/);
});

test("every worker's own cost is served, keyed by Goal and by session", async (context) => {
  const machine = await buildMachine();
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  assert.equal(index.status, "ready");

  // The Goal's own figure: 20 from the Claude ledger, charged once across the
  // two attempts that share its conversation, plus 1.58 for pi's million
  // input tokens. The brain's 5 is not in it, because the brain is not the
  // Goal's worker.
  const job = index.work[`job:${area}/goal-thing.md`];
  assert.equal(Number(job.amount.toFixed(4)), 21.58);
  assert.equal(job.conversations, 2);
  assert.equal(job.workers, 2);
  assert.deepEqual(job.harnesses, ["claude-otto", "pi-code"]);

  // The brain is its own worker with its own figure.
  assert.equal(Number(index.work[`brain:${area}`].amount.toFixed(4)), 5);

  // One session is one worker. The Claude worker carries its own conversation
  // and nothing of the pi worker beside it.
  assert.equal(Number(index.sessions["thing-claude"].amount.toFixed(4)), 20);
  assert.equal(Number(index.sessions["thing-pi"].amount.toFixed(4)), 1.58);
  assert.equal(index.sessions["brain-1"].conversations, 1);
});

test("a worker's figure names its subagents and says why it is a floor", async (context) => {
  const machine = await buildMachine();
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  const job = index.work[`job:${area}/goal-thing.md`];

  // Subagent cost is inside the figure, and the surface is told by which
  // route rather than being asked to trust a bare promise.
  assert.match(job.subagents, /Claude's own ledger already counts them/);
  assert.match(job.subagents, /pi has no subagent tool/);

  // Every attempt in the fixture is still running, and one of them ran on a
  // harness with no transcripts folder. Both make the figure a floor, and
  // both are named on the same surface.
  assert.equal(job.floor, true);
  assert.equal(job.reasons[0], "this worker is still running, so this is what it has cost so far");
  assert.equal(job.reasons.includes("the codex-gw harness declares no transcripts folder"), true);
});

test("a worker whose model has no rate reports tokens, never a guessed dollar", async (context) => {
  const machine = await buildMachine({ pricingDocument: null, unratedModel: true });
  const base = await startShellServer(context, { here, ...machine });
  if (!base) return;

  const index = await (await fetch(`${base}/api/cost/workers?wait=1`)).json();
  const worker = index.sessions["thing-pi"];
  assert.equal(worker.amount, 0);
  assert.ok(worker.unpricedTokens > 0);
  assert.equal(worker.unpricedDisplay, "1.0M tok");
  assert.equal(worker.floor, true);
  assert.match(worker.reasons.join(" "), /no rate for resetdata-glm\/zai\/glm-nine/);
});
