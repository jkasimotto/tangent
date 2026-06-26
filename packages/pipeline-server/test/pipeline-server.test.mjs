import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createPipelineUiApp } from "../dist/index.js";

test("creates a pipeline ui app descriptor", async () => {
  const registration = await createPipelineUiApp({ mode: "static" });
  assert.deepEqual(registration.app, {
    id: "pipeline",
    label: "Designs",
    routePath: "/pipeline",
    modulePath: "/apps/pipeline/embedded.js",
    stylePaths: ["/apps/pipeline/embedded.css"]
  });
  assert.equal(registration.routes.length, 1);
  assert.equal(registration.assetMounts[0].pathPrefix, "/apps/pipeline");
});

test("features route lists scoped features newest-first and skips unscoped slugs", async () => {
  const dir = await featuresDir();
  await writeFeature(dir, "older", { title: "Older feature", status: "scoped", updatedAt: "2026-06-25T00:00:00.000Z" }, scopeMarkdown("Older real problem.", "Older design."));
  await writeFeature(dir, "newer", { title: "Newer feature", status: "planned", updatedAt: "2026-06-26T00:00:00.000Z" }, scopeMarkdown("Newer real problem.", "Newer design."));
  await writeFeature(dir, "unscoped", { title: "Promoted only", status: "promoted", updatedAt: "2026-06-27T00:00:00.000Z" }, null);
  const route = await pipelineRoute(dir);

  const result = await callRoute(route, "GET", "/api/pipeline/features");

  assert.equal(result.status, 200);
  assert.deepEqual(result.json.features.map((feature) => feature.slug), ["newer", "older"]);
  assert.deepEqual(result.json.features[0], { slug: "newer", title: "Newer feature", status: "planned", updatedAt: "2026-06-26T00:00:00.000Z" });
});

test("scope route parses the two mapped sections and ignores the rest", async () => {
  const dir = await featuresDir();
  await writeFeature(dir, "demo", { title: "Demo feature", status: "scoped", updatedAt: "2026-06-26T00:00:00.000Z" }, scopeMarkdown("The real problem body.", "The proposed design body."));
  const route = await pipelineRoute(dir);

  const result = await callRoute(route, "GET", "/api/pipeline/features/demo/scope");

  assert.equal(result.status, 200);
  assert.equal(result.json.slug, "demo");
  assert.equal(result.json.title, "Demo feature");
  assert.equal(result.json.realProblem, "The real problem body.");
  assert.equal(result.json.proposedDesign, "The proposed design body.");
});

test("scope route 404s for an unknown or unscoped slug", async () => {
  const dir = await featuresDir();
  await writeFeature(dir, "promoted", { title: "Promoted", status: "promoted", updatedAt: "2026-06-26T00:00:00.000Z" }, null);
  const route = await pipelineRoute(dir);

  assert.equal((await callRoute(route, "GET", "/api/pipeline/features/missing/scope")).status, 404);
  assert.equal((await callRoute(route, "GET", "/api/pipeline/features/promoted/scope")).status, 404);
});

test("non-GET is blocked under the verify-readonly harness", async () => {
  const dir = await featuresDir();
  const route = await pipelineRoute(dir);
  const previous = process.env.TANGENT_VERIFY_READONLY;
  process.env.TANGENT_VERIFY_READONLY = "1";
  try {
    const result = await callRoute(route, "POST", "/api/pipeline/features");
    assert.equal(result.status, 403);
  } finally {
    if (previous === undefined) delete process.env.TANGENT_VERIFY_READONLY;
    else process.env.TANGENT_VERIFY_READONLY = previous;
  }
});

/** Creates a temporary features directory root. */
async function featuresDir() {
  return mkdtemp(path.join(tmpdir(), "tangent-pipeline-server-"));
}

/** Returns the pipeline API route registered for a temp features dir. */
async function pipelineRoute(dir) {
  return (await createPipelineUiApp({ featuresDir: dir, mode: "static" })).routes[0];
}

/** Writes a feature's manifest and optional scope file under the features dir. */
async function writeFeature(dir, slug, manifest, scope) {
  const featureDir = path.join(dir, slug);
  await mkdir(featureDir, { recursive: true });
  await writeFile(path.join(featureDir, "feature.json"), JSON.stringify({ slug, ...manifest }, null, 2));
  if (scope !== null) await writeFile(path.join(featureDir, "10-scope.md"), scope);
}

/** Builds a minimal scope file with the two mapped sections plus an ignored section. */
function scopeMarkdown(realProblem, proposedDesign) {
  return [
    `# ${"feature"} — Scope`,
    "",
    "## Real problem",
    realProblem,
    "",
    "## Minimal surgical solution",
    proposedDesign,
    "",
    "## Non-goals",
    "- Nothing here should appear in the DTO.",
    "",
    "### Decision taken",
    "Also ignored."
  ].join("\n");
}

/** Calls a UI route with an optional JSON request body. */
async function callRoute(route, method, pathname, body) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  return route.handle(request, new URL(pathname, "http://localhost"), pathname.match(route.pattern));
}
