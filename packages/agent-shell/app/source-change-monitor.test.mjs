import assert from "node:assert/strict";
import test from "node:test";
import { createCommitChangeMonitor } from "./commit-change-monitor.mjs";

test("only commits after the deployed revision make a Tangent rebuild available", async () => {
  let head = "aaaaaaaa";
  const calls = [];
  const monitor = await createCommitChangeMonitor({
    root: "/repo",
    /** Supplies a changing HEAD without touching a repository. */
    async git(root, args) {
      assert.equal(root, "/repo");
      calls.push(args);
      if (args[0] === "rev-parse") return head;
      return "bbbbbbbb\0bbbbbbb\0Ship committed change\0Julian";
    },
  });

  assert.deepEqual((await monitor.status()).commits, []);
  head = "bbbbbbbb";
  assert.deepEqual((await monitor.status()).commits, [{ hash: "bbbbbbbb", shortHash: "bbbbbbb", subject: "Ship committed change", author: "Julian" }]);
  assert.ok(calls.some((args) => args[0] === "log" && args.at(-1) === "aaaaaaaa..bbbbbbbb"));
});
