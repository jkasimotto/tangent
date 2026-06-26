/**
 * Renders the small markdown subset that actually appears in scope files (paragraphs, `**bold**`,
 * inline `` `code` ``, and ordered + unordered lists) to safe HTML. Self-contained on purpose: no
 * markdown renderer exists in the repo's UI packages and scope forbids a heavy engine. HTML is
 * escaped first, so the source is never trusted as markup.
 */
export function renderScopeMarkdown(markdown: string): string {
  const blocks = markdown.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return blocks.map(renderBlock).filter(Boolean).join("\n");
}

/** Renders one blank-line-delimited block as a list or paragraph. */
function renderBlock(block: string): string {
  const lines = block.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  if (!lines.length) return "";
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
  }
  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    return `<ol>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
  }
  return `<p>${renderInline(lines.join(" "))}</p>`;
}

/** Escapes HTML, then applies inline code and bold spans. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** Escapes the five HTML-significant characters so source text is never interpreted as markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
