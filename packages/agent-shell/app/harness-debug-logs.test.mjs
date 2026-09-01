import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { lstat, mkdtemp, readlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { enforceHarnessLogRetention, prepareHarnessDebugLog } from "./harness-debug-logs.mjs";

test("Pi debug output is linked outside the working tree", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-logs-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "harness-cwd-"));
  context.after(async () => Promise.all([import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })), import("node:fs/promises").then(({ rm }) => rm(cwd, { recursive: true, force: true }))]));
  const prepared = await prepareHarnessDebugLog({ command: "pi-code --model glm", cwd, session: "agent-a", root });
  assert.equal((await lstat(prepared.link)).isSymbolicLink(), true);
  assert.equal(await readlink(prepared.link), prepared.target);
  assert.equal(prepared.target.startsWith(root), true);
});

test("retention rotates an oversized external log and bounds file count", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-retention-"));
  const cwdRoot = await mkdtemp(path.join(tmpdir(), "harness-retention-cwd-"));
  context.after(async () => Promise.all([import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })), import("node:fs/promises").then(({ rm }) => rm(cwdRoot, { recursive: true, force: true }))]));
  for (let index = 0; index < 4; index += 1) {
    const prepared = await prepareHarnessDebugLog({ command: "pi-code", cwd: path.join(cwdRoot, String(index)), session: `agent-${index}`, root });
    await writeFile(prepared.target, "x".repeat(64));
  }
  const result = await enforceHarnessLogRetention(root, { maxBytes: 32, maxFiles: 2 });
  assert.equal(result.files, 2);
  const retained = [];
  for (const directory of await import("node:fs/promises").then(({ readdir }) => readdir(root))) {
    for (const name of await import("node:fs/promises").then(({ readdir }) => readdir(path.join(root, directory)))) retained.push(path.join(root, directory, name));
  }
  assert.equal(retained.length, 2);
  assert.ok((await Promise.all(retained.map((file) => stat(file)))).every((info) => info.isFile()));
});
