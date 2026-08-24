const SVG_NS = "http://www.w3.org/2000/svg";
const DIRECTIONS = new Set(["LR", "RL", "TB", "TD", "BT"]);
const HTML_BREAK = /<br\s*\/?\s*>/gi;

/** Returns a parse failure that the reader can explain without hiding source. */
function failure(kind, detail, line = 0) {
  return { ok: false, kind, detail, line };
}

/** Rejects Mermaid features whose model can carry active content or styling. */
function forbiddenLine(line) {
  return /^(?:%%\{|click\b|linkStyle\b|classDef\b|class\b|style\b|accTitle\b|accDescr\b)|(?:https?:)?\/\//i.test(line);
}

/** Converts the supported Mermaid text-label syntax to plain text. */
function textLabel(value) {
  let label = String(value).trim();
  const startsQuoted = label.startsWith('"');
  const endsQuoted = label.endsWith('"');
  if (startsQuoted !== endsQuoted) return null;
  if (startsQuoted) label = label.slice(1, -1);
  label = label.replace(HTML_BREAK, "\n");
  if (/<\/?[a-z][^>]*>/i.test(label)) return null;
  return label;
}

/** Finds syntax outside a quoted text label. */
function indexOutsideQuotes(value, syntax, offset) {
  let quoted = false;
  for (let index = offset; index <= value.length - syntax.length; index += 1) {
    if (value[index] === '"') { quoted = !quoted; continue; }
    if (!quoted && value.startsWith(syntax, index)) return index;
  }
  return -1;
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
    if (match) {
      const label = match[2] == null ? match[1] : textLabel(match[2]);
      return label == null ? null : { id: match[1], label, shape };
    }
  }
  return null;
}

