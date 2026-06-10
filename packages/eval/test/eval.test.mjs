import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { captureContext, collectEval, prepareEval, startEvalUiServer } from "../dist/sdk/index.js";

const execFileAsync = promisify(execFile);

test("captures repo context into a synthetic git ref", async () => {
  const repo = await createRepo();
  await mkdir(path.join(repo, "packages", "search"), { recursive: true });
  await writeFile(path.join(repo, "CLAUDE.md"), "root context\n", "utf8");
  await writeFile(path.join(repo, "packages", "search", "AGENT.md"), "package context\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "add context");

  const result = await captureContext({
    name: "current",
    repo,
    cwd: "packages/search",
    includeAncestors: true
  });

  assert.equal(result.ref, "refs/tangent/eval/contexts/current");
  assert.deepEqual(result.manifest.files.map((file) => file.snapshotPath), [
    "repo/CLAUDE.md",
    "repo/packages/search/AGENT.md"
  ]);

  const manifest = JSON.parse(await gitShow(repo, `${result.ref}:manifest.json`));
  assert.equal(manifest.schema, "eval.context.v1");
});

test("prepare creates external worktrees with isolated context commits", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "CLAUDE.md"), "repo context\n", "utf8");
  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const evalDir = path.join(repo, "evals", "task");
  await mkdir(path.join(evalDir, "prompts"), { recursive: true });
  await writeFile(path.join(evalDir, "prompts", "task.md"), "Change the value.\n", "utf8");
  const specPath = path.join(evalDir, "eval.json");
  await writeFile(specPath, JSON.stringify({
    schema: "eval.spec.v1",
    name: "task",
    defaults: {
      repo: { path: repo, ref: "HEAD" },
      cwd: ".",
      agent: { kind: "manual" },
      phases: ["plan", "implement"]
    },
    cases: [
      {
        id: "task",
        prompt: "prompts/task.md",
        variants: [
          { id: "empty", context: { mode: "empty" } },
          { id: "repo", context: { mode: "repo" } }
        ]
      }
    ]
  }, null, 2), "utf8");

  const result = await prepareEval(specPath);
  assert.equal(result.manifest.variants.length, 2);

  const empty = result.manifest.variants.find((variant) => variant.variantId === "empty");
  const repoVariant = result.manifest.variants.find((variant) => variant.variantId === "repo");
  assert.ok(empty);
  assert.ok(repoVariant);
  assert.notEqual(empty.contextCommit, empty.baseCommit);
  assert.notEqual(repoVariant.contextCommit, repoVariant.baseCommit);
  assert.equal(await fileExists(path.join(empty.worktree, "CLAUDE.md")), false);
  assert.equal(await readFile(path.join(repoVariant.worktree, "CLAUDE.md"), "utf8"), "repo context\n");

  await writeFile(path.join(empty.worktree, "index.ts"), "export const value = 2;\n", "utf8");
  const collected = await collectEval(result.manifest);
  const emptyMetrics = collected.metrics.find((metrics) => metrics.variantId === "empty");
  assert.ok(emptyMetrics.git.implementationCommit);
  assert.ok(emptyMetrics.files.changed.includes("index.ts"));
});

