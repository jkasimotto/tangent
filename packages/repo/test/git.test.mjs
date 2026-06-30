import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { showFile, showFileFollowingSymlinks } from "../dist/git.js";

/** Creates a temp git repo, commits the given { path: content | { link } } entries, and returns its root. */
function repoWith(entries) {
  const root = mkdtempSync(path.join(tmpdir(), "repo-git-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  for (const [filePath, entry] of Object.entries(entries)) {
    const full = path.join(root, filePath);
    mkdirSync(path.dirname(full), { recursive: true });
    if (typeof entry === "string") writeFileSync(full, entry);
    else symlinkSync(entry.link, full);
  }
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return root;
}

test("showFile returns a committed symlink's target path, not the linked content", async () => {
  const root = repoWith({ "AGENTS.md": "real body\n", "CLAUDE.md": { link: "AGENTS.md" } });
  assert.equal(await showFile(root, "HEAD", "CLAUDE.md"), "AGENTS.md");
});

test("showFileFollowingSymlinks reads the linked file's content for a same-directory symlink", async () => {
  const root = repoWith({ "AGENTS.md": "real body\n", "CLAUDE.md": { link: "AGENTS.md" } });
  assert.equal(await showFileFollowingSymlinks(root, "HEAD", "CLAUDE.md"), "real body\n");
});

test("showFileFollowingSymlinks resolves a target relative to the link's directory", async () => {
  const root = repoWith({ "docs/AGENTS.md": "nested body\n", "docs/CLAUDE.md": { link: "AGENTS.md" } });
  assert.equal(await showFileFollowingSymlinks(root, "HEAD", "docs/CLAUDE.md"), "nested body\n");
});

test("showFileFollowingSymlinks resolves a parent-relative target", async () => {
  const root = repoWith({ "AGENTS.md": "root body\n", "sub/CLAUDE.md": { link: "../AGENTS.md" } });
  assert.equal(await showFileFollowingSymlinks(root, "HEAD", "sub/CLAUDE.md"), "root body\n");
});

test("showFileFollowingSymlinks follows a chain of symlinks", async () => {
  const root = repoWith({ "AGENTS.md": "final\n", "AGENT.md": { link: "AGENTS.md" }, "CLAUDE.md": { link: "AGENT.md" } });
  assert.equal(await showFileFollowingSymlinks(root, "HEAD", "CLAUDE.md"), "final\n");
});

test("showFileFollowingSymlinks reads a plain file unchanged", async () => {
  const root = repoWith({ "CLAUDE.md": "plain\n" });
  assert.equal(await showFileFollowingSymlinks(root, "HEAD", "CLAUDE.md"), "plain\n");
});

test("showFileFollowingSymlinks throws on a broken symlink (missing target)", async () => {
  const root = repoWith({ "CLAUDE.md": { link: "MISSING.md" } });
  await assert.rejects(showFileFollowingSymlinks(root, "HEAD", "CLAUDE.md"));
});

test("showFileFollowingSymlinks throws on a symlink cycle", async () => {
  const root = repoWith({ "A.md": { link: "B.md" }, "B.md": { link: "A.md" } });
  await assert.rejects(showFileFollowingSymlinks(root, "HEAD", "A.md"));
});
