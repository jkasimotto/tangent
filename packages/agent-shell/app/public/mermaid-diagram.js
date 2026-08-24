const SVG_NS = "http://www.w3.org/2000/svg";
const DIRECTIONS = new Set(["LR", "RL", "TB", "TD", "BT"]);

/** Returns a parse failure that the reader can explain without hiding source. */
function failure(kind, detail, line = 0) {
  return { ok: false, kind, detail, line };
}

/** Rejects Mermaid features whose model can carry active content or styling. */
function forbiddenLine(line) {
  return /^(?:%%\{|click\b|linkStyle\b|classDef\b|class\b|style\b|accTitle\b|accDescr\b)|<\/?[a-z][^>]*>|(?:https?:)?\/\//i.test(line);
}

/** Reads one supported flowchart node token. */
function flowNode(token) {
  const value = token.trim();
  const patterns = [
    [/^([\w.-]+)\[\[([^\n]+)\]\]$/, "subroutine"],
    [/^([\w.-]+)\[\(([^\n]+)\)\]$/, "cylinder"],
    [/^([\w.-]+)\(\(([^\n]+)\)\)$/, "circle"],
    [/^([\w.-]+)\(\[([^\n]+)\]\)$/, "stadium"],
    [/^([\w.-]+)\(([^\n]+)\)$/, "rounded"],
    [/^([\w.-]+)\{([^\n]+)\}$/, "diamond"],
    [/^([\w.-]+)\[([^\n]+)\]$/, "rect"],
    [/^([\w.-]+)$/, "rect"],
  ];
  for (const [pattern, shape] of patterns) {
    const match = value.match(pattern);
    if (match) return { id: match[1], label: match[2] ?? match[1], shape };
  }
  return null;
}

/** Parses the supported Mermaid subset into a text-only graph model. */
export function parseMermaidDiagram(source) {
  const lines = String(source ?? "").split("\n");
  const firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex < 0) return failure("invalid", "The diagram is empty.");
  const header = lines[firstIndex].trim();
  const flow = header.match(/^(?:flowchart|graph)\s+([A-Za-z]+)$/);
  const state = header === "stateDiagram-v2";
  if (!flow && !state) return failure("unsupported", "Only flowcharts and simple state diagrams are supported.", firstIndex + 1);
  const direction = state ? "LR" : flow[1].toUpperCase() === "TD" ? "TB" : flow[1].toUpperCase();
  if (!DIRECTIONS.has(direction)) return failure("unsupported", `Direction ${flow[1]} is not supported.`, firstIndex + 1);
  const nodes = new Map();
  const edges = [];
  const groups = [];
  let group = null;
  let marker = 0;
  /** Adds or updates one node without losing its original source order. */
  const addNode = (node) => {
    const existing = nodes.get(node.id);
    if (existing && existing.label !== existing.id && node.label === node.id) return existing;
    const value = { ...existing, ...node, order: existing?.order ?? nodes.size, group: group?.id ?? existing?.group ?? null };
    nodes.set(value.id, value);
    if (group && !group.members.includes(value.id)) group.members.push(value.id);
    return value;
  };
  for (let index = firstIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (forbiddenLine(line)) return failure("unsupported", "Active content and Mermaid configuration are not supported.", index + 1);
    if (line.startsWith("%%")) continue;
    if (!state && /^subgraph\b/i.test(line)) {
      if (group) return failure("unsupported", "Nested subgraphs are not supported.", index + 1);
      const match = line.match(/^subgraph\s+([\w.-]+)(?:\s*\[([^\n]+)\]|\s+(.+))?$/i);
      if (!match) return failure("invalid", "The subgraph header is not valid.", index + 1);
      group = { id: match[1], label: (match[2] ?? match[3] ?? match[1]).trim(), members: [] };
      groups.push(group);
      continue;
    }
    if (!state && line === "end") {
      if (!group) return failure("invalid", "The subgraph end has no matching start.", index + 1);
      group = null;
      continue;
    }
    if (state) {
      const match = line.match(/^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)(?:\s*:\s*(.+))?$/);
      if (!match) return failure("unsupported", "This state statement is not supported.", index + 1);
      /** Gives each start or end marker a distinct internal node identity. */
      const endpoint = (value, side) => value === "[*]" ? `__marker_${marker += 1}_${side}` : value;
      const from = endpoint(match[1], "from");
      const to = endpoint(match[2], "to");
      addNode({ id: from, label: match[1] === "[*]" ? "" : match[1], shape: match[1] === "[*]" ? "marker" : "rounded" });
      addNode({ id: to, label: match[2] === "[*]" ? "" : match[2], shape: match[2] === "[*]" ? "marker" : "rounded" });
      edges.push({ from, to, label: match[3]?.trim() ?? "" });
      continue;
    }
    const edge = line.match(/^(.+?)\s*(?:--\s+(.+?)\s+-->|-->\s*(?:\|([^|]+)\|\s*)?)\s*(.+)$/);
    if (edge) {
      const from = flowNode(edge[1]);
      const to = flowNode(edge[4]);
      if (!from || !to) return failure("invalid", "An edge endpoint is not valid.", index + 1);
      addNode(from); addNode(to);
      edges.push({ from: from.id, to: to.id, label: (edge[2] ?? edge[3] ?? "").trim() });
      continue;
    }
    const node = flowNode(line);
    if (!node) return failure("unsupported", "This flowchart statement is not supported.", index + 1);
    addNode(node);
  }
  if (group) return failure("invalid", "The subgraph has no end.", lines.length);
  if (!nodes.size) return failure("invalid", "The diagram has no nodes.");
  return { ok: true, kind: state ? "state" : "flowchart", direction, nodes: [...nodes.values()], edges, groups };
}

