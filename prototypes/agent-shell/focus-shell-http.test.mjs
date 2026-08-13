import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

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

function nodeExecutable() {
  const candidates = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")),
    process.execPath,
  ];
  const executable = candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error("A Node executable was not found for the server test.");
  return executable;
}

test("the context-first shell is default and keeps the user's understanding with the outcome", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-focus-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const node = path.join(trees, "otto", "test");
  await mkdir(node, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: work\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(node, "test.md"), "---\ntype: work\n---\n\n# Test\n\n## Resources\n\n- Repository: .\n", "utf8");
  await writeFile(path.join(node, "design-test.md"), "# Test design\n\nA useful result is visible.\n", "utf8");
  await writeFile(
    path.join(node, "outcome-prove-it.md"),
    "---\ntype: outcome\nstatus: open\noutcome: The result is visible\nsession:\n---\n\n# Prove it\n\n## State\n\nNot started.\n\n## Design\n\n[[design-test]]\n",
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
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      WORKSPACE: workspace,
      AGENT_SHELL_NO_OPEN: "1",
      CHAT_SESSION: `focus-shell-test-${process.pid}`,
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

  const home = await fetch(base).then((response) => response.text());
  assert.match(home, /Agent Shell/i);
  assert.match(home, /\/shell\.js/);
  assert.doesNotMatch(home, />Legacy</);

  const shellScript = await fetch(`${base}/shell.js`).then((response) => response.text());
  assert.match(shellScript, /data-command-enter-submit/);
  assert.match(shellScript, /event\.key === "Enter" && event\.metaKey/);
  assert.match(shellScript, /data-new-outcome/);
  assert.match(shellScript, /data-next-step/);
  assert.match(shellScript, /data-toggle-awake/);
  assert.match(shellScript, /data-open-vision/);
  assert.match(shellScript, /post\("\/api\/caffeinate"/);

  const sessionPayload = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(sessionPayload.caffeinate, false);

  const vision = await fetch(`${base}/vision`).then((response) => response.text());
  assert.match(vision, /Agent Shell — product vision/i);
  assert.match(vision, /Human limit/);
  assert.match(vision, /Model limit/);

  const visionScript = await fetch(`${base}/vision.js`).then((response) => response.text());
  assert.match(visionScript, /Keep the native agent chat whole/);
  assert.match(visionScript, /Native agent surface/);
  assert.match(visionScript, /Shape this work/);
  assert.match(visionScript, /Keep Mac awake/);
  assert.match(visionScript, /Two-minute context/);

  const legacy = await fetch(`${base}/legacy`).then((response) => response.text());
  assert.match(legacy, /id="sidebar"/);
  assert.match(legacy, /Open current Agent Shell/);

  const brief = await fetch(`${base}/api/outcome/brief?file=otto%2Ftest%2Foutcome-prove-it.md`).then((response) => response.json());
  assert.equal(brief.outcome.title, "Prove it");
  assert.match(brief.markdown, /^# Assignment: Prove it/m);
  assert.match(brief.markdown, /## Result\n\nThe result is visible/);
  assert.deepEqual(brief.context.notes.map((file) => path.basename(file)), ["test.md", "otto.md"]);
  assert.deepEqual(brief.context.designs.map((file) => path.basename(file)), ["design-test.md"]);

  const saved = await fetch(`${base}/api/outcome/understanding`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: "otto/test/outcome-prove-it.md",
      understanding: "I asked for a visible result. I will inspect it before I close the outcome.",
    }),
  }).then((response) => response.json());
  assert.equal(saved.ok, true);

  const updated = await fetch(`${base}/api/outcome/brief?file=otto%2Ftest%2Foutcome-prove-it.md`).then((response) => response.json());
  assert.equal(updated.outcome.myUnderstanding, "I asked for a visible result. I will inspect it before I close the outcome.");
  assert.match(updated.markdown, /## Julian's understanding/);

  const created = await fetch(`${base}/api/outcome/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      node: "otto/test",
      title: "A second visible result",
      outcome: "The second result is visible.",
      state: "Not started.",
    }),
  }).then((response) => response.json());
  assert.equal(created.file, "otto/test/outcome-a-second-visible-result.md");

  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const newOutcome = vault.map.flatMap((group) => group.outcomes).find((outcome) => outcome.file === created.file);
  assert.equal(newOutcome.title, "A second visible result");
  assert.equal(newOutcome.status, "open");
});
