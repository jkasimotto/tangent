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
    headers: new Headers({ "retry-after": "2", "x-tangent-operation-id": "operation-1" }),
    /** Returns the error body. */
    async json() { return { error: "conflict" }; },
  }));
  await assert.rejects(client.api("/api/example"), (error) => {
    assert.equal(error.message, "conflict");
    assert.equal(error.kind, "http");
    assert.equal(error.status, 409);
    assert.equal(error.retryAfterMs, 2_000);
    assert.equal(error.operationId, "operation-1");
    assert.equal(error.path, "/api/example");
    assert.equal(error.method, "GET");
    return true;
  });
});

test("API client aborts a stalled request at its response deadline", async () => {
  const client = createApiClient((_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), null, 10);
  await assert.rejects(client.api("/api/stalled"), (error) => {
    assert.match(error.message, /10ms response deadline/);
    assert.equal(error.kind, "timeout");
    assert.equal(error.path, "/api/stalled");
    return true;
  });
});

test("API client distinguishes transport errors and caller aborts", async () => {
  const transport = createApiClient(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(transport.api("/api/example"), (error) => error.kind === "transport");

  const signal = new AbortController();
  signal.abort();
  const aborted = createApiClient(async (_path, options) => {
    if (options.signal.aborted) throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(aborted.api("/api/example", { signal: signal.signal }), (error) => error.kind === "abort");
});
