import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupThread, markValidationReady, readSidecar, registerThread, renderThreadsStatusBadge } from "../dist/sdk/index.js";

test("validation evidence is persisted on the registered thread", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "threads-lifecycle-"));
  const sidecarPath = path.join(dir, "status.json");
  await registerThread({ slug: "panel", node: "n", worktree: "/wt", tmux: "tg-panel", sidecarPath });
  await markValidationReady({ slug: "panel", verdict: "Does the panel match items 1/3/4?", url: "http://app/?org=pge&cli=panel", sidecarPath, now: new Date("2026-07-17T01:00:00Z") });
  const sidecar = await readSidecar(sidecarPath);
  assert.equal(sidecar.registry.panel.validation.verdict, "Does the panel match items 1/3/4?");
});

test("cleanup removes created resources and never touches reused resources", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "threads-lifecycle-"));
  const sidecarPath = path.join(dir, "status.json");
  await registerThread({
    slug: "panel", node: "n", worktree: "/created/wt", tmux: "tg-panel", baseBranch: "main", sidecarPath,
    created: { tmuxSessions: ["tg-panel"], cdevInstances: ["panel"], worktrees: ["/created/wt"], branches: ["dev/panel"] },
    reused: { worktrees: ["/precious/wt"], branches: ["long-lived"] }
  });
  const calls = [];
  /** Records cleanup process calls and returns successful deterministic fixtures. */
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const steps = await cleanupThread({ slug: "panel", sidecarPath, run });
  assert.ok(steps.some((step) => step.target === "/precious/wt" && step.result === "skipped"));
  assert.ok(calls.some((call) => call.join(" ") === "tmux kill-session -t tg-panel"));
  assert.ok(calls.some((call) => call.join(" ") === "plz cdev rm panel"));
  assert.ok(calls.some((call) => call.includes("/created/wt")));
  assert.ok(!calls.some((call) => call.includes("/precious/wt")));
  assert.ok(!calls.some((call) => call.includes("long-lived")));
});

test("status badge contains identity, reason, overflow, and staleness", () => {
  const badge = renderThreadsStatusBadge({
    sweptAt: "2026-07-17T00:00:00Z",
    counts: { needsYou: 2, blocked: 0, working: 0, finishing: 0, ready: 0, parked: 0, unowned: 0 },
    needsYou: [
      { slug: "clearances", why: "deadline passed", reason: "deadline", verb: "/threads" },
      { slug: "other", why: "question", reason: "blocked", verb: "/attach other" }
    ], registry: {}, notified: {}
  }, new Date("2026-07-17T02:00:01Z"));
  assert.equal(badge, "●2 clearances(deadline) +1 stale");
});
