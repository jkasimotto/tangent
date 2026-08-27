// A notice never types over a brain generation's activation prompt. A brain
// is armed with its activation prompt while its pane still sits at the shell,
// and the arming poll types that prompt as soon as the harness comes up. A
// booting harness reads as a working pane with an empty composer, so mid-turn
// delivery (agent-messages.mjs) would otherwise send a queued notice into the
// same pane at the same moment and both texts would arrive as one line. This
// test drives the real server: a notice is queued while the activation prompt
// is on its way, and the prompt must arrive whole before the notice starts.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readAllArmedPrompts } from "./armed-prompts.mjs";
import { promptArrived, squash } from "./prompt-delivery.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// Stands in for a real harness TUI. It echoes every keystroke it is given, in
// the order it was given them, and redraws a composer prompt line after each
// Enter, so the pane reads as "idle" or "draft" exactly as a real composer
// does (pane-state.mjs). Raw mode keeps a multi-KB prompt whole, which a
// canonical-mode line buffer would truncate.
const HARNESS_SOURCE = [
  "#!/bin/sh",
  "exec node -e 'process.stdin.setRawMode(true);process.stdout.write(\"\\u276f \");process.stdin.on(\"data\",(b)=>process.stdout.write(String(b).replace(/\\r/g,\"\\r\\n\\u276f \")));'",
  "",
].join("\n");

/** Writes the stand-in harness and returns the command that starts it. */
async function makeHarness(root) {
  const file = path.join(root, "harness.sh");
  await writeFile(file, HARNESS_SOURCE, { encoding: "utf8", mode: 0o755 });
  return file;
}

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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

/** Polls until the condition holds, then returns its value. */
async function waitFor(what, check, attempts = 200) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Kills one tmux session; a session that is already gone is not an error. */
async function killSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/** Writes an Area note tree with one Area under otto. */
async function makeTrees(root, leaf) {
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", leaf);
  const harness = await makeHarness(root);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), `# Harnesses\n\n\`\`\`tangent.harnesses.v1\n{"version":1,"harnesses":[{"id":"probe","label":"Probe","command":${JSON.stringify(harness)}}]}\n\`\`\`\n`, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n\n\`\`\`tangent.environment.v1\n{"defaults":{"brain":{"harness":"probe"}}}\n\`\`\`\n`, "utf8");
  return trees;
}

/** Starts one Agent Shell server against the given roots. */
function startServer(root, trees, port, label) {
  return spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `${label}-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Stops one child server and waits for it to exit. */
async function stopServer(child) {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/** POSTs JSON to the server and returns the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** The pane's text including scrollback, whitespace removed so wrapping cannot hide a match. */
async function paneText(session) {
  try {
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-S", "-", "-t", `=${session}:`]);
    return squash(stdout);
  } catch {
    return "";
  }
}

test("a queued notice waits for a booting brain's activation prompt", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-boot-notice-"));
  const leaf = `probeboot${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const armedRoot = path.join(root, "armed");
  const sessions = [];
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return;
    }
    throw error;
  }
  const child = startServer(root, trees, port, "boot-notice");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const area = `otto/${leaf}`;
  const brain = await post(base, "/api/brains/start", { area, instruction: "Control the boot probe." });
  assert.ok(brain.session, `brain started: ${JSON.stringify(brain)}`);
  sessions.push(brain.session);

  // The activation prompt is armed before the launch command is typed and
  // stays armed until it has arrived, so this is the window the race lived in.
  const armed = await waitFor("the brain's armed activation prompt", async () => {
    const records = await readAllArmedPrompts(armedRoot);
    return records.find((record) => record.session === brain.session && record.prompt) ?? null;
  }, 60);
  const activation = armed.prompt;
  assert.ok(!promptArrived(await paneText(brain.session), activation), "the activation prompt is still on its way");

  // A worker report and a Request answer reach the brain the same way: a
  // durable notice, queued for the brain's session. Queue one now.
  const created = await post(base, "/api/brains/requests", {
    session: brain.session,
    kind: "decision",
    subject: "Worker harness",
    question: "Should the worker harness come from the Area?",
    proposal: "Take the harness from the Area declaration.",
    detail: "The fallback picks a harness nobody declared.",
  });
  assert.ok(created.request?.id, JSON.stringify(created));
  const marker = `BOOTNOTICE${process.pid}`;
  const answered = await post(base, "/api/brains/requests/answer", { area, id: created.request.id, answer: "changes", note: marker });
  assert.equal(answered.request?.answer, "changes", JSON.stringify(answered));

  const pane = await waitFor("the notice typed into the brain pane", async () => {
    const text = await paneText(brain.session);
    return text.includes(marker) ? text : null;
  }, 600);

  const before = pane.slice(0, pane.indexOf(marker));
  assert.ok(promptArrived(before, activation), "the whole activation prompt arrived before the notice was typed");
});
