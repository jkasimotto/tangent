import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dismissGoalCard, dismissGoalDocument, markGoalDocumentOpened, presentGoalCard, presentGoalDocument, projectCards, projectPresentations, pruneMissingPresentations, readGoalPresentations, removeGoalPresentations, withdrawGoalCard, withdrawGoalDocument } from "./goal-presentations.mjs";

const goal = { area: "otto/tangent", slug: "documents" };

/** Projects the current presentations of the test Goal. */
async function shown(root) { return projectPresentations(await readGoalPresentations(root, goal.area, goal.slug)); }

test("opening a presented Document keeps it and its siblings presented", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "presented-"));
  const first = { root: "vault", file: "otto/tangent/design-a.md", title: "Design A", hash: "one" };
  const second = { root: "vault", file: "otto/tangent/design-b.md", title: "Design B", hash: "two" };
  await presentGoalDocument(root, goal, first, { role: "worker" });
  await presentGoalDocument(root, goal, second, { role: "worker" });
  assert.equal((await markGoalDocumentOpened(root, goal, first.file, "one")).changed, true);
  const items = await shown(root);
  assert.deepEqual(items.map((item) => item.file), [second.file, first.file], "opening removes nothing from Work");
  assert.equal(items[1].openedAt !== null, true, "the opening is still recorded for the reader");
  assert.equal((await presentGoalDocument(root, goal, first, { role: "worker" })).changed, false, "re-presenting the same content is a no-op even after opening");
});

test("Julian dismisses one presentation, fenced to its content, without touching siblings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "presented-"));
  const first = { root: "vault", file: "otto/tangent/design-a.md", title: "Design A", hash: "one" };
  const second = { root: "vault", file: "otto/tangent/design-b.md", title: "Design B", hash: "two" };
  await presentGoalDocument(root, goal, first);
  await presentGoalDocument(root, goal, second);
  assert.equal((await dismissGoalDocument(root, goal, first.file)).changed, true);
  assert.deepEqual((await shown(root)).map((item) => item.file), [second.file], "only the dismissed row leaves");
  assert.equal((await dismissGoalDocument(root, goal, first.file)).changed, false, "a second dismiss has nothing to do");
  assert.equal((await presentGoalDocument(root, goal, first)).changed, false, "the same content stays dismissed");
  assert.equal((await presentGoalDocument(root, goal, { ...first, hash: "three" })).item.dismissedAt, null, "new content returns to Work");
  assert.deepEqual((await shown(root)).map((item) => item.file), [first.file, second.file]);
});

test("brain withdraw, missing-file pruning, and Goal closure still clear presentations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "presented-"));
  const document = { root: "vault", file: "otto/tangent/design-a.md", title: "Design A", hash: "one" };
  await presentGoalDocument(root, goal, document);
  await markGoalDocumentOpened(root, goal, document.file, "one");
  assert.equal((await withdrawGoalDocument(root, goal, document.file)).changed, true, "the brain withdraws an opened presentation");
  assert.equal((await shown(root)).length, 0);
  assert.equal((await presentGoalDocument(root, goal, document)).changed, true, "the brain can present the same content again after withdrawing");
  await presentGoalDocument(root, goal, { ...document, file: "missing.md", hash: "three" });
  const pruned = await pruneMissingPresentations(root, await readGoalPresentations(root, goal.area, goal.slug), async (item) => item.file !== "missing.md");
  assert.equal(pruned.changed, true, "a missing file cannot litter the attention store");
  assert.equal(await removeGoalPresentations(root, goal), true);
  assert.equal((await readGoalPresentations(root, goal.area, goal.slug)).items.length, 0);
});

test("cards update in place, dismiss by hash, return on change, and withdraw", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-cards-"));
  const first = { kind: "copy", title: "Review", fields: { text: "one" }, fieldsHash: "one" };
  const created = await presentGoalCard(root, goal, first, { session: "brain", role: "brain", area: goal.area }, "2026-01-01T00:00:00.000Z");
  assert.equal((await presentGoalCard(root, goal, first, {})).changed, false);
  await dismissGoalCard(root, goal, created.card.id);
  assert.equal(projectCards(await readGoalPresentations(root, goal.area, goal.slug)).length, 0);
  const changed = await presentGoalCard(root, goal, { ...first, fields: { text: "two" }, fieldsHash: "two" }, {}, "2026-01-02T00:00:00.000Z");
  assert.equal(changed.card.id, created.card.id);
  assert.equal(changed.card.presentedAt, created.card.presentedAt);
  assert.equal(projectCards(changed.record).length, 1);
  await withdrawGoalCard(root, goal, first.title);
  assert.equal(projectCards(await readGoalPresentations(root, goal.area, goal.slug)).length, 0);
});
