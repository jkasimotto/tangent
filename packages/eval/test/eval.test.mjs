import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { captureContext, collectEval, prepareEval, runEval } from "../dist/sdk/index.js";
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

/** Returns whether a path can be read. */
async function fileExists(filePath) {
  return readFile(filePath).then(() => true).catch(() => false);
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
