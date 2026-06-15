import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { captureContext, collectEval, prepareEval, runEval, startEvalUiServer } from "../dist/sdk/index.js";
import { isEvalRunCancelled, runPreparedEval } from "../dist/core/run.js";

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

test("context capture stays inside the repo when including ancestors", async () => {
  const grandparent = await mkdtemp(path.join(tmpdir(), "tangent-eval-parent-"));
  const parent = path.join(grandparent, "projects");
  const repo = await createRepo(path.join(parent, "repo"));
  await mkdir(path.join(grandparent, ".claude", ".git"), { recursive: true });
  await writeFile(path.join(grandparent, ".claude", "settings.json"), "{}\n", "utf8");
  await writeFile(path.join(grandparent, ".claude", ".git", "COMMIT_EDITMSG"), "internal git state\n", "utf8");
  await writeFile(path.join(repo, "CLAUDE.md"), "repo context\n", "utf8");
  await mkdir(path.join(repo, "packages", "search"), { recursive: true });
  await writeFile(path.join(repo, "packages", "AGENTS.md"), "package context\n", "utf8");
  await writeFile(path.join(repo, "packages", "search", "AGENT.md"), "search context\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "add context");

  const result = await captureContext({
    name: "current",
    repo,
    cwd: "packages/search",
    includeAncestors: true
  });

  assert.deepEqual(result.manifest.files.map((file) => file.snapshotPath), [
    "repo/CLAUDE.md",
    "repo/packages/AGENTS.md",
    "repo/packages/search/AGENT.md"
  ]);
});

test("context capture ignores nested git metadata in repo context directories", async () => {
  const repo = await createRepo();
  await mkdir(path.join(repo, ".claude", ".git"), { recursive: true });
  await writeFile(path.join(repo, ".claude", "settings.json"), "{}\n", "utf8");
  await writeFile(path.join(repo, ".claude", ".git", "COMMIT_EDITMSG"), "internal git state\n", "utf8");
  await writeFile(path.join(repo, "CLAUDE.md"), "repo context\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "add context");

  const result = await captureContext({
    name: "current",
    repo,
    cwd: ".",
    includeAncestors: true
  });

  assert.deepEqual(result.manifest.files.map((file) => file.snapshotPath), [
    "repo/.claude/settings.json",
    "repo/CLAUDE.md"
  ]);
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

test("run eval starts automatic variants in parallel", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-parallel-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const command = await fakeCodexCommand(true);
  const specPath = await writeEvalSpec(repo, "parallel-run", command, [
    { id: "left", context: { mode: "repo" } },
    { id: "right", context: { mode: "repo" } }
  ]);

  const prepared = await prepareEval(specPath);
  const controller = new AbortController();
  const started = new Set();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await assert.rejects(
      runPreparedEval(prepared.manifest, {
        signal: controller.signal,
        /** Supports the on progress helper. */
        onProgress: (event) => {
          if (event.type !== "phase.agent-started" || !event.variantId) return;
          started.add(event.variantId);
          if (started.size === 2) controller.abort();
        }
      }),
      (error) => isEvalRunCancelled(error)
    );
  } finally {
    clearTimeout(timeout);
  }

  assert.deepEqual([...started].sort(), ["left", "right"]);
  const manifest = JSON.parse(await readFile(path.join(prepared.manifest.runDir, "run.json"), "utf8"));
  assert.deepEqual(manifest.variants.map((variant) => variant.status), ["cancelled", "cancelled"]);
});

test("run eval records failures after sibling variants finish", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-failure-home-"));
  const coordinationDir = await mkdtemp(path.join(tmpdir(), "tangent-eval-failure-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const command = await fakeVariantOutcomeCodexCommand(coordinationDir, "fail");
  const specPath = await writeEvalSpec(repo, "parallel-failure", command, [
    { id: "fail", context: { mode: "repo" } },
    { id: "pass", context: { mode: "repo" } }
  ], 30000);

  await assert.rejects(runEval(specPath), /case-a\/fail: intentional failure/);

  const manifest = await readLatestRunManifest(evalHome);
  const statuses = Object.fromEntries(manifest.variants.map((variant) => [variant.variantId, variant.status]));
  assert.deepEqual(statuses, { fail: "failed", pass: "done" });
  assert.equal(await readFile(path.join(coordinationDir, "pass.done"), "utf8"), "done\n");
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
    assert.match(compare.git.comparisonDiff, /diff --git a\/result.txt b\/result.txt/);
    assert.match(compare.git.comparisonDiff, /-left/);
    assert.match(compare.git.comparisonDiff, /\+right/);
    assert.equal(compare.metricsDelta.tokensTotal, -20);
    assert.equal(compare.metricsDelta.toolCalls, -1);
    assert.deepEqual(compare.git.changedFiles.shared, ["result.txt"]);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /Tangent Eval/);
    const appScript = html.match(/src="([^"]+\.js)"/)?.[1];
    const stylesheet = html.match(/href="([^"]+\.css)"/)?.[1];
    assert.ok(appScript);
    assert.ok(stylesheet);
    const appJs = await (await fetch(new URL(appScript, server.url))).text();
    assert.match(appJs, /api\/eval\/runs/);
    const css = await (await fetch(new URL(stylesheet, server.url))).text();
    assert.match(css, /\.tg-compare-layout/);
  } finally {
    await server.close();
  }
});

