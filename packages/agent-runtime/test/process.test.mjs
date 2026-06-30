import assert from "node:assert/strict";
import test from "node:test";

import { runProcess } from "../dist/process.js";

test("runProcess reports stdout and stderr chunks", async () => {
  const chunks = [];
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('out'); process.stderr.write('err');"],
    onOutput: (chunk) => chunks.push(chunk)
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.deepEqual(chunks.map((chunk) => chunk.stream).sort(), ["stderr", "stdout"]);
  assert.equal(chunks.map((chunk) => chunk.chunk).sort().join(""), "errout");
});

test("runProcess aborts a running child", async () => {
  const controller = new AbortController();
  const promise = runProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    signal: controller.signal
  });

  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, { name: "ProcessAbortedError" });
});
