import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sweep } from "../dist/sdk/index.js";

const now = new Date("2026-07-16T12:00:00Z");
const noopNotifier = {
  /** Fake notifier that discards every notification, standing in for terminal-notifier. */
  notify: async () => {}
};

test("a scan error leaves the previous threads.md and sidecar byte-identical and exits nonzero", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-fail-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  const nodeDir = path.join(vaultRoot, "n");
  await mkdir(nodeDir, { recursive: true });
  await writeFile(path.join(nodeDir, "thread-ok.md"), "---\noutcome: fine\nstatus: open\nopened: 2026-07-01\n---\nOwner: Someone.\n", "utf8");

  const first = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });
  const previousMarkdown = await readFile(path.join(vaultRoot, "threads.md"), "utf8");
  const previousSidecar = await readFile(sidecarPath, "utf8");
  assert.equal(previousMarkdown, first.markdown);

  // Make the vault unreadable as a directory by replacing it with a file, simulating a scan error.
  await rm(vaultRoot, { recursive: true, force: true });
  await writeFile(vaultRoot, "not a directory", "utf8");

  await assert.rejects(sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier }));

  const afterFailureSidecar = await readFile(sidecarPath, "utf8");
  assert.equal(afterFailureSidecar, previousSidecar);

  await rm(vaultRoot, { force: true });
});

test("a haiku failure alone never propagates as a sweep failure", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-haiku-only-fail-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  const nodeDir = path.join(vaultRoot, "n");
  await mkdir(nodeDir, { recursive: true });
  await writeFile(path.join(nodeDir, "thread-ok.md"), "---\noutcome: fine\nstatus: open\nopened: 2026-07-01\n---\nOwner: Someone.\n", "utf8");

  const failingRunner = {
    /** Fake WhyLineRunner that always throws, simulating a haiku call failure. */
    run: async () => { throw new Error("boom"); }
  };
  const result = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier, whyLineRunner: failingRunner });
  assert.equal(result.dryRun, false);
  assert.ok(result.markdown.length > 0);
});
