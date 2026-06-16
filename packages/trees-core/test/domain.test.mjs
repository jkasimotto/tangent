import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryTreeEventStore, createTreesClient } from "../dist/index.js";

test("entities can be created, resolved by suffix, and moved with children", async () => {
  const client = createTreesClient(createMemoryTreeEventStore());
  const parent = await client.entities.create({ path: "project/feature", kind: "group" });
  const child = await client.entities.create({ path: "project/feature/api", kind: "work", branch: "api" });

  assert.equal((await client.entities.get("api"))?.id, child.id);
  await client.entities.move(parent.id, "project/renamed");

  assert.equal((await client.entities.get(parent.id))?.path, "project/renamed");
  assert.equal((await client.entities.get(child.id))?.path, "project/renamed/api");
  assert.equal((await client.entities.get(child.id))?.parentPath, "project/renamed");
});

test("entities reject duplicate paths", async () => {
  const client = createTreesClient(createMemoryTreeEventStore());
  await client.entities.create({ path: "project/feature", kind: "work" });

  await assert.rejects(
    () => client.entities.create({ path: "project/feature", kind: "note" }),
    /already exists/
  );

  assert.equal((await client.projection()).entities.length, 1);
});

test("project registration reuses exact matches and rejects ambiguous duplicates", async () => {
  const client = createTreesClient(createMemoryTreeEventStore());
  const project = await client.projects.add("main", "/repo/main");

  assert.equal((await client.projects.add("main", "/repo/main")).id, project.id);
  await assert.rejects(() => client.projects.add("main", "/repo/other"), /already exists with name/);
  await assert.rejects(() => client.projects.add("other", "/repo/main"), /already exists at path/);
});

test("work session checkpoint resolves linked captures", async () => {
  const client = createTreesClient(createMemoryTreeEventStore());
  const entity = await client.entities.create({ path: "project/checkpoints" });
  const session = await client.sessions.start({ entity: entity.path, intent: "finish typed workflow" });
  const capture = await client.captures.add({ entity: entity.path, text: "remember to update docs", kind: "next" });

  const checkpoint = await client.sessions.checkpoint(session.id, {
    outcome: "done",
    did: "implemented workflow",
    linkedCaptureIds: [capture.id]
  });
  const projection = await client.projection();

  assert.equal(checkpoint.outcome, "done");
  assert.equal(projection.workSessions.find((item) => item.id === session.id)?.status, "done");
  assert.equal(projection.captures.find((item) => item.id === capture.id)?.status, "resolved");
});

test("captures can be dismissed without becoming checkpoints", async () => {
  const client = createTreesClient(createMemoryTreeEventStore());
  const capture = await client.captures.add({ text: "scratch" });

  await client.captures.dismiss(capture.id, "not relevant");

  const dismissed = (await client.projection()).captures.find((item) => item.id === capture.id);
  assert.equal(dismissed?.status, "dismissed");
  assert.equal(dismissed?.resolution?.kind, "dismissed");
});