/** Assigns stable ranks, with cycle members sharing a rank. */
function graphRanks(model) {
  const adjacency = new Map(model.nodes.map((node) => [node.id, []]));
  for (const edge of model.edges) adjacency.get(edge.from)?.push(edge.to);
  let cursor = 0;
  const stack = [], onStack = new Set(), indices = new Map(), low = new Map(), component = new Map();
  /** Visits one node during the strongly connected component pass. */
  const visit = (id) => {
    indices.set(id, cursor); low.set(id, cursor); cursor += 1; stack.push(id); onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)));
    }
    if (low.get(id) !== indices.get(id)) return;
    let value;
    const number = new Set(component.values()).size;
    do { value = stack.pop(); onStack.delete(value); component.set(value, number); } while (value !== id);
  };
  for (const node of model.nodes) if (!indices.has(node.id)) visit(node.id);
  const rank = new Map([...new Set(component.values())].map((id) => [id, 0]));
  for (let pass = 0; pass < rank.size; pass += 1) {
    for (const edge of model.edges) {
      const from = component.get(edge.from), to = component.get(edge.to);
      if (from !== to) rank.set(to, Math.max(rank.get(to), rank.get(from) + 1));
    }
  }
  return new Map(model.nodes.map((node) => [node.id, rank.get(component.get(node.id))]));
}

