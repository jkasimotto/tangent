import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { runVaultCli } from "../dist/cli/index.js";

const execFileAsync = promisify(execFile);

/** Runs Git in the fixture and returns trimmed stdout. */
async function git(root, ...args) {
  return (await execFileAsync("git", ["-C", root, ...args])).stdout.trim();
}

/** Creates a committed vault fixture with the paths used by the CLI proofs. */
async function createVaultFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-cli-vault-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Tangent Test");
  await git(root, "config", "user.email", "tangent@example.com");
  await mkdir(path.join(root, "removed-dir"));
  await writeFile(path.join(root, "named-survivor.md"), "survivor before\n");
  await writeFile(path.join(root, "removed-file.md"), "removed file\n");
  await writeFile(path.join(root, "removed-dir", "one.md"), "removed one\n");
  await writeFile(path.join(root, "removed-dir", "two.md"), "removed two\n");
  await writeFile(path.join(root, "unrelated-staged.md"), "staged before\n");
  await writeFile(path.join(root, "unrelated-unstaged.md"), "unstaged before\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "base");
  return root;
}

/** Points the vault CLI at one fixture without inheriting a worker identity. */
function useVaultFixture(context, root) {
  const previousRoot = process.env.TANGENT_TREES_DIR;
  const previousTmux = process.env.TMUX;
  process.env.TANGENT_TREES_DIR = root;
  delete process.env.TMUX;
  context.after(() => {
    if (previousRoot === undefined) delete process.env.TANGENT_TREES_DIR;
    else process.env.TANGENT_TREES_DIR = previousRoot;
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
  });
}

test("vault commit recovers staged deletions and commits only named paths", async (context) => {
  const root = await createVaultFixture(context);
  useVaultFixture(context, root);

  await rm(path.join(root, "removed-file.md"));
  await rm(path.join(root, "removed-dir"), { recursive: true });
  await git(root, "add", "--", "removed-file.md");
  await writeFile(path.join(root, "named-survivor.md"), "survivor after\n");
  await writeFile(path.join(root, "unrelated-staged.md"), "staged after\n");
  await git(root, "add", "--", "unrelated-staged.md");
  await writeFile(path.join(root, "unrelated-unstaged.md"), "unstaged after\n");
  assert.equal(await git(root, "ls-files", "--", "removed-file.md"), "", "the staged deletion is absent from the shared index");

  await runVaultCli([
    "commit",
    "named-survivor.md",
    "removed-file.md",
    "removed-dir",
    "-m",
    "remove: otto/tangent named paths",
    "--area",
    "otto/tangent",
  ]);

  assert.deepEqual((await git(root, "diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD")).split("\n"), [
    "M\tnamed-survivor.md",
    "D\tremoved-dir/one.md",
    "D\tremoved-dir/two.md",
    "D\tremoved-file.md",
  ]);
  assert.match(await git(root, "log", "-1", "--format=%B"), /Tangent-Area: otto\/tangent/);
  assert.equal(await git(root, "status", "--short"), "M  unrelated-staged.md\n M unrelated-unstaged.md");
});

test("vault commit refuses a never-tracked missing path without changing Git state", async (context) => {
  const root = await createVaultFixture(context);
  useVaultFixture(context, root);
  await writeFile(path.join(root, "named-survivor.md"), "survivor after\n");
  await writeFile(path.join(root, "unrelated-staged.md"), "staged after\n");
  await git(root, "add", "--", "unrelated-staged.md");
  const headBefore = await git(root, "rev-parse", "HEAD");
  const statusBefore = await git(root, "status", "--short");

  await assert.rejects(
    runVaultCli(["commit", "named-survivor.md", "never-tracked.md", "-m", "update: otto/tangent named paths"]),
    /Vault path does not exist and was never tracked: never-tracked\.md/,
  );

  assert.equal(await git(root, "rev-parse", "HEAD"), headBefore);
  assert.equal(await git(root, "status", "--short"), statusBefore);
});