test("eval ui server loads snapshot context contents", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-ui-context-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "AGENTS.md"), "no search context\n", "utf8");
  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  const noSearch = await captureContext({ name: "no-search", repo, cwd: "." });

  await writeFile(path.join(repo, "AGENTS.md"), "with search context\n", "utf8");
  await git(repo, "commit", "-am", "with search context");
  const withSearch = await captureContext({ name: "with-search", repo, cwd: "." });

  const specPath = await writeSnapshotEvalSpec(repo, noSearch.ref, withSearch.ref);
  const server = await startEvalUiServer({ specPath, cwd: repo, open: false });
  try {
    const specs = await (await fetch(`${server.url}api/eval/specs`)).json();
    const spec = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}`)).json();
    assert.equal(spec.cases[0].variants[0].context.ref, "refs/tangent/eval/contexts/no-search");
    assert.equal(spec.cases[0].variants[1].context.ref, "refs/tangent/eval/contexts/with-search");
    const left = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}/context?caseId=case-a&variantId=no-search`)).json();
    const right = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}/context?caseId=case-a&variantId=with-search`)).json();
    assert.equal(left.files.find((file) => file.snapshotPath === "repo/AGENTS.md").content, "no search context\n");
    assert.equal(right.files.find((file) => file.snapshotPath === "repo/AGENTS.md").content, "with search context\n");
    const html = await (await fetch(server.url)).text();
    assert.match(html, /Tangent Eval/);
    assert.match(html, /\/assets\/.*\.js/);
  } finally {
    await server.close();
  }
});

test("eval ui server discovers specs and runs a spec job", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-ui-job-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const specPath = await writeEvalSpec(repo, "ui-job");
  const server = await startEvalUiServer({ specPath, cwd: repo, open: false });
  try {
    const specs = await (await fetch(`${server.url}api/eval/specs`)).json();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].name, "ui-job");
    const spec = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}`)).json();
    assert.match(spec.cases[0].prompt, /Change the value/);
    assert.equal(spec.cases[0].variants[0].agent.kind, "manual");

    const started = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}/runs`, { method: "POST" })).json();
    assert.equal(started.status, "running");
    const done = await waitForJob(server.url, started.id, "done");
    assert.ok(done.runId);
    const status = await (await fetch(`${server.url}api/eval/runs/${done.runId}/status`)).json();
    assert.equal(status.variants[0].status, "manual");
  } finally {
    await server.close();
  }
});

test("eval ui server cancels a running spec job", async () => {
  const repo = await createRepo();
  const evalHome = await mkdtemp(path.join(tmpdir(), "tangent-eval-ui-cancel-home-"));
  process.env.TANGENT_EVAL_HOME = evalHome;

  await writeFile(path.join(repo, "index.ts"), "export const value = 1;\n", "utf8");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");

  const command = await fakeCodexCommand(true);
  const specPath = await writeEvalSpec(repo, "ui-cancel", command, [
    { id: "left", context: { mode: "repo" } },
    { id: "right", context: { mode: "repo" } }
  ]);
  const server = await startEvalUiServer({ specPath, cwd: repo, open: false });
  try {
    const specs = await (await fetch(`${server.url}api/eval/specs`)).json();
    const started = await (await fetch(`${server.url}api/eval/specs/${encodeURIComponent(specs[0].id)}/runs`, { method: "POST" })).json();
    await waitForEvents(server.url, started.id, (event) => event.type === "phase.agent-started", 2);
    await fetch(`${server.url}api/eval/jobs/${started.id}/cancel`, { method: "POST" });
    const cancelled = await waitForJob(server.url, started.id, "cancelled");
    assert.ok(cancelled.runId);
    const status = await (await fetch(`${server.url}api/eval/runs/${cancelled.runId}/status`)).json();
    assert.deepEqual(status.variants.map((variant) => variant.status), ["cancelled", "cancelled"]);
    assert.deepEqual(status.variants.map((variant) => variant.phases[0].status), ["cancelled", "cancelled"]);
  } finally {
    await server.close();
  }
});

/** Creates a temporary git repository for eval tests. */
async function createRepo(repoPath) {
  const repo = repoPath || await mkdtemp(path.join(tmpdir(), "tangent-eval-repo-"));
  await mkdir(repo, { recursive: true });
  await git(repo, "init");
  await git(repo, "config", "user.name", "Test User");
  await git(repo, "config", "user.email", "test@example.invalid");
  return repo;
}

/** Runs a git command in the given repository. */
async function git(repo, ...args) {
  await execFileAsync("git", ["-C", repo, ...args]);
}

/** Reads a git object as text. */
async function gitShow(repo, ref) {
  const { stdout } = await execFileAsync("git", ["-C", repo, "show", ref]);
  return stdout;
}

/** Resolves a git ref to a commit id. */
async function gitRev(repo, ref) {
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", ref]);
  return stdout.trim();
}

/** Returns whether a path can be read. */
async function fileExists(filePath) {
  return readFile(filePath).then(() => true).catch(() => false);
}

/** Builds a run manifest variant fixture. */
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

/** Builds an eval metrics fixture. */
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

/** Writes eval spec. */
async function writeEvalSpec(repo, name, command, variants = [{ id: "repo", context: { mode: "repo" } }], timeoutMs = 10000) {
  const evalDir = path.join(repo, "evals", name);
  await mkdir(path.join(evalDir, "prompts"), { recursive: true });
  await writeFile(path.join(evalDir, "prompts", "task.md"), "Change the value.\n", "utf8");
  const specPath = path.join(evalDir, "eval.json");
  await writeFile(specPath, JSON.stringify({
    schema: "eval.spec.v1",
    name,
    defaults: {
      repo: { path: repo, ref: "HEAD" },
      cwd: ".",
      agent: command ? { kind: "codex-cli", command, model: "fake", sandbox: "workspace-write", timeoutMs } : { kind: "manual" },
      phases: ["implement"]
    },
    cases: [
      {
        id: "case-a",
        prompt: "prompts/task.md",
        variants
      }
    ]
  }, null, 2), "utf8");
  return specPath;
}

/** Writes snapshot eval spec. */
async function writeSnapshotEvalSpec(repo, noSearchRef, withSearchRef) {
  const evalDir = path.join(repo, "evals", "context-compare");
  await mkdir(path.join(evalDir, "prompts"), { recursive: true });
  await writeFile(path.join(evalDir, "prompts", "task.md"), "Compare contexts.\n", "utf8");
  const specPath = path.join(evalDir, "eval.json");
  await writeFile(specPath, JSON.stringify({
    schema: "eval.spec.v1",
    name: "context-compare",
    defaults: {
      repo: { path: repo, ref: "HEAD" },
      cwd: ".",
      agent: { kind: "manual" },
      phases: ["implement"]
    },
    cases: [
      {
        id: "case-a",
        prompt: "prompts/task.md",
        variants: [
          { id: "no-search", context: { mode: "snapshot", ref: noSearchRef } },
          { id: "with-search", context: { mode: "snapshot", ref: withSearchRef } }
        ]
      }
    ]
  }, null, 2), "utf8");
  return specPath;
}

/** Supports the fake codex command helper. */
async function fakeCodexCommand(blocking) {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-fake-codex-"));
  const file = path.join(dir, "fake-codex.sh");
  await writeFile(file, `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    out="$1"
  fi
  shift || true
