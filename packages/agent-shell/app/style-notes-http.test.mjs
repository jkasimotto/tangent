// The acceptance bar for style notes, proved against a real Agent Shell server
// on an ephemeral vault: a style note is invisible, silent, and durable.
//
// The invisibility claim is the one worth proving end to end, because the
// design bought it with absence rather than with suppression
// (docs/design/style-notes/design-record.md D1). So the assertions compare the
// whole world before and after: every byte of the vault, its git history and
// worktree state, every durable record outside it, the message log, and the
// exact comment listing with its numbering.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const INSTANCE_ID = `style-notes-http-${process.pid}`;
const AUTHOR_SESSION = "tangent-scene-2";

// Two comments in the shape the 89 real ones have: one standalone under a
// heading, one anchored to a highlighted span. Their meaning must not change.
const DOCUMENT_BEFORE = [
  "---",
  "type: document",
  "---",
  "",
  "# Scene generation",
  "",
  "{>>Julian: Say why the anchors matter.<<}",
  "",
  "## Rendering",
  "",
  "The {==render pass==}{>>Julian: Name the pass.<<} runs once.",
  "",
].join("\n");

const AUTHORED_PARAGRAPH = "Because the pipeline resolves each anchor before the render pass begins, the scene is stable.";

/** Reserves one local test port. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Waits until the fixture server accepts requests. */
async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

/** Finds the Node executable for the fixture process. */
function nodeExecutable() {
  const candidates = [...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")), process.execPath];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate)) ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Runs git inside the fixture vault with a fixed identity. */
function git(trees, args) {
  return execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
}

/** Every file under one directory as path-to-digest, so a change anywhere is visible. */
async function snapshot(root) {
  const digests = {};
  /** Walks one directory, skipping git's own volatile bookkeeping. */
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A symlink is compared by its target, because the server drops one for
      // the Area skills folder and its target need not exist.
      if (entry.isSymbolicLink()) digests[relative] = `link:${await readlink(absolute)}`;
      else if (entry.isDirectory()) await walk(absolute, relative);
      else digests[relative] = createHash("sha256").update(await readFile(absolute)).digest("hex");
    }
  }
  if (existsSync(root)) await walk(root, "");
  return digests;
}

