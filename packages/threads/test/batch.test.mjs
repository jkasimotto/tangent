import assert from "node:assert/strict";
import test from "node:test";

import { parseThreadFile } from "../dist/core/thread-parser.js";
import { renderThreadsMarkdown } from "../dist/core/render.js";

test("parses the Batch body line", () => {
  const parsed = parseThreadFile("proj/thread-fix-a.md", [
    "---", "outcome: fix a", "status: open", "opened: 2026-07-16", "---",
    "Owner: sonnet worker (dispatched)", "Batch: dim-fixups", "Fix the a."
  ].join("\n"));
  assert.equal(parsed.batch, "dim-fixups");
});

test("working threads group by batch with a bracketed prefix", () => {
  const markdown = renderThreadsMarkdown({
    vaultRoot: "/tmp/trees",
    threads: [
      { slug: "fix-b", node: "proj", owner: "sonnet", state: "working", why: "in progress.", batch: "dim-fixups" },
      { slug: "solo", node: "proj", owner: "you", state: "working", why: "in progress." },
      { slug: "fix-a", node: "proj", owner: "sonnet", state: "working", why: "in progress.", batch: "dim-fixups" }
    ],
    unowned: [],
    now: new Date("2026-07-16T08:00:00Z")
  });
  const lines = markdown.split("\n").filter((l) => l.includes("fix-") || l.includes("solo"));
  assert.match(lines[0], /fix-a.*\[dim-fixups\]/);
  assert.match(lines[1], /fix-b.*\[dim-fixups\]/);
  assert.match(lines[2], /solo/);
});
