import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendIdea, areaNoteTemplate, currentSectionKey, ensureAreaNoteLinks, ensureVaultRootLinks, ideasFromFile, noteSignal, orderGoals, removeGoalsSection, vaultRootAgentsText } from "./area-note-links.mjs";

test("an Area gets its template note and two relative links once, and a real file is never replaced", async () => {
  const trees = await mkdtemp(path.join(os.tmpdir(), "area-note-links-"));
  await mkdir(path.join(trees, "otto", "dnd"), { recursive: true });
  const first = await ensureAreaNoteLinks({ treesRoot: trees, area: "otto/dnd" });
  assert.deepEqual(first, ["otto/dnd/dnd.md", "otto/dnd/AGENTS.md", "otto/dnd/CLAUDE.md"]);
  assert.equal(await readFile(path.join(trees, "otto", "dnd", "dnd.md"), "utf8"), areaNoteTemplate("Dnd"));
  assert.equal(await readlink(path.join(trees, "otto", "dnd", "AGENTS.md")), "dnd.md", "a relative link to the note");
  assert.equal(await readlink(path.join(trees, "otto", "dnd", "CLAUDE.md")), "AGENTS.md");
  assert.deepEqual(await ensureAreaNoteLinks({ treesRoot: trees, area: "otto/dnd" }), [], "idempotent");
  await mkdir(path.join(trees, "otto", "real"), { recursive: true });
  await writeFile(path.join(trees, "otto", "real", "real.md"), "# Real\n", "utf8");
  await writeFile(path.join(trees, "otto", "real", "AGENTS.md"), "hand-written\n", "utf8");
  assert.deepEqual(await ensureAreaNoteLinks({ treesRoot: trees, area: "otto/real" }), ["otto/real/CLAUDE.md"]);
  assert.equal((await lstat(path.join(trees, "otto", "real", "AGENTS.md"))).isSymbolicLink(), false, "a real AGENTS.md stays");
  assert.equal(await readFile(path.join(trees, "otto", "real", "real.md"), "utf8"), "# Real\n", "an existing note is never rewritten");
  const root = await ensureVaultRootLinks({ treesRoot: trees, agentsText: await vaultRootAgentsText() });
  assert.deepEqual(root, ["AGENTS.md", "CLAUDE.md"]);
  assert.match(await readFile(path.join(trees, "AGENTS.md"), "utf8"), /^# Brains\n/);
  assert.match(await readFile(path.join(trees, "AGENTS.md"), "utf8"), /tangent goal create --area <area> --title "<t>" --start --path <dir>/);
  assert.deepEqual(await ensureVaultRootLinks({ treesRoot: trees, agentsText: "other" }), [], "the root file is written once");
});

test("the template has Purpose, Knowledge, Current, and Ideas and no Goals or Resources", () => {
  const note = areaNoteTemplate("Live Edit");
  assert.equal(note, "---\ntype: area\nstatus: active\n---\n# Live Edit\n## Purpose\n\n## Knowledge\n\n## Current\n\n## Ideas and open questions\n");
});

test("removing the machine-written Goals section keeps every other byte", () => {
  const note = "---\ntype: area\n---\n\n# Tangent\r\n\n## Purpose\n\nThe product.  \n\n## Goals\n\n1. [[goal-a]]\n2. [[goal-b]]\n\n## Knowledge\n\n- Repository: ~/p\n";
  const stripped = removeGoalsSection(note);
  assert.equal(stripped.changed, true);
  assert.equal(stripped.text, "---\ntype: area\n---\n\n# Tangent\r\n\n## Purpose\n\nThe product.  \n\n## Knowledge\n\n- Repository: ~/p\n");
  assert.deepEqual(removeGoalsSection(stripped.text), { text: stripped.text, changed: false });
  const tail = removeGoalsSection("# A\n\n## Goals\n\n1. [[goal-a]]\n");
  assert.equal(tail.text, "# A\n\n");
});

test("the note signal counts lines and ages Current, and warns past the guide", () => {
  const short = noteSignal("# A\n## Current\n\nNow.\n", Date.now() - 3 * 86_400_000);
  assert.deepEqual({ lines: short.lines, currentDays: short.currentDays, warning: short.warning, text: short.text }, { lines: 4, currentDays: 3, warning: false, text: "4 lines · Current 3 days old" });
  const stale = noteSignal("# A\n## Current\n\nNow.\n", Date.now() - 20 * 86_400_000);
  assert.equal(stale.warning, true);
  assert.equal(stale.text, "4 lines · Current 20 days old");
  const long = noteSignal(`# A\n${"- line\n".repeat(120)}`);
  assert.equal(long.warning, true);
  assert.equal(long.text, "121 lines · no Current");
  assert.equal(noteSignal("# A\n## Current\n\nNow.\n", null).text, "4 lines · Current age unknown");
  assert.notEqual(currentSectionKey("## Current\n\nA\n"), currentSectionKey("## Current\n\nB\n"));
});

test("ideas go to ideas.md and read back in order", async () => {
  const trees = await mkdtemp(path.join(os.tmpdir(), "area-ideas-"));
  await mkdir(path.join(trees, "otto", "dnd"), { recursive: true });
  assert.equal(await appendIdea({ treesRoot: trees, area: "otto/dnd", text: " A calmer\nreturn screen. " }), "otto/dnd/ideas.md");
  await appendIdea({ treesRoot: trees, area: "otto/dnd", text: "Second." });
  const text = await readFile(path.join(trees, "otto", "dnd", "ideas.md"), "utf8");
  assert.equal(text, "# Ideas\n\n- A calmer return screen.\n- Second.\n");
  assert.deepEqual(ideasFromFile(text), ["A calmer return screen.", "Second."]);
  await assert.rejects(() => appendIdea({ treesRoot: trees, area: "otto/dnd", text: " " }), /describe the idea/);
});

test("Goals order by status, then creation time, then slug", () => {
  const goals = [
    { slug: "old-open", status: "open", birthtime: 100 },
    { slug: "new-open", status: "open", birthtime: 200 },
    { slug: "done", status: "done", birthtime: 50 },
    { slug: "running", status: "active", birthtime: 300 },
    { slug: "check", status: "verify", birthtime: 400 },
    { slug: "dated", status: "open", created: "2026-01-01", birthtime: 900 },
    { slug: "parked", status: "parked", birthtime: 10 },
  ];
  assert.deepEqual(orderGoals(goals).map((goal) => goal.slug), ["running", "check", "old-open", "new-open", "dated", "parked", "done"]);
});
