import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

const REGISTRY = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {
    "claude": [
      { "id": "opus-4-6", "label": "Opus 4.6", "args": "--model claude-opus-4-6" }
    ]
  },
  "harnesses": [
    { "id": "claude-otto", "label": "Claude · Otto", "command": "CLAUDE_CONFIG_DIR=~/.claude-otto claude", "modelSet": "claude" },
    { "id": "pi-code", "label": "Pi Code", "command": "pi-code" }
  ]
}
\`\`\`
`;

test("launch options resolve the registry, and saving writes an Area default", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-launch-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), REGISTRY, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "test.md"),
    `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-launch]]\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults": {"launch": {"harness": "claude-otto", "model": "opus-4-6"}}}\n\`\`\`\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-prove-launch.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The launch is proven\nsession:\n---\n\n# Prove launch\n\n## State\n\nNot started.\n",
    "utf8"
  );

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
  const openedSessions = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1",
      GROQ_API_KEY: "",
      CHAT_SESSION: `launch-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  // The declared default resolves through the registry with display labels.
  const options = await fetch(`${base}/api/launch/options?area=otto/test`).then((response) => response.json());
  assert.deepEqual(options.harnesses.map((harness) => harness.label), ["Claude · Otto", "Pi Code"]);
  assert.equal(options.harnesses[0].models[0].label, "Opus 4.6");
  assert.deepEqual(options.harnesses[1].models, []);
  assert.equal(options.default.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(options.default.label, "Claude · Otto · Opus 4.6");
  assert.equal(options.default.source, "otto/test");

  // A legacy area without a declaration keeps the profile fallback.
  const fallback = await fetch(`${base}/api/launch/options?area=otto`).then((response) => response.json());
  assert.equal(fallback.default.command, "claude-otto");
  assert.equal(fallback.default.label, null);

  // An unknown id in a per-run choice blocks the start and names the id.
  const bad = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-none.md", choice: { harness: "gemini" } }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unknown harness "gemini"/);

  // Saving a selection writes the durable Area default into the note.
  const saved = await fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto", launch: { harness: "pi-code" } }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.clone().json()).label, "Pi Code");
  const note = await readFile(path.join(trees, "otto", "otto.md"), "utf8");
  assert.match(note, /## Development environment/);
  assert.match(note, /"harness": "pi-code"/);
  const after = await fetch(`${base}/api/launch/options?area=otto`).then((response) => response.json());
  assert.equal(after.default.command, "pi-code");
  assert.equal(after.default.label, "Pi Code");

  // Starting a Goal with an explicit choice types the exact composed
  // command into the shell pane without submitting it, and records the
  // display label on the session.
  const started = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-launch.md", choice: { harness: "claude-otto", model: "opus-4-6" } }),
  });
  assert.equal(started.status, 200);
  const session = (await started.json()).session;
  openedSessions.push(session);
  const typed = await new Promise((resolve) => {
    let attempts = 0;
    /** Polls the pane until the primed command line appears. */
    const poll = () => {
      execFile("tmux", ["capture-pane", "-p", "-t", `=${session}:`], (error, stdout) => {
        if (!error && /CLAUDE_CONFIG_DIR/.test(stdout)) return resolve(stdout);
        if (attempts += 1, attempts > 40) return resolve(stdout ?? "");
        setTimeout(poll, 250);
      });
    };
    poll();
  });
  assert.match(typed, /CLAUDE_CONFIG_DIR=~\/\.claude-otto claude --model claude-opus-4-6/);
  const label = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", session, "-v", "@tangent_launch"], (error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.equal(label, "Claude · Otto · Opus 4.6");

  // Reopening the Goal resumes the same session instead of rebuilding one.
  const reopened = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-launch.md" }),
  }).then((response) => response.json());
  assert.equal(reopened.session, session);
  assert.equal(reopened.reattached, true);
});
