/**
 * The pure matcher behind the Work search bar (design agent-shell-work-search
 * 4.2). Rows come in as `{ cursor, text }` in table order. The pattern matches
 * when every word appears in the row's normalized text, the convention Go To
 * and the Area search already use.
 */

/** Lowercases and collapses one text for forgiving matching. */
export function normalizeSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The words of one pattern, empty for a blank pattern. */
export function searchWords(pattern) {
  return normalizeSearchText(pattern).split(" ").filter(Boolean);
}

/** Returns the cursor ids of the rows that match, in table order. */
export function workSearchMatches(rows, pattern) {
  const words = searchWords(pattern);
  if (!words.length) return [];
  return rows.filter((row) => {
    const text = normalizeSearchText(row.text);
    const joined = text.replaceAll(" ", "");
    return words.every((word) => text.includes(word) || joined.includes(word));
  }).map((row) => row.cursor);
}

/**
 * The match to land on. Incremental search starts at the origin row and moves
 * forward with wrap, like Vim. `n` and `N` step from the current cursor.
 */
export function searchTarget(matches, rowOrder, { from = "", direction = 1, inclusive = false } = {}) {
  if (!matches.length) return null;
  const position = new Map(rowOrder.map((cursor, index) => [cursor, index]));
  const origin = position.has(from) ? position.get(from) : -1;
  const ordered = matches.map((cursor) => ({ cursor, index: position.get(cursor) ?? -1 })).filter((item) => item.index >= 0);
  if (!ordered.length) return null;
  if (direction >= 0) {
    return (ordered.find((item) => (inclusive ? item.index >= origin : item.index > origin)) ?? ordered[0]).cursor;
  }
  return (ordered.findLast((item) => (inclusive ? item.index <= origin : item.index < origin)) ?? ordered.at(-1)).cursor;
}

/** The 1-based position of one cursor among the matches, or 0. */
export function matchPosition(matches, cursor) {
  return matches.indexOf(cursor) + 1;
}
