import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { markGoalDocumentOpened, presentGoalDocument, projectPresentations, pruneMissingPresentations, readGoalPresentations, removeGoalPresentations, withdrawGoalDocument } from "./goal-presentations.mjs";

test("presentations are idempotent, reopen on a new hash, and leave no record after Goal closure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "presented-"));
  const goal = { area: "otto/tangent", slug: "documents" };
  const document = { root: "vault", file: "otto/tangent/design-documents.md", title: "Human title", hash: "one" };
  assert.equal((await presentGoalDocument(root, goal, document, { role: "worker" })).changed, true);
  assert.equal((await presentGoalDocument(root, goal, document, { role: "worker" })).changed, false);
  await markGoalDocumentOpened(root, goal, document.file, "one");
  assert.equal(projectPresentations(await readGoalPresentations(root, goal.area, goal.slug))[0].openedAt !== null, true);
  assert.equal((await presentGoalDocument(root, goal, { ...document, hash: "two" })).item.openedAt, null);
  assert.equal((await withdrawGoalDocument(root, goal, document.file)).changed, true);
  assert.equal(projectPresentations(await readGoalPresentations(root, goal.area, goal.slug)).length, 0);
  await presentGoalDocument(root, goal, { ...document, file: "missing.md", hash: "three" });
  const pruned = await pruneMissingPresentations(root, await readGoalPresentations(root, goal.area, goal.slug), async (item) => item.file !== "missing.md");
  assert.equal(pruned.changed, true, "a missing file cannot litter the attention store");
  assert.equal(await removeGoalPresentations(root, goal), true);
  assert.equal((await readGoalPresentations(root, goal.area, goal.slug)).items.length, 0);
});
