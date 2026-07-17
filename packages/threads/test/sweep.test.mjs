import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { registerThread, sweep } from "../dist/sdk/index.js";
import { readSidecar, writeSidecarAtomic } from "../dist/core/sidecar.js";

const now = new Date("2026-07-16T12:00:00Z");

/** Builds a fake SessionStateReader keyed by session id, with no cwd-based resolution. */
function fakeReader(states) {
  return {
    /** Returns the fixed fake state for a session id, looked up from the given states map. */
    async read(sessionId) {
      return states[sessionId];
    },
    /** Never resolves by cwd: every registered thread in this file already carries a sessionId. */
    async resolveSessionIdByCwd() {
      return undefined;
    }
  };
}

const noopNotifier = {
  /** Fake notifier that discards every notification, standing in for terminal-notifier. */
  notify: async () => {}
};

/** Writes a thread-<slug>.md fixture file under the vault. */
async function writeThread(root, node, slug, frontmatter, body) {
  const dir = path.join(root, node);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `thread-${slug}.md`), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

/** Sets up one synthetic vault covering every state in the design's state table, plus an owned and an unowned overview backlog item. */
async function buildVault() {
  const root = await mkdtemp(path.join(tmpdir(), "tangent-threads-vault-"));

  await writeThread(root, "n-working", "working", "outcome: ship it\nstatus: open\nopened: 2026-07-10", "Just plain progress notes.");
  await writeThread(root, "n-blocked", "blocked", "outcome: land clearances\nstatus: open\nopened: 2026-07-14", "Owner: Chris.");
  await writeThread(root, "n-ready", "ready", "outcome: pxp review\nstatus: open\nopened: 2026-07-12", "Owner: Troy.");
  await writeThread(root, "n-deadline", "deadline", "outcome: guys on staging\nstatus: open\nopened: 2026-07-01", "Owner: Will. Guys on the staging instance by 📅 2026-07-16.");
  await writeThread(root, "n-cadence", "cadence", "outcome: keep in touch with Will\nstatus: open\nopened: 2026-07-01", "Owner: Will. Check in every 2 days.");
  await writeThread(root, "n-parked", "parked", "outcome: land error remediation\nstatus: open\nopened: 2026-07-01", "Wake when pgande-staging lands on main.");
  await writeThread(root, "n-done", "done", "outcome: old work\nstatus: done\nopened: 2026-06-01\nclosed: 2026-06-05", "Owner: Julian.");
  await writeThread(root, "n-owned", "target", "outcome: merge staging\nstatus: open\nopened: 2026-07-01", "Owner: you.");

  await mkdir(path.join(root, "n-cadence"), { recursive: true });
  await writeFile(path.join(root, "n-cadence", "2026-07-10-check-in.md"), "# Check-in\n\nSpoke with Will.\n", "utf8");

  await mkdir(path.join(root, "n-owned"), { recursive: true });
  await writeFile(
    path.join(root, "n-owned", "overview.md"),
    ["# Owned node", "", "## On me", "", "- [ ] Get the pgande-staging branch merged [[n-owned/thread-target]] 📅 2026-07-16", ""].join("\n"),
    "utf8"
  );

  await mkdir(path.join(root, "n-unowned"), { recursive: true });
  await writeFile(
    path.join(root, "n-unowned", "overview.md"),
    ["# Unowned node", "", "## On me", "", "- [ ] Take stock of small DIM fixups and quality-of-life items", ""].join("\n"),
    "utf8"
  );

  return root;
}

