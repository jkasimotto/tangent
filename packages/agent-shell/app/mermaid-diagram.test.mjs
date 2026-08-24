import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { mountMermaidDiagrams, parseMermaidDiagram, renderMermaidSvg } from "./public/mermaid-diagram.js";
import documentComments from "./public/document-comments.js";
import { browserBundle } from "./test-browser-bundle.mjs";

const shellBundle = await browserBundle();
const here = path.dirname(fileURLToPath(import.meta.url));

const REAL_FLOWCHARTS = [
  `flowchart LR
  Desk[Desk popover: step list] -->|POST /api/goals/start steps| Server
  Server -->|record| Rec[(~/.tangent/agent-shell/pipelines/area/slug.json)]
  Server -->|spawn + prime| S1[step 1 session]`,
  `flowchart LR
  subgraph host [DM page, the host]
    CT[ControlTable] --> SH[player-speech-host]
    DS[DialogueSession] --> CS[conversation-stream]
  end
  P1[phone composer] -- SpeechCommand --> SH`,
  `flowchart LR
  A[Escaped fence source] --> B[Parse supported syntax]
  B --> C{Valid and supported?}
  C -->|yes| D[Build safe SVG nodes]
  C -->|no| E[Show source and edit message]`,
];

const REAL_STATE = `stateDiagram-v2
  [*] --> Open
  Open --> Answering: verb needs text
  Answering --> Open: cancel
  Open --> Resolved: complete answer saved`;

test("parses real vault flowcharts and state diagrams", () => {
  for (const source of REAL_FLOWCHARTS) assert.equal(parseMermaidDiagram(source).ok, true, source);
  const state = parseMermaidDiagram(REAL_STATE);
  assert.equal(state.ok, true);
  assert.equal(state.kind, "state");
});

test("supports directions, common shapes, labels, groups, cycles, and state markers", () => {
  for (const direction of ["LR", "RL", "TB", "TD", "BT"]) {
    const parsed = parseMermaidDiagram(`graph ${direction}\nA[rect] --> B(round)\nB --> C([stadium])\nC --> D[(data)]\nD --> E((circle))\nE --> F{choice}\nF --> A`);
    assert.equal(parsed.ok, true, direction);
    assert.deepEqual(parsed.nodes.map((node) => node.shape), ["rect", "rounded", "stadium", "cylinder", "circle", "diamond"]);
  }
});

test("fails closed for malformed or active Mermaid features", () => {
  const cases = [
    "sequenceDiagram\nA->>B: hello",
    "flowchart LR\nsubgraph one\nsubgraph two\nend\nend",
    "flowchart LR\nclick A https://example.com",
    "flowchart LR\nA[<img onerror=alert(1)>]",
    "flowchart LR\n%%{init: {'htmlLabels': true}}%%\nA --> B",
    "flowchart LR\nA --x B",
  ];
  for (const source of cases) assert.equal(parseMermaidDiagram(source).ok, false, source);
});

test("creates labels as SVG text without HTML, links, events, or resource URLs", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const model = { ok: true, kind: "flowchart", direction: "LR", groups: [], edges: [], nodes: [{ id: "a", label: "<img onerror=alert(1)>", shape: "rect", order: 0 }] };
  const svg = renderMermaidSvg(dom.window.document, model);
  assert.equal(svg.querySelector("text").textContent, "<img onerror=alert(1)>");
  assert.equal(svg.querySelector("img, foreignObject, a, script, style"), null);
  assert.equal([...svg.querySelectorAll("*")].some((node) => [...node.attributes].some((attribute) => /^on/i.test(attribute.name) || /^(?:href|src)$/i.test(attribute.name))), false);
  assert.equal([...svg.querySelectorAll("*")].some((node) => [...node.attributes].some((attribute) => /url\((?!#)/i.test(attribute.value))), false);
});

test("mount renders valid diagrams and keeps readable source with actionable failures", () => {
  const dom = new JSDOM(`<main>
    <div data-mermaid-diagram><pre><code>flowchart LR\nA --&gt; B</code></pre></div>
    <div data-mermaid-diagram><pre><code>sequenceDiagram\nA-&gt;&gt;B: hi</code></pre></div>
  </main>`);
  mountMermaidDiagrams(dom.window.document.querySelector("main"));
  const hosts = dom.window.document.querySelectorAll("[data-mermaid-diagram]");
  assert.equal(hosts[0].querySelectorAll("svg").length, 1);
  assert.equal(hosts[1].querySelector("code").textContent, "sequenceDiagram\nA->>B: hi");
  assert.match(hosts[1].querySelector(".diagram-message").textContent, /Open Edit/);
});

test("Markdown integration branches only Mermaid fences and preserves line, headings, code, and comments", async () => {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  dom.window.setInterval = () => 0;
  dom.window.fetch = async () => ({
    ok: true,
    status: 200,
    /** Returns the empty browser state used by this rendering-only test. */
    async json() { return {}; },
  });
  dom.window.eval(shellBundle);
  const source = `# Title

\`\`\`mermaid
## not a heading
A --> B
\`\`\`

\`\`\`js
const safe = true;
\`\`\`

Words here.`;
  const rendered = dom.window.markdownToHtml(source);
  assert.match(rendered, /class="markdown-diagram" data-mermaid-diagram data-line="2"/);
  assert.match(rendered, /class="markdown-code-wrap" data-line="7"/);
  assert.match(rendered, /<p data-line="11">Words here\.<\/p>/);
  assert.equal(dom.window.markdownHeadings(source).map((heading) => heading.title).join(" "), "Title");
  assert.equal(documentComments.parseComments(source.replace("A --> B", "{>>Julian: hidden<<}")).length, 0);
});
