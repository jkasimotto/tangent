import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createReviewedBuildEngine } from "../dist/index.js";

const execFileAsync = promisify(execFile);

test("Reviewed build completes all eight steps with validated handoffs and a dirty baseline", async () => {
  const fixture = await createFixture();
  const calls = [];
  const engine = createReviewedBuildEngine({
    treesRoot: fixture.trees,
    loopsRoot: fixture.loops,
    runner: completeRunner(fixture.repo, calls)
  });
  try {
    await engine.initialize();
    const started = await engine.start({ goalPath: fixture.goalPath });
    await engine.waitForIdle(started.id);
    const run = await engine.getRun(started.id);

    assert.equal(run.status, "complete");
    assert.deepEqual(run.steps.map((step) => step.status), Array(8).fill("complete"));
    assert.deepEqual(calls.map((call) => call.label), [
      "Create the design",
      "Review the design",
      "Respond and plan",
      "Review the implementation plan",
      "Respond to the plan review",
      "Implement",
      "Review the implementation",
      "Respond and fix"
    ]);
    assert.equal(new Set(run.steps.map((step) => step.attempts[0].sessionId)).size, 8);
    assert.ok(calls.every((call) => call.prompt.includes("A finished widget has reviewed code and proof.")));
    assert.match(calls[1].prompt, /design: docs\/design\.md/);
    assert.match(calls[6].prompt, /implementation-plan: docs\/implementation-plan\.md/);
    assert.equal(await readFile(path.join(fixture.repo, "unrelated.txt"), "utf8"), "user's unfinished change\n");
    assert.ok(!run.final.changedPaths.includes("unrelated.txt"));
    assert.ok(run.final.changedPaths.includes("src/feature.txt"));
    assert.equal(run.steps[7].attempts[0].artifacts[0].purpose, "review-response");
    assert.match(await readFile(path.join(fixture.loops, "reviewed-build", "runs", run.id, "run.json"), "utf8"), /reviewed-build\.run\.v1/);
    assert.match(await readFile(path.join(fixture.trees, fixture.goalPath), "utf8"), /^---[\s\S]*status: open/m);
  } finally {
    await fixture.cleanup();
  }
});

test("a pending model change and selected session continuation affect only the resolved Run", async () => {
  const fixture = await createFixture();
  const calls = [];
  const gate = deferred();
  const runner = completeRunner(fixture.repo, calls, {
    /** Blocks the design step until the test changes its pending choices. */
    before: async (label) => { if (label === "Create the design") await gate.promise; }
  });
  const engine = createReviewedBuildEngine({ treesRoot: fixture.trees, loopsRoot: fixture.loops, runner });
  try {
    const started = await engine.start({
      goalPath: fixture.goalPath,
      sessions: { "respond-and-plan": { mode: "continue", fromStepId: "design" } }
    });
    await waitFor(async () => (await engine.getRun(started.id)).steps[0].status === "running");
    await engine.updatePendingStep(started.id, "implement", {
      binding: { id: "codex-low", label: "Codex low", provider: "codex", command: "codex", model: "gpt-low", effort: "low" }
    });
    gate.resolve();
    await engine.waitForIdle(started.id);
    const run = await engine.getRun(started.id);

    assert.equal(run.status, "complete");
    const resumed = calls.find((call) => call.label === "Respond and plan");
    assert.deepEqual(resumed.session, { kind: "resume", id: run.steps[0].attempts[0].sessionId });
    const implement = calls.find((call) => call.label === "Implement");
    assert.equal(implement.model, "gpt-low");
    assert.equal(run.steps.find((step) => step.id === "implement").binding.label, "Codex low");
  } finally {
    await fixture.cleanup();
  }
});

