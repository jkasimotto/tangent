import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sweep } from "../dist/core/sweep.js";

/** Notifier that records instead of alerting. */
function fakeNotifier(calls) {
  return {
    /** Records the notification for assertions. */
    notify: async (n) => { calls.push(n); }
  };
}

/** Session reader for vaults with no dispatched workers. */
const noSessions = {
  /** No registered session ever resolves. */
  read: async () => undefined,
  /** No cwd ever matches a session. */
  resolveSessionIdByCwd: async () => undefined
};

/** Builds a vault containing one parked thread with the given wake line. */
async function vaultWithParkedThread(wakeLine) {
  const root = await mkdtemp(path.join(tmpdir(), "wake-vault-"));
  const node = path.join(root, "proj");
  await mkdir(node, { recursive: true });
  await writeFile(path.join(node, "thread-frozen.md"), [
    "---", "outcome: land the thing", "status: open", "opened: 2026-07-01", "---",
    "Owner: you.", wakeLine, ""
  ].join("\n"));
  return root;
}

test("a met wake condition surfaces the thread as needs-you and notifies", async () => {
  const root = await vaultWithParkedThread("Wake when b is merged into main in /tmp/repo");
  const calls = [];
  const result = await sweep({
    vaultRoot: root,
    sidecarPath: path.join(root, "..", `sidecar-${path.basename(root)}.json`),
    now: new Date("2026-07-16T08:00:00Z"),
    sessionStateReader: noSessions,
    notifier: fakeNotifier(calls),
    gitProbe: {
      /** Simulates a git probe where the wake condition's branch is already merged. */
      isAncestor: async () => true
    }
  });
  const frozen = result.derived.find((t) => t.slug === "frozen");
  assert.equal(frozen.state, "needs-you");
  assert.match(frozen.templateWhy, /wake condition met/);
  assert.deepEqual(result.notifiedSlugs, ["frozen"]);
});

test("an unmet wake condition keeps the thread parked", async () => {
  const root = await vaultWithParkedThread("Wake when b is merged into main in /tmp/repo");
  const result = await sweep({
    vaultRoot: root,
    sidecarPath: path.join(root, "..", `sidecar-${path.basename(root)}.json`),
    now: new Date("2026-07-16T08:00:00Z"),
    sessionStateReader: noSessions,
    notifier: fakeNotifier([]),
    gitProbe: {
      /** Simulates a git probe where the wake condition's branch is not yet merged. */
      isAncestor: async () => false
    }
  });
  assert.equal(result.derived.find((t) => t.slug === "frozen").state, "parked");
});

test("a past-dated \"Wake on\" body line surfaces as needs-you through the full sweep", async () => {
  const root = await vaultWithParkedThread("Wake on 2026-07-01");
  const calls = [];
  const result = await sweep({
    vaultRoot: root,
    sidecarPath: path.join(root, "..", `sidecar-${path.basename(root)}.json`),
    now: new Date("2026-07-16T08:00:00Z"),
    sessionStateReader: noSessions,
    notifier: fakeNotifier(calls),
    gitProbe: {
      /** Unused: the date condition never consults the git probe. */
      isAncestor: async () => false
    }
  });
  const frozen = result.derived.find((t) => t.slug === "frozen");
  assert.equal(frozen.state, "needs-you");
  assert.match(frozen.templateWhy, /wake condition met: Wake on 2026-07-01/);
  assert.deepEqual(result.notifiedSlugs, ["frozen"]);
});
