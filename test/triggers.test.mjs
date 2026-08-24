import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverTriggers,
  installTriggerLaunchAgent,
  parseDuration,
  parseTriggerManifest,
  parseTriggerOutcome,
  triggerIsDue,
  triggerSessionName,
} from "../dist/cli/triggers.js";

test("duration and probe contracts reject ambiguity", () => {
  assert.equal(parseDuration("15m"), 900_000);
  assert.deepEqual(parseTriggerOutcome('{"status":"idle"}'), { status: "idle" });
  assert.deepEqual(parseTriggerOutcome('{"status":"work","key":"new-1","context":"one file"}'), { status: "work", key: "new-1", context: "one file" });
  assert.deepEqual(parseTriggerOutcome('{"status":"attention","key":"adb-off","message":"Enable debugging"}'), { status: "attention", key: "adb-off", message: "Enable debugging" });
  assert.throws(() => parseDuration("hourly"), /invalid interval/);
  assert.throws(() => parseTriggerOutcome('{"status":"work"}'), /with key/);
});

test("manifest parsing derives cwd and validates trigger fields", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tangent-trigger-cwd-"));
  const definitions = parseTriggerManifest(JSON.stringify({
    scripts: { dev: "npm run dev" },
    triggers: { media: { every: "5m", probe: "./check", instructions: ".tangent/media.md" } }
  }), "area/.processes.json", "otto/media", cwd);
  assert.equal(definitions[0].cwd, cwd);
  assert.equal(definitions[0].everyMs, 300_000);
  assert.throws(() => parseTriggerManifest('{"triggers":{"bad":{"every":"5m","probe":"x"}}}', "x", "a", cwd), /needs instructions/);
});

test("due checks coalesce missed intervals", () => {
  const definition = { area: "a", name: "x", every: "5m", everyMs: 300_000, probe: "x", instructions: "x", cwd: "/tmp", paused: false };
  assert.equal(triggerIsDue(definition, undefined, new Date("2026-08-24T10:00:00Z")), true);
  assert.equal(triggerIsDue(definition, { lastCheckedAt: "2026-08-24T09:58:00Z" }, new Date("2026-08-24T10:00:00Z")), false);
  assert.equal(triggerIsDue(definition, { lastCheckedAt: "2026-08-24T09:00:00Z" }, new Date("2026-08-24T10:00:00Z")), true);
  assert.match(triggerSessionName(definition), /^trigger-a--x-/);
});

test("discovery finds triggers beside Area programs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-trigger-tree-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tangent-trigger-repo-"));
  const area = path.join(root, "otto", "media");
  await mkdir(area, { recursive: true });
  await writeFile(path.join(area, "media.md"), `---\ntype: area\n---\n\n# Media\n\n## Resources\n\n- Repository: ${cwd}\n`);
  await writeFile(path.join(area, ".processes.json"), JSON.stringify({ triggers: { poll: { every: "1h", probe: "./poll", instructions: "RUN.md" } } }));
  const definitions = await discoverTriggers(root);
  assert.deepEqual(definitions.map(({ area, name, every }) => ({ area, name, every })), [{ area: "otto/media", name: "poll", every: "1h" }]);
});

test("launch agent installation writes one coarse wake-up and reloads it", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "tangent-trigger-home-"));
  const calls = [];
  const runner = {
    /** Records one fixture launchctl call. */
    async run(command, args) { calls.push([command, args]); return { stdout: "", stderr: "" }; },
  };
  assert.match(await installTriggerLaunchAgent(home, runner), /installed com\.tangent\.triggers/);
  const plist = await import("node:fs/promises").then(({ readFile }) => readFile(path.join(home, "Library", "LaunchAgents", "com.tangent.triggers.plist"), "utf8"));
  assert.match(plist, /tangent trigger check/);
  assert.match(plist, /<integer>60<\/integer>/);
  assert.deepEqual(calls.map(([command, args]) => [command, args[0]]), [["launchctl", "bootout"], ["launchctl", "bootstrap"]]);
});