done
cat >/dev/null
printf '${blocking ? "fake agent waiting" : "fake agent complete"}\\n'
${blocking ? "trap 'exit 143' TERM INT\nwhile :; do sleep 1; done" : "[ -n \"$out\" ] && printf 'fake final\\n' > \"$out\"\nexit 0"}
`, "utf8");
  await chmod(file, 0o755);
  return file;
}

/** Supports the fake variant outcome codex command helper. */
async function fakeVariantOutcomeCodexCommand(coordinationDir, failingVariant) {
  const dir = await mkdtemp(path.join(tmpdir(), "tangent-fake-codex-"));
  const file = path.join(dir, "fake-codex.sh");
  await writeFile(file, `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    out="$1"
  fi
  shift || true
done
cat >/dev/null
if [ "$TANGENT_EVAL_VARIANT_ID" = ${shellQuote(failingVariant)} ]; then
  printf 'intentional failure\\n' >&2
  exit 7
fi
coord=${shellQuote(coordinationDir)}
printf 'done\\n' > "$coord/$TANGENT_EVAL_VARIANT_ID.done"
[ -n "$out" ] && printf 'fake final %s\\n' "$TANGENT_EVAL_VARIANT_ID" > "$out"
exit 0
`, "utf8");
  await chmod(file, 0o755);
  return file;
}

/** Reads latest run manifest. */
async function readLatestRunManifest(evalHome) {
  const runsPath = path.join(evalHome, "runs");
  const manifests = [];
  for (const entry of await readdir(runsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(await readFile(path.join(runsPath, entry.name, "run.json"), "utf8"));
    manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return manifests[0];
}

/** Supports the shell quote helper. */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Supports the wait for job helper. */
async function waitForJob(baseUrl, jobId, status) {
  const deadline = Date.now() + 30000;
  let lastJob;
  while (Date.now() < deadline) {
    const job = await (await fetch(`${baseUrl}api/eval/jobs/${jobId}`)).json();
    lastJob = job;
    if (job.status === status) return job;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${status}; last=${JSON.stringify(lastJob)}`);
}

/** Supports the wait for events helper. */
async function waitForEvents(baseUrl, jobId, predicate, count) {
  const deadline = Date.now() + 15000;
  let after = 0;
  const matches = [];
  while (Date.now() < deadline) {
    const events = await (await fetch(`${baseUrl}api/eval/jobs/${jobId}/events?after=${after}`)).json();
    for (const event of events) {
      after = Math.max(after, event.seq);
      if (predicate(event)) matches.push(event);
      if (matches.length >= count) return matches;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${count} events from job ${jobId}; matched=${matches.length}`);
}

/** Supports the sleep helper. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
