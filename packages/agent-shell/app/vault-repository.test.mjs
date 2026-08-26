import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVaultRepository } from "./vault-repository.mjs";

test("vault repository atomically writes and pathspec-commits Markdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-vault-repository-"));
  const calls = [];
  const repository = createVaultRepository({
    root,
    /** Records Git arguments without invoking Git. */
    async runGit(args) { calls.push(args); },
  });

  await repository.writeAndCommit("otto/note.md", "# Note\n", "update: otto note", "otto", "agent-1");

  assert.equal(await readFile(path.join(root, "otto", "note.md"), "utf8"), "# Note\n");
  assert.deepEqual(await readdir(path.join(root, "otto")), ["note.md"]);
  assert.deepEqual(calls[0].slice(-2), ["--", "otto/note.md"]);
  assert.match(calls[0].join("\n"), /Tangent-Tmux: agent-1/);
});

test("vault repository rejects traversal before writing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-vault-repository-"));
  const repository = createVaultRepository({
    root,
    /** Git is not reached for an unsafe path. */
    async runGit() { throw new Error("unexpected"); },
  });
  await assert.rejects(repository.writeMarkdown("../outside.md", "bad"), /unsafe vault path/);
});

test("vault repository reports a refused commit instead of hiding it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-vault-repository-"));
  const reported = [];
  const repository = createVaultRepository({
    root,
    /** Refuses every commit the way a rejected vault commit does. */
    async runGit() { const error = new Error("commit rejected"); error.stderr = "the vault refused this commit"; throw error; },
    /** Collects the reported failure instead of printing it. */
    reportError: (message) => reported.push(message),
  });

  const refused = await repository.commit(["otto/note.md"], "note: otto", "otto", null);

  assert.equal(refused.committed, false, "a caller can see that the commit failed");
  assert.match(refused.error, /the vault refused this commit/);
  assert.equal(reported.length, 1, "the failure is still logged");
});

test("vault repository reports a successful commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-vault-repository-"));
  const repository = createVaultRepository({
    root,
    /** Accepts the commit without invoking Git. */
    async runGit() {},
  });
  assert.deepEqual(await repository.commit(["otto/note.md"], "note: otto", "otto", null), { committed: true, error: null });
});
