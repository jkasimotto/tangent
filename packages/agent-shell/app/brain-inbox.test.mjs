import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  INBOX_SCHEMA,
  appendNotice,
  inboxPath,
  inboxesForBrain,
  markDelivered,
  mergeNotices,
  newInbox,
  noticeBlock,
  noticeDigest,
  pruneDelivered,
  readAllInboxes,
  readInbox,
  unreadNotices,
  writeInbox
} from "./brain-inbox.mjs";

/** A temporary brains root that the test removes afterwards. */
async function tempRoot(context) {
  const root = await mkdtemp(path.join(tmpdir(), "brain-inbox-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("a notice is unread until a generation reads it", () => {
  const inbox = newInbox("otto/tangent");
  const first = appendNotice(inbox, "Goal alpha: pipeline complete.");
  const second = appendNotice(inbox, "Goal beta: step 2 stopped.");
  assert.equal(first.id, "n1");
  assert.equal(second.id, "n2");
  assert.equal(unreadNotices(inbox).length, 2);

  const changed = markDelivered(inbox, [first.id], { session: "tangent--brain", generation: 3 });
  assert.equal(changed, 1);
  assert.equal(inbox.notices[0].deliveredTo, "tangent--brain");
  assert.equal(inbox.notices[0].deliveredGeneration, 3);
  assert.deepEqual(unreadNotices(inbox).map((notice) => notice.id), ["n2"]);

  // Marking the same notice twice, or an id from another pass, changes nothing.
  assert.equal(markDelivered(inbox, [first.id, "n99"], { session: "other" }), 0);
  assert.equal(inbox.notices[0].deliveredTo, "tangent--brain");
});

test("an empty notice is refused", () => {
  const inbox = newInbox("otto/tangent");
  assert.throws(() => appendNotice(inbox, "   "), /a notice needs text/);
});

test("a stable source identity appends one notice", () => {
  const inbox = newInbox("otto/tangent");
  const first = appendNotice(inbox, "Material result.", "2026-08-26T01:00:00.000Z", "operation:event-1");
  const duplicate = appendNotice(inbox, "Material result.", "2026-08-26T02:00:00.000Z", "operation:event-1");
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(inbox.notices.length, 1);
  assert.equal(inbox.notices[0].sourceId, "operation:event-1");
});

test("notices survive a restart: they read back unread from disk", async (context) => {
  const root = await tempRoot(context);
  const inbox = await readInbox(root, "otto/tangent");
  assert.equal(inbox.schema, INBOX_SCHEMA);
  assert.deepEqual(inbox.notices, []);

  appendNotice(inbox, "Goal alpha: pipeline complete. Last handover: done.");
  await writeInbox(root, inbox);

  // A second process reads the same file: the notice is still unread.
  const reopened = await readInbox(root, "otto/tangent");
  assert.equal(reopened.notices.length, 1);
  assert.equal(unreadNotices(reopened).length, 1);
  assert.equal(unreadNotices(reopened)[0].text, "Goal alpha: pipeline complete. Last handover: done.");

  // Ids keep counting after the restart, so two notices never share one id.
  const next = appendNotice(reopened, "Goal beta: session ended.");
  assert.equal(next.id, "n2");
  markDelivered(reopened, ["n1"], { session: "tangent--brain-g2", generation: 2 });
  await writeInbox(root, reopened);

  const again = await readInbox(root, "otto/tangent");
  assert.deepEqual(unreadNotices(again).map((notice) => notice.id), ["n2"]);
  const raw = JSON.parse(await readFile(inboxPath(root, "otto/tangent"), "utf8"));
  assert.equal(raw.area, "otto/tangent");
  assert.equal(raw.notices[0].deliveredGeneration, 2);
});

test("a missing or damaged inbox reads as an empty one", async (context) => {
  const root = await tempRoot(context);
  assert.deepEqual((await readInbox(root, "otto/nothing")).notices, []);

  const inbox = newInbox("otto/broken");
  appendNotice(inbox, "kept");
  await writeInbox(root, inbox);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(inboxPath(root, "otto/broken"), "{ not json", "utf8");
  assert.deepEqual((await readInbox(root, "otto/broken")).notices, []);
});

test("a brain reads only its exact Area inbox", async (context) => {
  const root = await tempRoot(context);
  const parent = newInbox("otto/tangent");
  appendNotice(parent, "Goal alpha: pipeline complete.", "2026-08-19T10:00:00.000Z");
  const child = newInbox("otto/tangent/search");
  appendNotice(child, "Goal beta: step 1 stopped.", "2026-08-19T09:00:00.000Z");
  const other = newInbox("otto/dnd");
  appendNotice(other, "Goal gamma: session ended.", "2026-08-19T08:00:00.000Z");
  for (const inbox of [parent, child, other]) await writeInbox(root, inbox);

  const all = await readAllInboxes(root);
  assert.deepEqual(all.map((record) => record.area).sort(), ["otto/dnd", "otto/tangent", "otto/tangent/search"]);

  const mine = inboxesForBrain(all, "otto/tangent");
  assert.deepEqual(mine.map((record) => record.area), ["otto/tangent"]);

  const merged = mergeNotices(mine);
  assert.deepEqual(merged.map((notice) => notice.area), ["otto/tangent"]);
  assert.equal(merged[0].text, "Goal alpha: pipeline complete.");

  const withoutChildTerritory = inboxesForBrain(all, "otto/tangent", (area) => area !== "otto/tangent/search");
  assert.deepEqual(withoutChildTerritory.map((record) => record.area), ["otto/tangent"]);
});

test("many notices become one flat line and one numbered block, both cut when long", () => {
  const inbox = newInbox("otto/tangent");
  appendNotice(inbox, "Goal alpha: pipeline complete.", "2026-08-19T10:00:00.000Z");
  appendNotice(inbox, "Goal beta: step 1 stopped.", "2026-08-19T11:00:00.000Z");
  const notices = unreadNotices(inbox);

  const digest = noticeDigest(notices);
  assert.match(digest, /^You have 2 notices no brain generation read yet\./);
  assert.match(digest, /1\. \(2026-08-19 10:00\) Goal alpha: pipeline complete\./);
  assert.match(digest, /2\. \(2026-08-19 11:00\) Goal beta: step 1 stopped\./);
  assert.doesNotMatch(digest, /\n/, "a composer message stays on one line");

  const block = noticeBlock(notices);
  assert.equal(block.split("\n").length, 2);

  const short = noticeDigest(notices, 110);
  assert.match(short, /and 1 more\.$/);
  assert.equal(noticeDigest([]), "");
  assert.equal(noticeBlock([]), "");
});

test("delivered notices are pruned, unread ones are never dropped", () => {
  const inbox = newInbox("otto/tangent");
  for (let i = 0; i < 12; i += 1) appendNotice(inbox, `notice ${i}`);
  markDelivered(inbox, inbox.notices.slice(0, 10).map((notice) => notice.id), { session: "s" });
  pruneDelivered(inbox, 3);
  assert.equal(inbox.notices.length, 5, "3 delivered plus 2 unread");
  assert.deepEqual(unreadNotices(inbox).map((notice) => notice.text), ["notice 10", "notice 11"]);
});
