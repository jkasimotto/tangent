// Opening and saving a Document stays under a second
// (goal-opening-and-saving-a-document-takes-under-a-seco).
//
// The shell polls /api/vault, /api/sessions, and /api/programs every 2.5
// seconds from every open tab, and each of those requests used to build the
// vault index from every Markdown file in the vault. The builds cost more than
// the poll interval gave them, so requests piled up and one Document read took
// 10 to 30 seconds. The index is now built once per vault change.
//
// The timing assertion calibrates itself: the first request pays for one build,
// and the requests after it must together cost less than a few builds. Remove
// the cache and the warm requests each pay for a build again, which is 30 times
// the budget.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const WARM_REQUESTS = 30;

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

/** Body text long enough that a build reads a vault of a realistic size. */
function documentBody(index) {
  const paragraph = `Paragraph about work item ${index}. `.repeat(40);
  return `# Document ${index}\n\nLinks [[design-0]] and [[goal-work-${index % 20}]].\n\n${paragraph}\n`;
}

/** Times one request and returns its milliseconds and parsed body. */
async function timed(url, init) {
  const start = performance.now();
  const response = await fetch(url, init);
  const body = await response.json();
  return { ms: performance.now() - start, status: response.status, body };
}

test("a Document opens and saves in under a second on a vault of realistic size", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vault-index-cache-"));
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", "tangent");
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: work\nstatus: active\n---\n\n# Otto\n\n## Purpose\n\nPersonal work.\n", "utf8");
  await writeFile(path.join(area, "tangent.md"), "---\ntype: work\nstatus: active\n---\n\n# Tangent\n\n## Purpose\n\nAgent Shell.\n", "utf8");
  for (let index = 0; index < 200; index += 1) {
    await writeFile(path.join(area, `design-${index}.md`), documentBody(index), "utf8");
  }
  for (let index = 0; index < 20; index += 1) {
    await writeFile(
      path.join(area, `goal-work-${index}.md`),
      `---\ntype: goal\nstatus: open\ndone_when: Work ${index} lands\nsession:\n---\n\n# Work ${index}\n\nUses [[design-${index}]].\n\n## State\n\nOpen.\n`,
      "utf8",
    );
  }
  const commented = path.join(area, "design-7.md");
  await writeFile(commented, `${documentBody(7)}\n{>>Julian: check this line<<}\n`, "utf8");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: the vault"]);

  const port = await freePort();
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `vault-index-cache-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const documentUrl = `${base}/api/document?file=otto/tangent/design-7.md`;
  await waitForServer(base);

  // The first read pays for one build of the whole index.
  const cold = await timed(documentUrl);
  assert.equal(cold.status, 200);
  assert.equal(cold.body.comments.length, 1);

  let warmTotal = 0;
  let warmWorst = 0;
  for (let request = 0; request < WARM_REQUESTS; request += 1) {
    const warm = await timed(documentUrl);
    assert.equal(warm.status, 200);
    warmTotal += warm.ms;
    warmWorst = Math.max(warmWorst, warm.ms);
  }
  const report = `cold ${cold.ms.toFixed(0)}ms, ${WARM_REQUESTS} warm reads ${warmTotal.toFixed(0)}ms, worst ${warmWorst.toFixed(0)}ms`;
  assert.ok(warmWorst < 1000, `every Document read must answer in under a second (${report})`);
  assert.ok(
    warmTotal < cold.ms * 4,
    `an unchanged vault must not be indexed again per request (${report})`,
  );

  // A save answers in under a second and the read after it carries the new text.
  const resolved = cold.body.text.replace(/\{>>Julian: check this line<<\}\n?/, "");
  const save = await timed(`${base}/api/document`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/tangent/design-7.md", text: resolved, baseHash: cold.body.hash, summary: "resolved a comment" }),
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.comments.length, 0);
  assert.ok(save.ms < 1000, `a comment save must answer in under a second (took ${save.ms.toFixed(0)}ms)`);
  assert.doesNotMatch(await readFile(commented, "utf8"), /check this line/);

  // An edit made outside the server is visible on the next read: the cache is
  // keyed on the vault, not on a clock.
  const afterSave = await timed(documentUrl);
  assert.equal(afterSave.body.comments.length, 0);
  await writeFile(commented, `${resolved}\n{>>Julian: a second look<<}\n`, "utf8");
  const afterEdit = await timed(documentUrl);
  assert.equal(afterEdit.body.comments.length, 1, "an edit outside the server is not hidden by the cache");
  assert.match(afterEdit.body.comments[0].text, /a second look/);
});
