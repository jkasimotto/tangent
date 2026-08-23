// Comments inside vault Documents (design contract: otto/tangent/design-comment-on-documents,
// overlap rule: otto/tangent/design-second-comment-lands).
//
// A comment is CriticMarkup in the Markdown itself: `{>>Julian: text<<}` on its
// own line under a heading, or `{==quoted words==}{>>Julian: text<<}` inline after
// the words it refers to. The file is the only store, so the same parser must
// run in the browser (reader, composer, remove) and on the server (index,
// prompt counts, `tangent document resolve`). This file is a plain script for
// the browser and is imported for its global by server.mjs.
//
// Marks can nest, share, and come in pieces, so a second comment always lands on
// the words that were selected. The parser is a scanner with a stack of open
// marks; every comment keeps the source range of each piece of its mark.

  const AUTHOR = "Julian";
  const MARK_OPEN = "{==";
  const MARK_CLOSE = "==}";
  const NOTE_OPEN = "{>>";
  const NOTE_CLOSE = "<<}";
  const BLOCK_PREFIXES = [/^#{1,4}\s+/, /^\s*[-*]\s+/, /^\s*\d+[.)]\s+/];
  const KIND_ORDER = { close: 0, comment: 1, open: 2 };

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

  /**
   * Every markup token of one line, sorted for a nesting reader. Entries hold
   * line-relative `pieces`, `start`, and `end`, as the parser builds them and
   * as `commentTokensOnLine` maps them from parsed comments.
   */
  function tokensForLine(entries) {
    const tokens = [];
    for (const entry of entries) {
      for (const piece of entry.pieces) {
        tokens.push({ from: piece.start, to: piece.start + 3, kind: "open", index: entry.index });
        tokens.push({ from: piece.end - 3, to: piece.end, kind: "close", index: entry.index });
      }
      tokens.push({ from: entry.start, to: entry.end, kind: "comment", index: entry.index });
    }
    /** Opens nest inward and closes unwind outward when several share one range. */
    const order = (a, b) => a.from - b.from || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.kind === "close" ? b.index - a.index : a.index - b.index);
    return tokens.sort(order);
  }

  /**
   * The markup tokens of the comments that sit on one file line, as offsets
   * relative to the start of that line. The reader places its marks with these,
   * and `visibleLine` hides them, so nothing has to guess what is comment markup.
   */
  function commentTokensOnLine(comments, line) {
    const entries = [];
    for (const comment of comments ?? []) {
      if (comment.line !== line) continue;
      const lineStart = comment.lineStart ?? 0;
      entries.push({
        index: comment.index,
        pieces: (comment.pieces ?? []).map((piece) => ({ start: piece.start - lineStart, end: piece.end - lineStart })),
        start: comment.start - lineStart,
        end: comment.end - lineStart,
      });
    }
    return tokensForLine(entries);
  }

  /**
   * One Markdown line as the reader shows it, with the source offset of every
   * visible character and the ranges of the inline markup that was cut out.
   * Julian selects words in the rendered line, so a selection can only be found
   * again on this form. The rules mirror `inlineMarkdown` in shell.js; change
   * both together.
   *
   * Known limit: a wiki link without an alias shows the linked record's title,
   * which this helper cannot know, so it keeps the raw target. A selection
   * across such a link can fail to match.
   */
  function visibleLine(lineText, tokens) {
    const source = String(lineText ?? "");
    const tokenAt = new Map();
    for (const token of tokens ?? []) tokenAt.set(token.from, Math.max(tokenAt.get(token.from) ?? 0, token.to));
    const out = [];
    const offsets = [];
    const spans = [];
    let boldEnd = -1;
    let codeEnd = -1;
    /** Appends one visible character, collapsing every run of whitespace to one space. */
    const emit = (char, offset) => {
      if (/\s/.test(char)) {
        if (!out.length || out[out.length - 1] === " ") return;
        out.push(" ");
        offsets.push(offset);
        return;
      }
      out.push(char);
      offsets.push(offset);
    };
    /** Appends one link label without the spaces around it, keeping source offsets. */
    const emitLabel = (label, labelStart) => {
      const first = label.search(/\S/);
      if (first < 0) return;
      const last = label.replace(/\s+$/, "").length - 1;
      for (let position = first; position <= last; position += 1) emit(label[position], labelStart + position);
    };
    let i = 0;
    for (const pattern of BLOCK_PREFIXES) {
      const match = source.match(pattern);
      if (match) {
        i = match[0].length;
        break;
      }
    }
    while (i < source.length) {
      if (tokenAt.has(i)) {
        i = tokenAt.get(i);
        continue;
      }
      if (i === boldEnd) {
        i += 2;
        boldEnd = -1;
        continue;
      }
      if (i === codeEnd) {
        i += 1;
        codeEnd = -1;
        continue;
      }
      const wiki = source.slice(i).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (wiki) {
        const label = wiki[2] ?? wiki[1];
        emitLabel(label, wiki[2] === undefined ? i + 2 : i + 2 + wiki[1].length + 1);
        spans.push({ from: i, to: i + wiki[0].length });
        i += wiki[0].length;
        continue;
      }
      const link = source[i - 1] === "!" ? null : source.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (link) {
        emitLabel(link[1], i + 1);
        spans.push({ from: i, to: i + link[0].length });
        i += link[0].length;
        continue;
      }
      if (source[i] === "`" && codeEnd < 0) {
        const close = source.indexOf("`", i + 1);
        if (close > i + 1) {
          spans.push({ from: i, to: close + 1 });
          codeEnd = close;
          i += 1;
          continue;
        }
      }
      if (source.startsWith("**", i) && boldEnd < 0) {
        const close = source.indexOf("*", i + 2);
        if (close > i + 2 && source[close + 1] === "*") {
          spans.push({ from: i, to: close + 2 });
          boldEnd = close;
          i += 2;
          continue;
        }
      }
      emit(source[i], i);
      i += 1;
    }
    if (out[out.length - 1] === " ") {
      out.pop();
      offsets.pop();
    }
    return { text: out.join(""), offsets, spans };
  }

  /** Drops one mark from a working list by identity. */
  function dropMark(list, mark) {
    const at = list.indexOf(mark);
    if (at >= 0) list.splice(at, 1);
  }

  /** True when every character between two line offsets belongs to a recognized token. */
  function coveredBetween(ranges, from, to) {
    for (let at = from; at < to; at += 1) {
      if (!ranges.some(([start, end]) => at >= start && at < end)) return false;
    }
    return true;
  }

  /**
   * Every comment in document order. Comments inside code are ignored.
   * `pieces` holds the source range of each part of the comment's mark, so
   * nested and crossing marks survive a round trip. `standalone` is true when
   * the markup is the whole content of its line.
   */
  function parseComments(text) {
    const source = String(text ?? "");
    const code = codeRanges(source);
    const comments = [];
    for (const [lineIndex, line] of lineTable(source).entries()) {
      const lineText = line.text;
      const lineStart = line.start;
      /** True when one line offset lies inside fenced or inline code. */
      const inCode = (at) => code.some(([from, to]) => lineStart + at >= from && lineStart + at < to);
      const open = [];
      const orphans = [];
      const tokenRanges = [];
      const found = [];
      let last = null;
      let i = 0;
      while (i < lineText.length) {
        if (lineText.startsWith(MARK_OPEN, i) && !inCode(i)) {
          open.push(i);
          tokenRanges.push([i, i + 3]);
          last = { kind: "open" };
          i += 3;
          continue;
        }
        if (lineText.startsWith(MARK_CLOSE, i) && !inCode(i) && open.length) {
          const mark = { start: open.pop(), end: i + 3 };
          orphans.push(mark);
          tokenRanges.push([i, i + 3]);
          last = { kind: "close", end: i + 3, mark };
          i += 3;
          continue;
        }
        if (lineText.startsWith(NOTE_OPEN, i) && !inCode(i)) {
          const close = lineText.indexOf(NOTE_CLOSE, i + 3);
          if (close < 0) {
            i += 1;
            continue;
          }
          const end = close + 3;
          tokenRanges.push([i, end]);
          let pieces = [];
          if (last?.kind === "comment" && last.end === i) pieces = last.pieces;
          else if (last?.kind === "close" && last.end === i) {
            pieces = [last.mark];
            dropMark(orphans, last.mark);
            // A closed mark with no comment of its own belongs to the next
            // comment whose mark touches it: only markup stands between it and
            // the piece already claimed. Walk backward piece by piece, so a mark
            // in three or more pieces is joined whole.
            let earliest = last.mark.start;
            for (const orphan of [...orphans].sort((a, b) => b.end - a.end)) {
              if (orphan.end > earliest) continue;
              if (!coveredBetween(tokenRanges, orphan.end, earliest)) continue;
              pieces.push(orphan);
              dropMark(orphans, orphan);
              earliest = orphan.start;
            }
            pieces.sort((a, b) => a.start - b.start);
          }
          found.push({ start: i, end, pieces, body: lineText.slice(i + 3, close) });
          last = { kind: "comment", end, pieces };
          i = end;
          continue;
        }
        i += 1;
      }
      if (!found.length) continue;
      const base = comments.length;
      for (const [position, entry] of found.entries()) entry.index = base + position;
      const visible = visibleLine(lineText, tokensForLine(found));
      for (const entry of found) {
        const { author, text: body } = splitAuthor(entry.body);
        const quoted = [];
        for (const [position, offset] of visible.offsets.entries()) {
          if (entry.pieces.some((piece) => offset >= piece.start + 3 && offset < piece.end - 3)) quoted.push(visible.text[position]);
        }
        comments.push({
          index: entry.index,
          author,
          text: body,
          quote: entry.pieces.length ? quoted.join("").replace(/\s+/g, " ").trim() : null,
          pieces: entry.pieces.map((piece) => ({ start: piece.start + lineStart, end: piece.end + lineStart })),
          start: entry.start + lineStart,
          end: entry.end + lineStart,
          line: lineIndex,
          lineStart,
          standalone: entry.pieces.length === 0 && lineText.trim() === lineText.slice(entry.start, entry.end),
          markup: lineText.slice(entry.start, entry.end),
        });
      }
    }
    return comments;
  }

  /** The stored markup for one comment body, with an optional quoted anchor. */
  function commentMarkup(body, quote) {
    const clean = String(body ?? "").replace(/\s+/g, " ").trim().replace(/<<\}/g, "<< }");
    const mark = `${NOTE_OPEN}${AUTHOR}: ${clean}${NOTE_CLOSE}`;
    return quote ? `${MARK_OPEN}${quote}${MARK_CLOSE}${mark}` : mark;
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

  /** The first offset after `at` that no comment token covers. */
  function afterCommentTokens(commentTokens, at) {
    let end = at;
    for (let moved = true; moved; ) {
      moved = false;
      const token = commentTokens.find((item) => item.from === end);
      if (token) {
        end = token.to;
        moved = true;
      }
    }
    return end;
  }

  /**
   * Writes one new mark over `[start, end)` of a line and puts the comment after
   * it. A mark the range contains stays nested inside the new one; a mark the
   * range only crosses splits the new mark into pieces, so neither comment
   * loses its own words.
   */
  function writeMark(lineText, marks, commentTokens, start, end, body) {
    let from = start;
    let to = end;
    for (let changed = true; changed; ) {
      changed = false;
      for (const mark of marks) {
        if (mark.start + 3 === from && mark.end <= to) {
          from = mark.start;
          changed = true;
        }
        if (mark.end - 3 === to && mark.start >= from) {
          to = afterCommentTokens(commentTokens, mark.end);
          changed = true;
        }
      }
    }
    const cuts = [];
    for (const mark of marks) {
      const openInside = mark.start >= from && mark.start < to;
      const closeInside = mark.end - 3 >= from && mark.end <= to;
      if (openInside === closeInside) continue;
      if (openInside) cuts.push([mark.start, mark.start + 3]);
      else cuts.push([mark.end - 3, afterCommentTokens(commentTokens, mark.end)]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let at = from;
    for (const [cutFrom, cutTo] of cuts) {
      if (cutFrom > at) pieces.push({ start: at, end: cutFrom });
      at = Math.max(at, cutTo);
    }
    if (to > at) pieces.push({ start: at, end: to });
    if (!pieces.length) return null;
    let out = lineText.slice(0, pieces[0].start);
    for (const [position, piece] of pieces.entries()) {
      out += `${MARK_OPEN}${lineText.slice(piece.start, piece.end)}${MARK_CLOSE}`;
      const next = pieces[position + 1];
      if (next) out += lineText.slice(piece.end, next.start);
    }
    return out + commentMarkup(body) + lineText.slice(pieces[pieces.length - 1].end);
  }

  /**
   * Adds one comment. Anchors: `{ kind: "selection", quote, line, offset }`
   * wraps the selected words where the reader shows them (on `line` when given,
   * nearest `offset` when the words repeat), `{ kind: "section", heading }` puts
   * a line under that heading, and `{ kind: "document" }` puts a line under the
   * title. Returns `{ text }` or `{ error }` and never guesses when the anchor
   * is missing or ambiguous.
   */
  function insertComment(text, anchor, body) {
    const source = String(text ?? "");
    const lines = lineTable(source);
    if (anchor.kind === "selection") {
      const quote = String(anchor.quote ?? "").replace(/\s+/g, " ").trim();
      if (!quote) return { error: "Select some words first." };
      const parsed = parseComments(source);
      const code = codeRanges(source);
      const hits = [];
      for (const [lineIndex, line] of lines.entries()) {
        const tokens = commentTokensOnLine(parsed, lineIndex);
        const visible = visibleLine(line.text, tokens);
        let from = 0;
        while (from <= visible.text.length) {
          const at = visible.text.indexOf(quote, from);
          if (at < 0) break;
          const sourceStart = line.start + visible.offsets[at];
          if (!code.some(([start, end]) => sourceStart >= start && sourceStart < end)) hits.push({ lineIndex, visibleStart: at, visibleEnd: at + quote.length, visible, tokens });
          from = at + 1;
        }
      }
      let hit = null;
      if (Number.isInteger(anchor.line)) {
        const onLine = hits.filter((candidate) => candidate.lineIndex === anchor.line);
        if (onLine.length && Number.isInteger(anchor.offset)) {
          /** The distance from one hit to the place the selection started. */
          const distance = (candidate) => Math.abs(candidate.visibleStart - anchor.offset);
          hit = onLine.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best), onLine[0]);
        } else if (onLine.length) hit = onLine[0];
      }
      if (!hit && hits.length === 1) hit = hits[0];
      if (!hit && hits.length > 1) return { error: "Those words appear more than once. Select a longer stretch." };
      if (!hit) return { error: "The text you selected changed. Choose where this comment goes." };
      const lineText = lines[hit.lineIndex].text;
      const lineStart = lines[hit.lineIndex].start;
      let start = hit.visible.offsets[hit.visibleStart];
      let end = hit.visible.offsets[hit.visibleEnd - 1] + 1;
      // Inline markup renders as one unit, so a mark can never cut it in half.
      for (let changed = true; changed; ) {
        changed = false;
        for (const span of hit.visible.spans) {
          if (span.from < start && start < span.to) {
            start = span.from;
            changed = true;
          }
          if (span.from < end && end < span.to) {
            end = span.to;
            changed = true;
          }
        }
      }
      const marks = [];
      for (const comment of parsed) {
        if (comment.line !== hit.lineIndex) continue;
        for (const piece of comment.pieces) {
          const mark = { start: piece.start - lineStart, end: piece.end - lineStart };
          if (!marks.some((item) => item.start === mark.start && item.end === mark.end)) marks.push(mark);
        }
      }
      const commentTokens = hit.tokens.filter((token) => token.kind === "comment");
      // The same words as an existing comment: one mark carries both comments.
      const sharing = parsed.filter((comment) => comment.line === hit.lineIndex && comment.pieces.length === 1
        && comment.pieces[0].start - lineStart + 3 === start && comment.pieces[0].end - lineStart - 3 === end);
      if (sharing.length) {
        const at = Math.max(...sharing.map((comment) => comment.end - lineStart));
        lines[hit.lineIndex].text = lineText.slice(0, at) + commentMarkup(body) + lineText.slice(at);
        return { text: lines.map((line) => line.text).join("\n") };
      }
      const written = writeMark(lineText, marks, commentTokens, start, end, body);
      if (!written) return { error: "The text you selected changed. Choose where this comment goes." };
      lines[hit.lineIndex].text = written;
      return { text: lines.map((line) => line.text).join("\n") };
    }
    if (anchor.kind === "section") {
      const wanted = headingKey(anchor.heading);
      const code = codeRanges(source);
      /** True when this line sits inside code, so a fenced heading lookalike is never the section. */
      const inCode = (line) => code.some(([from, to]) => line.start >= from && line.start < to);
      const index = lines.findIndex((line) => /^#{1,6}\s+/.test(line.text) && !inCode(line) && headingKey(line.text) === wanted);
      if (index < 0) return { error: "That section is gone. Choose where this comment goes." };
      return { text: insertLineAfter(source, index, commentMarkup(body)) };
    }
    if (anchor.kind === "document") {
      return { text: insertLineAfter(source, titleLine(lines), commentMarkup(body)) };
    }
    return { error: "Unknown comment anchor." };
  }

  /**
   * Removes one parsed comment: its own token, and the brackets of each piece of
   * its mark unless another comment shares that piece. A caller that removes
   * several comments must parse again after each one, because the offsets of
   * the others move.
   */
  function removeComment(text, comment) {
    const source = String(text ?? "");
    if (!comment.standalone) {
      const parsed = parseComments(source);
      /** True when another comment's mark covers exactly the same piece. */
      const shared = (piece) => parsed.some((other) => other.index !== comment.index
        && (other.pieces ?? []).some((item) => item.start === piece.start && item.end === piece.end));
      const edits = [[comment.start, comment.end]];
      for (const piece of comment.pieces ?? []) {
        if (shared(piece)) continue;
        edits.push([piece.start, piece.start + 3], [piece.end - 3, piece.end]);
      }
      edits.sort((a, b) => b[0] - a[0]);
      let out = source;
      for (const [from, to] of edits) out = out.slice(0, from) + out.slice(to);
      return out;
    }
    const lines = source.split("\n");
    lines.splice(comment.line, 1);
    const before = lines[comment.line - 1];
    const after = lines[comment.line];
    if (before !== undefined && before.trim() === "" && (after === undefined || after.trim() === "")) lines.splice(comment.line - 1, 1);
    return lines.join("\n");
  }

  /** Replaces the words of one parsed comment, keeping its place and its marks. */
  function replaceCommentText(text, comment, body) {
    const source = String(text ?? "");
    return source.slice(0, comment.start) + commentMarkup(body) + source.slice(comment.end);
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

export default { AUTHOR, parseComments, insertComment, removeComment, replaceCommentText, resolveComment, commentMarkup, commentTokensOnLine, visibleLine };
