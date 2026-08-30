import assert from "node:assert/strict";
import test from "node:test";
import { cardFieldsHash, validateCard } from "./goal-cards.mjs";

test("the first-version card kinds validate to typed plain data", async () => {
  const examples = [
    ["copy", { text: "Copy me" }],
    ["link", { label: "Preview", url: "https://example.com/a" }],
    ["links", { items: [{ label: "PR", url: "https://example.com/pr" }] }],
    ["progress", { steps: [{ label: "Build", status: "current" }], current: 1 }],
    ["checklist", { items: [{ label: "Tests", done: true }] }],
    ["commits", { repo: "/repo", commits: [{ hash: "abcdef1", subject: "Ship" }] }],
    ["reviews", { items: [{ id: "D1", title: "Ship", url: "https://example.com/D1", state: "Accepted" }] }],
  ];
  for (const [kind, fields] of examples) assert.equal((await validateCard(kind, "Title", fields)).kind, kind);
});

test("cards refuse arbitrary kinds, unsafe URLs, bad limits, and bad progress", async () => {
  await assert.rejects(validateCard("html", "Title", {}), /not available/);
  await assert.rejects(validateCard("link", "Title", { label: "Bad", url: "javascript:alert(1)" }), /url must be http/);
  await assert.rejects(validateCard("links", "Title", { items: [] }), /1-3/);
  await assert.rejects(validateCard("progress", "Title", { steps: [{ label: "One", status: "running" }] }), /done, current, or todo/);
});

test("file URLs use the injected allow-list and field hashes are canonical", async () => {
  const card = await validateCard("link", "Design", { url: "design.md", label: "Design" }, async (file) => ({ root: "vault", file }));
  assert.deepEqual(card.fields.url, { root: "vault", file: "design.md" });
  assert.equal(cardFieldsHash({ b: 2, a: 1 }), cardFieldsHash({ a: 1, b: 2 }));
});
