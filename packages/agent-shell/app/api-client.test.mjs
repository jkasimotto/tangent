import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./public/api-client.js";

test("API client posts JSON and returns parsed success payloads", async () => {
  const calls = [];
  const client = createApiClient(async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      status: 200,
      /** Returns the response body. */
      async json() { return { ok: true }; },
    };
  });
  assert.deepEqual(await client.post("/api/example", { value: 1 }), { ok: true });
  assert.equal(calls[0].options.body, '{"value":1}');
});

test("API client uses a server error message when available", async () => {
  const client = createApiClient(async () => ({
    ok: false,
    status: 409,
    /** Returns the error body. */
    async json() { return { error: "conflict" }; },
  }));
  await assert.rejects(client.api("/api/example"), /conflict/);
});
