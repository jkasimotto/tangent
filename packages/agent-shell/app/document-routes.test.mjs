import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createDocumentRoutes } from "./document-routes.mjs";

/** Creates a request double. */
function request(method, body = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

/** Creates a response recorder. */
function response() {
  return {
    /** Records status. */
    writeHead(status) { this.status = status; },
    /** Records JSON. */
    end(body) { this.body = JSON.parse(body); },
  };
}

test("Document routes share one read contract for content and comments", async () => {
  const document = { file: "otto/note.md", title: "Note", comments: [{ text: "Fix" }] };
  const routes = createDocumentRoutes({
    /** Returns the requested Document. */
    async readDocument() { return document; },
  });
  const content = response();
  await routes.handle(request("GET"), content, new URL("http://shell/api/document?file=otto/note.md"));
  assert.deepEqual(content.body, document);
  const comments = response();
  await routes.handle(request("GET"), comments, new URL("http://shell/api/document/comments?file=otto/note.md"));
  assert.deepEqual(comments.body.comments, document.comments);
});

test("map-state writes reject invalid payloads before storage", async () => {
  let writes = 0;
  const routes = createDocumentRoutes({
    /** Rejects every Area in this test. */
    validArea() { return false; },
    /** Counts unexpected storage calls. */
    async writeMap() { writes += 1; },
  });
  const output = response();
  await routes.handle(request("POST", { area: "../bad", state: {} }), output, new URL("http://shell/api/map-state"));
  assert.equal(output.status, 400);
  assert.equal(writes, 0);
});