/** Creates one SVG element with fixed attributes only. */
function svgElement(document, name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** Builds a safe SVG diagram directly from the parsed graph model. */
export function renderMermaidSvg(document, model) {
  const ranks = graphRanks(model);
  const byRank = new Map();
  for (const node of model.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(node);
  }
  const horizontal = ["LR", "RL"].includes(model.direction);
  const reverse = ["RL", "BT"].includes(model.direction);
  const maxRank = Math.max(...byRank.keys());
  const positions = new Map();
  for (const [rank, nodes] of byRank) nodes.forEach((node, lane) => {
    const logicalRank = reverse ? maxRank - rank : rank;
    positions.set(node.id, horizontal ? { x: 110 + logicalRank * 230, y: 85 + lane * 120 } : { x: 110 + lane * 230, y: 85 + logicalRank * 130 });
  });
  const width = Math.max(260, ...[...positions.values()].map((point) => point.x + 120));
  const height = Math.max(170, ...[...positions.values()].map((point) => point.y + 75));
  const svg = svgElement(document, "svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${model.kind === "state" ? "State" : "Flowchart"} diagram` });
  const title = svgElement(document, "title"); title.textContent = model.kind === "state" ? "State diagram" : "Flowchart diagram"; svg.append(title);
  const defs = svgElement(document, "defs");
  const marker = svgElement(document, "marker", { id: "diagram-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.append(svgElement(document, "path", { d: "M 0 0 L 10 5 L 0 10 z" })); defs.append(marker); svg.append(defs);
  for (const group of model.groups) {
    const points = group.members.map((id) => positions.get(id)).filter(Boolean);
    if (!points.length) continue;
    const x = Math.min(...points.map((p) => p.x)) - 100, y = Math.min(...points.map((p) => p.y)) - 58;
    const right = Math.max(...points.map((p) => p.x)) + 100, bottom = Math.max(...points.map((p) => p.y)) + 55;
    const element = svgElement(document, "g", { class: "diagram-group" });
    element.append(svgElement(document, "rect", { x, y, width: right - x, height: bottom - y, rx: 12 }));
    const label = svgElement(document, "text", { x: x + 14, y: y + 22 }); label.textContent = group.label; element.append(label); svg.append(element);
  }
  for (const edge of model.edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const element = svgElement(document, "g", { class: "diagram-edge" });
    element.append(svgElement(document, "path", { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, "marker-end": "url(#diagram-arrow)" }));
    if (edge.label) { const label = svgElement(document, "text", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 8 }); label.textContent = edge.label; element.append(label); }
    svg.append(element);
  }
  for (const node of model.nodes) {
    const point = positions.get(node.id);
    const element = svgElement(document, "g", { class: `diagram-node diagram-node-${node.shape}` });
    if (node.shape === "marker") element.append(svgElement(document, "circle", { cx: point.x, cy: point.y, r: 9 }));
    else if (node.shape === "diamond") element.append(svgElement(document, "path", { d: `M ${point.x} ${point.y - 40} L ${point.x + 70} ${point.y} L ${point.x} ${point.y + 40} L ${point.x - 70} ${point.y} Z` }));
    else if (node.shape === "circle") element.append(svgElement(document, "circle", { cx: point.x, cy: point.y, r: 46 }));
    else if (node.shape === "cylinder") element.append(svgElement(document, "path", { d: `M ${point.x - 88} ${point.y - 25} C ${point.x - 88} ${point.y - 43}, ${point.x + 88} ${point.y - 43}, ${point.x + 88} ${point.y - 25} L ${point.x + 88} ${point.y + 25} C ${point.x + 88} ${point.y + 43}, ${point.x - 88} ${point.y + 43}, ${point.x - 88} ${point.y + 25} Z M ${point.x - 88} ${point.y - 25} C ${point.x - 88} ${point.y - 7}, ${point.x + 88} ${point.y - 7}, ${point.x + 88} ${point.y - 25}` }));
    else element.append(svgElement(document, "rect", { x: point.x - 88, y: point.y - 34, width: 176, height: 68, rx: ["rounded", "stadium"].includes(node.shape) ? 34 : 7 }));
    if (node.label) { const label = svgElement(document, "text", { x: point.x, y: point.y + 5, "text-anchor": "middle" }); label.textContent = node.label; element.append(label); }
    svg.append(element);
  }
  return svg;
}

/** Replaces Mermaid placeholders with local SVG or a readable failure message. */
export function mountMermaidDiagrams(root) {
  for (const host of root?.querySelectorAll?.("[data-mermaid-diagram]") ?? []) {
    if (host.dataset.diagramMounted === "true") continue;
    host.dataset.diagramMounted = "true";
    const source = host.querySelector("code")?.textContent ?? "";
    const parsed = parseMermaidDiagram(source);
    if (!parsed.ok) {
      host.classList.add("diagram-failed");
      const message = host.ownerDocument.createElement("p");
      message.className = "diagram-message";
      message.textContent = parsed.kind === "unsupported"
        ? "This diagram uses unsupported Mermaid syntax. Open Edit and use a flowchart or simple state diagram."
        : "This diagram could not render. Open Edit, correct the diagram syntax, then save.";
      host.prepend(message);
      continue;
    }
    const svg = renderMermaidSvg(host.ownerDocument, parsed);
    host.replaceChildren(svg);
    host.classList.add("diagram-rendered");
  }
}
