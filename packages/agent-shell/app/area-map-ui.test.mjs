import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { browserBundle } from "./test-browser-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shellBundle = await browserBundle();

test("the Area map holds stored node positions, simulates new nodes, and persists layouts", async () => {
  const [html, ...d3] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    ...["d3-dispatch", "d3-quadtree", "d3-timer", "d3-force"].map((name) => readFile(path.join(here, "node_modules", name, "dist", `${name}.min.js`), "utf8")),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.fetch = async () => ({
    ok: true,
    status: 200,
    /** Returns an empty payload. */
    async json() { return {}; },
  });
  window.setInterval = () => 0;
  for (const script of d3) window.eval(script);
  window.eval(shellBundle);
  const view = window.areaMapView;
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const now = 1_700_000_000_000;
  /** Creates one design Document record. */
  const record = (file, links = []) => ({ file, area: "otto/dnd", kind: "document", docKind: "design", title: file, links, backlinks: [], changedAt: now, mtime: now, inDegree: 0, outDegree: links.length });
  const records = [record("otto/dnd/design-a.md", ["design-b"]), record("otto/dnd/design-b.md"), record("otto/dnd/design-c.md", ["design-a"])];
  const saved = [];
  /** Records persisted map state. */
  const onSaveState = (state) => saved.push(state);
  /** No-op shell route. */
  const noop = () => {};
  /** Returns an Area's readable name. */
  const areaName = (value) => value;
  /** Omits card dates. */
  const dateLabel = () => "";
  /** Marks every Goal ready. */
  const attentionOf = () => "ready";
  /** Creates map mount properties. */
  const props = (extra = {}) => ({ scope: "otto/dnd", records, areaPaths: ["otto", "otto/dnd"], now, timezoneOffset: 0, areaName, dateLabel, attentionOf, mapState: null, onOpenDocument: noop, onSelectGoal: noop, onSelectArea: noop, onSaveState, ...extra });

  let instance = view.mount(host, props({ mapState: null }));
  assert.equal(instance.nodes.length, 0);
  const stored = { positions: { "otto/dnd/design-a.md": { x: 10, y: 20 }, "otto/dnd/design-b.md": { x: -30, y: 40, pinned: true }, "otto/dnd/design-c.md": { x: 50, y: -60 } }, kindsOff: [], showDone: false, collapsed: [] };
  instance = view.mount(host, props({ mapState: stored }));
  /** Returns one node's graph position. */
  const at = (file) => { const node = instance.nodes.find((item) => item.file === file); return [node.x, node.y]; };
  assert.deepEqual(at("otto/dnd/design-a.md"), [10, 20]);
  assert.deepEqual(at("otto/dnd/design-b.md"), [-30, 40]);
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  assert.equal(saved.length, 0);

  records.push(record("otto/dnd/design-d.md", ["design-a"]));
  instance = view.mount(host, props({ mapState: stored }));
  assert.deepEqual(at("otto/dnd/design-a.md"), [10, 20]);
  assert.ok(at("otto/dnd/design-d.md").every(Number.isFinite));
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].positions["otto/dnd/design-b.md"].pinned, true);

  view.forget("otto/dnd");
  const first = view.mount(host, props({ mapState: {} }));
  assert.ok(first.nodes.every((node) => Number.isFinite(node.x)));
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  assert.equal(saved.length, 2);
  dom.window.close();
});
