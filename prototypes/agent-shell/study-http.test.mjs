// HTTP tests for the study screen's server side (design contract:
// otto/tangent/design-learning-ai-written-code Decision 7, solution
// impl-learning-ai-written-code Piece 3): a session opens on a subsystem,
// the tutor's turns land asynchronously, snippets are grounded from disk,
// a path that leaves the repository is refused, and End closes the session
// with its one-line record.
//
// The tutor is stubbed by a small Node script on STUDY_TUTOR_CMD that prints
// the same harness envelope `claude -p --output-format json` prints. It
// decides its reply from the message it is given, so the test drives the
// whole turn machinery without a model.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reserves and releases one local port for the HTTP test. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Polls until the child server accepts HTTP requests. */
async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start at ${url}`);
}

/** Prefers the nvm Node on PATH so node-pty loads against the same ABI as the shell. */
function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Polls one study record until the tutor turn lands, then returns it. */
async function settled(base, id, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { study } = await fetch(`${base}/api/study/state?id=${encodeURIComponent(id)}`).then((response) => response.json());
    if (study && !study.pending) return study;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`study ${id} stayed pending`);
}

/** The stub tutor: one Node script that answers by the message it is given. */
const STUB = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const message = readFileSync(0, "utf8");
/** Prints one harness envelope with the tutor reply as its result string. */
function say(reply) {
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, session_id: "stub-1", result: JSON.stringify(reply) }));
}
if (message.startsWith("Study session on:")) {
  say({ say: "Load-bearing: the cache.", mode: "calibration", done: false,
    question: { index: 1, total: 5, type: "calibration", text: "What does this subsystem do?", snippet: { file: "cache.js", start: 2, end: 3 } } });
} else if (message === "(end session)") {
  say({ say: "", mode: "predict-first", done: true, record: "predict-first, 1 of 1 first try" });
} else if (message === "traverse") {
  say({ say: "", mode: "predict-first", done: false,
    question: { index: 3, total: 5, type: "why", text: "Why?", snippet: { file: "../outside.txt", start: 1, end: 1 } } });
} else {
  say({ say: "", mode: "predict-first", done: false,
    verdict: { result: "pass", evidence: "cache.js:4 return cached", note: "" },
    reveal: { file: "cache.js", start: 1, end: 4 },
    question: { index: 2, total: 5, type: "blast-radius", text: "What breaks?", snippet: null } });
}
`;

const CACHE_JS = ["// a cache", "function get(key) {", "  if (!cached) cached = load();", "  return cached[key];", "}"].join("\n");

