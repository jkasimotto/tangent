import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createStyleNoteRoutes } from "./style-note-routes.mjs";

/** Creates a request double, with the caller's session header when it has one. */
function request(method, body = {}, session = "") {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  stream.headers = session ? { "x-tangent-session": session } : {};
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

test("a filed note carries the caller's session, so the server resolves the observer, not the caller", async () => {
  let seen = null;
  const routes = createStyleNoteRoutes({
    /** Records the normalized input and the session the router read off the request. */
    async add(input, session) {
      seen = { input, session };
      return { status: 200, entry: { id: "note-1" } };
    },
  });
  const output = response();
  const owned = await routes.handle(
    request("POST", { file: "otto/a.md", note: "Buried lede.", quote: "some words", tags: ["buried-lede"] }, "tangent-brain-g4"),
    output,
    new URL("http://shell/api/style-notes"),
  );
  assert.equal(owned, true);
  assert.equal(output.status, 200);
  assert.deepEqual(output.body, { note: { id: "note-1" } });
  assert.deepEqual(seen, { input: { file: "otto/a.md", note: "Buried lede.", quote: "some words", tags: ["buried-lede"] }, session: "tangent-brain-g4" });
});

test("a refused note answers with the server's reason and nothing else", async () => {
  const routes = createStyleNoteRoutes({
    /** Refuses every note in this test. */
    async add() { return { status: 404, error: "no Document otto/gone.md" }; },
  });
  const output = response();
  await routes.handle(request("POST", { file: "otto/gone.md", note: "Buried lede." }), output, new URL("http://shell/api/style-notes"));
  assert.deepEqual([output.status, output.body], [404, { error: "no Document otto/gone.md" }]);
});

test("the listing passes every filter through and owns no other path", async () => {
  let filters = null;
  const routes = createStyleNoteRoutes({
    /** Records the filters the router derived from the query string. */
    async list(value) {
      filters = value;
      return { entries: [], skipped: 0, total: 0, counts: null };
    },
  });
  const output = response();
  await routes.handle(request("GET"), output, new URL("http://shell/api/style-notes?area=otto/tangent&model=opus-5&tag=buried-lede&since=2026-09-01"));
  assert.deepEqual(filters, { area: "otto/tangent", file: "", model: "opus-5", harness: "", tag: "buried-lede", since: "2026-09-01", id: "" });
  assert.equal(await routes.handle(request("GET"), response(), new URL("http://shell/api/document/comments?file=otto/a.md")), false, "the comments listing is not this router's path");
});
