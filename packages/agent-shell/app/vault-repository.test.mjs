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
