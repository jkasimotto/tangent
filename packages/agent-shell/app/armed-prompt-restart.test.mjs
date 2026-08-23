// An armed step prompt survives a server restart. A pipeline step's prompt
// is armed (armSession in server.mjs) as soon as its session is spawned, well
// before its harness has finished booting; a restart in that window used to
// drop the prompt outright, because armedSessions was an in-memory Map only.
// This test drives the real server: a pipeline step is armed, the server is
// killed and a fresh one started against the same tmux and armed-prompts
// root, and only then does the pane's harness "start". The prompt must
// still arrive.

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
import { PROBE_CHARS, promptArrived, squash } from "./prompt-delivery.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// Stands in for a real harness TUI: raw mode (no canonical line-buffer limit,
// which drops the tail of a multi-KB prompt fed straight to a plain `cat`)
// with echo on, so the pty shows whatever gets typed into it once it is the
// pane's foreground command.
const HARNESS_CMD = 'sh -c "stty raw echo; exec cat"';

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
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  return trees;
}

/** Starts one Agent Shell server against the given roots; the pipeline step's launch is typed but never entered (AGENT_SHELL_TEST_NO_LAUNCH), so the pane sits at its shell until the test itself makes it leave. */
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
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
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

/** The pane's text including scrollback, whitespace collapsed so line-wrapping and a small pane cannot hide a match. */
async function paneText(session) {
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-S", "-", "-t", `=${session}:`]);
  return stdout.replace(/\s+/g, "");
}

/** The pane's foreground command, "" when the session is gone. */
async function paneCommand(session) {
  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", `=${session}:`, "#{pane_current_command}"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "tcsh", "nu"]);

/**
 * Puts the pane onto the harness command, retrying until it leaves the shell.
 * The leftover launch line the server typed before the restart is not trusted:
 * a login shell still initializing when text arrives can wipe or reorder it
 * (the redraw window server.mjs's priming sleeps 700ms for), so each attempt
 * clears the line, types the command fresh, and submits it.
 */
async function startHarness(session, command) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!SHELLS.has(await paneCommand(session))) return;
    await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "C-u"]);
    await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", command]);
    await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
    for (let poll = 0; poll < 40; poll += 1) {
      if (!SHELLS.has(await paneCommand(session))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`the pane of ${session} never left its shell for the harness command`);
}

test("an armed step prompt survives a server restart", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-armed-restart-"));
  const leaf = `probearm${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const armed = path.join(root, "armed");
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
  let child = startServer(root, trees, port, "arm-restart");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const goal = await post(base, "/api/goals/create", {
    area: `otto/${leaf}`,
    goal: { title: "Arm-restart probe", doneWhen: "The step's armed prompt arrives after a restart." },
  });
  assert.ok(goal.file, `goal was created: ${JSON.stringify(goal)}`);

  const started = await post(base, "/api/goals/start", {
    file: goal.file,
    steps: [{ instruction: "Prove the arm-restart probe delivers.", command: HARNESS_CMD }],
  });
  assert.ok(started.session, `pipeline started: ${JSON.stringify(started)}`);
  sessions.push(started.session);

  // The step's session is spawned and armed; AGENT_SHELL_TEST_NO_LAUNCH left
  // the launch command typed but not entered, so the pane still sits at its
  // shell. The prompt must already be on disk before anything leaves it.
  const persisted = await waitFor("the armed prompt on disk", async () => {
    const records = await readAllArmedPrompts(armed);
    return records.find((record) => record.session === started.session) ?? null;
  });
  assert.match(persisted.prompt, /Prove the arm-restart probe delivers\./);

  // Restart now, in the exact window the bug lived in: armed, harness not
  // yet up. The in-memory arm is gone; the tmux session and the disk record
  // are not.
  await stopServer(child);
  const nextPort = await freePort();
  child = startServer(root, trees, nextPort, "arm-restart-2");
  const restarted = `http://127.0.0.1:${nextPort}`;
  await waitForServer(restarted);

  // Only after the restart does the harness "start" (the priming step never
  // launches it under AGENT_SHELL_TEST_NO_LAUNCH): the pane moves onto a
  // quiet, non-shell command whose pty echo shows whatever gets typed into it
  // next. startHarness types the command itself rather than submitting the
  // leftover primed line, so a slow shell init cannot strand the pane.
  await startHarness(started.session, HARNESS_CMD);

  // The re-armed session must not sit at 0 tokens with an empty composer:
  // real content (the prompt's opening words) reaches the pane once the
  // pane leaves the shell. This is a small, fast transfer, so it stays
  // reliable even when the rest of the suite is hammering the shared tmux
  // server at the same time.
  const probe = squash(persisted.prompt.slice(0, PROBE_CHARS));
  await waitFor(
    "the prompt's opening words typed into the pane after the restart",
    async () => (await paneText(started.session)).includes(probe),
    4800
  );

  // Delivery fully settles (success or a final failure) once the record
  // clears; typing the whole multi-KB prompt (with a partial-match retry
  // clearing the composer and retyping, up to 3 attempts) can take a while
  // when the rest of the suite is also driving tmux hard, so this allows a
  // generous window.
  await waitFor("the armed-prompt record cleared after delivery settles", async () => {
    const records = await readAllArmedPrompts(armed);
    return records.every((record) => record.session !== started.session) ? true : null;
  }, 4800);

  // The same test the server itself used to decide delivery succeeded: the
  // composer holds the whole prompt, not just a fragment of it.
  const finalPane = await paneText(started.session);
  assert.ok(promptArrived(finalPane, persisted.prompt), `the whole prompt should have arrived in the pane; got:\n${finalPane}`);
});
