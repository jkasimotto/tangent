import assert from "node:assert/strict";
import test from "node:test";

import { runSendCli, sendCommandSpec } from "../dist/cli/index.js";

/** Captures one CLI request and its printed result. */
function capture(context, respond) {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const requests = [];
  const lines = [];
  console.log = (line) => lines.push(String(line));
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init.body)) });
    return Response.json(respond(requests.at(-1)));
  };
  context.after(() => { globalThis.fetch = previousFetch; console.log = previousLog; });
  return { requests, lines };
}

test("tangent send exposes only a session or Area and a plain note", () => {
  assert.equal(sendCommandSpec.args, "<session|area> <note...>");
  assert.deepEqual(sendCommandSpec.options.map((option) => option.name), ["session", "server"]);
});

test("an Area note uses ordinary delivery and reports live or saved", async (context) => {
  let live = false;
  const { requests, lines } = capture(context, () => ({ status: "queued", to: "otto/dnd", target: "area", live }));
  await runSendCli(["otto/dnd", "I am done. Tests pass.", "--session", "terrain-worker"]);
  live = true;
  await runSendCli(["otto/dnd", "One more fact.", "--session", "terrain-worker"]);
  assert.deepEqual(requests.map((item) => item.body), [
    { to: "otto/dnd", text: "I am done. Tests pass.", from: "terrain-worker" },
    { to: "otto/dnd", text: "One more fact.", from: "terrain-worker" },
  ]);
  assert.deepEqual(lines, ["Saved for otto/dnd. It reads this when it runs.", "Sent to otto/dnd."]);
});

test("old done and blocked flags become ordinary words for one release", async (context) => {
  const { requests } = capture(context, () => ({ status: "queued", to: "otto/dnd", target: "area", live: false }));
  await runSendCli(["otto/dnd", "--done", "All checks pass.", "--session", "worker-a"]);
  await runSendCli(["otto/dnd", "--blocked", "Port is taken.", "--session", "worker-a"]);
  assert.deepEqual(requests.map((item) => item.body.text), ["done: All checks pass.", "blocked: Port is taken."]);
});

test("magic brain and removed worker flags fail before HTTP", async (context) => {
  const { requests } = capture(context, () => ({}));
  await assert.rejects(() => runSendCli(["brain", "Done.", "--session", "worker-a"]), /brain is not a send target/);
  await assert.rejects(() => runSendCli(["otto/dnd", "--question", "Which?", "--session", "worker-a"]), /worker send flags are gone/);
  await assert.rejects(() => runSendCli(["otto/dnd", "Done.", "--present", "x.md", "--session", "worker-a"]), /worker send flags are gone/);
  assert.equal(requests.length, 0);
});