test("eval ui server lists runs and compares variants", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-ui-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "result.txt"), "base\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  const baseCommit = await gitRev(repo, "HEAD");
  await writeFile(path.join(repo, "result.txt"), "left\n", "utf8");
  await git(repo, "commit", "-am", "left");
  const leftCommit = await gitRev(repo, "HEAD");
  await git(repo, "checkout", "-B", "right", baseCommit);
  await writeFile(path.join(repo, "result.txt"), "right\n", "utf8");
  await git(repo, "commit", "-am", "right");
  const rightCommit = await gitRev(repo, "HEAD");

  const runDir = path.join(evalHome, "runs", "ui-run");
  const leftDir = path.join(runDir, "variants", "case-a-left");
  const rightDir = path.join(runDir, "variants", "case-a-right");
  await mkdir(leftDir, { recursive: true });
  await mkdir(rightDir, { recursive: true });
  await writeFile(path.join(leftDir, "implementation-output.md"), "left output\n", "utf8");
  await writeFile(path.join(rightDir, "implementation-output.md"), "right output\n", "utf8");
  await writeFile(path.join(leftDir, "prompt.md"), "prompt\n", "utf8");
  await writeFile(path.join(rightDir, "prompt.md"), "prompt\n", "utf8");

  const manifest = {
    schema: "eval.run.v1",
    id: "ui-run",
    name: "UI Run",
    createdAt: "2026-06-10T10:00:00.000Z",
    runDir,
    variants: [
      variantState("case-a", "left", repo, baseCommit, leftCommit, leftDir),
      variantState("case-a", "right", repo, baseCommit, rightCommit, rightDir)
    ]
  };
  const metrics = [
    metricRow("ui-run", "case-a", "left", baseCommit, leftCommit, repo, 100, 2, 1),
    metricRow("ui-run", "case-a", "right", baseCommit, rightCommit, repo, 80, 1, 0)
  ];
  await writeFile(path.join(runDir, "run.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(path.join(runDir, "report.json"), JSON.stringify(metrics, null, 2), "utf8");
  await writeFile(path.join(leftDir, "metrics.json"), JSON.stringify(metrics[0], null, 2), "utf8");
  await writeFile(path.join(rightDir, "metrics.json"), JSON.stringify(metrics[1], null, 2), "utf8");

  const server = await startEvalUiServer({ runId: "ui-run", open: false });
  try {
    const runs = await (await fetch(`${server.url}api/eval/runs`)).json();
    assert.equal(runs[0].id, "ui-run");
    const compare = await (await fetch(`${server.url}api/eval/runs/ui-run/compare?caseId=case-a&a=left&b=right&phase=all`)).json();
    assert.equal(compare.left.variantId, "left");
    assert.equal(compare.right.variantId, "right");
    assert.equal(compare.outputs.leftImplementation.trim(), "left output");
    assert.deepEqual(compare.git.changedFiles.shared, ["result.txt"]);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /Tangent Eval/);
  } finally {
    await server.close();
  }
});

async function createRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), "tangent-eval-repo-"));
  await git(repo, "init");
  await git(repo, "config", "user.name", "Test User");
  await git(repo, "config", "user.email", "test@example.invalid");
  return repo;
}

async function git(repo, ...args) {
  await execFileAsync("git", ["-C", repo, ...args]);
}

async function gitShow(repo, ref) {
  const { stdout } = await execFileAsync("git", ["-C", repo, "show", ref]);
  return stdout;
}

async function gitRev(repo, ref) {
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", ref]);
  return stdout.trim();
}

async function fileExists(filePath) {
  return readFile(filePath).then(() => true).catch(() => false);
}

function variantState(caseId, variantId, repo, baseCommit, implementationCommit, dir) {
  return {
    caseId,
    variantId,
    status: "done",
    branch: variantId,
    repoRoot: repo,
    baseCommit,
    contextCommit: baseCommit,
    implementationCommit,
    workParent: path.dirname(repo),
    worktree: repo,
    executionCwd: repo,
    promptPath: path.join(dir, "prompt.md"),
    metricsPath: path.join(dir, "metrics.json"),
    context: { mode: "repo" },
    agent: { kind: "manual" },
    startedAt: "2026-06-10T10:00:00.000Z",
    endedAt: "2026-06-10T10:01:00.000Z",
    phases: [
      {
        id: "implement",
        startedAt: "2026-06-10T10:00:10.000Z",
        endedAt: "2026-06-10T10:00:50.000Z",
        agentStartedAt: "2026-06-10T10:00:12.000Z",
        agentEndedAt: "2026-06-10T10:00:42.000Z",
        agentDurationMs: 30000,
        status: "done",
        outputPath: path.join(dir, "implementation-output.md"),
        commit: implementationCommit
      }
    ],
    warnings: []
  };
}

function metricRow(runId, caseId, variantId, baseCommit, implementationCommit, repo, tokens, tools, failures) {
  return {
    schema: "eval.metrics.v1",
    runId,
    caseId,
    variantId,
    status: "done",
    time: { durationMs: 60000, activeAgentDurationMs: 30000 },
    tokens: { total: tokens, byModel: [], messages: [] },
    tools: { total: tools, byModel: {}, byName: {}, byCategory: {}, calls: [] },
    files: { read: [], searched: [], written: [], changed: ["result.txt"], confidence: "exact" },
    commands: { total: 0, tests: 0, builds: 0, lints: 0, typechecks: 0, failures },
    git: { baseCommit, contextCommit: baseCommit, implementationCommit, branch: variantId, worktree: repo },
    conversations: [],
    warnings: []
  };
}
