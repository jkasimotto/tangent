import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sweep } from "../dist/sdk/index.js";
import { normalizeWhyLineResult } from "../dist/core/haiku.js";

const now = new Date("2026-07-16T12:00:00Z");
const noopNotifier = {
  /** Fake notifier that discards every notification, standing in for terminal-notifier. */
  notify: async () => {}
};

/** Writes a minimal open thread-<slug>.md fixture file under the given vault node. */
async function writeOpenThread(root, node, slug, body) {
  const dir = path.join(root, node);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `thread-${slug}.md`), `---\noutcome: test\nstatus: open\nopened: 2026-07-01\n---\n${body}\n`, "utf8");
}

test("normalizeWhyLineResult discards unknown slugs and non-string garbage", () => {
  const known = new Set(["real-slug"]);
  const normalized = normalizeWhyLineResult(
    {
      whyLines: { "real-slug": "a real why line", "unknown-slug": "should be dropped", "another-unknown": 42 },
      drafts: { "real-slug": "a draft", "unknown-slug": "dropped" },
      state: "blocked-on-you",
      extraGarbage: { nested: true }
    },
    known
  );
  assert.deepEqual(normalized.whyLines, { "real-slug": "a real why line" });
  assert.deepEqual(normalized.drafts, { "real-slug": "a draft" });
});

test("a runner returning extra keys, unknown slugs, and garbage changes no derived state and the sweep still succeeds", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-haiku-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  await writeOpenThread(vaultRoot, "n", "guy-wires", "Owner: Will. Deadline 📅 2026-07-16.");

  const maliciousRunner = {
    /** Fake WhyLineRunner that returns a valid why-line plus unknown slugs, garbage keys, and a fake "state"/"counts", simulating an adversarial or buggy model response. */
    run: async () => ({
      whyLines: { "guy-wires": "haiku why", "not-a-real-slug": "ignored", junk: 12345 },
      drafts: {},
      state: "working",
      needsYou: [],
      counts: { blocked: 999 }
    })
  };

  const withoutHaiku = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier });
  const withHaiku = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier, whyLineRunner: maliciousRunner });

  assert.equal(withoutHaiku.derived[0].state, "needs-you");
  assert.equal(withHaiku.derived[0].state, "needs-you");
  assert.match(withHaiku.markdown, /haiku why/);
});

test("a haiku runner that throws falls back to templated why-lines and the sweep still succeeds", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-haiku-fail-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  await writeOpenThread(vaultRoot, "n", "guy-wires", "Owner: Will. Deadline 📅 2026-07-16.");

  const failingRunner = {
    /** Fake WhyLineRunner that always throws, simulating the claude CLI being unavailable. */
    run: async () => { throw new Error("claude cli not installed"); }
  };
  const result = await sweep({ vaultRoot, sidecarPath, now, notifier: noopNotifier, whyLineRunner: failingRunner });

  assert.equal(result.derived[0].state, "needs-you");
  assert.match(result.markdown, /deadline 2026-07-16/);
});
