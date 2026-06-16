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
    assert.equal(await fetchText(`${server.url}healthz`), "{\n  \"ok\": true,\n  \"product\": \"test\",\n  \"dev\": false\n}\n");
    assert.equal(await fetchText(server.url), "ok");
    const apiResponse = await fetch(`${server.url}api/missing`);
    assert.equal(apiResponse.status, 404);
    assert.equal(apiResponse.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await apiResponse.json(), { error: "API route not found." });
  } finally {
    await server.close();
  }
});

test("serves dev asset mounts through Vite middleware", async () => {
  const shell = path.join(tmpdir(), `tangent-ui-server-shell-${Date.now()}`);
  const product = path.join(tmpdir(), `tangent-ui-server-dev-${Date.now()}`);
  await mkdir(path.join(product, "src"), { recursive: true });
  await mkdir(shell, { recursive: true });
  await writeFile(path.join(shell, "index.html"), "shell");
  await writeFile(path.join(product, "src", "embedded.ts"), "import \"./local.css\";\nexport const ok = true;");
  await writeFile(path.join(product, "src", "local.css"), ".local { color: red; }");
  const server = await createLocalUiServer({
    product: "test",
    mode: "dev",
    assets: { rootDir: shell },
    assetMounts: [{ pathPrefix: "/apps/dev", assets: { rootDir: product, dev: { sourceRoot: product } } }],
    open: false
  });
  try {
    const module = await fetchText(`${server.url}apps/dev/src/embedded.ts`);
    assert.match(module, /ok = true/);
    const cssModule = await fetch(`${server.url}apps/dev/src/local.css`);
    assert.equal(cssModule.headers.get("content-type"), "text/css");
    assert.match(await cssModule.text(), /color: red/);
    assert.equal((await (await fetch(`${server.url}healthz`)).json()).dev, true);
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
