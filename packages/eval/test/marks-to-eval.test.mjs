import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMarkRecord, readMark, writeMark } from "../dist/marks/store.js";
import {
  buildEvalSpec,
  deriveEvalSlug,
  draftCriteriaFromExpected,
  renderReadme,
  renderTaskPromptFile,
  runToEval,
  selectTaskPrompt
} from "../dist/marks/to-eval.js";

const anchor = {
  provider: "claude",
  sessionId: "session-1",
  conversationId: "claude:session-1",
  transcriptPath: "/home/user/.claude/projects/repo/session-1.jsonl"
};
const repo = { root: "/Users/me/Projects/example", branch: "main" };

/** Creates a temp marks directory for a test, and returns it plus a cleanup function. */
async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  /** Removes the temp directory created for this test. */
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

// --- Pure helpers: slug derivation, prompt selection, criteria drafting. ---

test("deriveEvalSlug uses a sanitized --name override when given", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "note" }, new Date("2026-07-05T14:30:12.000Z"));
  assert.equal(deriveEvalSlug(mark, "  Read The Docs First!  "), "read-the-docs-first");
});

test("deriveEvalSlug falls back to the mark's own slug (the id, minus its timestamp prefix)", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "you should have read the docs index first" }, new Date("2026-07-05T14:30:12.000Z"));
  assert.equal(mark.id, "20260705T143012-you-should-have-read-the-docs");
  assert.equal(deriveEvalSlug(mark), "you-should-have-read-the-docs");
});

test("deriveEvalSlug sanitizes a custom mark id with no timestamp prefix", () => {
  const mark = createMarkRecord({ id: "My Custom Id!!", anchor, repo, observed: "note" });
  assert.equal(deriveEvalSlug(mark), "my-custom-id");
});

test("selectTaskPrompt picks the last user message at or before the anchor ordinal when the anchor has one", () => {
  const mark = createMarkRecord({
    anchor: { ...anchor, ordinal: 5 },
    repo,
    observed: "note",
    at: "2026-07-05T14:30:12.000Z"
  });
  const userMessages = [
    { ordinal: 1, at: "2026-07-05T14:00:00.000Z", text: "first ask" },
    { ordinal: 3, at: "2026-07-05T14:10:00.000Z", text: "second ask" },
    { ordinal: 9, at: "2026-07-05T14:40:00.000Z", text: "asked after the mark, must not be picked" }
  ];
  const selection = selectTaskPrompt(mark, userMessages);
  assert.equal(selection.text, "second ask");
  assert.equal(selection.source, "conversation");
});

test("selectTaskPrompt falls back to the mark's own at timestamp when the anchor has no ordinal", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "note", at: "2026-07-05T14:30:12.000Z" });
  const userMessages = [
    { ordinal: 1, at: "2026-07-05T14:00:00.000Z", text: "first ask" },
    { ordinal: 3, at: "2026-07-05T14:20:00.000Z", text: "second ask" },
    { ordinal: 9, at: "2026-07-05T14:40:00.000Z", text: "after the mark" }
  ];
  const selection = selectTaskPrompt(mark, userMessages);
  assert.equal(selection.text, "second ask");
});

test("selectTaskPrompt drafts a stub from observed/expected/hypothesis when there are no user messages", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "greped for six minutes", expected: "should have read docs/index.md", hypothesis: "CLAUDE.md never points at docs/index.md" });
  const selection = selectTaskPrompt(mark, []);
  assert.equal(selection.source, "stub");
  assert.equal(selection.text, "Observed: greped for six minutes\n\nExpected: should have read docs/index.md\n\nHypothesis: CLAUDE.md never points at docs/index.md");
});

test("draftCriteriaFromExpected splits sentences and semicolon clauses into one binary criterion each", () => {
  const criteria = draftCriteriaFromExpected("Should have read docs/index.md before searching. Should not have modified unrelated files; should have run the test suite.");
  assert.deepEqual(criteria, [
    { id: "criterion-1", statement: "The agent read docs/index.md before searching.", points: 1 },
    { id: "criterion-2", statement: "The agent not have modified unrelated files.", points: 1 },
    { id: "criterion-3", statement: "The agent run the test suite.", points: 1 }
  ]);
});

test("draftCriteriaFromExpected returns one placeholder criterion when expected is empty", () => {
  const criteria = draftCriteriaFromExpected(undefined);
  assert.equal(criteria.length, 1);
  assert.equal(criteria[0].id, "criterion-1");
});

