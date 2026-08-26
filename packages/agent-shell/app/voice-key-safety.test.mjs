import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("voice capture has no action-router mount", async () => {
  const source = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  const mount = source.slice(source.indexOf("const voiceRoutes = createVoiceRoutes"), source.indexOf("const goalQueryRoutes"));
  assert.match(mount, /capture(?:\(body\)\s*\{\s*return|:\s*\(body\)\s*=>)\s*areaRoutesOperations\.capture/);
  assert.doesNotMatch(mount, /routeAndExecute|executeVoiceActions|routerCall/);
});
