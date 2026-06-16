import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalUiServer } from "../dist/index.js";

test("serves health and static index", async () => {
  const root = path.join(tmpdir(), `tangent-ui-server-${Date.now()}`);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "index.html"), "ok");
  const server = await createLocalUiServer({ product: "test", assets: { rootDir: root }, open: false });
  try {
    assert.equal(await fetchText(`${server.url}healthz`), "{\n  \"ok\": true,\n  \"product\": \"test\"\n}\n");
    assert.equal(await fetchText(server.url), "ok");
    const apiResponse = await fetch(`${server.url}api/missing`);
    assert.equal(apiResponse.status, 404);
    assert.equal(apiResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await apiResponse.json(), { error: "API route not found." });
  } finally {
    await server.close();
  }
});

test("serves mounted static assets by path prefix", async () => {
  const root = path.join(tmpdir(), `tangent-ui-server-root-${Date.now()}`);
  const usage = path.join(tmpdir(), `tangent-ui-server-usage-${Date.now()}`);
  await mkdir(path.join(usage, "assets"), { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "index.html"), "shell");
  await writeFile(path.join(usage, "index.html"), "usage index");
  await writeFile(path.join(usage, "assets", "embedded.js"), "export const ok = true;");
  const server = await createLocalUiServer({
    product: "test",
    assets: { rootDir: root },
    assetMounts: [{ pathPrefix: "/apps/usage", assets: { rootDir: usage } }],
    open: false
  });
  try {
    assert.equal(await fetchText(`${server.url}apps/usage/assets/embedded.js`), "export const ok = true;");
    assert.equal(await fetchText(`${server.url}apps/usage/missing`), "usage index");
    assert.equal(await fetchText(server.url), "shell");
  } finally {
    await server.close();
  }
});

/** Supports the fetch text helper. */
async function fetchText(url) {
  const response = await fetch(url);
  return response.text();
}
