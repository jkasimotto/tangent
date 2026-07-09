import path from "node:path";

import { SearchDB, type EntityRow, type SymbolRow } from "./db.js";
import { readTextLossy, tokenizeText } from "./helpers.js";

export type SearchQueryMode = "precise" | "normal" | "broad";

export type SearchHit = {
  type: "symbol" | "file";
  score: number;
  language: string;
  name: string;
  qualifiedName: string;
  kind?: string;
  path: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  reasons: string[];
  isTest: boolean;
};

export type SearchResults = {
  query: string;
  mode: SearchQueryMode;
  implementationSymbols: SearchHit[];
  implementationFiles: SearchHit[];
  tests: SearchHit[];
};

export type SymbolDetails = {
  qualifiedName: string;
  language: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string;
  calledBy: Array<{ qualifiedName: string; path: string }>;
  calls: Array<{ qualifiedName: string; path: string }>;
  tests: string[];
};

export type CallGraphResult = {
  root?: SymbolDetails;
  direction: "callers" | "callees";
  rows: Array<{ qualifiedName: string; path: string; line: number; evidence: string }>;
};

export type TestResult = {
  target: string;
  rows: Array<{ path: string; confidence: number; evidence: string }>;
};

export type SkeletonResult = {
  path?: string;
  language?: string;
  rows: Array<{ kind: string; qualifiedName: string; startLine: number; endLine: number; signature?: string; parentSymbolId?: number }>;
};

export type OpenPlanResult = {
  paths: string[];
};

export type SearchStatus = {
  dbPath: string;
  exists: boolean;
  root?: string;
  version?: string;
  indexedAt?: string;
  languages: Array<{ language: string; files: number; symbols: number }>;
  ftsEnabled?: boolean;
};

