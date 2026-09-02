// The writing-style corpus (design contract: docs/design/style-notes/design-record.md).
//
// A style note is an observation about how a piece of writing went wrong or
// right. It is not feedback that asks for a change, so it must never behave
// like a Document comment: never in the reading view, never in
// `tangent document comments`, never a brain notice, never open work.
//
// D1 buys that invisibility with absence rather than with suppression. A style
// note writes no vault file and makes no vault commit, so the six surfaces that
// count or list `{>>...<<}` comments (the reader, the Area badge, the worker
// prompt, the For Julian rows, the comments listing, and the notice) need no
// change and cannot regress.
//
// D2 puts the corpus in one append-only JSONL file beside the other root-level
// logs in ~/.tangent. Every entry is a fact at the moment of writing: it carries
// a snapshot of the annotated words, so the note survives the rewrite it caused,
// which is the whole point of "if they still exist". No field is a live pointer,
// and nothing repairs a stale one later.

import { appendFile, readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const STYLE_NOTE_SCHEMA = "tangent.style-note.v1";

/** One line's observation stays short enough that an interleaved append is unlikely. */
const NOTE_MAX_CHARS = 1000;
/** The annotated words are the load-bearing field, so they get more room than the note. */
const QUOTE_MAX_CHARS = 2000;
const TAG_MAX_CHARS = 40;
const TAGS_MAX = 10;

/**
 * Why an author is unknown, or that it is known. The value is auditable, so a
 * harvest can tell a missing trailer from a missing quote and never has to
 * guess which. `no-blame` covers a vault with no usable git answer for the
 * line: no repository, an untracked file, or a line past the end.
 */
export const AUTHOR_SOURCES = new Set(["blame-trailer", "no-trailer", "quote-not-found", "unknown-session", "no-blame"]);

/** Collapses whitespace and clips to a cap, so one entry is always one short line. */
function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Keeps the annotated words as the reader showed them, only capped. */
function clipQuote(value) {
  const text = String(value ?? "").trim();
  return text.length <= QUOTE_MAX_CHARS ? text : `${text.slice(0, QUOTE_MAX_CHARS - 1).trimEnd()}…`;
}

/** A free-text tag reduced to one comparable token (D9 keeps the vocabulary open). */
function normalizeTag(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, TAG_MAX_CHARS);
}

/** The launch facts of one harness run, or null when they are not known. */
function normalizeLaunch(launch) {
  const harness = String(launch?.harness ?? "").trim();
  const model = String(launch?.model ?? "").trim();
  const effort = String(launch?.effort ?? "").trim();
  return harness || model || effort ? { harness: harness || null, model: model || null, effort: effort || null } : null;
}

/** The session that filed the note, with its own harness facts when it has any. */
function normalizeObserver(observer) {
  const kind = String(observer?.kind ?? "julian").trim() || "julian";
  const launch = normalizeLaunch(observer);
  return {
    kind,
    session: String(observer?.session ?? "").trim() || null,
    area: String(observer?.area ?? "").trim() || null,
    harness: launch?.harness ?? null,
    model: launch?.model ?? null,
    effort: launch?.effort ?? null,
  };
}

/**
 * Who wrote the annotated words. `known` is false whenever any resolution step
 * failed, and `source` says which one. Provenance is recorded or explicitly
 * null with a reason; it is never inferred (invariant 5).
 */
function normalizeAuthor(author) {
  const source = AUTHOR_SOURCES.has(author?.source) ? author.source : "no-blame";
  const launch = normalizeLaunch(author);
  const known = source === "blame-trailer" && Boolean(launch);
  return {
    known,
    source,
    commit: String(author?.commit ?? "").trim() || null,
    session: String(author?.session ?? "").trim() || null,
    harness: known ? launch.harness : null,
    model: known ? launch.model : null,
    effort: known ? launch.effort : null,
  };
}

/** Where the note was taken, as a fact rather than a pointer that is repaired later. */
function normalizeDocument(document) {
  return {
    file: String(document?.file ?? "").trim(),
    area: String(document?.area ?? "").trim() || null,
    title: String(document?.title ?? "").trim() || null,
    vaultCommit: String(document?.vaultCommit ?? "").trim() || null,
  };
}

