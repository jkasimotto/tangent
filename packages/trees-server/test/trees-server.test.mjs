import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { openFsTrees } from "@tangent/trees-store-fs";

import { createTreesUiApp } from "../dist/index.js";

test("creates a trees ui app descriptor", async () => {
  const registration = await createTreesUiApp({ mode: "static" });
  assert.deepEqual(registration.app, {
    id: "trees",
    label: "Trees",
    routePath: "/trees",
    modulePath: "/apps/trees/embedded.js",
    stylePaths: ["/apps/trees/embedded.css"]
  });
  assert.equal(registration.routes.length, 1);
  assert.equal(registration.assetMounts[0].pathPrefix, "/apps/trees");
});

test("workspace route returns persisted Trees projects", async () => {
  const root = await treesRoot();
  const client = await openFsTrees({ root });
  const project = await client.projects.add("polez", "/repo/polez");
  const route = await treesRoute(root);

  const result = await callRoute(route, "GET", "/api/trees/workspace");

  assert.equal(result.status, 200);
  assert.deepEqual(result.json.projects, [{ id: project.id, name: "polez", path: "/repo/polez" }]);
});

test("create path route persists missing group-ready entities", async () => {
  const root = await treesRoot();
  const route = await treesRoute(root);

  const result = await callRoute(route, "POST", "/api/trees/entities/path", { path: "foo/bar" });

  assert.equal(result.status, 200);
  assert.deepEqual(result.json.entities.map((entity) => [entity.path, entity.kind]), [["foo", "group"], ["foo/bar", "group"]]);
  assert.deepEqual((await (await openFsTrees({ root })).entities.list()).map((entity) => entity.path), ["foo", "foo/bar"]);
});

test("save and clear leaf routes persist leaf metadata", async () => {
  const root = await treesRoot();
  const client = await openFsTrees({ root });
  const project = await client.projects.add("polez", "/repo/polez");
  const entity = await client.entities.create({ path: "foo/bar", kind: "group" });
  const route = await treesRoute(root);

  const saved = await callRoute(route, "POST", `/api/trees/entities/${encodeURIComponent(entity.id)}/leaf`, {
    projectId: project.id,
    branch: "feature/trees",
    worktreePath: "/tmp/trees"
  });

  assert.equal(saved.status, 200);
  assert.deepEqual(entityByPath(saved.json, "foo/bar"), {
    id: entity.id,
    path: "foo/bar",
    title: "bar",
    projectId: project.id,
    branch: "feature/trees",
    worktreePath: "/tmp/trees",
    kind: "work"
  });

  const cleared = await callRoute(route, "POST", `/api/trees/entities/${encodeURIComponent(entity.id)}/leaf/clear`);

  assert.equal(cleared.status, 200);
  assert.deepEqual(entityByPath(cleared.json, "foo/bar"), {
    id: entity.id,
    path: "foo/bar",
    title: "bar",
    kind: "group"
  });
});

test("create path route rejects children under locked leaves", async () => {
  const root = await treesRoot();
  const client = await openFsTrees({ root });
  const project = await client.projects.add("polez", "/repo/polez");
  await client.entities.create({ path: "foo/bar", kind: "work", projectId: project.id, branch: "main" });
  const route = await treesRoute(root);

  const result = await callRoute(route, "POST", "/api/trees/entities/path", { path: "foo/bar/baz" });

  assert.equal(result.status, 400);
  assert.match(result.json.error, /foo\/bar is configured as a leaf/);
});

/** Creates a temporary Trees store root. */
async function treesRoot() {
  return mkdtemp(path.join(tmpdir(), "tangent-trees-server-"));
}

/** Returns the Trees API route registered for a temp root. */
async function treesRoute(root) {
  return (await createTreesUiApp({ store: { root }, mode: "static" })).routes[0];
}

/** Calls a UI route with a small JSON request body. */
async function callRoute(route, method, pathname, body) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  return route.handle(request, new URL(pathname, "http://localhost"), pathname.match(route.pattern));
}

/** Finds a workspace entity by path and removes undefined fields. */
function entityByPath(workspace, entityPath) {
  return Object.fromEntries(Object.entries(workspace.entities.find((entity) => entity.path === entityPath)).filter(([, value]) => value !== undefined));
}
