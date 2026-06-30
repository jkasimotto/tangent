import assert from "node:assert/strict";
import test from "node:test";
import { extractResultText } from "../dist/runners/judge.js";

test("extractResultText returns the final result event text", () => {
  const stdout = [
    JSON.stringify({ type: "assistant", message: { content: [] } }),
    JSON.stringify({ type: "result", result: "{\"criteria\":[]}" })
  ].join("\n") + "\n";
  assert.equal(extractResultText(stdout), "{\"criteria\":[]}");
});

test("extractResultText tolerates non-json lines and returns empty when absent", () => {
  assert.equal(extractResultText("garbage\n{not json}\n"), "");
});
