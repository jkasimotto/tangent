import documentComments from "./document-comments.js";
import { scanMarkdownBlocks, visibleMarkdown } from "./markdown-structure.js";

/** Human-readable fallback for an unresolved wiki-link target. */
export function humanizeWikiTarget(target) {
  const leaf = String(target ?? "").split("#")[0].split("/").at(-1)?.replace(/\.md$/i, "") || String(target ?? "");
  return leaf.replace(/^design-|^goal-|^outcome-/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Removes reader-only source markup while leaving code literal. */
function cleanInlineSource(value, resolveWikiTitle = null) {
  const source = String(value ?? "");
  let out = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "`") {
      const close = source.indexOf("`", index + 1);
      if (close >= 0) { out += source.slice(index, close + 1); index = close + 1; continue; }
    }
    if (source.startsWith("{>>", index)) {
      const close = source.indexOf("<<}", index + 3);
      if (close >= 0) { index = close + 3; continue; }
    }
    if (source.startsWith("{==", index) || source.startsWith("==}", index)) { index += 3; continue; }
    const wiki = source.slice(index).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (wiki) {
      const target = wiki[1].trim();
      out += wiki[2]?.trim() || resolveWikiTitle?.(target) || humanizeWikiTarget(target);
      index += wiki[0].length;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

/** Clean Markdown for the whole source Document. */
export function cleanDocumentMarkdown(text, { title = "", resolveWikiTitle = null } = {}) {
  const source = visibleMarkdown(text);
  const blocks = scanMarkdownBlocks(text);
  const cleaned = blocks.map((block) => ({ block, text: block.type === "code" ? block.raw : cleanInlineSource(block.raw, resolveWikiTitle) })).filter((item) => item.text.trim());
  let markdown = cleaned.map((item, index) => {
    if (!index) return item.text;
    const previous = cleaned[index - 1].block;
    const tight = previous.type === item.block.type && ["list", "quote"].includes(item.block.type);
    return `${tight ? "\n" : "\n\n"}${item.text}`;
  }).join("").trim();
  const hasH1 = blocks.some((block) => block.type === "heading" && block.detail.level === 1
    && cleanInlineSource(block.detail.content, resolveWikiTitle).trim());
  if (!hasH1 && title.trim()) markdown = `# ${title.trim()}${markdown ? `\n\n${markdown}` : ""}`;
  // Preserve a completely empty body without leaking its frontmatter.
  return markdown || (source.trim() ? cleanInlineSource(source, resolveWikiTitle).trim() : "");
}

/** Visible inline projection plus semantic spans used at selection boundaries. */
function inlineProjection(value, resolveWikiTitle = null) {
  const source = String(value ?? "");
  const units = [];
  /** Adds one source-backed visible unit. */
  const pushText = (text, markdown = text, kind = "text") => units.push({ text, markdown, kind });
  for (let index = 0; index < source.length;) {
    if (source.startsWith("{>>", index)) {
      const close = source.indexOf("<<}", index + 3);
      if (close >= 0) { index = close + 3; continue; }
    }
    if (source.startsWith("{==", index) || source.startsWith("==}", index)) { index += 3; continue; }
    const wiki = source.slice(index).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (wiki) {
      const target = wiki[1].trim();
      const label = wiki[2]?.trim() || resolveWikiTitle?.(target) || humanizeWikiTarget(target);
      pushText(label, label, "wiki"); index += wiki[0].length; continue;
    }
    const link = source[index - 1] === "!" ? null : source.slice(index).match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (link) { pushText(link[1], link[0], "link"); index += link[0].length; continue; }
    const strong = source.slice(index).match(/^\*\*([^*]+)\*\*/);
    if (strong) { pushText(strong[1], strong[0], "strong"); index += strong[0].length; continue; }
    const emphasis = source.slice(index).match(/^\*([^*]+)\*/);
    if (emphasis) { pushText(emphasis[1], emphasis[0], "emphasis"); index += emphasis[0].length; continue; }
    const code = source.slice(index).match(/^`([^`]+)`/);
    if (code) { pushText(code[1], code[0], "code"); index += code[0].length; continue; }
    pushText(source[index]); index += 1;
  }
  let cursor = 0;
  for (const unit of units) { unit.from = cursor; cursor += unit.text.length; unit.to = cursor; }
  return { text: units.map((unit) => unit.text).join(""), units };
}

/** Serializes an inline visible range and closes any cut inline structure. */
function sliceInline(value, from, to, resolveWikiTitle) {
  const projection = inlineProjection(value, resolveWikiTitle);
  const start = Math.max(0, Math.min(from, projection.text.length));
  const end = Math.max(start, Math.min(to, projection.text.length));
  return projection.units.flatMap((unit) => {
    const left = Math.max(start, unit.from);
    const right = Math.min(end, unit.to);
    if (left >= right) return [];
    const selected = unit.text.slice(left - unit.from, right - unit.from);
    return [left === unit.from && right === unit.to ? unit.markdown : selected];
  }).join("");
}

/** Counts rendered characters from the start of one semantic copy block. */
function domTextOffset(block, node, offset) {
  const range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

/** Returns a semantic source block for one DOM endpoint. */
function copyBlock(node, root) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const block = element?.closest?.("[data-copy-block]") ?? null;
  return block && root.contains(block) ? block : null;
}

/** Normalizes one selected table cell to a paragraph. */
function selectedTableCell(range, block, markdownBlock, resolveWikiTitle) {
  const cells = [...block.querySelectorAll("[data-copy-cell]")].filter((cell) => range.intersectsNode(cell));
  if (cells.length !== 1) return null;
  const cell = cells[0];
  const row = Number(cell.dataset.copyRow);
  const column = Number(cell.dataset.copyCell);
  const value = markdownBlock.detail.rows[row]?.[column] ?? "";
  const start = range.startContainer === cell || cell.contains(range.startContainer) ? domTextOffset(cell, range.startContainer, range.startOffset) : 0;
  const end = range.endContainer === cell || cell.contains(range.endContainer) ? domTextOffset(cell, range.endContainer, range.endOffset) : cell.textContent.length;
  return sliceInline(value, start ?? 0, end ?? cell.textContent.length, resolveWikiTitle).trim();
}

/** Serializes selected blocks according to the reader's structured edge rules. */
function selectedMarkdown({ blocks, firstIndex, lastIndex, startOffset, endOffset, range, elements, resolveWikiTitle }) {
  const chosen = blocks.slice(firstIndex, lastIndex + 1);
  const listIndents = chosen.filter((block) => block.type === "list").map((block) => block.detail.indent);
  const listDepth = listIndents.length ? Math.min(...listIndents) : 0;
  const parts = [];
  for (const [relative, block] of chosen.entries()) {
    const first = relative === 0;
    const last = relative === chosen.length - 1;
    const from = first ? startOffset : 0;
    const projectionText = block.type === "heading" || block.type === "list" || block.type === "quote" || block.type === "paragraph" ? block.detail.content : "";
    const visibleLength = inlineProjection(projectionText, resolveWikiTitle).text.length;
    const to = last ? endOffset : visibleLength;
    if (block.type === "heading") parts.push({ type: block.type, text: `${"#".repeat(block.detail.level)} ${sliceInline(block.detail.content, from, to, resolveWikiTitle).trim()}` });
    else if (block.type === "paragraph") parts.push({ type: block.type, text: sliceInline(block.detail.content, from, to, resolveWikiTitle).trim() });
    else if (block.type === "list") parts.push({ type: block.type, text: `${" ".repeat(Math.max(0, block.detail.indent - listDepth))}${block.detail.marker} ${sliceInline(block.detail.content, from, to, resolveWikiTitle).trim()}` });
    else if (block.type === "quote") parts.push({ type: block.type, text: `${block.detail.prefix}${sliceInline(block.detail.content, from, to, resolveWikiTitle).trim()}` });
    else if (block.type === "code") {
      const element = elements.get(block.id);
      const code = element?.querySelector("code") ?? element;
      const body = code?.textContent ?? "";
      const bodyFrom = first && code?.contains(range.startContainer) ? domTextOffset(code, range.startContainer, range.startOffset) ?? 0 : 0;
      const bodyTo = last && code?.contains(range.endContainer) ? domTextOffset(code, range.endContainer, range.endOffset) ?? body.length : body.length;
      const selected = body.slice(bodyFrom, bodyTo).replace(/^\n|\n$/g, "");
      const char = block.detail.fence?.[0] || "`";
      const longest = Math.max(0, ...[...selected.matchAll(new RegExp(`${char}+`, "g"))].map((match) => match[0].length));
      const fence = char.repeat(Math.max(3, longest + 1));
      parts.push({ type: block.type, text: `${fence}${block.detail.language}\n${selected}\n${fence}` });
    } else if (block.type === "table") {
      const element = elements.get(block.id);
      const cell = firstIndex === lastIndex ? selectedTableCell(range, element, block, resolveWikiTitle) : null;
      if (cell) parts.push({ type: "paragraph", text: cell });
      else {
        const rows = [...element.querySelectorAll("tr")];
        const touched = rows.map((row, index) => range.intersectsNode(row) ? index : -1).filter((index) => index >= 0);
        const selectedRows = [...new Set([0, ...touched.filter((index) => index > 0)])];
        /** Serializes one complete table row after private-markup cleanup. */
        const rowMarkdown = (cells) => `| ${cells.map((cell) => cleanInlineSource(cell, resolveWikiTitle)).join(" | ")} |`;
        parts.push({ type: block.type, text: [rowMarkdown(block.detail.rows[0]), `| ${block.detail.alignments.map((alignment) => alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---").join(" | ")} |`, ...selectedRows.filter(Boolean).map((index) => rowMarkdown(block.detail.rows[index]))].join("\n") });
      }
    }
  }
  const present = parts.filter((part) => part.text.trim());
  return present.map((part, index) => {
    if (!index) return part.text;
    const tight = part.type === present[index - 1].type && ["list", "quote"].includes(part.type);
    return `${tight ? "\n" : "\n\n"}${part.text}`;
  }).join("").trim();
}

/** Maps the current reading-column Selection to clean Markdown. */
export function selectedDocumentMarkdown({ text, root, selection, resolveWikiTitle = null }) {
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const anchorBlock = copyBlock(selection.anchorNode, root);
  if (!anchorBlock) return null;
  const blocks = scanMarkdownBlocks(text);
  const elements = new Map([...root.querySelectorAll("[data-copy-block]")].map((element) => [element.dataset.copyBlock, element]));
  const range = selection.getRangeAt(0);
  let firstElement = copyBlock(range.startContainer, root);
  let lastElement = copyBlock(range.endContainer, root);
  if (!firstElement) firstElement = elements.get("0") ?? null;
  if (!lastElement) lastElement = elements.get(String(blocks.length - 1)) ?? null;
  if (!firstElement || !lastElement) return null;
  const firstIndex = blocks.findIndex((block) => block.id === firstElement.dataset.copyBlock);
  const lastIndex = blocks.findIndex((block) => block.id === lastElement.dataset.copyBlock);
  if (firstIndex < 0 || lastIndex < firstIndex) return null;
  const startOffset = copyBlock(range.startContainer, root) ? domTextOffset(firstElement, range.startContainer, range.startOffset) : 0;
  const endOffset = copyBlock(range.endContainer, root) ? domTextOffset(lastElement, range.endContainer, range.endOffset) : lastElement.textContent.length;
  if (startOffset === null || endOffset === null) return null;
  const markdown = selectedMarkdown({ blocks, firstIndex, lastIndex, startOffset, endOffset, range, elements, resolveWikiTitle });
  return markdown.trim() ? markdown : null;
}

/** Prepares both clean clipboard forms without touching browser clipboard APIs. */
export function documentCopyPayload({ source, root, selection, markdownToHtml, resolveWikiTitle = null, whole = false }) {
  if (!source) return null;
  const selected = whole ? null : selectedDocumentMarkdown({ text: source.text, root, selection, resolveWikiTitle });
  const markdown = selected || (whole ? cleanDocumentMarkdown(source.text, { title: source.title, resolveWikiTitle }) : null);
  if (!markdown?.trim()) return null;
  return { scope: selected ? "selection" : "document", markdown, html: markdownToHtml(markdown, { mode: "export", baseFile: source.file }) };
}

/** Exact comment ranges are public for focused tests and future copy adapters. */
export function documentCommentRanges(text) {
  return documentComments.parseComments(text).map(({ start, end }) => ({ start, end }));
}
