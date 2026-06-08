import Database from "better-sqlite3";

export const searchIndexVersion = "0.4.0";

export type FileRow = {
  id: number;
  path: string;
  language: string;
  package: string | null;
  library_uri: string | null;
  is_test: number;
  is_generated: number;
  hash: string | null;
  size: number | null;
  mtime: number | null;
  mtime_ns: number | null;
  indexed_at: number | null;
  parse_error: string | null;
};

export type SymbolRow = {
  id: number;
  file_id: number;
  language: string;
  name: string;
  qualified_name: string;
  kind: string;
  visibility: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  doc: string | null;
  parent_symbol_id: number | null;
  path?: string;
  is_test?: number;
};

export type EntityRow = {
  entity_type: "file" | "symbol";
  entity_id: number;
  language: string;
  name: string | null;
  qualified_name: string | null;
  path: string;
  signature: string | null;
  doc: string | null;
  tokens: string | null;
  rank?: number;
};

export class SearchDB {
  readonly conn: Database.Database;
  ftsEnabled = false;

  constructor(readonly path: string) {
    this.conn = new Database(path);
  }

  close(): void {
    this.conn.close();
  }

  initSchema(reset = false): void {
    if (reset) this.conn.exec("DROP TABLE IF EXISTS meta;DROP TABLE IF EXISTS files;DROP TABLE IF EXISTS symbols;DROP TABLE IF EXISTS edges;DROP TABLE IF EXISTS entities;DROP TABLE IF EXISTS entities_fts;");
    this.conn.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA temp_store=MEMORY;
      PRAGMA cache_size=-200000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, language TEXT NOT NULL DEFAULT 'dart', package TEXT, library_uri TEXT, is_test INTEGER NOT NULL DEFAULT 0, is_generated INTEGER NOT NULL DEFAULT 0, hash TEXT, size INTEGER, mtime REAL, mtime_ns INTEGER, indexed_at REAL, parse_error TEXT);
      CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE TABLE IF NOT EXISTS symbols(id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, language TEXT NOT NULL DEFAULT 'dart', name TEXT NOT NULL, qualified_name TEXT NOT NULL, kind TEXT NOT NULL, visibility TEXT NOT NULL, start_line INTEGER, end_line INTEGER, signature TEXT, doc TEXT, parent_symbol_id INTEGER, FOREIGN KEY(file_id) REFERENCES files(id));
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_qname ON symbols(qualified_name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_language ON symbols(language);
      CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY, from_symbol_id INTEGER, to_symbol_id INTEGER, from_file_id INTEGER, to_file_id INTEGER, kind TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0, evidence TEXT);
      CREATE INDEX IF NOT EXISTS idx_edges_from_symbol ON edges(from_symbol_id,kind);
      CREATE INDEX IF NOT EXISTS idx_edges_to_symbol ON edges(to_symbol_id,kind);
      CREATE INDEX IF NOT EXISTS idx_edges_from_file ON edges(from_file_id,kind);
      CREATE INDEX IF NOT EXISTS idx_edges_to_file ON edges(to_file_id,kind);
      CREATE TABLE IF NOT EXISTS entities(entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, language TEXT NOT NULL, name TEXT, qualified_name TEXT, path TEXT, signature TEXT, doc TEXT, tokens TEXT, PRIMARY KEY(entity_type,entity_id));
      CREATE INDEX IF NOT EXISTS idx_entities_language ON entities(language);
      CREATE INDEX IF NOT EXISTS idx_entities_path ON entities(path);
    `);
    try {
      this.conn.exec("CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, language UNINDEXED, name, qualified_name, path, signature, doc, tokens)");
      this.ftsEnabled = true;
    } catch {
      this.ftsEnabled = false;
    }
  }

  setMeta(key: string, value: string): void {
    this.conn.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)").run(key, value);
  }

  getMeta(key: string): string | undefined {
    return (this.conn.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }

  requireIndex(): void {
    const hasFiles = this.conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get();
    if (!hasFiles) throw new Error("search index not found. Run: tangent search index");
    const count = (this.conn.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
    if (count === 0) throw new Error("search index is empty. Run: tangent search index");
  }
}

export function rowStatTuple(row: FileRow): [string, number, number] {
  return [row.language || "", Number(row.size || 0), row.mtime_ns === null || row.mtime_ns === undefined ? Math.trunc(Number(row.mtime || 0) * 1_000_000_000) : Number(row.mtime_ns)];
}

export function dbFileSnapshot(db: SearchDB, languages?: readonly string[]): Map<string, FileRow> {
  const rows = languages?.length
    ? db.conn.prepare(`SELECT id,path,language,size,mtime,mtime_ns,is_generated,package,library_uri,is_test,hash,indexed_at,parse_error FROM files WHERE language IN (${languages.map(() => "?").join(",")})`).all(...languages) as FileRow[]
    : db.conn.prepare("SELECT id,path,language,size,mtime,mtime_ns,is_generated,package,library_uri,is_test,hash,indexed_at,parse_error FROM files").all() as FileRow[];
  return new Map(rows.map((row) => [row.path, row]));
}

export function deleteFileIndexRows(db: SearchDB, fileId: number, deleteFileRow: boolean): void {
  db.conn.prepare("DELETE FROM edges WHERE from_file_id=? OR to_file_id=?").run(fileId, fileId);
  const symbolRows = db.conn.prepare("SELECT id FROM symbols WHERE file_id=?").all(fileId) as Array<{ id: number }>;
  for (const row of symbolRows) deleteEntity(db, "symbol", row.id);
  deleteEntity(db, "file", fileId);
  db.conn.prepare("DELETE FROM symbols WHERE file_id=?").run(fileId);
  if (deleteFileRow) db.conn.prepare("DELETE FROM files WHERE id=?").run(fileId);
}

export function resetLanguageContent(db: SearchDB, languages: readonly string[]): void {
  if (!languages.length) return;
  const rows = db.conn.prepare(`SELECT id FROM files WHERE language IN (${languages.map(() => "?").join(",")})`).all(...languages) as Array<{ id: number }>;
  for (const row of rows) deleteFileIndexRows(db, row.id, true);
}

export function resetIndexContent(db: SearchDB): void {
  db.conn.exec("DELETE FROM edges;DELETE FROM symbols;DELETE FROM files;DELETE FROM entities;");
  if (db.ftsEnabled) {
    try {
      db.conn.prepare("DELETE FROM entities_fts").run();
    } catch {
      // Older/broken FTS tables are ignored and rebuilt on insert.
    }
  }
}

export function insertEntities(db: SearchDB, rows: Array<[string, number, string, string, string, string, string, string, string]>): void {
  if (!rows.length) return;
  const insert = db.conn.prepare("INSERT OR REPLACE INTO entities(entity_type,entity_id,language,name,qualified_name,path,signature,doc,tokens) VALUES (?,?,?,?,?,?,?,?,?)");
  const insertFts = db.ftsEnabled ? db.conn.prepare("INSERT INTO entities_fts(entity_type,entity_id,language,name,qualified_name,path,signature,doc,tokens) VALUES (?,?,?,?,?,?,?,?,?)") : undefined;
  for (const row of rows) {
    insert.run(...row);
    if (insertFts) insertFts.run(...row);
  }
}

function deleteEntity(db: SearchDB, type: "file" | "symbol", id: number): void {
  db.conn.prepare("DELETE FROM entities WHERE entity_type=? AND entity_id=?").run(type, id);
  if (db.ftsEnabled) {
    try {
      db.conn.prepare("DELETE FROM entities_fts WHERE entity_type=? AND entity_id=?").run(type, id);
    } catch {
      // FTS delete support can vary with SQLite builds.
    }
  }
}
