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
  } finally {
    await server.close();
  }
});

/** Supports the fetch text helper. */
async function fetchText(url) {
  const response = await fetch(url);
  return response.text();
}
