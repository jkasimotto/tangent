import assert from "node:assert/strict";
import test from "node:test";

import { runSendCli, sendCommandSpec } from "../dist/cli/index.js";

/** Captures the one request and the printed lines of one send command. */
function capture(context, respond) {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const lines = [];
  console.log = (line) => lines.push(String(line));
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init.body)), session: new Headers(init.headers).get("x-tangent-session") });
    return Response.json(respond(requests.at(-1)));
  };
  context.after(() => {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  });
  return { requests, lines };
}

test("tangent send has the three flags and the sender option", () => {
  assert.equal(sendCommandSpec.args, "<brain|session|area> <note...>");
  assert.deepEqual(sendCommandSpec.options.map((option) => option.name), ["done", "blocked", "question", "present", "session", "server"]);
});

test("each flag maps to one send kind and the plain note is kind note", async (context) => {
  const { requests, lines } = capture(context, () => ({ status: "sent", to: "otto-tangent-brain-g3", kind: undefined }));
  await runSendCli(["brain", "Parser wired.", "--session", "worker-a"]);
  await runSendCli(["brain", "--done", "Parser wired and proven.", "--session", "worker-a"]);
  await runSendCli(["brain", "--blocked", "Port taken.", "--session", "worker-a"]);
  await runSendCli(["brain", "--question", "Rename the field?", "--session", "worker-a"]);
  assert.deepEqual(requests.map((request) => request.path), Array(4).fill("/api/agents/send"));
  assert.deepEqual(requests.map((request) => request.body), [
    { to: "brain", text: "Parser wired.", from: "worker-a", kind: "note" },
    { to: "brain", text: "Parser wired and proven.", from: "worker-a", kind: "done" },
    { to: "brain", text: "Port taken.", from: "worker-a", kind: "blocked" },
    { to: "brain", text: "Rename the field?", from: "worker-a", kind: "question" },
  ]);
  assert.deepEqual(lines, [
    "sent to otto-tangent-brain-g3 (note)",
    "sent to otto-tangent-brain-g3 (done)",
    "sent to otto-tangent-brain-g3 (blocked)",
    "sent to otto-tangent-brain-g3 (question)",
  ]);
});

test("two flags at once is an error before any HTTP", async (context) => {
  const { requests } = capture(context, () => ({}));
  await assert.rejects(
    () => runSendCli(["brain", "--done", "--blocked", "Both.", "--session", "worker-a"]),
    /one of --done, --blocked, or --question, not --done and --blocked/,
  );
  assert.equal(requests.length, 0);
});

test("brain outside a worker session is an error that names the alternatives", async (context) => {
  const previousTmux = process.env.TMUX;
  delete process.env.TMUX;
  context.after(() => { if (previousTmux !== undefined) process.env.TMUX = previousTmux; });
  const { requests } = capture(context, () => ({}));
  await assert.rejects(
    () => runSendCli(["brain", "No session here."]),
    /tangent send brain works inside a worker session\. Name a session or an Area path\./,
  );
  assert.equal(requests.length, 0);
});

test("the server's refusal of a non-worker sender surfaces as the command's error", async (context) => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "tangent send brain works inside a worker session. Name a session or an Area path." }, { status: 400 });
  context.after(() => { globalThis.fetch = previousFetch; });
  await assert.rejects(
    () => runSendCli(["brain", "Hello.", "--session", "some-brain"]),
    /works inside a worker session/,
  );
});

test("a session or Area target uses the plain send path and refuses flags", async (context) => {
  const { requests, lines } = capture(context, () => ({ status: "queued", to: "otto/tangent", target: "area", reason: "stored in the Area inbox; it will arrive when the brain starts" }));
  await runSendCli(["otto/tangent", "Start the queued Goal.", "--session", "some-brain"]);
  assert.deepEqual(requests[0].body, { to: "otto/tangent", text: "Start the queued Goal.", from: "some-brain" });
  assert.deepEqual(lines, ["queued for otto/tangent (stored in the Area inbox; it will arrive when the brain starts)"]);
  await assert.rejects(() => runSendCli(["otto/tangent", "--done", "Done.", "--session", "some-brain"]), /work only with tangent send brain/);
});