/** The snapshot of the annotated words with its locators, or null for a whole-Document note. */
function normalizeQuote(quote) {
  const text = clipQuote(quote?.text);
  if (!text) return null;
  return {
    text,
    line: Number.isInteger(quote?.line) ? quote.line : null,
    heading: String(quote?.heading ?? "").trim() || null,
  };
}

/**
 * Validates one style note and returns the exact line the corpus stores, or
 * `{ error }`. The note text and the Document path are the only required
 * fields, because an observation with no anchor is still worth keeping.
 */
export function buildStyleNote(input, { id = randomUUID(), at = new Date().toISOString() } = {}) {
  const note = clip(input?.note, NOTE_MAX_CHARS);
  if (!note) return { error: "a style note needs the observation text" };
  const document = normalizeDocument(input?.document);
  if (!document.file) return { error: "a style note needs the Document it is about" };
  const tags = [...new Set((Array.isArray(input?.tags) ? input.tags : []).map(normalizeTag).filter(Boolean))].slice(0, TAGS_MAX);
  return {
    entry: {
      schema: STYLE_NOTE_SCHEMA,
      id: String(id),
      at: String(at),
      note,
      tags,
      document,
      quote: normalizeQuote(input?.quote),
      author: normalizeAuthor(input?.author),
      observer: normalizeObserver(input?.observer),
    },
  };
}

/** Keeps only the entries a listing asked for; an absent filter matches everything. */
export function filterStyleNotes(entries, filters = {}) {
  const area = String(filters.area ?? "").trim();
  const file = String(filters.file ?? "").trim();
  const model = String(filters.model ?? "").trim();
  const harness = String(filters.harness ?? "").trim();
  const tag = normalizeTag(filters.tag);
  const since = String(filters.since ?? "").trim();
  return entries.filter((entry) => {
    if (area && entry.document?.area !== area && !String(entry.document?.area ?? "").startsWith(`${area}/`)) return false;
    if (file && entry.document?.file !== file) return false;
    if (model && entry.author?.model !== model) return false;
    if (harness && entry.author?.harness !== harness) return false;
    if (tag && !(entry.tags ?? []).includes(tag)) return false;
    if (since && String(entry.at ?? "") < since) return false;
    return true;
  });
}

/** Counts one field across the corpus, newest counts first, for the deterministic half of D10. */
function countBy(entries, pick) {
  const counts = new Map();
  for (const entry of entries) {
    for (const value of pick(entry)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([value, count]) => ({ value, count }));
}

/**
 * The counts a distillation reads before a model touches the notes: which
 * model and harness wrote badly, which problems repeat, and where. Models
 * describe findings; they never discover them.
 */
export function summarizeStyleNotes(entries) {
  return {
    total: entries.length,
    /** Counts by the model that wrote the annotated words, not the one that noticed. */
    byModel: countBy(entries, (entry) => [entry.author?.model]),
    byHarness: countBy(entries, (entry) => [entry.author?.harness]),
    byTag: countBy(entries, (entry) => entry.tags ?? []),
    byArea: countBy(entries, (entry) => [entry.document?.area]),
    unknownAuthors: entries.filter((entry) => !entry.author?.known).length,
  };
}

/** Reads one JSONL line, or null when it is blank or unparsable. */
function parseLine(line) {
  const text = line.trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    // An array and a bare number both parse. Only a JSON object is an entry.
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Opens the append-only corpus at `file`. The store owns nothing but the file:
 * no HTTP, no git, no vault. A missing file reads as an empty corpus and is
 * created by the first append, because first run must work.
 */
export function createStyleNotes({ file, now = () => new Date().toISOString(), newId = () => randomUUID() }) {
  /** Appends one validated note and returns it, or `{ error }` without writing. */
  async function add(input) {
    const built = buildStyleNote(input, { id: newId(), at: now() });
    if (built.error) return built;
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(built.entry)}\n`);
    return built;
  }

  /**
   * Every entry, newest first, with the number of lines that could not be
   * parsed. An append-only log must survive one bad line, so a corrupt line is
   * counted and skipped rather than thrown.
   */
  async function read(filters = {}) {
    const text = await readFile(file, "utf8").catch(() => "");
    const lines = text.split("\n");
    const entries = [];
    let skipped = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = parseLine(line);
      if (entry) entries.push(entry);
      else skipped += 1;
    }
    const kept = filterStyleNotes(entries, filters).reverse();
    return { entries: kept, skipped, total: entries.length, counts: summarizeStyleNotes(kept) };
  }

  return { add, read, file };
}
