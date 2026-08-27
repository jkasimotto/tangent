import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { areaNotePath, describeAreaResources, parseAreaResources, resolveWorkFolder, unboundAreaMessage } from "./area-resources.mjs";

test("parses the three resource lines, with backticks, trailing notes, and a tilde", () => {
  const note = [
    "# Area", "", "Repository: ignored outside the section", "", "## Resources", "",
    "- Repository: `~/Projects/x`", "- Worktree: /tmp/x-wt (tracks origin/main)", "- Branch: feature/one", "", "## Notes", "",
  ].join("\n");
  assert.deepEqual(parseAreaResources(note), {
    repository: path.join(os.homedir(), "Projects", "x"),
    worktree: "/tmp/x-wt",
    branch: "feature/one",
  });
});

test("a note with no Resources section binds nothing", () => {
  assert.deepEqual(parseAreaResources("# Area\n\n## Purpose\n\nText\n"), { repository: null, worktree: null, branch: null });
});

/** Writes one Area note with the given Resources lines into a temporary vault. */
async function writeArea(trees, area, lines) {
  const file = areaNotePath(trees, area);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\ntype: area\n---\n\n# ${area}\n\n## Resources\n\n${lines.join("\n")}\n`, "utf8");
}

test("a child inherits the nearest parent folder and branch, the worktree wins over the repository", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "worktree");
  await mkdir(repo, { recursive: true });
  await mkdir(worktree, { recursive: true });
  await writeArea(trees, "otto", [`- Repository: ${repo}`, "- Branch: main"]);
  await writeArea(trees, "otto/mid", [`- Worktree: ${worktree}`]);
  await writeArea(trees, "otto/mid/leaf", []);

  assert.deepEqual(await resolveWorkFolder(trees, "otto/mid/leaf"), { cwd: worktree, source: "area:otto/mid", branch: "main" });
  assert.deepEqual(await resolveWorkFolder(trees, "otto"), { cwd: repo, source: "area:otto", branch: "main" });
  const described = await describeAreaResources(trees, "otto/mid/leaf");
  assert.deepEqual(described, {
    repository: { value: repo, area: "otto" },
    worktree: { value: worktree, area: "otto/mid" },
    branch: { value: "main", area: "otto" },
  });
});

test("a folder that does not exist is skipped and an unbound tree resolves to null", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  await writeArea(trees, "otto", [`- Repository: ${path.join(root, "missing")}`]);
  await writeArea(trees, "otto/leaf", []);
  assert.equal(await resolveWorkFolder(trees, "otto/leaf"), null);
  assert.equal(
    unboundAreaMessage(trees, "otto/leaf"),
    `otto/leaf and its parent Areas bind no repository. Add "- Repository: <path>" under ## Resources in ${areaNotePath(trees, "otto/leaf")}, or pass --path.`,
  );
});

test("a vault folder binds only the Area that declares it and never inherits", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "area-resources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  await writeArea(trees, "otto/docs", [`- Repository: ${path.join(trees, "otto", "docs")}`]);
  await writeArea(trees, "otto/docs/kid", []);
  assert.deepEqual(await resolveWorkFolder(trees, "otto/docs"), { cwd: path.join(trees, "otto", "docs"), source: "area:otto/docs", branch: null });
  assert.equal(await resolveWorkFolder(trees, "otto/docs/kid"), null, "the vault opt-in stops at the Area that made it");
});
