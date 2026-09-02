import assert from "node:assert/strict";
import test from "node:test";
import { blameCommit, findQuoteLine, headingAbove, launchFromAgentContext, observerFor, resolveNoteAuthor, trailerSession, vaultHead } from "./style-note-provenance.mjs";

const TEXT = [
  "# Scene generation",
  "",
  "## Rendering",
  "",
  "Because the pipeline resolves    each anchor before the render pass,",
  "the scene is stable.",
].join("\n");

test("the annotated words are located exactly, then by collapsed whitespace, then not at all", () => {
  assert.deepEqual(findQuoteLine(TEXT, "the scene is stable"), { line: 5, heading: "Rendering" });
  assert.deepEqual(
    findQuoteLine(TEXT, "resolves each anchor"),
    { line: 4, heading: "Rendering" },
    "a quote copied out of the reader has its whitespace collapsed, so the source must be compared the same way",
  );
  assert.equal(findQuoteLine(TEXT, "words that are gone"), null);
  assert.equal(findQuoteLine(TEXT, "   "), null);
});

test("the nearest heading above a line is the note's section, or null above every heading", () => {
  assert.equal(headingAbove(TEXT.split("\n"), 5), "Rendering");
  assert.equal(headingAbove(TEXT.split("\n"), 1), "Scene generation");
  assert.equal(headingAbove(["plain", "text"], 1), null);
});

test("harness facts come off a brain generation and off a queue assignment alike", () => {
  assert.deepEqual(
    launchFromAgentContext({ role: "brain", brain: { attempt: { resolvedLaunch: { harness: "claude-otto", model: "opus-5", effort: "high" } } } }),
    { harness: "claude-otto", model: "opus-5", effort: "high" },
  );
  assert.deepEqual(
    launchFromAgentContext({ role: "worker", assignment: { launch: { harness: "codex", model: "gpt", effort: "" } } }),
    { harness: "codex", model: "gpt", effort: null },
  );
  assert.equal(launchFromAgentContext({ role: "worker", assignment: { launch: {} } }), null);
  assert.equal(launchFromAgentContext(null), null);
});

test("an unnamed caller is Julian, a brain session is a brain, and any other session is an agent", () => {
  assert.equal(observerFor({ session: "", role: "local-shell" }, null).kind, "julian");
  assert.equal(observerFor({ session: "tangent-brain-g4", role: "brain", area: "otto/tangent" }, null).kind, "brain");
  assert.equal(observerFor({ session: "some-shell", role: "local-session" }, null).kind, "agent", "an unknown session never claims to be Julian");
  assert.equal(observerFor({ session: "tangent-brain-g4", role: "brain" }, { harness: "claude-otto", model: "opus-5", effort: "high" }).model, "opus-5");
});

test("blame and trailer output are read without guessing", () => {
  assert.equal(blameCommit("9c1e4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e 12 12 1\nauthor Julian\n"), "9c1e4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e");
  assert.equal(blameCommit("0000000000000000000000000000000000000000 1 1 1\n"), null, "an uncommitted line has no author");
  assert.equal(blameCommit(""), null);
  assert.equal(trailerSession("tangent-scene-2\n"), "tangent-scene-2");
  assert.equal(trailerSession("\n\n"), "");
});

/** A git double that answers each command with fixed stdout, or throws for a named failure. */
function git(answers) {
  return async (args) => {
    const verb = args[2];
    const answer = answers[verb];
    if (answer === undefined) throw new Error(`unexpected git ${verb}`);
    if (answer instanceof Error) throw answer;
    return { stdout: answer };
  };
}

test("a resolved author names the harness that wrote the words", async () => {
  const author = await resolveNoteAuthor({
    runGit: git({ blame: "9c1e4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e 12 12 1\n", show: "tangent-scene-2\n" }),
    root: "/vault",
    file: "otto/tangent/a.md",
    line: 41,
    /** Resolves the blamed session to the run that produced it. */
    launchForSession: async (session) => (session === "tangent-scene-2" ? { harness: "claude-otto", model: "opus-5", effort: "high" } : null),
  });
  assert.deepEqual(author, { source: "blame-trailer", commit: "9c1e4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", session: "tangent-scene-2", harness: "claude-otto", model: "opus-5", effort: "high" });
});

test("each resolution step that fails says which step it was", async () => {
  /** Never called: these cases fail before a session is ever named. */
  const noLaunch = async () => null;
  assert.deepEqual(
    await resolveNoteAuthor({ runGit: git({}), root: "/vault", file: "a.md", line: null, launchForSession: noLaunch }),
    { source: "quote-not-found" },
    "no located line means no blame was even attempted",
  );
  assert.deepEqual(
    await resolveNoteAuthor({ runGit: git({ blame: new Error("not a git repository") }), root: "/vault", file: "a.md", line: 0, launchForSession: noLaunch }),
    { source: "no-blame" },
  );
  assert.deepEqual(
    await resolveNoteAuthor({ runGit: git({ blame: "abc1234 1 1 1\n", show: "\n" }), root: "/vault", file: "a.md", line: 0, launchForSession: noLaunch }),
    { source: "no-trailer", commit: "abc1234" },
    "a Document Julian saved in the reader carries no session trailer",
  );
  assert.deepEqual(
    await resolveNoteAuthor({ runGit: git({ blame: "abc1234 1 1 1\n", show: "pruned-session\n" }), root: "/vault", file: "a.md", line: 0, launchForSession: noLaunch }),
    { source: "unknown-session", commit: "abc1234", session: "pruned-session" },
    "a pruned Job record leaves the author unknown rather than guessed",
  );
});

test("the vault HEAD is recorded when git can answer and null when it cannot", async () => {
  assert.equal(await vaultHead({ runGit: git({ "rev-parse": "33b5efb29dc7707f118091e6214e51275185f51d\n" }), root: "/vault" }), "33b5efb29dc7707f118091e6214e51275185f51d");
  assert.equal(await vaultHead({ runGit: git({ "rev-parse": new Error("no HEAD") }), root: "/vault" }), null);
});