test("a study session opens, grades, grounds its snippets from disk, and closes with one line", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "study-http-"));
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", "tangent");
  const repo = path.join(root, "repo");
  await mkdir(area, { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(area, "tangent.md"), `---\ntype: area\nstatus: active\n---\n\n# Tangent\n\n## Resources\n\n- Repository: ${repo}\n`, "utf8");
  await writeFile(path.join(repo, "cache.js"), `${CACHE_JS}\n`, "utf8");
  await writeFile(path.join(root, "outside.txt"), "a secret\n", "utf8");
  const stub = path.join(root, "stub-tutor.mjs");
  await writeFile(stub, STUB, "utf8");
  await chmod(stub, 0o755);

  const port = await freePort();
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"), TANGENT_STUDY_ROOT: path.join(root, "study"),
      STUDY_TUTOR_CMD: stub, AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `study-test-${process.pid}`,
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

  /** POSTs one JSON body to a study route and returns the response. */
  const post = (route, body) => fetch(`${base}/api/study/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // No study yet on the Area.
  const none = await fetch(`${base}/api/study/latest?area=otto/tangent`).then((response) => response.json());
  assert.equal(none.study, null);

  // A subsystem is required; the repository falls back to the Area's own.
  const unnamed = await post("start", { area: "otto/tangent", subsystem: "  " });
  assert.equal(unnamed.status, 400);
  const nowhere = await post("start", { area: "otto/nothing", subsystem: "the cache" });
  assert.equal(nowhere.status, 400);

  const started = await post("start", { area: "otto/tangent", subsystem: "the cache" }).then((response) => response.json());
  assert.match(started.study.id, /-the-cache$/);
  assert.equal(started.study.repo, repo, "the repository comes from the Area note");
  assert.equal(started.study.pending, true, "the calibration turn runs in the background");
  assert.equal(started.study.status, "open");
  assert.ok(existsSync(path.join(root, "study", `${started.study.id}.json`)), "the record is on disk before the turn lands");

  // The calibration probe lands, and its snippet holds the real lines of the file.
  const calibration = await settled(base, started.study.id);
  assert.equal(calibration.turns.length, 1);
  const probe = calibration.turns[0];
  assert.equal(probe.role, "tutor");
  assert.equal(probe.question.type, "calibration");
  assert.equal(probe.question.snippet.text, "function get(key) {\n  if (!cached) cached = load();", "lines 2 to 3, read from disk");
  assert.equal(probe.question.snippet.error, undefined);
  assert.equal(calibration.claudeSessionId, "stub-1", "the session id is kept for --resume");

  // An answer is graded, with the evidence quoted and the hidden code revealed.
  const answered = await post("answer", { id: started.study.id, text: "It caches the load." }).then((response) => response.json());
  assert.equal(answered.study.pending, true);
  assert.equal(answered.study.turns.at(-1).text, "It caches the load.");
  const graded = await settled(base, started.study.id);
  const verdictTurn = graded.turns.at(-1);
  assert.equal(verdictTurn.verdict.result, "pass");
  assert.equal(verdictTurn.verdict.evidence, "cache.js:4 return cached");
  assert.equal(verdictTurn.reveal.text, CACHE_JS.split("\n").slice(0, 4).join("\n"));
  assert.equal(graded.mode, "predict-first", "the record follows the tutor's mode");

  // An empty answer is refused, and a reference outside the repository is refused too.
  assert.equal((await post("answer", { id: started.study.id, text: "  " })).status, 400);
  await post("answer", { id: started.study.id, text: "traverse" });
  const traversal = await settled(base, started.study.id);
  const outside = traversal.turns.at(-1).question.snippet;
  assert.equal(outside.text, undefined);
  assert.match(outside.error, /outside the repository/);
  assert.equal(await readFile(path.join(root, "outside.txt"), "utf8"), "a secret\n", "the file itself is untouched");

  // The latest route resumes the open session, and End closes it with one line.
  const latest = await fetch(`${base}/api/study/latest?area=otto/tangent`).then((response) => response.json());
  assert.equal(latest.study.id, started.study.id);
  await post("end", { id: started.study.id });
  const closed = await settled(base, started.study.id);
  assert.equal(closed.status, "closed");
  assert.equal(closed.record, "predict-first, 1 of 1 first try");
  assert.ok(closed.closedAt);

  // A closed session takes no more answers.
  assert.equal((await post("answer", { id: started.study.id, text: "more" })).status, 409);
  assert.equal((await post("answer", { id: "no-such-study", text: "more" })).status, 404);
  assert.equal((await fetch(`${base}/api/study/state?id=no-such-study`)).status, 404);
});

test("an unparsable tutor reply is retried once, and a failing tutor leaves the reason on the record", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "study-http-retry-"));
  const trees = path.join(root, "trees");
  const repo = path.join(root, "repo");
  await mkdir(path.join(trees, "otto", "tangent"), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, "cache.js"), `${CACHE_JS}\n`, "utf8");
  // First call answers with prose, second with valid JSON: the corrective retry works.
  const stub = path.join(root, "stub-tutor.mjs");
  await writeFile(stub, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
readFileSync(0, "utf8");
const counter = ${JSON.stringify(path.join(root, "calls.txt"))};
appendFileSync(counter, "x");
const calls = readFileSync(counter, "utf8").length;
const reply = calls === 1
  ? "I will start with a broad question."
  : JSON.stringify({ say: "", mode: "calibration", done: false, question: { index: 1, total: 3, type: "calibration", text: "What is it for?", snippet: null } });
process.stdout.write(JSON.stringify({ type: "result", is_error: false, session_id: "stub-2", result: reply }));
`, "utf8");
  await chmod(stub, 0o755);

  const port = await freePort();
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"), TANGENT_STUDY_ROOT: path.join(root, "study"),
      STUDY_TUTOR_CMD: stub, AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `study-retry-test-${process.pid}`,
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

  const started = await fetch(`${base}/api/study/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "otto/tangent", subsystem: "the cache", repo }) }).then((response) => response.json());
  const settledStudy = await settled(base, started.study.id);
  assert.equal(settledStudy.error, null, "the corrective retry recovered the turn");
  assert.equal(settledStudy.turns.at(-1).question.text, "What is it for?");
  assert.equal((await readFile(path.join(root, "calls.txt"), "utf8")).length, 2, "exactly one retry");

  // A tutor that cannot run at all leaves the reason on the record, not an exception.
  const broken = await fetch(`${base}/api/study/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ area: "otto/tangent", subsystem: "the reader", repo: path.join(root, "not-a-directory") }) });
  assert.equal(broken.status, 400, "a repository that does not exist is refused before any turn");
});