/** Searches db. */
export function searchDb(dbPath: string, query: string, options: { mode: SearchQueryMode; maxResults?: number; languages?: string[]; includeTests?: boolean }): SearchResults {
  const db = openDb(dbPath);
  const limit = options.maxResults || modeLimit(options.mode);
  const rows = searchEntities(db, query, options.languages, limit);
  const scored: Array<{ score: number; row: EntityRow; reasons: string[] }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let [score, reasons] = scoreEntity(row, query);
    if (row.entity_type === "symbol") score += relatedBoost(db, row.entity_id);
    if (score > 0) scored.push({ score, row, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const implementationSymbols: SearchHit[] = [];
  const implementationFiles: SearchHit[] = [];
  const tests: SearchHit[] = [];
  for (const item of scored) {
    const hit = hitForEntity(db, item.row, item.score, item.reasons);
    if (!hit) continue;
    if (hit.isTest) tests.push(hit);
    else if (hit.type === "symbol") implementationSymbols.push(hit);
    else implementationFiles.push(hit);
  }
  db.close();
  return {
    query,
    mode: options.mode,
    implementationSymbols: implementationSymbols.slice(0, limit),
    implementationFiles: implementationFiles.slice(0, Math.max(0, limit - implementationSymbols.slice(0, limit).length)),
    tests: options.includeTests || tests.length ? tests.slice(0, Math.min(limit, 8)) : []
  };
}

/** Looks up db. */
export function symbolDb(dbPath: string, name: string, languages?: string[]): SymbolDetails[] {
  const db = openDb(dbPath);
  const rows = findSymbols(db, name, languages).slice(0, 25);
  // Call-graph detail is only useful when the match list is short enough to
  // read; for long fuzzy lists it multiplies output size without helping
  // routing, so hydrate the top rows only.
  const detailed = 5;
  const result = rows.map((row, index) => (index < detailed ? symbolDetails(db, row) : symbolSummary(row)));
  db.close();
  return result;
}

/** Supports the call graph db helper. */
export function callGraphDb(dbPath: string, name: string, incoming: boolean, languages?: string[]): CallGraphResult {
  const db = openDb(dbPath);
  const rootRow = findSymbols(db, name, languages)[0];
  if (!rootRow) {
    db.close();
    return { direction: incoming ? "callers" : "callees", rows: [] };
  }
  const rows = incoming
    ? db.conn.prepare("SELECT fs.qualified_name AS qualifiedName, ff.path AS path, fs.start_line AS line, e.evidence AS evidence FROM edges e JOIN symbols fs ON fs.id=e.from_symbol_id JOIN files ff ON ff.id=fs.file_id WHERE e.to_symbol_id=? AND e.kind='calls' ORDER BY e.confidence DESC LIMIT 80").all(rootRow.id)
    : db.conn.prepare("SELECT ts.qualified_name AS qualifiedName, tf.path AS path, ts.start_line AS line, e.evidence AS evidence FROM edges e JOIN symbols ts ON ts.id=e.to_symbol_id JOIN files tf ON tf.id=ts.file_id WHERE e.from_symbol_id=? AND e.kind='calls' ORDER BY e.confidence DESC LIMIT 80").all(rootRow.id);
  const root = symbolDetails(db, rootRow);
  db.close();
  return { root, direction: incoming ? "callers" : "callees", rows: rows as CallGraphResult["rows"] };
}

/** Supports the tests db helper. */
export function testsDb(dbPath: string, target: string, languages?: string[]): TestResult {
  const db = openDb(dbPath);
  const fileRow = db.conn.prepare("SELECT id,path FROM files WHERE path=?").get(target) as { id: number; path: string } | undefined;
  let fileId = fileRow?.id;
  if (!fileId) fileId = findSymbols(db, target, languages)[0]?.file_id;
  if (!fileId) {
    db.close();
    return { target, rows: [] };
  }
  const rows = db.conn.prepare("SELECT tf.path AS path,e.confidence AS confidence,e.evidence AS evidence FROM edges e JOIN files tf ON tf.id=e.from_file_id WHERE e.to_file_id=? AND e.kind='tests' ORDER BY e.confidence DESC LIMIT 30").all(fileId) as TestResult["rows"];
  db.close();
  return { target, rows };
}

/** Builds db. */
export function skeletonDb(dbPath: string, target: string, languages?: string[]): SkeletonResult {
  const db = openDb(dbPath);
  let file = db.conn.prepare("SELECT * FROM files WHERE path=?").get(target) as { id: number; path: string; language: string } | undefined;
  if (!file) {
    const symbol = findSymbols(db, target, languages)[0];
    if (symbol) file = db.conn.prepare("SELECT * FROM files WHERE id=?").get(symbol.file_id) as { id: number; path: string; language: string } | undefined;
  }
  if (!file) {
    db.close();
    return { rows: [] };
  }
  const rows = db.conn.prepare("SELECT kind,qualified_name AS qualifiedName,start_line AS startLine,end_line AS endLine,signature,parent_symbol_id AS parentSymbolId FROM symbols WHERE file_id=? ORDER BY start_line,kind,name").all(file.id) as SkeletonResult["rows"];
  db.close();
  return { path: file.path, language: file.language, rows };
}

/** Supports the open plan db helper. */
export function openPlanDb(dbPath: string, query: string, languages?: string[]): OpenPlanResult {
  const db = openDb(dbPath);
  const rows = searchEntities(db, query, languages, 8);
  const paths: string[] = [];
  for (const row of rows) {
    if (!paths.includes(row.path)) paths.push(row.path);
    if (paths.length >= 5) break;
  }
  db.close();
  return { paths };
}

/** Reports db. */
export function statusDb(dbPath: string): SearchStatus {
  let db: SearchDB | undefined;
  try {
    db = new SearchDB(dbPath);
    db.initSchema(false);
    const fileRows = db.conn.prepare("SELECT language,COUNT(*) AS files FROM files GROUP BY language ORDER BY language").all() as Array<{ language: string; files: number }>;
    const symbolRows = db.conn.prepare("SELECT language,COUNT(*) AS symbols FROM symbols GROUP BY language ORDER BY language").all() as Array<{ language: string; symbols: number }>;
    const symbolsByLanguage = new Map(symbolRows.map((row) => [row.language, row.symbols]));
    const value: SearchStatus = {
      dbPath,
      exists: fileRows.length > 0,
      root: db.getMeta("root"),
      version: db.getMeta("version"),
      indexedAt: db.getMeta("indexed_at"),
      languages: fileRows.map((row) => ({ language: row.language, files: row.files, symbols: symbolsByLanguage.get(row.language) || 0 })),
      ftsEnabled: db.ftsEnabled
    };
    db.close();
    return value;
  } catch {
    db?.close();
    return { dbPath, exists: false, languages: [] };
  }
}

/** Reads skeleton source. */
export async function readSkeletonSource(root: string, skeleton: SkeletonResult): Promise<string | undefined> {
  if (!skeleton.path) return undefined;
  return readTextLossy(path.join(root, skeleton.path));
}

/** Supports the open db helper. */
function openDb(dbPath: string): SearchDB {
  const db = new SearchDB(dbPath);
  db.initSchema(false);
  db.requireIndex();
  return db;
}

/** Supports the mode limit helper. */
function modeLimit(mode: SearchQueryMode): number {
  return mode === "precise" ? 5 : mode === "broad" ? 25 : 10;
}

/** Supports the language clause helper. */
function languageClause(languages?: string[], alias = ""): { sql: string; params: string[] } {
  if (!languages?.length) return { sql: "", params: [] };
  const column = alias ? `${alias}.language` : "language";
  return { sql: ` AND ${column} IN (${languages.map(() => "?").join(",")})`, params: languages };
}

/** Supports the fts query helper. */
function ftsQuery(query: string): string {
  const tokens = tokenizeText(query);
  return tokens.length ? tokens.slice(0, 12).join(" OR ") : query;
}

/** Searches entities. */
function searchEntities(db: SearchDB, query: string, languages: string[] | undefined, maxResults: number): EntityRow[] {
  const lang = languageClause(languages);
  if (db.ftsEnabled) {
    try {
      const rows = db.conn.prepare(`SELECT e.*, bm25(entities_fts) AS rank FROM entities_fts e WHERE entities_fts MATCH ? ${lang.sql} ORDER BY rank LIMIT ?`).all(ftsQuery(query), ...lang.params, maxResults * 4) as EntityRow[];
      if (rows.length) return rows;
    } catch {
      // Fall back to LIKE search below.
    }
  }
  const tokens = tokenizeText(query).slice(0, 8);
  if (!tokens.length) return [];
  const clauses: string[] = [];
  const params: string[] = [];
  for (const token of tokens) {
    const like = `%${token}%`;
    clauses.push("(lower(name) LIKE ? OR lower(qualified_name) LIKE ? OR lower(path) LIKE ? OR lower(signature) LIKE ? OR lower(doc) LIKE ? OR lower(tokens) LIKE ?)");
    params.push(like, like, like, like, like, like);
  }
  return db.conn.prepare(`SELECT * FROM entities WHERE ${clauses.join(" OR ")} ${lang.sql} LIMIT ?`).all(...params, ...lang.params, maxResults * 4) as EntityRow[];
}

/** Supports the score entity helper. */
function scoreEntity(row: EntityRow, query: string): [number, string[]] {
  const tokens = new Set(tokenizeText(query));
  const reasons: string[] = [];
  let score = 0;
  const fields = {
    name: row.name || "",
    qualified_name: row.qualified_name || "",
    path: row.path || "",
    signature: row.signature || "",
    doc: row.doc || ""
  };
  for (const [label, value] of Object.entries(fields)) {
    const hits = [...tokens].filter((token) => value.toLowerCase().includes(token));
    if (!hits.length) continue;
    const weight = label === "name" ? 8 : label === "qualified_name" ? 7 : label === "path" ? 5 : label === "signature" ? 4 : 2;
    score += weight * hits.length;
    reasons.push(`${label.replace("_", " ")} matches ${hits.slice(0, 4).join(", ")}`);
  }
  if ((row.name || "").toLowerCase().includes(query.toLowerCase()) || (row.qualified_name || "").toLowerCase().includes(query.toLowerCase())) {
    score += 12;
    reasons.unshift("exact phrase match");
  }
  if (row.entity_type === "symbol") score += 2;
  return [score, reasons.slice(0, 4)];
}

/** Supports the related boost helper. */
function relatedBoost(db: SearchDB, symbolId: number): number {
  const count = (db.conn.prepare("SELECT COUNT(*) AS c FROM edges WHERE from_symbol_id=? OR to_symbol_id=?").get(symbolId, symbolId) as { c: number }).c;
  return Math.min(3.0, Number(count) * 0.15);
}

/** Supports the hit for entity helper. */
function hitForEntity(db: SearchDB, row: EntityRow, score: number, reasons: string[]): SearchHit | undefined {
  if (row.entity_type === "file") {
    const file = db.conn.prepare("SELECT * FROM files WHERE id=?").get(row.entity_id) as { path: string; language: string; is_test: number } | undefined;
    if (!file) return undefined;
    return { type: "file", score, language: file.language, name: path.posix.basename(file.path), qualifiedName: file.path, path: file.path, reasons, isTest: Boolean(file.is_test) };
  }
  const symbol = db.conn.prepare("SELECT s.*, f.path, f.is_test FROM symbols s JOIN files f ON f.id=s.file_id WHERE s.id=?").get(row.entity_id) as SymbolRow | undefined;
  if (!symbol?.path) return undefined;
  return {
    type: "symbol",
    score,
    language: symbol.language,
    name: symbol.name,
    qualifiedName: symbol.qualified_name,
    kind: symbol.kind,
    path: symbol.path,
    startLine: symbol.start_line,
    endLine: symbol.end_line,
    signature: symbol.signature || undefined,
    reasons,
    isTest: Boolean(symbol.is_test)
  };
}

/** Finds symbols. */
function findSymbols(db: SearchDB, name: string, languages?: string[]): SymbolRow[] {
  const lang = languageClause(languages, "s");
  const exact = db.conn.prepare(`SELECT s.*, f.path FROM symbols s JOIN files f ON f.id=s.file_id WHERE (s.name=? OR s.qualified_name=?) ${lang.sql} ORDER BY s.language,f.path,s.start_line`).all(name, name, ...lang.params) as SymbolRow[];
  if (exact.length) return exact;
  // Fuzzy tier. Match on the symbol's own name so a query like "ToolState"
  // surfaces every *ToolState* declaration instead of one class plus all of
  // its members (each member's qualified name contains the class name).
  // Dotted queries ("Foo.bar") match qualified names.
  const like = `%${name}%`;
  const nameClause = name.includes(".") ? "(s.name LIKE ? OR s.qualified_name LIKE ?)" : "s.name LIKE ?";
  const nameParams = name.includes(".") ? [like, like] : [like];
  const kindRank = `CASE WHEN s.kind IN ('class','interface','mixin','enum','extension','typedef','type') THEN 0
    WHEN s.kind IN ('function','constructor') THEN 1
    WHEN s.kind IN ('method','getter','setter','arrow_function') THEN 2
    ELSE 3 END`;
  return db.conn.prepare(
    `SELECT s.*, f.path FROM symbols s JOIN files f ON f.id=s.file_id WHERE ${nameClause} ${lang.sql}
     ORDER BY CASE WHEN s.visibility='private' THEN 1 ELSE 0 END, ${kindRank},
       CASE WHEN s.name LIKE ? THEN 0 ELSE 1 END, LENGTH(s.name), s.name, f.path LIMIT 50`
  ).all(...nameParams, ...lang.params, `${name}%`) as SymbolRow[];
}

/** Builds details without call-graph hydration for long fuzzy match lists. */
function symbolSummary(symbol: SymbolRow): SymbolDetails {
  return {
    qualifiedName: symbol.qualified_name,
    language: symbol.language,
    kind: symbol.kind,
    path: symbol.path || "",
    startLine: symbol.start_line,
    endLine: symbol.end_line,
    signature: symbol.signature || undefined,
    calledBy: [],
    calls: [],
    tests: []
  };
}

/** Looks up details. */
function symbolDetails(db: SearchDB, symbol: SymbolRow): SymbolDetails {
  const calledBy = db.conn.prepare("SELECT fs.qualified_name AS qualifiedName, ff.path AS path FROM edges e JOIN symbols fs ON fs.id=e.from_symbol_id JOIN files ff ON ff.id=fs.file_id WHERE e.to_symbol_id=? AND e.kind='calls' LIMIT 8").all(symbol.id) as SymbolDetails["calledBy"];
  const calls = db.conn.prepare("SELECT ts.qualified_name AS qualifiedName, tf.path AS path FROM edges e JOIN symbols ts ON ts.id=e.to_symbol_id JOIN files tf ON tf.id=ts.file_id WHERE e.from_symbol_id=? AND e.kind='calls' LIMIT 8").all(symbol.id) as SymbolDetails["calls"];
  const tests = (db.conn.prepare("SELECT tf.path AS path FROM edges e JOIN files tf ON tf.id=e.from_file_id WHERE e.to_file_id=? AND e.kind='tests' LIMIT 8").all(symbol.file_id) as Array<{ path: string }>).map((row) => row.path);
  return {
    qualifiedName: symbol.qualified_name,
    language: symbol.language,
    kind: symbol.kind,
    path: symbol.path || "",
    startLine: symbol.start_line,
    endLine: symbol.end_line,
    signature: symbol.signature || undefined,
    calledBy,
    calls,
    tests
  };
}