/** Finds the next supported flowchart connector outside a node token. */
function flowConnector(value, offset = 0) {
  let depth = 0;
  let quoted = false;
  for (let index = offset; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if ("[({".includes(character)) { depth += 1; continue; }
    if ("])}".includes(character)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    const bidirectional = value.startsWith("<-->", index);
    const directed = value.startsWith("-->", index);
    if (bidirectional || directed) {
      let end = index + (bidirectional ? 4 : 3);
      let label = "";
      while (value[end] === " ") end += 1;
      if (value[end] === "|") {
        if (bidirectional) return { invalid: true };
        const close = indexOutsideQuotes(value, "|", end + 1);
        if (close < 0) return { invalid: true };
        label = textLabel(value.slice(end + 1, close));
        if (label == null) return { invalid: true };
        end = close + 1;
      }
      return { start: index, end, label, bidirectional };
    }
    if (value.startsWith("--", index) && /\s/.test(value[index + 2] ?? "")) {
      const close = indexOutsideQuotes(value, "-->", index + 2);
      if (close < 0) continue;
      if (!/\s/.test(value[close - 1] ?? "")) return { invalid: true };
      const label = textLabel(value.slice(index + 2, close));
      if (!label) return { invalid: true };
      return { start: index, end: close + 3, label, bidirectional: false };
    }
  }
  return null;
}

/** Parses one node statement or a chain of supported flowchart edges. */
function flowStatement(value) {
  let connector = flowConnector(value);
  if (!connector) {
    const node = flowNode(value);
    return node ? { nodes: [node], edges: [] } : null;
  }
  if (connector.invalid) return null;
  let node = flowNode(value.slice(0, connector.start));
  if (!node) return null;
  const nodes = [node];
  const edges = [];
  while (connector) {
    const next = flowConnector(value, connector.end);
    if (next?.invalid) return null;
    const target = flowNode(value.slice(connector.end, next?.start ?? value.length));
    if (!target) return null;
    nodes.push(target);
    edges.push({ from: node.id, to: target.id, label: connector.label });
    if (connector.bidirectional) edges.push({ from: target.id, to: node.id, label: connector.label });
    node = target;
    connector = next;
  }
  return { nodes, edges };
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
      const label = textLabel(match[2] ?? match[3] ?? match[1]);
      if (label == null) return failure("unsupported", "This subgraph label is not supported.", index + 1);
      group = { id: match[1], label, members: [] };
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
      const label = match[3] == null ? "" : textLabel(match[3]);
      if (label == null) return failure("unsupported", "This state label is not supported.", index + 1);
      edges.push({ from, to, label });
      continue;
    }
    const statement = flowStatement(line);
    if (!statement) return failure("unsupported", "This flowchart statement is not supported.", index + 1);
    for (const node of statement.nodes) addNode(node);
    edges.push(...statement.edges);
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

/** Splits a label into short SVG lines without discarding long path segments. */
function labelLines(value, limit = 24) {
  const lines = [];
  for (const explicitLine of String(value).split("\n")) {
    let current = "";
    const words = explicitLine.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    for (const word of words) {
      const pieces = word.length > limit ? word.match(new RegExp(`.{1,${limit}}`, "g")) : [word];
      for (const piece of pieces) {
        if (current && current.length + piece.length + 1 > limit) { lines.push(current); current = ""; }
        current = current ? `${current} ${piece}` : piece;
        if (current.length === limit) { lines.push(current); current = ""; }
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

/** Adds an aligned multi-line text label. */
function appendLabel(document, parent, value, x, y, limit, anchor = "middle") {
  const lines = labelLines(value, limit);
  const label = svgElement(document, "text", { x, y: y - ((lines.length - 1) * 9), "text-anchor": anchor });
  lines.forEach((line, index) => {
    const span = svgElement(document, "tspan", { x, dy: index ? 18 : 0 });
    span.textContent = line;
    label.append(span);
  });
  parent.append(label);
  return lines.length;
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
    positions.set(node.id, horizontal ? { x: 120 + logicalRank * 290, y: 95 + lane * 150 } : { x: 120 + lane * 290, y: 95 + logicalRank * 160 });
  });
  const width = Math.max(280, ...[...positions.values()].map((point) => point.x + 130));
  const height = Math.max(190, ...[...positions.values()].map((point) => point.y + 85));
  const svg = svgElement(document, "svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${model.kind === "state" ? "State" : "Flowchart"} diagram` });
  const title = svgElement(document, "title"); title.textContent = model.kind === "state" ? "State diagram" : "Flowchart diagram"; svg.append(title);
  const defs = svgElement(document, "defs");
  const marker = svgElement(document, "marker", { id: "diagram-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.append(svgElement(document, "path", { d: "M 0 0 L 10 5 L 0 10 z" })); defs.append(marker); svg.append(defs);
  for (const group of model.groups) {
    const points = group.members.map((id) => positions.get(id)).filter(Boolean);
    if (!points.length) continue;
    const groupLabelLines = labelLines(group.label, 24).length;
    const x = Math.min(...points.map((p) => p.x)) - 100, y = Math.min(...points.map((p) => p.y)) - 40 - (groupLabelLines * 18);
    const right = Math.max(...points.map((p) => p.x)) + 100, bottom = Math.max(...points.map((p) => p.y)) + 55;
    const element = svgElement(document, "g", { class: "diagram-group" });
    element.append(svgElement(document, "rect", { x, y, width: right - x, height: bottom - y, rx: 12 }));
    appendLabel(document, element, group.label, x + 14, y + 22, 24, "start");
    svg.append(element);
  }
  for (const edge of model.edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const start = { x: from.x + (dx / length) * 96, y: from.y + (dy / length) * 42 };
    const end = { x: to.x - (dx / length) * 96, y: to.y - (dy / length) * 42 };
    const element = svgElement(document, "g", { class: "diagram-edge" });
    element.append(svgElement(document, "path", { d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, "marker-end": "url(#diagram-arrow)" }));
    if (edge.label) appendLabel(document, element, edge.label, (from.x + to.x) / 2, (from.y + to.y) / 2 - 10, 22);
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
    if (node.label) appendLabel(document, element, node.label, point.x, point.y + 5, 22);
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
      const location = parsed.line ? `Line ${parsed.line}: ` : "";
      const action = parsed.kind === "unsupported"
        ? "Open Edit and use supported Mermaid syntax."
        : "Open Edit, correct the diagram syntax, then save.";
      message.textContent = `${location}${parsed.detail} ${action}`;
      host.prepend(message);
      continue;
    }
    const svg = renderMermaidSvg(host.ownerDocument, parsed);
    host.replaceChildren(svg);
    host.classList.add("diagram-rendered");
  }
}
