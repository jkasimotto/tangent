import { once } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

/** Reserves and returns an available loopback port. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Waits until the fixture server accepts requests. */
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

/** Returns the Node executable used for the fixture process. */
function nodeExecutable() {
  const candidates = [...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")), process.execPath];
  const executable = candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error("A Node.js executable was not found for the server test.");
  return executable;
}

/** Starts and cleans up one isolated Agent Shell server for an HTTP capability suite. */
export async function startShellServer(context, { here, root, trees, workspace, openedSessions = [], env = {} }) {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return null;
    }
    throw error;
  }
  const instanceId = env.TANGENT_SHELL_INSTANCE_ID ?? `focus-shell-${process.pid}-${port}`;
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: workspace, AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1", TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "", CHAT_SESSION: `focus-shell-test-${process.pid}`,
      TANGENT_SHELL_INSTANCE_ID: instanceId,
      // These tests hand a brain over to prove the swap, not the pacing of an
      // idle brain; brain-pacing.test.mjs owns the ladder.
      TANGENT_BRAIN_WAITING_BACKOFF_MS: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  context.after(async () => {
    await Promise.all(openedSessions.map(async (session) => {
      try {
        await fetch(`${base}/api/kill/${encodeURIComponent(session)}`, { method: "POST" });
        return;
      } catch {}
      const owner = await new Promise((resolve) => execFile("tmux", ["display-message", "-p", "-t", `=${session}:`, "#{@tangent_agent_shell_instance}"], (error, stdout) => resolve(error ? "" : stdout.trim())));
      if (owner === instanceId) await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve()));
    }));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  await waitForServer(base);
  return base;
}

/**
 * Starts one Area brain through the public route and returns its session
 * name. Only the brain starts workers (D8), so a test that starts a worker
 * passes this name as `caller`.
 */
export async function startBrainCaller(base, { area, choice = null, instruction = `Control ${area}.`, openedSessions = [] }) {
  const response = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area, instruction, ...(choice ? { choice } : {}) }),
  });
  const body = await response.json();
  if (!response.ok || !body.session) throw new Error(`the ${area} brain did not start: ${JSON.stringify(body)}`);
  openedSessions.push(body.session);
  return body.session;
}
