import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { captureContext, collectEval, prepareEval } from "../dist/sdk/index.js";

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

async function fileExists(filePath) {
  return readFile(filePath).then(() => true).catch(() => false);
}
