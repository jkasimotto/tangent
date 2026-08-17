// Comments inside vault Documents (design contract: otto/tangent/design-comment-on-documents).
//
// A comment is CriticMarkup in the Markdown itself: `{>>Julian: text<<}` on its
// own line under a heading, or `{==quoted words==}{>>Julian: text<<}` inline after
// the words it refers to. The file is the only store, so the same parser must
// run in the browser (reader, composer, remove) and on the server (index,
// prompt counts, `tangent document resolve`). This file is a plain script for
// the browser and is imported for its global by server.mjs.
(function (root) {
  "use strict";

  const AUTHOR = "Julian";
  const COMMENT_PATTERN = /\{==([^\n]*?)==\}\{>>([^\n]*?)<<\}|\{>>([^\n]*?)<<\}/g;

  /** Character ranges of fenced and inline code, where markup is literal. */
  function codeRanges(text) {
    const ranges = [];
    for (const match of text.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
  }

  /** Splits "Julian: text" into its author and body. */
  function splitAuthor(raw) {
    const match = raw.match(/^([A-Za-z][\w .-]{0,40}?):\s+([\s\S]*)$/);
    return match ? { author: match[1], text: match[2].trim() } : { author: "", text: raw.trim() };
  }

  /** The zero-based line that holds one character offset. */
  function lineAt(text, offset) {
    let line = 0;
    for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
    return line;
  }

  /**
   * Every comment in document order. Comments inside code are ignored.
   * `standalone` is true when the markup is the whole content of its line.
   */
  function parseComments(text) {
    const source = String(text ?? "");
    const code = codeRanges(source);
    const comments = [];
    for (const match of source.matchAll(COMMENT_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      if (code.some(([from, to]) => start >= from && start < to)) continue;
      const { author, text: body } = splitAuthor(match[2] ?? match[3] ?? "");
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const lineEndIndex = source.indexOf("\n", end);
      const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
      const standalone = source.slice(lineStart, start).trim() === "" && source.slice(end, lineEnd).trim() === "";
      comments.push({
        index: comments.length,
        author,
        text: body,
        quote: match[1] ?? null,
        start,
        end,
        line: lineAt(source, start),
        standalone,
        markup: match[0],
      });
    }
    return comments;
  }

  /** The stored markup for one comment body, with an optional quoted anchor. */
  function commentMarkup(body, quote) {
    const clean = String(body ?? "").replace(/\s+/g, " ").trim().replace(/<<\}/g, "<< }");
    const mark = `{>>${AUTHOR}: ${clean}<<}`;
    return quote ? `{==${quote}==}${mark}` : mark;
  }

  /** Lines of the text, keeping the character offset where each line starts. */
  function lineTable(text) {
    const lines = [];
    let offset = 0;
    for (const line of text.split("\n")) {
      lines.push({ text: line, start: offset });
      offset += line.length + 1;
    }
    return lines;
  }

  /** Inserts one standalone comment line after line `index`, keeping blank lines around it. */
  function insertLineAfter(text, index, markup) {
    const lines = text.split("\n");
    const following = lines[index + 1] ?? null;
    const insert = following === null || following.trim() === "" ? ["", markup] : ["", markup, ""];
    lines.splice(index + 1, 0, ...insert);
    return lines.join("\n");
  }

  /** The line index of the first level-one heading after any frontmatter, or -1. */
  function titleLine(lines) {
    let index = 0;
    if (lines[0]?.text.trim() === "---") {
      const close = lines.findIndex((line, position) => position > 0 && line.text.trim() === "---");
      if (close > 0) index = close + 1;
    }
    for (let position = index; position < lines.length; position += 1) {
      if (/^#\s+\S/.test(lines[position].text)) return position;
    }
    return index - 1;
  }

  /** Reduces heading text to a comparable key. */
  function headingKey(value) {
    return String(value ?? "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * Adds one comment. Anchors: `{ kind: "selection", quote, line }` wraps the
   * quoted words (on `line` when given, else the unique occurrence anywhere),
   * `{ kind: "section", heading }` puts a line under that heading, and
   * `{ kind: "document" }` puts a line under the title. Returns `{ text }` or
   * `{ error }` and never guesses when the anchor is missing or ambiguous.
   */
  function insertComment(text, anchor, body) {
    const source = String(text ?? "");
    const lines = lineTable(source);
    if (anchor.kind === "selection") {
      const quote = String(anchor.quote ?? "").replace(/\s+/g, " ").trim();
      if (!quote) return { error: "Select some words first." };
      const code = codeRanges(source);
      const hits = [];
      for (const line of lines) {
        let from = 0;
        while (from <= line.text.length) {
          const found = line.text.indexOf(quote, from);
          if (found < 0) break;
          const offset = line.start + found;
          if (!code.some(([start, end]) => offset >= start && offset < end)) hits.push({ offset, lineIndex: lines.indexOf(line) });
          from = found + 1;
        }
      }
      let hit = null;
      if (Number.isInteger(anchor.line)) hit = hits.find((candidate) => candidate.lineIndex === anchor.line) ?? null;
      if (!hit && hits.length === 1) hit = hits[0];
      if (!hit && hits.length > 1) return { error: "Those words appear more than once. Select a longer stretch." };
      if (!hit) return { error: "The text you selected changed. Choose where this comment goes." };
      const markup = commentMarkup(body, quote);
      return { text: source.slice(0, hit.offset) + markup + source.slice(hit.offset + quote.length) };
    }
    if (anchor.kind === "section") {
      const wanted = headingKey(anchor.heading);
      const index = lines.findIndex((line) => /^#{1,6}\s+/.test(line.text) && headingKey(line.text) === wanted);
      if (index < 0) return { error: "That section is gone. Choose where this comment goes." };
      return { text: insertLineAfter(source, index, commentMarkup(body)) };
    }
    if (anchor.kind === "document") {
      return { text: insertLineAfter(source, titleLine(lines), commentMarkup(body)) };
    }
    return { error: "Unknown comment anchor." };
  }

  /** Removes one parsed comment, unwrapping its quoted words and its own line. */
  function removeComment(text, comment) {
    const source = String(text ?? "");
    if (!comment.standalone || comment.quote != null) {
      return source.slice(0, comment.start) + (comment.quote ?? "") + source.slice(comment.end);
    }
    const lines = source.split("\n");
    lines.splice(comment.line, 1);
    const before = lines[comment.line - 1];
    const after = lines[comment.line];
    if (before !== undefined && before.trim() === "" && (after === undefined || after.trim() === "")) lines.splice(comment.line - 1, 1);
    return lines.join("\n");
  }

  /** Replaces the words of one parsed comment, keeping its place and quote. */
  function replaceCommentText(text, comment, body) {
    const source = String(text ?? "");
    return source.slice(0, comment.start) + commentMarkup(body, comment.quote) + source.slice(comment.end);
  }

  /** Comparable form of comment text for matching a typed prefix. */
  function textKey(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * Resolves the one comment whose text starts with `prefix`. Returns
   * `{ text, comment }` or `{ error, matches }` when zero or several match, so a
   * caller can never remove the wrong comment.
   */
  function resolveComment(text, prefix) {
    const wanted = textKey(prefix);
    if (!wanted) return { error: "Give the first words of the comment.", matches: [] };
    const matches = parseComments(text).filter((comment) => textKey(comment.text).startsWith(wanted));
    if (matches.length !== 1) {
      return {
        error: matches.length ? `${matches.length} comments start with those words. Give more of the text.` : "No open comment starts with those words.",
        matches,
      };
    }
    return { text: removeComment(text, matches[0]), comment: matches[0] };
  }

  root.AgentShellDocumentComments = { AUTHOR, parseComments, insertComment, removeComment, replaceCommentText, resolveComment, commentMarkup };
})(typeof window !== "undefined" ? window : globalThis);
