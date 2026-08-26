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

test("JSON reader can reject malformed or non-object bodies for strict mutations", async () => {
  for (const body of ["", '{"value":', "[]", "null"]) {
    await assert.rejects(
      readJson(Readable.from(body ? [body] : []), { rejectMalformed: true, malformedMessage: "retry the complete JSON body" }),
      (error) => error instanceof HttpError && error.status === 400 && /retry the complete JSON body/.test(error.message)
    );
  }
});