test("buildEvalSpec produces one case with baseline/fixed snapshot variants and the drafted evaluator block", () => {
  const mark = createMarkRecord({ anchor, repo, observed: "note", expected: "should have read docs/index.md" });
  const spec = buildEvalSpec({ slug: "my-slug", mark, agent: { kind: "manual" }, phases: ["plan", "implement"], judgeModel: "haiku" });
  assert.equal(spec.schema, "eval.spec.v1");
  assert.equal(spec.name, "my-slug");
  assert.equal(spec.markId, mark.id, "the report renderers link back to the originating mark via markId");
  assert.equal(spec.evaluator.model, "haiku");
  assert.deepEqual(spec.evaluator.criteria, [{ id: "criterion-1", statement: "The agent read docs/index.md.", points: 1 }]);
  assert.equal(spec.cases.length, 1);
  assert.equal(spec.cases[0].id, "my-slug");
  assert.equal(spec.cases[0].prompt, "prompts/task.md");
  assert.deepEqual(spec.cases[0].variants, [
    { id: "baseline", context: { mode: "snapshot", ref: "refs/tangent/eval/contexts/my-slug-baseline" } },
    { id: "fixed", context: { mode: "snapshot", ref: "refs/tangent/eval/contexts/my-slug-fixed" } }
  ]);
});

test("renderTaskPromptFile banners a conversation-sourced prompt differently from a stub", () => {
  const mark = createMarkRecord({ id: "my-id", anchor, repo, observed: "note" });
  const fromConversation = renderTaskPromptFile(mark, { text: "do the thing", source: "conversation" });
  assert.match(fromConversation, /^<!-- Generated by "tangent mark to-eval my-id"\. This is the user message nearest the marked moment/);
  assert.match(fromConversation, /do the thing\n$/);

  const stub = renderTaskPromptFile(mark, { text: "Observed: x", source: "stub" });
  assert.match(stub, /^<!-- Generated by "tangent mark to-eval my-id"\. The session was not indexed yet/);
});

test("renderReadme prints the baseline-then-fixed capture commands in order", () => {
  const mark = createMarkRecord({ id: "my-id", anchor, repo, observed: "note" });
  const readme = renderReadme({ mark, slug: "my-slug", repoRoot: "/repo" });
  const baselineIndex = readme.indexOf("tangent eval context capture my-slug-baseline --repo /repo --cwd . --include-ancestors");
  const fixedIndex = readme.indexOf("tangent eval context capture my-slug-fixed --repo /repo --cwd . --include-ancestors --include-dirty-context");
  assert.ok(baselineIndex >= 0 && fixedIndex >= 0 && baselineIndex < fixedIndex, "baseline capture command must come before the fixed capture command");
  assert.match(readme, /tangent eval run evals\/my-slug\/eval\.json/);
});

// --- runToEval: golden-file assertions on the generated eval.json/task.md/README.md, and the mark update. ---

test("runToEval golden file: an indexed conversation produces the exact scaffold and updates the mark", async () => {
  const { dir: marksDir, cleanup: cleanupMarks } = await tempDir("tangent-marks-to-eval-");
  const { dir: repoDir, cleanup: cleanupRepo } = await tempDir("tangent-eval-scaffold-repo-");
  try {
    const mark = createMarkRecord({
      id: "20260705T143012-read-docs-first",
      anchor: { ...anchor, ordinal: 5 },
      repo: { root: repoDir, branch: "main" },
      observed: "greped the codebase for six minutes instead of reading docs/index.md",
      expected: "should have read docs/index.md before searching",
      hypothesis: "CLAUDE.md never says docs/index.md is the entry point",
      at: "2026-07-05T14:30:12.000Z"
    }, new Date("2026-07-05T14:30:12.000Z"));
    await writeMark(mark, marksDir);

    /** Fake dependencies standing in for the real usage index; readMark/updateMark use the real store against marksDir. */
    const deps = {
      /** Stub index refresh; the golden test does not need a real database. */
      ensureIndex: async () => ({}),
      /** Stub conversation reader returning one user message before the anchor ordinal and one after. */
      readMessages: async () => [{
        conversationId: anchor.conversationId,
        userMessages: [
          { ordinal: 2, at: "2026-07-05T14:20:00.000Z", text: "please add a feature flag for the new rollout" },
          { ordinal: 9, at: "2026-07-05T14:45:00.000Z", text: "this came after the mark and must not be picked" }
        ]
      }]
    };

    const result = await runToEval({ markId: mark.id, marksDir }, deps);

    assert.equal(result.slug, "read-docs-first");
    assert.equal(result.promptSource, "conversation");
    assert.equal(result.evalDir, path.join(repoDir, "evals", "read-docs-first"));

    const spec = JSON.parse(await readFile(result.specPath, "utf8"));
    assert.deepEqual(spec, {
      schema: "eval.spec.v1",
      name: "read-docs-first",
      markId: "20260705T143012-read-docs-first",
      defaults: {
        repo: { path: ".", ref: "HEAD" },
        cwd: ".",
        agent: { kind: "manual" },
        phases: ["plan", "implement"]
      },
      evaluator: {
        model: "haiku",
        criteria: [{ id: "criterion-1", statement: "The agent read docs/index.md before searching.", points: 1 }]
      },
      cases: [{
        id: "read-docs-first",
        prompt: "prompts/task.md",
        variants: [
          { id: "baseline", context: { mode: "snapshot", ref: "refs/tangent/eval/contexts/read-docs-first-baseline" } },
          { id: "fixed", context: { mode: "snapshot", ref: "refs/tangent/eval/contexts/read-docs-first-fixed" } }
        ]
      }]
    });

    const taskPrompt = await readFile(result.promptPath, "utf8");
    assert.equal(
      taskPrompt,
      `<!-- Generated by "tangent mark to-eval 20260705T143012-read-docs-first". This is the user message nearest the marked moment, pulled from the Usage index. Edit freely: this file is the eval's task prompt, not the mark record. -->\n\nplease add a feature flag for the new rollout\n`
    );

    const updated = await readMark(mark.id, marksDir);
    assert.equal(updated.status, "eval-created");
    assert.deepEqual(updated.links, { eval: "evals/read-docs-first", fix: null });
    assert.deepEqual(result.mark.links, updated.links);
  } finally {
    await cleanupMarks();
    await cleanupRepo();
  }
});