test("stop and resume preserve completed steps and create a new active-step attempt", async () => {
  const fixture = await createFixture();
  const calls = [];
  const secondStarted = deferred();
  let blockSecond = true;
  const runner = completeRunner(fixture.repo, calls, {
    /** Blocks the second step until the test stops the Run. */
    before: async (label, args) => {
      if (label !== "Review the design" || !blockSecond) return;
      blockSecond = false;
      secondStarted.resolve();
      await aborted(args.signal);
    }
  });
  const engine = createReviewedBuildEngine({ treesRoot: fixture.trees, loopsRoot: fixture.loops, runner });
  try {
    const started = await engine.start({ goalPath: fixture.goalPath });
    await secondStarted.promise;
    await engine.control(started.id, { action: "stop" });
    await engine.waitForIdle(started.id);
    const stopped = await engine.getRun(started.id);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.steps[0].attempts.length, 1);
    assert.equal(stopped.steps[1].attempts.length, 1);

    await engine.control(started.id, { action: "resume" });
    await engine.waitForIdle(started.id);
    const completed = await engine.getRun(started.id);
    assert.equal(completed.status, "complete");
    assert.equal(completed.steps[0].attempts.length, 1);
    assert.equal(completed.steps[1].attempts.length, 2);
    assert.equal(completed.steps[1].attempts[0].status, "stopped");
    assert.equal(completed.steps[1].attempts[1].status, "complete");
  } finally {
    await fixture.cleanup();
  }
});

test("a judgment pause returns the answer to a new attempt and then continues", async () => {
  const fixture = await createFixture();
  const calls = [];
  let asked = false;
  const base = completeRunner(fixture.repo, calls);
  /** Pauses the first design review for a product judgment. */
  const runner = async (args) => {
    const label = stepLabel(args.prompt);
    if (label === "Review the design" && !asked) {
      asked = true;
      calls.push(callRecord(label, args));
      await writeArtifact(fixture.repo, "docs/design-review.md", "Result: needs_judgment\n\nChoose the public API name.\n");
      const envelope = {
        status: "needs_judgment",
        summary: "The API name needs product judgment.",
        artifacts: [{ path: "docs/design-review.md", purpose: "design-review" }],
        proof: [],
        question: "Should the API be named build or program?"
      };
      return result(args, envelope, calls.length);
    }
    return base(args);
  };
  const engine = createReviewedBuildEngine({ treesRoot: fixture.trees, loopsRoot: fixture.loops, runner });
  try {
    const started = await engine.start({ goalPath: fixture.goalPath });
    await engine.waitForIdle(started.id);
    const paused = await engine.getRun(started.id);
    assert.equal(paused.status, "needs_attention");
    assert.equal(paused.attention.kind, "judgment");

    await engine.control(started.id, { action: "resume", decision: "Use Program because it is durable and reusable." });
    await engine.waitForIdle(started.id);
    const completed = await engine.getRun(started.id);
    assert.equal(completed.status, "complete");
    assert.equal(completed.steps[1].attempts.length, 2);
    assert.match(calls.filter((call) => call.label === "Review the design")[1].prompt, /Use Program because it is durable and reusable/);
  } finally {
    await fixture.cleanup();
  }
});

test("an invalid artifact handoff blocks the next step and retry preserves the failed attempt", async () => {
  const fixture = await createFixture();
  let invalid = true;
  const calls = [];
  const base = completeRunner(fixture.repo, calls);
  /** Returns one invalid handoff before delegating to the complete runner. */
  const runner = async (args) => {
    if (stepLabel(args.prompt) === "Create the design" && invalid) {
      invalid = false;
      calls.push(callRecord("Create the design", args));
      return result(args, { status: "complete", summary: "Claimed completion.", artifacts: [], proof: [], question: null }, calls.length);
    }
    return base(args);
  };
  const engine = createReviewedBuildEngine({ treesRoot: fixture.trees, loopsRoot: fixture.loops, runner });
  try {
    const started = await engine.start({ goalPath: fixture.goalPath });
    await engine.waitForIdle(started.id);
    const failed = await engine.getRun(started.id);
    assert.equal(failed.status, "needs_attention");
    assert.match(failed.attention.message, /required design artifact/);
    assert.equal(failed.steps[1].attempts.length, 0);

    await engine.control(started.id, { action: "retry" });
    await engine.waitForIdle(started.id);
    const completed = await engine.getRun(started.id);
    assert.equal(completed.status, "complete");
    assert.equal(completed.steps[0].attempts.length, 2);
    assert.equal(completed.steps[0].attempts[0].status, "failed");
    assert.equal(completed.steps[0].attempts[1].status, "complete");
  } finally {
    await fixture.cleanup();
  }
});

