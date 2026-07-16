import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { commitPath } from "../dist/worktree.js";
import { statusPorcelain } from "../dist/git.js";

/** Creates a temp git repo with local user config and an initial empty commit, so `commitPath` has a HEAD to diff against. */
function initRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "repo-commitpath-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.email", "t@t.t"]);
  execFileSync("git", ["-C", root, "config", "user.name", "t"]);
  execFileSync("git", ["-C", root, "commit", "-q", "--allow-empty", "-m", "init"]);
  return root;
}

test("commitPath commits only the targeted file, leaving an unrelated dirty file uncommitted", async () => {
  const root = initRepo();
  writeFileSync(path.join(root, "state-of-play.md"), "shared state\n");
  writeFileSync(path.join(root, "unrelated.md"), "half-finished human edit\n");

  await commitPath(root, "state-of-play.md", "update: state-of-play threads section");

  const status = await statusPorcelain(root);
  // state-of-play.md was committed and no longer shows as dirty; unrelated.md remains untracked/dirty.
  assert.doesNotMatch(status, /state-of-play\.md/);
  assert.match(status, /unrelated\.md/);

  const log = execFileSync("git", ["-C", root, "log", "-1", "--pretty=%s"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(log, "update: state-of-play threads section");

  const show = execFileSync("git", ["-C", root, "show", "--stat", "-1", "--pretty=format:"], { cwd: root, encoding: "utf8" }).trim();
  assert.match(show, /state-of-play\.md/);
  assert.doesNotMatch(show, /unrelated\.md/);
});

test("commitPath does not override the repo's committer identity", async () => {
  const root = initRepo();
  writeFileSync(path.join(root, "state-of-play.md"), "shared state\n");

  await commitPath(root, "state-of-play.md", "update: state-of-play threads section");

  const author = execFileSync("git", ["-C", root, "log", "-1", "--pretty=%an <%ae>"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(author, "t <t@t.t>");
});

test("commitPath is a no-op (returns current commit) when the targeted path has no changes", async () => {
  const root = initRepo();
  writeFileSync(path.join(root, "state-of-play.md"), "shared state\n");
  await commitPath(root, "state-of-play.md", "update: state-of-play threads section");
  const before = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const result = await commitPath(root, "state-of-play.md", "update: state-of-play threads section (again)");

  const after = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(after, before);
  assert.equal(result, before);
});
