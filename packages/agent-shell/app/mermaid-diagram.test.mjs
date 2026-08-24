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

const CURRENT_DOCUMENT_FLOWCHARTS = [
  `flowchart LR
  T["DataTable<br/>name column = code"] --> H["enums() holder<br/>field: dt_grades"]
  H --> V["row holder<br/>fields: a, b, c, d"]`,
  `flowchart LR
  ST -->|assessed| SU["Setup: complete data"] --> R["pure Rules"] --> A["Assessments"] --> UI["UI, PDF, autodesign"]`,
  `flowchart LR
  J[Julian] <--> B[Area brain<br/>intent, policy, exceptions]
  B --> G[Approved work graph]`,
];

test("parses real vault flowcharts and state diagrams", () => {
  for (const source of REAL_FLOWCHARTS) assert.equal(parseMermaidDiagram(source).ok, true, source);
  const state = parseMermaidDiagram(REAL_STATE);
  assert.equal(state.ok, true);
  assert.equal(state.kind, "state");
});

test("parses current Document flowcharts with quoted multiline labels and common connectors", () => {
  const [multiline, chained, bidirectional] = CURRENT_DOCUMENT_FLOWCHARTS.map((source) => parseMermaidDiagram(source));
  assert.equal(multiline.ok, true);
  assert.equal(multiline.nodes[0].label, "DataTable\nname column = code");
  assert.deepEqual(chained.edges.map(({ from, to, label }) => [from, to, label]), [
    ["ST", "SU", "assessed"], ["SU", "R", ""], ["R", "A", ""], ["A", "UI", ""],
  ]);
  assert.deepEqual(bidirectional.edges.map(({ from, to }) => [from, to]), [["J", "B"], ["B", "J"], ["B", "G"]]);
});

test("keeps connector-like text and delimiters inside quoted edge labels", () => {
  const source = `flowchart LR
  A -->|"reads | writes<br/>without loss"| B
  B -- "retry --> stop<br>keep source" --> C`;
  const parsed = parseMermaidDiagram(source);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.edges.map(({ from, to, label }) => [from, to, label]), [
    ["A", "B", "reads | writes\nwithout loss"],
    ["B", "C", "retry --> stop\nkeep source"],
  ]);
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
    "flowchart LR\nA[\"<span>HTML label</span>\"] --> B",
    "flowchart LR\n%%{init: {'htmlLabels': true}}%%\nA --> B",
    "flowchart LR\nA --x B",
    "flowchart LR\nA --x B --> C",
    "flowchart LR\nA <-->|label| B",
    "flowchart LR\n<br>A --> B",
    "flowchart LR\nA[\"unclosed label] --> B",
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

test("wraps long node labels without losing their text", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const source = "flowchart LR\nA[Desk popover: step list] --> B[(~/.tangent/agent-shell/pipelines/area/slug.json)]";
  const svg = renderMermaidSvg(dom.window.document, parseMermaidDiagram(source));
  const labels = [...svg.querySelectorAll(".diagram-node text")];
  assert.ok(labels.some((label) => label.querySelectorAll("tspan").length > 1));
  assert.equal(labels.map((label) => label.textContent).join("").replace(/\s/g, ""), "Deskpopover:steplist~/.tangent/agent-shell/pipelines/area/slug.json");
});

test("renders explicit node, edge, subgraph, and state label breaks as safe SVG text lines", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const flowchart = `flowchart LR
subgraph group ["group first<br/>group second"]
A["node first<br/>node second"] -->|"edge first<br/>edge second"| B
end`;
  const flowSvg = renderMermaidSvg(dom.window.document, parseMermaidDiagram(flowchart));
  assert.deepEqual([...flowSvg.querySelectorAll(".diagram-node tspan")].map((span) => span.textContent), ["node first", "node second", "B"]);
  assert.deepEqual([...flowSvg.querySelectorAll(".diagram-edge tspan")].map((span) => span.textContent), ["edge first", "edge second"]);
  assert.deepEqual([...flowSvg.querySelectorAll(".diagram-group tspan")].map((span) => span.textContent), ["group first", "group second"]);
  const state = parseMermaidDiagram("stateDiagram-v2\nOpen --> Closed: first line<br>second line");
  const stateSvg = renderMermaidSvg(dom.window.document, state);
  assert.deepEqual([...stateSvg.querySelectorAll(".diagram-edge tspan")].map((span) => span.textContent), ["first line", "second line"]);
  assert.equal(flowSvg.querySelector("br, foreignObject"), null);
  assert.equal(stateSvg.querySelector("br, foreignObject"), null);
});

test("applies the dark Document theme to diagram text, edges, and arrowheads", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  const dom = new JSDOM(`<!doctype html><style>${css}</style><div class="markdown-diagram"></div>`);
  const svg = renderMermaidSvg(dom.window.document, parseMermaidDiagram("flowchart LR\nA --> B"));
  dom.window.document.querySelector(".markdown-diagram").append(svg);
  assert.equal(dom.window.getComputedStyle(svg.querySelector(".diagram-node text")).fill, "#dce4eb");
  assert.equal(dom.window.getComputedStyle(svg.querySelector(".diagram-edge path")).stroke, "#8294a6");
  assert.equal(dom.window.getComputedStyle(svg.querySelector("marker path")).fill, "#8294a6");
});

test("mount renders valid diagrams and keeps readable source with actionable failures", () => {
  const dom = new JSDOM(`<main>
    <div data-mermaid-diagram><pre><code>flowchart LR\nA --&gt; B</code></pre></div>
    <div data-mermaid-diagram><pre><code>sequenceDiagram\nA-&gt;&gt;B: hi</code></pre></div>
    <div data-mermaid-diagram><pre><code>flowchart LR\nA --&gt; B\nC --x D</code></pre></div>
  </main>`);
  mountMermaidDiagrams(dom.window.document.querySelector("main"));
  const hosts = dom.window.document.querySelectorAll("[data-mermaid-diagram]");
  assert.equal(hosts[0].querySelectorAll("svg").length, 1);
  assert.equal(hosts[1].querySelector("code").textContent, "sequenceDiagram\nA->>B: hi");
  assert.match(hosts[1].querySelector(".diagram-message").textContent, /Line 1.*Only flowcharts and simple state diagrams are supported.*Open Edit/);
  assert.match(hosts[2].querySelector(".diagram-message").textContent, /Line 3.*This flowchart statement is not supported.*Open Edit/);
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