test("a review result must be the first line of its artifact", async () => {
  const fixture = await createFixture();
  const calls = [];
  const base = completeRunner(fixture.repo, calls);
  /** Returns one review whose result appears after a preface. */
  const runner = async (args) => {
    if (stepLabel(args.prompt) !== "Review the design") return base(args);
    calls.push(callRecord("Review the design", args));
    await writeArtifact(fixture.repo, "docs/design-review.md", "Design review\n\nResult: pass\n");
    return result(args, complete("Design reviewed.", [{ path: "docs/design-review.md", purpose: "design-review" }]), calls.length);
  };
  const engine = createReviewedBuildEngine({ treesRoot: fixture.trees, loopsRoot: fixture.loops, runner });
  try {
    const started = await engine.start({ goalPath: fixture.goalPath });
    await engine.waitForIdle(started.id);
    const failed = await engine.getRun(started.id);
    assert.equal(failed.status, "needs_attention");
    assert.match(failed.attention.message, /must start with Result/);
    assert.equal(failed.steps[2].attempts.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

/** Creates an isolated Git repository and Tangent tree. */
async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tangent-reviewed-build-"));
  const repo = path.join(root, "repo");
  const trees = path.join(root, "trees");
  const loops = path.join(root, "loops");
  const area = path.join(trees, "otto", "widget");
  const goalPath = "otto/widget/goal-finish-widget.md";
  await mkdir(path.join(repo, "src"), { recursive: true });
  await mkdir(area, { recursive: true });
  await writeFile(path.join(repo, "src", "feature.txt"), "initial\n", "utf8");
  await writeFile(path.join(repo, "unrelated.txt"), "clean\n", "utf8");
  await git(repo, ["init", "-q"]);
  await git(repo, ["config", "user.email", "fixture@example.com"]);
  await git(repo, ["config", "user.name", "Fixture"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-qm", "fixture"]);
  await writeFile(path.join(repo, "unrelated.txt"), "user's unfinished change\n", "utf8");
  await writeFile(path.join(area, "widget.md"), `---\ntype: work\nstatus:\n---\n\n# Widget\n\n## Resources\n\n- Repository: ${repo}\n- Design: [[design-widget]]\n`, "utf8");
  await writeFile(path.join(area, "design-widget.md"), "# Widget constraints\n\nKeep the public API small.\n", "utf8");
  await writeFile(path.join(trees, goalPath), `---\ntype: goal\nstatus: open\ndone_when: A finished widget has reviewed code and proof.\nsession:\nwaiting_on:\n---\n\n# Finish the widget\n\n## Current brief\n\nImplement the durable widget behavior.\n\n## Documents\n\n1. [[design-widget]]\n`, "utf8");
  return {
    root, repo, trees, loops, goalPath,
    /** Removes every temporary fixture path. */
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

/** Returns a complete fake provider runner for each Program step. */
function completeRunner(repo, calls, hooks = {}) {
  let sequence = 0;
  return async (args) => {
    const label = stepLabel(args.prompt);
    calls.push(callRecord(label, args));
    await hooks.before?.(label, args);
    sequence += 1;
    let envelope;
    if (label === "Create the design") {
      await writeArtifact(repo, "docs/design.md", `# Design\n\nVersion ${sequence}.\n`);
      envelope = complete("Design written.", [{ path: "docs/design.md", purpose: "design" }]);
    } else if (label === "Review the design") {
      await writeArtifact(repo, "docs/design-review.md", `Result: pass\n\nDesign review ${sequence}.\n`);
      envelope = complete("Design reviewed.", [{ path: "docs/design-review.md", purpose: "design-review" }]);
    } else if (label === "Respond and plan") {
      await writeArtifact(repo, "docs/design.md", `# Design\n\nRevised ${sequence}.\n`);
      await writeArtifact(repo, "docs/implementation-plan.md", `# Plan\n\nPlan ${sequence}.\n`);
      envelope = complete("Review answered and plan written.", [
        { path: "docs/design.md", purpose: "design" },
        { path: "docs/implementation-plan.md", purpose: "implementation-plan" }
      ]);
    } else if (label === "Review the implementation plan") {
      await writeArtifact(repo, "docs/implementation-plan-review.md", `Result: changes_requested\n\nPlan review ${sequence}.\n`);
      envelope = complete("Plan changes requested.", [{ path: "docs/implementation-plan-review.md", purpose: "implementation-plan-review" }]);
    } else if (label === "Respond to the plan review") {
      await writeArtifact(repo, "docs/implementation-plan.md", `# Plan\n\nRevised plan ${sequence}.\n`);
      envelope = complete("Plan review answered.", [{ path: "docs/implementation-plan.md", purpose: "implementation-plan" }]);
    } else if (label === "Implement") {
      await writeArtifact(repo, "src/feature.txt", `implemented ${sequence}\n`);
      envelope = complete("Implementation complete.", [], [{ command: "npm test", result: "passed" }]);
    } else if (label === "Review the implementation") {
      await writeArtifact(repo, "docs/implementation-review.md", `Result: changes_requested\n\nImplementation review ${sequence}.\n`);
      envelope = complete("One fix requested.", [{ path: "docs/implementation-review.md", purpose: "implementation-review" }]);
    } else if (label === "Respond and fix") {
      await writeArtifact(repo, "src/feature.txt", `fixed ${sequence}\n`);
      await writeArtifact(repo, "docs/review-response.md", `# Review response\n\nFixed in pass ${sequence}.\n`);
      envelope = complete("Review answered and final proof passed.", [{ path: "docs/review-response.md", purpose: "review-response" }], [{ command: "npm test", result: "passed" }]);
    } else throw new Error(`Unknown step: ${label}`);
    return result(args, envelope, sequence);
  };
}

/** Creates a valid complete envelope. */
function complete(summary, artifacts, proof = []) {
  return { status: "complete", summary, artifacts, proof, question: null };
}

/** Creates one fake provider result. */
function result(args, envelope, sequence) {
  const sessionId = args.session?.kind === "resume" ? args.session.id : `${args.agent.provider}-session-${sequence}`;
  return {
    provider: args.agent.provider,
    text: JSON.stringify(envelope),
    structuredOutput: envelope,
    sessionId,
    stdout: JSON.stringify(envelope),
    stderr: ""
  };
}

/** Records the runner facts asserted by tests. */
function callRecord(label, args) {
  return { label, prompt: args.prompt, session: args.session, provider: args.agent.provider, model: args.agent.model };
}

/** Reads the visible Program step label from the complete prompt. */
function stepLabel(prompt) {
  return prompt.match(/\nSTEP\n([^\n]+)/)?.[1] || "";
}

/** Writes one project-native fixture artifact. */
async function writeArtifact(repo, relative, text) {
  await mkdir(path.dirname(path.join(repo, relative)), { recursive: true });
  await writeFile(path.join(repo, relative), text, "utf8");
}

/** Runs one Git command in the fixture repository. */
async function git(repo, args) {
  await execFileAsync("git", ["-C", repo, ...args]);
}

/** Returns a manually controlled promise. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Waits for an abort signal and rejects like a stopped process. */
function aborted(signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

/** Polls a fixture condition until it becomes true. */
async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for fixture state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