/** Posts one style note and returns its status and parsed body. */
async function postStyleNote(base, body, session = "") {
  const response = await fetch(`${base}/api/style-notes`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { "x-tangent-session": session } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test("a style note is recorded with provenance and changes nothing else in the world", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "style-notes-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "test");
  const corpus = path.join(root, "style-notes.jsonl");
  const messageLog = path.join(root, "messages.jsonl");
  const brains = path.join(root, "brains");
  const design = path.join(area, "design-scene.md");
  await Promise.all([mkdir(area, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(path.join(brains, "otto", "test"), { recursive: true })]);
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n");
  await writeFile(path.join(area, "test.md"), "---\ntype: area\n---\n\n# Test\n");
  await writeFile(design, DOCUMENT_BEFORE);
  // The two surfaces that read a Document's comment count out of the vault
  // index rather than out of the reader: the prompt a worker is given, and the
  // For Julian row a brain wrote. Both must read the same after a style note.
  await writeFile(path.join(area, "goal-render-the-scene.md"), "---\ntype: goal\nstatus: active\ndone_when: The scene renders.\n---\n\n# Render the scene\n\n## Sources\n\n- [[design-scene]]\n");
  await writeFile(path.join(area, "plan.md"), "# Plan\n\n## For Julian\n\n- Decide [[design-scene]]: Do the anchors matter?\n");
  // The brain that wrote the authored paragraph, so its session resolves to a
  // harness, model, and effort exactly as the live server resolves one.
  await writeFile(path.join(brains, "otto", "test", "brain.json"), JSON.stringify({
    schema: "area-brain.v1", area: "otto/test", status: "stopped", generation: 1, session: AUTHOR_SESSION,
    planFile: "otto/test/plan.md",
    generations: [{ generation: 1, session: AUTHOR_SESSION, resolvedLaunch: { harness: "claude-otto", model: "opus-5", effort: "high" } }],
  }));

  await git(trees, ["init", "-q"]);
  await git(trees, ["add", "-A"]);
  await git(trees, ["commit", "-q", "-m", "add: otto/test the Document"]);
  // A second commit written the way a Tangent agent writes one: with the
  // session trailer that makes the author of these words recoverable.
  await writeFile(design, DOCUMENT_BEFORE.replace("The {==render pass==}", `${AUTHORED_PARAGRAPH}\n\nThe {==render pass==}`));
  await git(trees, ["add", "-A"]);
  await git(trees, ["commit", "-q", "-m", "update: otto/test the render paragraph", "-m", "Tangent-Area: otto/test\nTangent-Tmux: " + AUTHOR_SESSION]);

  const port = await freePort().catch((error) => {
    if (error?.code === "EPERM") return null;
    throw error;
  });
  if (!port) return context.skip("This environment does not permit local HTTP listeners.");
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees, WORKSPACE: workspace,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: brains,
      TANGENT_STYLE_NOTES_FILE: corpus, AGENT_MESSAGE_LOG: messageLog, GROQ_API_KEY: "",
      CHAT_SESSION: `style-notes-http-test-${process.pid}`, TANGENT_SHELL_INSTANCE_ID: INSTANCE_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const file = "otto/test/design-scene.md";
  const commentsBefore = await fetch(`${base}/api/document/comments?file=${encodeURIComponent(file)}`).then((response) => response.json());
  const documentBefore = await fetch(`${base}/api/document?file=${encodeURIComponent(file)}`).then((response) => response.json());
  const vaultBefore = await fetch(`${base}/api/vault`).then((response) => response.json());
  const headBefore = (await git(trees, ["rev-parse", "HEAD"])).stdout.trim();
  const vaultFilesBefore = await snapshot(trees);
  const brainsBefore = await snapshot(brains);
  const messagesBefore = await readFile(messageLog, "utf8").catch(() => "");
  const goalFile = "otto/test/goal-render-the-scene.md";
  const promptBefore = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(goalFile)}`).then((response) => response.json());
  const forJulianBefore = await fetch(`${base}/api/brains/show?area=otto/test`).then((response) => response.json());
  assert.equal(commentsBefore.comments.length, 2, "the fixture carries the two comment shapes the real vault uses");
  assert.equal(typeof promptBefore.markdown, "string", `the Goal brief was built: ${JSON.stringify(promptBefore).slice(0, 200)}`);
  assert.match(promptBefore.markdown, /\(2 open comments from Julian\)/, "the worker prompt counts the two comments before the note");
  assert.equal(forJulianBefore.brain.forJulian[0].commentCount, 2, "the For Julian row counts them too");

  // A repaint is woken by a server-sent `changed` frame, so an open stream is
  // the only way to observe that a style note wakes none. The frames are
  // collected for the whole test and read twice: once here, and once at the
  // end against a Document save that must wake one.
  const frames = [];
  const events = await fetch(`${base}/api/events`);
  const eventReader = events.body.getReader();
  context.after(() => eventReader.cancel().catch(() => {}));
  /** Collects every event frame until the stream closes. */
  const collect = async () => {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await eventReader.read();
        if (done) return;
        frames.push(decoder.decode(value));
      }
    } catch {}
  };
  collect();
  await new Promise((resolve) => setTimeout(resolve, 200));

  const filed = await postStyleNote(base, {
    file,
    note: "Three clauses stand before the subject. The point lands last.",
    quote: "Because the pipeline resolves each anchor before the render pass begins",
    tags: ["buried-lede"],
  });
  assert.equal(filed.status, 200);
  const note = filed.body.note;

  // The note itself: a self-contained fact with the author of the words, not
  // the caller who noticed them.
  assert.equal(note.schema, "tangent.style-note.v1");
  assert.equal(note.quote.text, "Because the pipeline resolves each anchor before the render pass begins");
  assert.equal(note.quote.heading, "Rendering", "the note records the section the words stood under");
  assert.deepEqual(
    { known: note.author.known, source: note.author.source, session: note.author.session, harness: note.author.harness, model: note.author.model, effort: note.author.effort },
    { known: true, source: "blame-trailer", session: AUTHOR_SESSION, harness: "claude-otto", model: "opus-5", effort: "high" },
    "git blame plus the vault's own commit trailer names who wrote the sentence",
  );
  assert.equal(note.document.vaultCommit, headBefore, "the entry records the vault revision it read the words from");
  assert.equal(note.observer.kind, "julian", "a request with no session header is Julian in the reader");
  const lines = (await readFile(corpus, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1, "one note is exactly one appended line");
  assert.deepEqual(JSON.parse(lines[0]), note);

  // Invisibility, proved by absence rather than by suppression.
  assert.deepEqual(await snapshot(trees), vaultFilesBefore, "no vault file changed");
  assert.equal((await git(trees, ["rev-parse", "HEAD"])).stdout.trim(), headBefore, "no vault commit was made");
  assert.equal((await git(trees, ["status", "--porcelain"])).stdout.trim(), "", "the vault worktree stayed clean");
  assert.deepEqual(await snapshot(brains), brainsBefore, "no brain record changed, so no notice and no activity");
  assert.equal(await readFile(messageLog, "utf8").catch(() => ""), messagesBefore, "nothing reached the message log");

  const documentAfter = await fetch(`${base}/api/document?file=${encodeURIComponent(file)}`).then((response) => response.json());
  assert.equal(documentAfter.text, documentBefore.text, "the Document Julian reads is byte-identical");
  assert.ok(!documentAfter.text.includes("Three clauses"), "the observation never reaches the rendered Document");
  assert.ok(!documentAfter.text.includes("{>>style"), "no marker was inserted, so no surface has to suppress one");
  const commentsAfter = await fetch(`${base}/api/document/comments?file=${encodeURIComponent(file)}`).then((response) => response.json());
  assert.deepEqual(commentsAfter, commentsBefore, "the comment listing keeps the same entries and the same numbering");
  const vaultAfter = await fetch(`${base}/api/vault`).then((response) => response.json());
  /** The Area-badge comment count of one indexed Document. */
  const countFor = (vault) => vault.documents.find((item) => item.file === file)?.commentCount;
  assert.equal(countFor(vaultAfter), countFor(vaultBefore), "the Area badge count is unchanged");
  assert.equal(countFor(vaultAfter), 2, "the two existing comments still count as open work; the style note does not");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(frames.join("").includes("event: changed"), false, "the note woke no repaint: the route is outside the POST invalidation path");
  const promptAfter = await fetch(`${base}/api/goals/brief?file=${encodeURIComponent(goalFile)}`).then((response) => response.json());
  assert.equal(promptAfter.markdown, promptBefore.markdown, "the prompt a worker is given is unchanged, down to the byte");
  const forJulianAfter = await fetch(`${base}/api/brains/show?area=otto/test`).then((response) => response.json());
  assert.deepEqual(forJulianAfter.brain.forJulian, forJulianBefore.brain.forJulian, "the For Julian rows keep their count and their wording");

  // The copy path strips comment markup author-blind. A style note is not in
  // the text at all, so what Julian copies out is the prose and nothing else.
  const { cleanDocumentMarkdown } = await import("./public/document-copy.js");
  const copied = cleanDocumentMarkdown(documentAfter.text);
  assert.ok(!copied.includes("Three clauses"), "the observation is not in what Julian copies");
  assert.ok(!copied.includes("{>>"), "and neither is any marker");
  assert.ok(copied.includes("The render pass runs once."), "while the prose the comments were anchored to still copies out");

  // Durability: the note survives the rewrite of the words it annotates.
  await writeFile(design, DOCUMENT_BEFORE.replace("The {==render pass==}", `The scene is stable.\n\nThe {==render pass==}`));
  await git(trees, ["add", "-A"]);
  await git(trees, ["commit", "-q", "-m", "update: otto/test rewrite the paragraph"]);
  const treesAfterNote = trees;
  const vaultFilesAfterNote = await snapshot(trees);
  const survivor = JSON.parse((await readFile(corpus, "utf8")).trim().split("\n")[0]);
  assert.equal(survivor.quote.text, "Because the pipeline resolves each anchor before the render pass begins", "the snapshot outlives the sentence it is about");
  assert.equal(survivor.author.model, "opus-5", "the provenance resolved at write time outlives the commit that moved");

  // Every failure mode stays a written note that says why it knows less.
  const noQuote = await postStyleNote(base, { file, note: "The whole page hedges." });
  assert.deepEqual([noQuote.status, noQuote.body.note.quote, noQuote.body.note.author.source], [200, null, "quote-not-found"]);
  const goneQuote = await postStyleNote(base, { file, note: "Buried lede.", quote: "words that were rewritten away" });
  assert.deepEqual([goneQuote.status, goneQuote.body.note.author.source, goneQuote.body.note.quote.text], [200, "quote-not-found", "words that were rewritten away"]);
  const untrailered = await postStyleNote(base, { file, note: "Passive voice.", quote: "runs once" });
  assert.deepEqual([untrailered.body.note.author.known, untrailered.body.note.author.source], [false, "no-trailer"], "a commit with no session trailer leaves the author unknown, with the reason");

  assert.equal((await postStyleNote(base, { file, note: "" })).status, 400);
  assert.equal((await postStyleNote(base, { file: "otto/test/gone.md", note: "Buried lede." })).status, 404);
  assert.equal((await postStyleNote(base, { file: "../outside.md", note: "Buried lede." })).status, 400, "a style note cannot reach outside the vault");

  const inArea = await fetch(`${base}/api/style-notes?area=otto/test`).then((response) => response.json());
  assert.equal(inArea.entries.length, 4);
  assert.equal(inArea.entries[0].note, "Passive voice.", "the corpus reads back newest first");
  assert.deepEqual(inArea.counts.byTag, [{ value: "buried-lede", count: 1 }]);
  assert.equal(inArea.counts.unknownAuthors, 3);
  const byModel = await fetch(`${base}/api/style-notes?model=opus-5`).then((response) => response.json());
  assert.equal(byModel.entries.length, 1, "the corpus can be read by the model that wrote badly");

  // The path a brain actually uses: the built `tangent style` command against
  // this same server, never the live one on 4321.
  const cli = path.resolve(here, "..", "..", "..", "dist", "cli", "index.js");
  if (!existsSync(cli)) return;
  await execFileAsync(process.execPath, [cli, "style", "add", file, "The heading promises more than the section gives.", "--tag", "over-promise", "--server", base]);
  const listed = JSON.parse((await execFileAsync(process.execPath, [cli, "style", "list", "--json", "--server", base])).stdout);
  assert.equal(listed.entries[0].note, "The heading promises more than the section gives.");
  assert.deepEqual(listed.counts.byTag, [{ value: "buried-lede", count: 1 }, { value: "over-promise", count: 1 }]);
  const shown = (await execFileAsync(process.execPath, [cli, "style", "show", listed.entries[0].id, "--server", base])).stdout;
  assert.match(shown, /Note: The heading promises more than the section gives\./);
  assert.match(shown, /Observed by /);
  assert.deepEqual(await snapshot(treesAfterNote), vaultFilesAfterNote, "the CLI path writes no vault file either");

  // The control for the silence: the same server, the same stream, one real
  // comment. Without it, "no frame arrived" could mean the stream was dead.
  assert.equal(frames.join("").includes("event: changed"), false, "no style note on any path woke a repaint");
  const current = await fetch(`${base}/api/document?file=${encodeURIComponent(file)}`).then((response) => response.json());
  const saved = await fetch(`${base}/api/document`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, text: `${current.text}\n{>>Julian: A third one.<<}\n`, summary: "added a comment", baseHash: current.hash }),
  });
  assert.equal(saved.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(frames.join("").includes("event: changed"), "a real comment does wake a repaint, so the silence above is a fact about style notes");
});

test("a worker gets the standard refusal, so \"workers only send\" stays visible on this route too", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "style-notes-worker-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "test");
  const corpus = path.join(root, "style-notes.jsonl");
  await Promise.all([mkdir(area, { recursive: true }), mkdir(workspace, { recursive: true })]);
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n");
  await writeFile(path.join(area, "test.md"), "---\ntype: area\n---\n\n# Test\n");
  await writeFile(path.join(area, "design-scene.md"), DOCUMENT_BEFORE);
  await git(trees, ["init", "-q"]);
  await git(trees, ["add", "-A"]);
  await git(trees, ["commit", "-q", "-m", "add: otto/test the Document"]);

  const worker = `style-notes-worker-${process.pid}`;
  await execFileAsync("tmux", ["new-session", "-d", "-s", worker]);
  await execFileAsync("tmux", ["set-option", "-t", worker, "@tangent_agent_shell_instance", INSTANCE_ID]);
  await execFileAsync("tmux", ["set-option", "-t", worker, "@tangent_kind", "goal"]);

  const port = await freePort().catch((error) => {
    if (error?.code === "EPERM") return null;
    throw error;
  });
  if (!port) return context.skip("This environment does not permit local HTTP listeners.");
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees, WORKSPACE: workspace,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_STYLE_NOTES_FILE: corpus, AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"), GROQ_API_KEY: "",
      CHAT_SESSION: `style-notes-worker-test-${process.pid}`, TANGENT_SHELL_INSTANCE_ID: INSTANCE_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await execFileAsync("tmux", ["kill-session", "-t", `=${worker}`]).catch(() => {});
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const refused = await postStyleNote(base, { file: "otto/test/design-scene.md", note: "Buried lede." }, worker);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /workers only send/);
  assert.equal(existsSync(corpus), false, "a refused note writes nothing at all");
});