test("runToEval falls back to a stub prompt when the session is not indexed", async () => {
  const { dir: marksDir, cleanup: cleanupMarks } = await tempDir("tangent-marks-to-eval-unindexed-");
  const { dir: repoDir, cleanup: cleanupRepo } = await tempDir("tangent-eval-scaffold-unindexed-repo-");
  try {
    const mark = createMarkRecord({
      anchor,
      repo: { root: repoDir },
      observed: "spent 11 minutes reading files before finding the right one",
      expected: "should have used structural search"
    });
    await writeMark(mark, marksDir);

    const deps = {
      /** Stub index refresh that never finds the transcript. */
      ensureIndex: async () => ({}),
      /** Stub conversation reader with no messages, as an unindexed session returns. */
      readMessages: async (options) => options.conversationIds.map((conversationId) => ({ conversationId, userMessages: [] }))
    };

    const result = await runToEval({ markId: mark.id, marksDir }, deps);
    assert.equal(result.promptSource, "stub");
    const taskPrompt = await readFile(result.promptPath, "utf8");
    assert.match(taskPrompt, /^<!-- Generated by "tangent mark to-eval .+"\. The session was not indexed yet/);
    assert.match(taskPrompt, /Observed: spent 11 minutes reading files before finding the right one/);
    assert.match(taskPrompt, /Expected: should have used structural search/);
  } finally {
    await cleanupMarks();
    await cleanupRepo();
  }
});

test("runToEval also falls back to a stub prompt when the index lookup throws", async () => {
  const { dir: marksDir, cleanup: cleanupMarks } = await tempDir("tangent-marks-to-eval-index-error-");
  const { dir: repoDir, cleanup: cleanupRepo } = await tempDir("tangent-eval-scaffold-index-error-repo-");
  try {
    const mark = createMarkRecord({ anchor, repo: { root: repoDir }, observed: "note" });
    await writeMark(mark, marksDir);

    const deps = {
      /** Stub index refresh that fails, as it would with no better-sqlite3 or a missing repo. */
      ensureIndex: async () => { throw new Error("boom"); },
      /** Stub reader that must never run: ensureIndex failing should short-circuit before this is called. */
      readMessages: async () => { throw new Error("must not be called"); }
    };

    const result = await runToEval({ markId: mark.id, marksDir }, deps);
    assert.equal(result.promptSource, "stub");
  } finally {
    await cleanupMarks();
    await cleanupRepo();
  }
});

test("runToEval honors a --name slug override and an explicit --repo, independent of the mark's own repo", async () => {
  const { dir: marksDir, cleanup: cleanupMarks } = await tempDir("tangent-marks-to-eval-name-override-");
  const { dir: repoDir, cleanup: cleanupRepo } = await tempDir("tangent-eval-scaffold-override-repo-");
  try {
    const mark = createMarkRecord({ anchor, repo: { root: "/somewhere/else" }, observed: "note" });
    await writeMark(mark, marksDir);

    const deps = {
      /** Stub index refresh; this test only cares about slug and repo resolution. */
      ensureIndex: async () => ({}),
      /** Stub reader with no messages, so the scaffold falls back to the mark's own stub text. */
      readMessages: async () => []
    };
    const result = await runToEval({ markId: mark.id, name: "Custom Slug", repo: repoDir, marksDir }, deps);

    assert.equal(result.slug, "custom-slug");
    assert.equal(result.evalDir, path.join(repoDir, "evals", "custom-slug"));
    assert.equal(await readFile(result.specPath, "utf8").then((text) => JSON.parse(text).name), "custom-slug");
  } finally {
    await cleanupMarks();
    await cleanupRepo();
  }
});