test("one synthetic vault derives every state in the design's state table", async () => {
  const vaultRoot = await buildVault();
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  await registerThread({ slug: "blocked", node: "n-blocked", worktree: "/tmp/wt-blocked", tmux: "tg-blocked", sessionId: "sess-blocked", sidecarPath, now });
  await registerThread({ slug: "ready", node: "n-ready", worktree: "/tmp/wt-ready", tmux: "tg-ready", sessionId: "sess-ready", sidecarPath, now });

  const reader = fakeReader({
    "sess-blocked": { status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" },
    "sess-ready": { status: "ended", idleMs: 0 }
  });

  const result = await sweep({ vaultRoot, sidecarPath, now, sessionStateReader: reader, notifier: noopNotifier });
  const byState = Object.fromEntries(result.derived.map((thread) => [thread.slug, thread.state]));

  assert.equal(byState.working, "working");
  assert.equal(byState.blocked, "blocked-on-you");
  assert.equal(byState.ready, "finishing");
  assert.equal(byState.deadline, "needs-you");
  assert.equal(byState.cadence, "needs-you");
  assert.equal(byState.parked, "parked");
  assert.equal(byState.done, "done");
  // The overview item links to n-owned/thread-target, which carries no deadline of its own; the
  // 📅 2026-07-16 on the linking "## On me" item is what pushes it to needs-you.
  assert.equal(byState.target, "needs-you");

  assert.equal(result.unowned.length, 1);
  assert.match(result.unowned[0].text, /DIM fixups/);

  assert.equal(result.sidecar.counts.blocked, 1);
  assert.equal(result.sidecar.counts.ready, 0);
  assert.equal(result.sidecar.counts.needsYou, 3);
  assert.equal(result.sidecar.counts.working, 1);
  assert.equal(result.sidecar.counts.finishing, 1);
  assert.equal(result.sidecar.counts.parked, 1);
  assert.equal(result.sidecar.counts.unowned, 1);

  assert.doesNotMatch(result.markdown, /\bdone\b/);
  assert.match(result.markdown, /NEEDS YOU/);
  assert.match(result.markdown, /◐ working/);
  assert.match(result.markdown, /◌ parked/);
  assert.match(result.markdown, /⚠ /);

  const writtenMarkdown = await readFile(path.join(vaultRoot, "threads.md"), "utf8");
  assert.equal(writtenMarkdown, result.markdown);

  // The sidecar persists the render view (minus done threads) so `list <subtree>` can filter later.
  assert.ok(result.sidecar.view, "expected the sidecar to carry the render view");
  assert.ok(!result.sidecar.view.threads.some((thread) => thread.state === "done"));
  assert.equal(result.sidecar.view.unowned.length, 1);
});

test("sweep --dry-run reports the result without writing threads.md or the sidecar", async () => {
  const vaultRoot = await buildVault();
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  const result = await sweep({ vaultRoot, sidecarPath, now, dryRun: true, notifier: noopNotifier });
  assert.equal(result.dryRun, true);
  assert.ok(result.markdown.length > 0);
  await assert.rejects(readFile(path.join(vaultRoot, "threads.md"), "utf8"));
  await assert.rejects(readFile(sidecarPath, "utf8"));
});

test("sweep carries forward recurring-dispatch bookkeeping already in the sidecar", async () => {
  const vaultRoot = await buildVault();
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  const seededRecur = { "some-slug": { lastRunAt: "2026-07-15T09:00:00.000Z" } };
  await writeSidecarAtomic(sidecarPath, { ...(await readSidecar(sidecarPath)), recur: seededRecur });

  const result = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });

  assert.deepEqual(result.sidecar.recur, seededRecur);
  const written = await readSidecar(sidecarPath);
  assert.deepEqual(written.recur, seededRecur);
});

/** Runs a git command synchronously in a fixture directory, discarding its output. */
function runGit(dir, args) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

test("sweep updates shared state-of-play only for nodes with a shared/ dir and a non-done thread", async () => {
  const vaultRoot = await buildVault();
  // n-blocked has a non-done ("blocked-on-you") thread and a shared/ dir: qualifies.
  await mkdir(path.join(vaultRoot, "n-blocked", "shared"), { recursive: true });
  // n-done's only thread is done: its shared/ dir must be skipped even though it exists.
  await mkdir(path.join(vaultRoot, "n-done", "shared"), { recursive: true });
  // n-working has a qualifying thread but no shared/ dir: must be skipped.
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  const calls = [];
  const sharedWriter = {
    /** Records every call instead of touching the filesystem or git. */
    async write(nodeDir, section) {
      calls.push({ nodeDir, section });
      return "written";
    }
  };

  await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier, sharedWriter });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].nodeDir, path.join(vaultRoot, "n-blocked"));
  assert.match(calls[0].section, /blocked/);
});

