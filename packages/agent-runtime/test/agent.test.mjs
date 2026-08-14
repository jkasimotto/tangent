import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentCli } from "../dist/agent.js";

const HANDOFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { enum: ["complete", "needs_judgment"] },
    summary: { type: "string" }
  },
  required: ["status", "summary"]
};

test("Claude runner returns structured output and a fresh session id", async () => {
  const fixture = await fakeAgentCommand("claude");
  try {
    const result = await runAgentCli({
      agent: { provider: "claude", command: fixture.command, model: "fable", permissionMode: "bypassPermissions" },
      prompt: "Create the design.",
      cwd: fixture.directory,
      schema: HANDOFF_SCHEMA,
      env: { AGENT_FIXTURE_PROBE: fixture.probe }
    });
    assert.equal(result.sessionId, "claude-fresh-session");
    assert.deepEqual(result.structuredOutput, { status: "complete", summary: "claude complete" });
    const probe = JSON.parse(await readFile(fixture.probe, "utf8"));
    assert.equal(probe.prompt, "Create the design.");
    assert.ok(probe.args.includes("--json-schema"));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Claude runner resumes an explicit session", async () => {
  const fixture = await fakeAgentCommand("claude");
  try {
    const result = await runAgentCli({
      agent: { provider: "claude", command: fixture.command },
      prompt: "Revise the plan.",
      cwd: fixture.directory,
      session: { kind: "resume", id: "claude-prior-session" },
      env: { AGENT_FIXTURE_PROBE: fixture.probe }
    });
    assert.equal(result.sessionId, "claude-prior-session");
    const probe = JSON.parse(await readFile(fixture.probe, "utf8"));
    assert.deepEqual(probe.args.slice(probe.args.indexOf("--resume"), probe.args.indexOf("--resume") + 2), ["--resume", "claude-prior-session"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Claude runner resolves a saved agent alias through a login shell", async () => {
  const fixture = await fakeAgentCommand("claude");
  try {
    await writeFile(path.join(fixture.directory, ".zshrc"), `alias fixture_claude=${JSON.stringify(fixture.command)}\n`, "utf8");
    const result = await runAgentCli({
      agent: {
        provider: "claude",
        command: "fixture_claude",
        loginShell: true,
        env: { SHELL: "/bin/zsh", ZDOTDIR: fixture.directory }
      },
      prompt: "Use the saved alias.",
      cwd: fixture.directory,
      env: { AGENT_FIXTURE_PROBE: fixture.probe }
    });
    assert.equal(result.sessionId, "claude-fresh-session");
    const probe = JSON.parse(await readFile(fixture.probe, "utf8"));
    assert.equal(probe.prompt, "Use the saved alias.");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Codex runner returns schema output and supports exec resume", async () => {
  const fixture = await fakeAgentCommand("codex");
  try {
    const fresh = await runAgentCli({
      agent: { provider: "codex", command: fixture.command, model: "gpt-test", effort: "max" },
      prompt: "Review the design.",
      cwd: fixture.directory,
      sandbox: "read-only",
      schema: HANDOFF_SCHEMA,
      env: { AGENT_FIXTURE_PROBE: fixture.probe }
    });
    assert.equal(fresh.sessionId, "codex-fresh-session");
    assert.deepEqual(fresh.structuredOutput, { status: "complete", summary: "codex complete" });

    const resumed = await runAgentCli({
      agent: { provider: "codex", command: fixture.command },
      prompt: "Fix the review.",
      cwd: fixture.directory,
      session: { kind: "resume", id: "codex-prior-session" },
      schema: HANDOFF_SCHEMA,
      env: { AGENT_FIXTURE_PROBE: fixture.probe }
    });
    assert.equal(resumed.sessionId, "codex-prior-session");
    const probe = JSON.parse(await readFile(fixture.probe, "utf8"));
    assert.deepEqual(probe.args.slice(0, 2), ["exec", "resume"]);
    assert.equal(probe.args.at(-2), "codex-prior-session");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Gemini runner rejects session continuation", async () => {
  await assert.rejects(
    runAgentCli({
      agent: { provider: "gemini", command: process.execPath },
      prompt: "Continue.",
      cwd: process.cwd(),
      session: { kind: "resume", id: "gemini-session" }
    }),
    /continuation is not supported/
  );
});

/** Creates one executable fake provider CLI and its probe file. */
async function fakeAgentCommand(provider) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `tangent-agent-${provider}-`));
  const command = path.join(directory, `fake-${provider}.mjs`);
  const probe = path.join(directory, "probe.json");
  const source = provider === "claude" ? fakeClaudeSource() : fakeCodexSource();
  await writeFile(command, source, "utf8");
  await chmod(command, 0o755);
  return { directory, command, probe };
}

/** Returns the fake Claude executable source. */
function fakeClaudeSource() {
  return `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
await writeFile(process.env.AGENT_FIXTURE_PROBE, JSON.stringify({ args, prompt }));
const resume = args.indexOf("--resume");
const sessionId = resume >= 0 ? args[resume + 1] : "claude-fresh-session";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }));
console.log(JSON.stringify({ type: "result", result: "{\\"status\\":\\"complete\\",\\"summary\\":\\"claude complete\\"}", structured_output: { status: "complete", summary: "claude complete" } }));
`;
}

/** Returns the fake Codex executable source. */
function fakeCodexSource() {
  return `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const outputIndex = args.indexOf("--output-last-message");
const output = outputIndex >= 0 ? args[outputIndex + 1] : "";
const resume = args[1] === "resume";
const sessionId = resume ? args.at(-2) : "codex-fresh-session";
await writeFile(process.env.AGENT_FIXTURE_PROBE, JSON.stringify({ args, prompt }));
if (output) await writeFile(output, JSON.stringify({ status: "complete", summary: "codex complete" }));
console.log(JSON.stringify({ type: "thread.started", thread_id: sessionId }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "codex complete" } }));
`;
}
