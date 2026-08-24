import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpError, readJson } from "./http-json.mjs";

test("JSON reader rejects a body beyond its byte budget", async () => {
  const request = Readable.from([Buffer.from('{"value":"'), Buffer.alloc(20, "x"), Buffer.from('"}')]);
  await assert.rejects(readJson(request, { maxBytes: 16 }), (error) => error instanceof HttpError && error.status === 413);
});

test("JSON reader accepts bounded objects and keeps malformed compatibility", async () => {
  assert.deepEqual(await readJson(Readable.from(['{"value":1}'])), { value: 1 });
  assert.deepEqual(await readJson(Readable.from(["not json"])), {});
});