test("sweep --dry-run never calls the shared state-of-play writer", async () => {
  const vaultRoot = await buildVault();
  await mkdir(path.join(vaultRoot, "n-blocked", "shared"), { recursive: true });
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  let called = false;
  const sharedWriter = {
    /** Marks itself called; dry-run must never reach this. */
    async write() {
      called = true;
      return "written";
    }
  };

  await sweep({ vaultRoot, sidecarPath, now, dryRun: true, notifier: noopNotifier, sharedWriter });

  assert.equal(called, false);
});

test("sweep commits the shared state-of-play update when shared/ is its own git repo", async () => {
  const vaultRoot = await buildVault();
  const sharedDir = path.join(vaultRoot, "n-blocked", "shared");
  await mkdir(sharedDir, { recursive: true });
  runGit(sharedDir, ["init", "-q", "-b", "main"]);
  runGit(sharedDir, ["config", "user.email", "shared-test@example.com"]);
  runGit(sharedDir, ["config", "user.name", "Shared Test"]);
  await writeFile(path.join(sharedDir, "keep.txt"), "hi\n");
  runGit(sharedDir, ["add", "."]);
  runGit(sharedDir, ["commit", "-q", "-m", "initial"]);
  const before = execFileSync("git", ["-C", sharedDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });

  const after = execFileSync("git", ["-C", sharedDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.notEqual(after, before);
  const message = execFileSync("git", ["-C", sharedDir, "log", "-1", "--pretty=%s"], { encoding: "utf8" }).trim();
  assert.equal(message, "update: state-of-play threads section");

  const content = await readFile(path.join(sharedDir, "state-of-play.md"), "utf8");
  assert.match(content, /blocked/);
});

test("sweep writes shared state-of-play without attempting a commit when shared/ has no .git", async () => {
  const vaultRoot = await buildVault();
  const sharedDir = path.join(vaultRoot, "n-blocked", "shared");
  await mkdir(sharedDir, { recursive: true });
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  try {
    await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });
  } finally {
    console.error = originalError;
  }

  // No .git means the writer must skip the commit outright, never attempt (and swallow) a failing one.
  assert.deepEqual(loggedErrors, []);
  const content = await readFile(path.join(sharedDir, "state-of-play.md"), "utf8");
  assert.match(content, /blocked/);
});

test("a throwing shared writer for one node is logged and isolated: the other node still gets written", async () => {
  const vaultRoot = await buildVault();
  // n-blocked's writer call throws; n-ready's must still succeed regardless.
  await mkdir(path.join(vaultRoot, "n-blocked", "shared"), { recursive: true });
  await mkdir(path.join(vaultRoot, "n-ready", "shared"), { recursive: true });
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  const calls = [];
  const sharedWriter = {
    /** Throws for n-blocked only, to prove one node's failure never blocks another's write. */
    async write(nodeDir, section) {
      if (nodeDir.endsWith("n-blocked")) throw new Error("simulated shared-write failure");
      calls.push({ nodeDir, section });
      return "written";
    }
  };

  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args.join(" "));
  let result;
  try {
    result = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier, sharedWriter });
  } finally {
    console.error = originalError;
  }

  // The sweep itself resolves normally despite the throw.
  assert.ok(result.markdown.length > 0);
  assert.ok(loggedErrors.some((line) => line.includes("n-blocked") && line.includes("simulated shared-write failure")));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].nodeDir, path.join(vaultRoot, "n-ready"));
});

test("sweep logs a precise diagnostic (path and marker counts) and never writes when a node's markers are malformed", async () => {
  const vaultRoot = await buildVault();
  const sharedDir = path.join(vaultRoot, "n-blocked", "shared");
  await mkdir(sharedDir, { recursive: true });
  const file = path.join(sharedDir, "state-of-play.md");
  const malformedContent = "# Notes\n\n<!-- tangent-threads:begin -->\nHuman content that must survive.\n";
  await writeFile(file, malformedContent);
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");

  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args.join(" "));
  try {
    await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });
  } finally {
    console.error = originalError;
  }

  assert.ok(loggedErrors.some((line) => line.includes(file) && line.includes("found 1 begin / 0 end") && line.includes("fix by hand")));
  assert.equal(await readFile(file, "utf8"), malformedContent);
});
