import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { postJson, vaultFetch } from "../dist/cli/client.js";

/** Starts one loopback fixture and returns its URL. */
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: new URL(`http://127.0.0.1:${address.port}`) };
}

test("CLI gives read requests a response deadline", async (t) => {
  const prior = process.env.TANGENT_SHELL_TIMEOUT_MS;
  process.env.TANGENT_SHELL_TIMEOUT_MS = "1000";
  t.after(() => { if (prior === undefined) delete process.env.TANGENT_SHELL_TIMEOUT_MS; else process.env.TANGENT_SHELL_TIMEOUT_MS = prior; });
  const fixture = await listen(() => {});
  t.after(() => fixture.server.closeAllConnections());
  t.after(() => fixture.server.close());
  await assert.rejects(vaultFetch(fixture.url, "/api/stalled"), /1000ms response deadline/);
});

test("CLI warns when a mutation loses its response after dispatch", async (t) => {
  let operationId = "";
  const fixture = await listen((request) => {
    operationId = String(request.headers["x-tangent-operation-id"] ?? "");
    request.socket.destroy();
  });
  t.after(() => fixture.server.close());
  await assert.rejects(postJson(fixture.url, "/api/mutate", { value: 1 }), (error) => {
    assert.match(error.message, /operation may have completed/i);
    assert.match(error.message, /Operation ID:/);
    return true;
  });
  assert.match(operationId, /^[0-9a-f-]{36}$/);
});
