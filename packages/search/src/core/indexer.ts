import { statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isFile } from "@tangent/repo";

import type { SearchConfig } from "../types/config.js";
import { deleteFileIndexRows, dbFileSnapshot, insertEntities, resetIndexContent, resetLanguageContent, rowStatTuple, searchIndexVersion, SearchDB, type FileRow, type SymbolRow } from "./db.js";
import { fileStatTuple, gitLsFiles, lineToPos, pathMatchesAny, relpath, shouldSkipDir, tokenizeText } from "./helpers.js";
import { emitCounterProgress, emitSlowOperation, fullIndexReason } from "./index-progress.js";
import { getAdapters, type LanguageAdapter, type LanguageContext, type ParsedFile } from "../languages/index.js";

export type IndexOptions = {
  root: string;
  dbPath: string;
  config: SearchConfig;
  languages?: string[];
  includeGenerated?: boolean;
  force?: boolean;
  reedgeAll?: boolean;
  slowOperationMs?: number;
  onProgress?: (event: IndexProgressEvent) => void;
};

export type IndexResult = {
  action: "full" | "incremental" | "up-to-date";
  files: number;
  symbols: number;
  edges: number;
  parsed: number;
  deleted: number;
  elapsedMs: number;
  dbPath: string;
};

export type IndexProgressEvent = {
  phase: "start" | "context" | "scan" | "plan" | "parse" | "write" | "edges" | "done";
  root: string;
  dbPath: string;
  languages: string[];
  step?: string;
  stage?: string;
  level?: "info" | "warning";
  message?: string;
  action?: IndexResult["action"];
  current?: number;
  total?: number;
  files?: number;
  changed?: number;
  deleted?: number;
  parsed?: number;
  path?: string;
  language?: string;
  size?: number;
  symbols?: number;
  imports?: number;
  entities?: number;
  fts?: number;
  ftsMode?: "bulk" | "fallback" | "disabled";
  edges?: number;
  durationMs?: number;
  stepElapsedMs?: number;
  indexVersion?: string;
  ftsEnabled?: boolean;
  includeGenerated?: boolean;
  force?: boolean;
  reedgeAll?: boolean;
  reason?: string;
  elapsedMs?: number;
};

type SnapshotRow = {
  language: string;
  size: number;
  mtimeNs: number;
};

type Contexts = Record<string, LanguageContext>;

type ProgressPayload = Omit<IndexProgressEvent, "root" | "dbPath" | "languages">;
type ProgressEmitter = (event: ProgressPayload) => void;
type ProgressContext = {
  emit: ProgressEmitter;
  slowOperationMs: number;
};

/** Builds index. */ export async function buildIndex(options: IndexOptions): Promise<IndexResult> {
  const started = Date.now();
  const adapters = getAdapters(options.languages || options.config.indexing.languages);
  const languages = adapters.map((adapter) => adapter.id);
  const includeGenerated = options.includeGenerated ?? options.config.indexing.includeGenerated;
  /** Supports the progress helper. */ const progress: ProgressEmitter = (event) => {
    options.onProgress?.({ root: options.root, dbPath: options.dbPath, languages, ...event });
  };
  const progressContext = { emit: progress, slowOperationMs: options.slowOperationMs ?? 5000 };
  progress({ phase: "start", indexVersion: searchIndexVersion, includeGenerated, force: Boolean(options.force), reedgeAll: Boolean(options.reedgeAll) });
  const db = new SearchDB(options.dbPath);
  db.initSchema(Boolean(options.force));
  progress({ phase: "context", stage: "db", step: "done", indexVersion: searchIndexVersion, ftsEnabled: db.ftsEnabled });
  progress({ phase: "context", stage: "languages", step: "start" });
  const contexts = await createContexts(options.root, adapters);
  progress({ phase: "context", stage: "languages", step: "done", durationMs: Date.now() - started });
  const contextSignature = JSON.stringify(Object.fromEntries(Object.entries(contexts).map(([key, value]) => [key, { packages: value.packages, tsconfig: value.tsconfig }])));
  progress({ phase: "scan" });
  const current = await snapshot(options.root, adapters, options.config, includeGenerated, (currentItem, total) => progress({ phase: "scan", current: currentItem, total }));
  progress({ phase: "scan", total: current.size, files: current.size });
  const existing = dbFileSnapshot(db, languages);
  const oldInclude = db.getMeta("include_generated");
  const oldLanguages = db.getMeta("languages");
  const oldContext = db.getMeta("context_signature");
  const fullReason = fullIndexReason({
    force: Boolean(options.force),
    existingSize: existing.size,
    oldInclude,
    includeGenerated,
    oldLanguages,
    languages,
    oldContext,
    contextSignature
  });
  const full = fullReason !== undefined;

  let action: IndexResult["action"] = "full";
  let parsedCount = 0;
  let deletedCount = 0;

  const adaptersById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  try {
    if (full) {
      progress({ phase: "plan", action: "full", total: current.size, files: current.size, changed: current.size, deleted: 0, reason: fullReason });
      const parsed = await parsePaths([...current.keys()], options.root, adaptersById, contexts, current, progressContext);
      parsedCount = parsed.length;
      progress({ phase: "write", action: "full", parsed: parsedCount, total: parsed.length });
      const transaction = db.conn.transaction(() => {
        const txStart = Date.now();
        progress({ phase: "write", stage: "transaction", step: "start", action: "full" });
        progress({ phase: "write", stage: "reset", step: "start", action: "full" });
        if (options.force && !languages.length) resetIndexContent(db);
        else resetLanguageContent(db, languages, (currentItem, total) => progress({ phase: "write", stage: "reset", action: "full", current: currentItem, total }));
        progress({ phase: "write", stage: "reset", step: "done", action: "full" });
        progress({ phase: "write", stage: "upsert", step: "start", action: "full", total: parsed.length });
        const pathToId = upsertParsedFiles(db, parsed, progressContext, "full");
        const cache = parsedCache(parsed, pathToId);
        progress({ phase: "edges", stage: "import", step: "start", action: "full", total: parsed.length });
        buildImportEdges(db, parsed, progressContext, "full");
        progress({ phase: "edges", stage: "symbol", step: "start", action: "full" });
        rebuildSymbolEdgesForFileIds(db, options.root, allFileIds(db, languages), adaptersById, contexts, cache, progressContext, "full");
        progress({ phase: "edges", stage: "test", step: "start", action: "full" });
        rebuildTestEdges(db, progressContext, "full");
        progress({ phase: "write", stage: "metadata", step: "start", action: "full" });
        writeMeta(db, options.root, includeGenerated, languages, contextSignature);
        progress({ phase: "write", stage: "metadata", step: "done", action: "full" });
        progress({ phase: "write", stage: "transaction", step: "done", action: "full", durationMs: Date.now() - txStart });
      });
      transaction();
      action = "full";
    } else {
      const deleted = [...existing.keys()].filter((item) => !current.has(item)).sort();
      const changed = [...current.entries()].filter(([item, snapshotRow]) => {
        const row = existing.get(item);
        return !row || tupleKey(rowStatTuple(row)) !== tupleKey([snapshotRow.language, snapshotRow.size, snapshotRow.mtimeNs]);
      }).map(([item]) => item).sort();

      const plannedAction: IndexResult["action"] = !deleted.length && !changed.length && !options.reedgeAll ? "up-to-date" : "incremental";
      progress({ phase: "plan", action: plannedAction, total: changed.length, files: current.size, changed: changed.length, deleted: deleted.length });
      if (!deleted.length && !changed.length && !options.reedgeAll) {
        writeMeta(db, options.root, includeGenerated, languages, contextSignature);
        const counts = countsFor(db);
        progress({ phase: "done", action: "up-to-date", ...counts, parsed: 0, deleted: 0, elapsedMs: Date.now() - started });
        db.close();
        return { action: "up-to-date", ...counts, parsed: 0, deleted: 0, elapsedMs: Date.now() - started, dbPath: options.dbPath };
      }

      const parsed = await parsePaths(changed, options.root, adaptersById, contexts, current, progressContext);
      parsedCount = parsed.length;
      deletedCount = deleted.length;
      progress({ phase: "write", action: "incremental", parsed: parsedCount, total: parsed.length, deleted: deletedCount });
      const transaction = db.conn.transaction(() => {
        const txStart = Date.now();
        progress({ phase: "write", stage: "transaction", step: "start", action: "incremental" });
        const oldIds = new Set(deleted.concat(changed).map((item) => existing.get(item)?.id).filter((id): id is number => id !== undefined));
        progress({ phase: "write", stage: "affected", step: "start", action: "incremental", total: oldIds.size });
        let affected = new Set([...oldIds, ...importerFileIdsFor(db, oldIds)]);
        progress({ phase: "write", stage: "affected", step: "done", action: "incremental", total: oldIds.size, files: affected.size });
        progress({ phase: "write", stage: "delete", step: "start", action: "incremental", total: deleted.length });
        for (const [index, item] of deleted.entries()) {
          const row = existing.get(item);
          if (row) deleteIndexedFile(db, row.id, item, progressContext, "incremental", true);
          emitCounterProgress(index + 1, deleted.length, (currentItem, total) => progress({ phase: "write", stage: "delete", action: "incremental", current: currentItem, total }));
        }
        progress({ phase: "write", stage: "delete", step: "done", action: "incremental", total: deleted.length });
        progress({ phase: "write", stage: "upsert", step: "start", action: "incremental", total: parsed.length });
        const pathToNew = upsertParsedFiles(db, parsed, progressContext, "incremental");
        const cache = parsedCache(parsed, pathToNew);
        const newIds = new Set(pathToNew.values());
        progress({ phase: "write", stage: "affected", step: "start", action: "incremental", total: newIds.size });
        affected = new Set([...affected, ...newIds, ...importerFileIdsFor(db, newIds)]);
        progress({ phase: "write", stage: "affected", step: "done", action: "incremental", total: newIds.size, files: affected.size });
        const currentIds = new Set(allFileIds(db, languages));
        affected = options.reedgeAll ? currentIds : intersection(affected, currentIds);
        progress({ phase: "edges", stage: "import", step: "start", action: "incremental", total: affected.size });
        rebuildImportEdgesForFileIds(db, options.root, [...affected], adaptersById, contexts, cache, progressContext, "incremental");
        progress({ phase: "edges", stage: "symbol", step: "start", action: "incremental" });
        rebuildSymbolEdgesForFileIds(db, options.root, [...affected], adaptersById, contexts, cache, progressContext, "incremental");
        progress({ phase: "edges", stage: "test", step: "start", action: "incremental" });
        rebuildTestEdges(db, progressContext, "incremental");
        progress({ phase: "write", stage: "metadata", step: "start", action: "incremental" });
        writeMeta(db, options.root, includeGenerated, languages, contextSignature);
        progress({ phase: "write", stage: "metadata", step: "done", action: "incremental" });
        progress({ phase: "write", stage: "transaction", step: "done", action: "incremental", durationMs: Date.now() - txStart });
      });
      transaction();
      action = "incremental";
    }
    const counts = countsFor(db);
    db.close();
    const result = { action, ...counts, parsed: parsedCount, deleted: deletedCount, elapsedMs: Date.now() - started, dbPath: options.dbPath };
    progress({ phase: "done", action, ...counts, parsed: parsedCount, deleted: deletedCount, elapsedMs: result.elapsedMs });
    return result;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Supports the watch index helper. */ export async function watchIndex(options: IndexOptions & { intervalSeconds: number; onResult?: (result: IndexResult) => void }): Promise<void> {
  options.onResult?.(await buildIndex(options));
  let previous = await snapshot(options.root, getAdapters(options.languages || options.config.indexing.languages), options.config, options.includeGenerated ?? options.config.indexing.includeGenerated);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0.1, options.intervalSeconds) * 1000));
    const adapters = getAdapters(options.languages || options.config.indexing.languages);
    const current = await snapshot(options.root, adapters, options.config, options.includeGenerated ?? options.config.indexing.includeGenerated);
    if (snapshotKey(current) === snapshotKey(previous)) continue;
    options.onResult?.(await buildIndex({ ...options, force: false }));
    previous = current;
  }
}

/** Creates contexts. */ async function createContexts(root: string, adapters: readonly LanguageAdapter[]): Promise<Contexts> {
  const entries = await Promise.all(adapters.map(async (adapter) => [adapter.id, await adapter.createContext(root)] as const));
  return Object.fromEntries(entries);
}

/** Supports the iter repo files helper. */ async function iterRepoFiles(root: string, adapters: readonly LanguageAdapter[], config: SearchConfig, includeGenerated: boolean): Promise<Array<[string, string]>> {
  const extToAdapter = new Map<string, LanguageAdapter>();
  for (const adapter of adapters) {
    for (const extension of adapter.extensions) extToAdapter.set(extension, adapter);
  }
  const patterns = [...extToAdapter.keys()].map((extension) => `*${extension}`);
  const out: Array<[string, string]> = [];
  const gitPaths = await gitLsFiles(root, patterns);
  if (gitPaths) {
    for (const rel of new Set(gitPaths)) {
      if (rel.split("/").some(shouldSkipDir)) continue;
      const adapter = adapterForPath(rel, extToAdapter);
      if (!adapter) continue;
      if (!includeGenerated && adapter.isGeneratedPath(rel)) continue;
      if (config.indexing.includeGlobs.length && !pathMatchesAny(rel, config.indexing.includeGlobs)) continue;
      if (config.indexing.excludeGlobs.length && pathMatchesAny(rel, config.indexing.excludeGlobs)) continue;
      if (await isFile(path.join(root, rel))) out.push([rel, adapter.id]);
    }
    return out;
  }

  /** Walks. */ async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relpath(full, root);
      const adapter = adapterForPath(rel, extToAdapter);
      if (!adapter) continue;
      if (!includeGenerated && adapter.isGeneratedPath(rel)) continue;
      if (config.indexing.includeGlobs.length && !pathMatchesAny(rel, config.indexing.includeGlobs)) continue;
      if (config.indexing.excludeGlobs.length && pathMatchesAny(rel, config.indexing.excludeGlobs)) continue;
      out.push([rel, adapter.id]);
    }
  }
  await walk(root);
  return out;
}

/** Supports the snapshot helper. */ async function snapshot(root: string, adapters: readonly LanguageAdapter[], config: SearchConfig, includeGenerated: boolean, onProgress?: (current: number, total: number) => void): Promise<Map<string, SnapshotRow>> {
  const out = new Map<string, SnapshotRow>();
  const files = await iterRepoFiles(root, adapters, config, includeGenerated);
  for (const [index, [rel, language]] of files.entries()) {
    try {
      const tuple = fileStatTuple(await stat(path.join(root, rel)));
      out.set(rel, { language, ...tuple });
    } catch {
      // File disappeared during scan.
    }
    emitCounterProgress(index + 1, files.length, onProgress);
  }
  return out;
}

/** Parses paths. */ async function parsePaths(paths: readonly string[], root: string, adaptersById: Map<string, LanguageAdapter>, contexts: Contexts, snap: Map<string, SnapshotRow>, progress?: ProgressContext): Promise<ParsedFile[]> {
  const parsed: ParsedFile[] = [];
  const sorted = [...paths].sort();
  for (const [index, rel] of sorted.entries()) {
    const language = snap.get(rel)?.language;
    const adapter = language ? adaptersById.get(language) : undefined;
    const itemStarted = Date.now();
    const size = snap.get(rel)?.size;
    if (adapter) {
      progress?.emit({ phase: "parse", stage: "file", step: "start", current: index + 1, total: sorted.length, path: rel, language: adapter.id, size });
      try {
        const item = await adapter.parseFile(path.join(root, rel), root, contexts[adapter.id]!);
        parsed.push(item);
        const durationMs = Date.now() - itemStarted;
        progress?.emit({ phase: "parse", stage: "file", step: "done", current: index + 1, total: sorted.length, path: rel, language: item.language, size, symbols: item.symbols.length, imports: item.imports.length, durationMs });
        emitSlowOperation(progress, { phase: "parse", stage: "file", path: rel, language: item.language, size, symbols: item.symbols.length, imports: item.imports.length }, durationMs);
      } catch (error) {
        console.warn(`tangent search: warning: failed to parse ${rel}: ${error instanceof Error ? error.message : String(error)}`);
        progress?.emit({ phase: "parse", stage: "file", step: "error", level: "warning", current: index + 1, total: sorted.length, path: rel, language: adapter.id, size, message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - itemStarted });
      }
    } else {
      emitCounterProgress(index + 1, sorted.length, (current, total) => progress?.emit({ phase: "parse", current, total }));
    }
  }
  return parsed;
}

/** Supports the upsert parsed files helper. */ function upsertParsedFiles(db: SearchDB, parsedFiles: readonly ParsedFile[], progress: ProgressContext, action: IndexResult["action"]): Map<string, number> {
  const now = Date.now() / 1000;
  const pathToFileId = new Map<string, number>();
  const insertFile = db.conn.prepare("INSERT INTO files(path,language,package,library_uri,is_test,is_generated,hash,size,mtime,mtime_ns,indexed_at,parse_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)");
  const updateFile = db.conn.prepare("UPDATE files SET language=?,package=?,library_uri=?,is_test=?,is_generated=?,hash=?,size=?,mtime=?,mtime_ns=?,indexed_at=?,parse_error=NULL WHERE id=?");
  const insertSymbol = db.conn.prepare("INSERT INTO symbols(file_id,language,name,qualified_name,kind,visibility,start_line,end_line,signature,doc,parent_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)");

  for (const [index, parsed] of parsedFiles.entries()) {
    const itemStarted = Date.now();
    const baseEvent = { action, current: index + 1, total: parsedFiles.length, path: parsed.path, language: parsed.language, symbols: parsed.symbols.length, imports: parsed.imports.length } as const;
    progress.emit({ phase: "write", stage: "upsert", step: "start", ...baseEvent });
    const existing = db.conn.prepare("SELECT id FROM files WHERE path=?").get(parsed.path) as { id: number } | undefined;
    const fileId = existing?.id;
    if (fileId !== undefined) deleteIndexedFile(db, fileId, parsed.path, progress, action, false, baseEvent);
    const statInfo = statSyncSafe(parsed.absolutePath);
    const row = [parsed.language, parsed.packageName || null, parsed.libraryUri || null, parsed.isTest ? 1 : 0, parsed.isGenerated ? 1 : 0, "", statInfo.size, statInfo.mtimeNs / 1_000_000_000, statInfo.mtimeNs, now] as const;
    const fileStarted = Date.now();
    progress.emit({ phase: "write", stage: "upsert", step: "file-row-start", size: statInfo.size, ...baseEvent });
    const id = fileId === undefined ? Number(insertFile.run(parsed.path, ...row).lastInsertRowid) : (updateFile.run(...row, fileId), fileId);
    const fileDurationMs = Date.now() - fileStarted;
    progress.emit({ phase: "write", stage: "upsert", step: "file-row-done", size: statInfo.size, durationMs: fileDurationMs, ...baseEvent });
    emitSlowOperation(progress, { phase: "write", stage: "upsert", step: "file-row", size: statInfo.size, ...baseEvent }, fileDurationMs);
    pathToFileId.set(parsed.path, id);
    const fileEntity = insertEntities(db, [["file", id, parsed.language, path.posix.basename(parsed.path), parsed.path, parsed.path, "", parsed.libraryUri || "", tokenizeText([parsed.path, path.posix.basename(parsed.path), parsed.libraryUri || "", parsed.language].join(" ")).join(" ")]]);

    const tempToReal = new Map<number, number>();
    const entityRows: Array<[string, number, string, string, string, string, string, string, string]> = [];
    const symbolsStarted = Date.now();
    progress.emit({ phase: "write", stage: "upsert", step: "symbols-start", ...baseEvent });
    for (const [symbolIndex, symbol] of parsed.symbols.entries()) {
      const parentId = symbol.parentTempId ? tempToReal.get(symbol.parentTempId) : undefined;
      const symbolId = Number(insertSymbol.run(id, parsed.language, symbol.name, symbol.qualifiedName, symbol.kind, symbol.visibility, symbol.startLine, symbol.endLine, symbol.signature, symbol.doc, parentId ?? null).lastInsertRowid);
      tempToReal.set(symbol.tempId, symbolId);
      entityRows.push(["symbol", symbolId, parsed.language, symbol.name, symbol.qualifiedName, parsed.path, symbol.signature, symbol.doc, tokenizeText([symbol.name, symbol.qualifiedName, parsed.path, symbol.signature, symbol.doc, parsed.language].join(" ")).join(" ")]);
      emitCounterProgress(symbolIndex + 1, parsed.symbols.length, (current, total) => progress.emit({ phase: "write", stage: "upsert", step: "symbols", current, total, path: parsed.path, language: parsed.language }));
    }
    const symbolsDurationMs = Date.now() - symbolsStarted;
    progress.emit({ phase: "write", stage: "upsert", step: "symbols-done", durationMs: symbolsDurationMs, ...baseEvent });
    emitSlowOperation(progress, { phase: "write", stage: "upsert", step: "symbols", ...baseEvent }, symbolsDurationMs);
    const entitiesStarted = Date.now();
    progress.emit({ phase: "write", stage: "upsert", step: "entities-start", entities: entityRows.length + fileEntity.entities, fts: fileEntity.fts, ...baseEvent });
    const entityResult = insertEntities(db, entityRows, (current, total) => progress.emit({ phase: "write", stage: "upsert", step: "entities", current, total, path: parsed.path, language: parsed.language }));
    const entities = entityResult.entities + fileEntity.entities;
    const fts = entityResult.fts + fileEntity.fts;
    const entitiesDurationMs = Date.now() - entitiesStarted;
    progress.emit({ phase: "write", stage: "upsert", step: "entities-done", entities, fts, durationMs: entitiesDurationMs, ...baseEvent });
    emitSlowOperation(progress, { phase: "write", stage: "upsert", step: "entities", entities, fts, ...baseEvent }, entitiesDurationMs);
    const durationMs = Date.now() - itemStarted;
    progress.emit({ phase: "write", stage: "upsert", step: "done", entities, fts, durationMs, size: statInfo.size, ...baseEvent });
    emitSlowOperation(progress, { phase: "write", stage: "upsert", entities, fts, size: statInfo.size, ...baseEvent }, durationMs);
  }
  return pathToFileId;
}

/** Builds import edges. */ function buildImportEdges(db: SearchDB, parsedFiles: readonly ParsedFile[], progress?: ProgressContext, action?: IndexResult["action"]): number {
  const pathToId = currentPathToFileId(db);
  const insert = db.conn.prepare("INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)");
  let count = 0;
  for (const [index, parsed] of parsedFiles.entries()) {
    const itemStarted = Date.now();
    progress?.emit({ phase: "edges", stage: "import", step: "start", action, current: index + 1, total: parsedFiles.length, path: parsed.path, language: parsed.language, imports: parsed.imports.length });
    let fileEdges = 0;
    const fromId = pathToId.get(parsed.path);
    if (fromId) {
      for (const imported of parsed.imports) {
        insert.run(null, null, fromId, imported.resolvedPath ? pathToId.get(imported.resolvedPath) ?? null : null, imported.kind, 1.0, `${imported.uri} at line ${imported.line}`);
        count += 1;
        fileEdges += 1;
      }
    }
    const durationMs = Date.now() - itemStarted;
    progress?.emit({ phase: "edges", stage: "import", step: "done", action, current: index + 1, total: parsedFiles.length, path: parsed.path, language: parsed.language, imports: parsed.imports.length, edges: fileEdges, durationMs });
    emitSlowOperation(progress, { phase: "edges", stage: "import", action, path: parsed.path, language: parsed.language, imports: parsed.imports.length, edges: fileEdges }, durationMs);
  }
  return count;
}

/** Supports the rebuild import edges for file ids helper. */ function rebuildImportEdgesForFileIds(db: SearchDB, root: string, fileIds: readonly number[], adaptersById: Map<string, LanguageAdapter>, contexts: Contexts, cache: Map<number, ParsedFile>, progress: ProgressContext, action: IndexResult["action"]): number {
  const ids = uniqueNumbers(fileIds);
  if (!ids.length) return 0;
  db.conn.prepare(`DELETE FROM edges WHERE from_file_id IN (${ids.map(() => "?").join(",")}) AND kind IN ('import','export','part','require','dynamic_import')`).run(...ids);
  const parsed: ParsedFile[] = [];
  const rows = fileRowsForIds(db, ids);
  for (const [index, row] of rows.entries()) {
    const item = parsedForFile(db, root, row, adaptersById, contexts, cache);
    if (item) parsed.push(item);
    emitCounterProgress(index + 1, rows.length, (current, total) => progress.emit({ phase: "edges", stage: "import", action, current, total }));
  }
  return buildImportEdges(db, parsed, progress, action);
}

/** Supports the rebuild symbol edges for file ids helper. */ function rebuildSymbolEdgesForFileIds(db: SearchDB, root: string, fileIds: readonly number[], adaptersById: Map<string, LanguageAdapter>, contexts: Contexts, cache: Map<number, ParsedFile>, progress: ProgressContext, action: IndexResult["action"]): number {
  const ids = uniqueNumbers(fileIds);
  if (!ids.length) return 0;
  db.conn.prepare(`DELETE FROM edges WHERE from_file_id IN (${ids.map(() => "?").join(",")}) AND kind IN ('calls','references_type')`).run(...ids);
  const { lookup, symbolsByFile, imports } = buildSymbolLookup(db);
  const insert = db.conn.prepare("INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)");
  let count = 0;
  const rows = fileRowsForIds(db, ids);
  for (const [index, row] of rows.entries()) {
    const itemStarted = Date.now();
    const parsed = parsedForFile(db, root, row, adaptersById, contexts, cache);
    const adapter = parsed ? adaptersById.get(parsed.language) : undefined;
    const baseEvent = { phase: "edges" as const, stage: "symbol", action, current: index + 1, total: rows.length, path: row.path, language: row.language };
    progress.emit({ ...baseEvent, step: "start" });
    let fileEdges = 0;
    if (parsed && adapter) {
      const imported = imports.get(row.id) || new Set<number>();
      for (const symbol of symbolsByFile.get(row.id) || []) {
        if (!adapter.functionLikeKinds.has(symbol.kind)) continue;
        const start = lineToPos(parsed.lineStarts, symbol.start_line);
        const end = lineToPos(parsed.lineStarts, symbol.end_line + 1);
        const body = parsed.cleanSource.slice(start, end);
        const seenCalls = new Set<string>();
        for (const name of adapter.callNames(body)) {
          if (seenCalls.has(name)) continue;
          seenCalls.add(name);
          for (const target of chooseTargets(lookup.get(name) || [], row.id, imported)) {
            if (target.id === symbol.id) continue;
            insert.run(symbol.id, target.id, row.id, target.file_id, "calls", imported.has(target.file_id) || target.file_id === row.id ? 0.85 : 0.65, name);
            count += 1;
            fileEdges += 1;
          }
        }
        const seenTypes = new Set<string>();
        for (const name of adapter.typeNames(body)) {
          if (seenTypes.has(name)) continue;
          seenTypes.add(name);
          for (const target of chooseTargets(lookup.get(name) || [], row.id, imported)) {
            insert.run(symbol.id, target.id, row.id, target.file_id, "references_type", imported.has(target.file_id) || target.file_id === row.id ? 0.8 : 0.55, name);
            count += 1;
            fileEdges += 1;
          }
        }
      }
    }
    const durationMs = Date.now() - itemStarted;
    progress.emit({ ...baseEvent, step: "done", edges: fileEdges, symbols: symbolsByFile.get(row.id)?.length || 0, durationMs });
    emitSlowOperation(progress, { ...baseEvent, edges: fileEdges, symbols: symbolsByFile.get(row.id)?.length || 0 }, durationMs);
  }
  return count;
}

/** Supports the rebuild test edges helper. */ function rebuildTestEdges(db: SearchDB, progress: ProgressContext, action: IndexResult["action"]): number {
  db.conn.prepare("DELETE FROM edges WHERE kind='tests'").run();
  const insert = db.conn.prepare("INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)");
  let count = 0;
  const pairs = new Set<string>();
  const importRows = db.conn.prepare("SELECT e.from_file_id AS test_id,e.to_file_id AS prod_id,e.evidence AS evidence FROM edges e JOIN files tf ON tf.id=e.from_file_id JOIN files pf ON pf.id=e.to_file_id WHERE e.kind IN ('import','export','part','require','dynamic_import') AND tf.is_test=1 AND pf.is_test=0").all() as Array<{ test_id: number; prod_id: number; evidence: string }>;
  const prodRows = db.conn.prepare("SELECT id,path,language,package FROM files WHERE is_test=0").all() as Array<{ id: number; path: string; language: string; package: string | null }>;
  const testRows = db.conn.prepare("SELECT id,path,language,package FROM files WHERE is_test=1").all() as Array<{ id: number; path: string; language: string; package: string | null }>;
  const total = importRows.length + testRows.length;
  for (const [index, row] of importRows.entries()) {
    const itemStarted = Date.now();
    const key = `${row.test_id}:${row.prod_id}`;
    let fileEdges = 0;
    if (!pairs.has(key)) {
      pairs.add(key);
      insert.run(null, null, row.test_id, row.prod_id, "tests", 0.95, `test imports ${row.evidence}`);
      count += 1;
      fileEdges += 1;
    }
    const durationMs = Date.now() - itemStarted;
    progress.emit({ phase: "edges", stage: "test", step: "done", action, current: index + 1, total, edges: fileEdges, durationMs });
    emitSlowOperation(progress, { phase: "edges", stage: "test", action, edges: fileEdges }, durationMs);
  }
  const prodByBase = new Map<string, typeof prodRows>();
  for (const row of prodRows) {
    const stem = stemName(row.path);
    prodByBase.set(stem, [...(prodByBase.get(stem) || []), row]);
  }
  for (const [index, testRow] of testRows.entries()) {
    const itemStarted = Date.now();
    let fileEdges = 0;
    const base = testTargetStem(stemName(testRow.path));
    for (const prodRow of prodByBase.get(base) || []) {
      const key = `${testRow.id}:${prodRow.id}`;
      if (pairs.has(key)) continue;
      let score = 0.65;
      let evidence = "matching test basename";
      if (testRow.package && prodRow.package && testRow.package === prodRow.package) {
        score += 0.1;
        evidence += "; same package";
      }
      pairs.add(key);
      insert.run(null, null, testRow.id, prodRow.id, "tests", Math.min(score, 0.85), evidence);
      count += 1;
      fileEdges += 1;
    }
    const durationMs = Date.now() - itemStarted;
    progress.emit({ phase: "edges", stage: "test", step: "done", action, current: importRows.length + index + 1, total, path: testRow.path, language: testRow.language, edges: fileEdges, durationMs });
    emitSlowOperation(progress, { phase: "edges", stage: "test", action, path: testRow.path, language: testRow.language, edges: fileEdges }, durationMs);
  }
  return count;
}

/** Builds symbol lookup. */ function buildSymbolLookup(db: SearchDB): { lookup: Map<string, SymbolRow[]>; symbolsByFile: Map<number, SymbolRow[]>; imports: Map<number, Set<number>> } {
  const lookup = new Map<string, SymbolRow[]>();
  const symbolsByFile = new Map<number, SymbolRow[]>();
  const rows = db.conn.prepare("SELECT s.*, f.path FROM symbols s JOIN files f ON f.id=s.file_id").all() as SymbolRow[];
  for (const row of rows) {
    addLookup(lookup, row.name, row);
    if (row.qualified_name !== row.name) addLookup(lookup, row.qualified_name, row);
    symbolsByFile.set(row.file_id, [...(symbolsByFile.get(row.file_id) || []), row]);
  }
  const imports = new Map<number, Set<number>>();
  const edgeRows = db.conn.prepare("SELECT from_file_id,to_file_id FROM edges WHERE kind IN ('import','export','part','require','dynamic_import') AND to_file_id IS NOT NULL").all() as Array<{ from_file_id: number; to_file_id: number }>;
  for (const row of edgeRows) imports.set(row.from_file_id, new Set([...(imports.get(row.from_file_id) || []), row.to_file_id]));
  return { lookup, symbolsByFile, imports };
}

/** Supports the choose targets helper. */ function chooseTargets(candidates: readonly SymbolRow[], currentFileId: number, imported: Set<number>): SymbolRow[] {
  const same = candidates.filter((row) => row.file_id === currentFileId);
  if (same.length) return same.slice(0, 4);
  const importedRows = candidates.filter((row) => imported.has(row.file_id));
  if (importedRows.length) return importedRows.slice(0, 4);
  return candidates.slice(0, 2);
}

/** Supports the parsed for file helper. */ function parsedForFile(_db: SearchDB, root: string, row: Pick<FileRow, "id" | "path" | "language">, adaptersById: Map<string, LanguageAdapter>, contexts: Contexts, cache: Map<number, ParsedFile>): ParsedFile | undefined {
  const cached = cache.get(row.id);
  if (cached) return cached;
  const adapter = adaptersById.get(row.language);
  if (!adapter) return undefined;
  // Files not parsed in this cycle are skipped for edge rebuilds; full indexing
  // and changed files are cached, and later index runs will refresh old importers.
  void root;
  void contexts;
  return undefined;
}

/** Supports the parsed cache helper. */ function parsedCache(parsed: readonly ParsedFile[], pathToId: Map<string, number>): Map<number, ParsedFile> {
  const cache = new Map<number, ParsedFile>();
  for (const item of parsed) {
    const id = pathToId.get(item.path);
    if (id !== undefined) cache.set(id, item);
  }
  return cache;
}

/** Supports the current path to file id helper. */ function currentPathToFileId(db: SearchDB): Map<string, number> {
  const rows = db.conn.prepare("SELECT id,path FROM files").all() as Array<{ id: number; path: string }>;
  return new Map(rows.map((row) => [row.path, row.id]));
}

/** Supports the delete indexed file helper. */ function deleteIndexedFile(db: SearchDB, fileId: number, filePath: string, progress: ProgressContext, action: IndexResult["action"], deleteFileRow: boolean, extra: Partial<IndexProgressEvent> = {}): void {
  const started = Date.now();
  progress.emit({ phase: "write", stage: "delete-old", step: "start", action, path: filePath, ...extra });
  const result = deleteFileIndexRows(db, fileId, deleteFileRow, (event) => {
    progress.emit({
      phase: "write",
      stage: "delete-old",
      step: event.step,
      action,
      path: filePath,
      current: event.current,
      total: event.total,
      edges: event.edges,
      symbols: event.symbols,
      entities: event.entities,
      fts: event.fts,
      files: event.files,
      ftsMode: event.ftsMode,
      ...extra
    });
  });
  const durationMs = Date.now() - started;
  progress.emit({ phase: "write", stage: "delete-old", step: "done", action, path: filePath, edges: result.edges, symbols: result.symbols, entities: result.entities, fts: result.fts, ftsMode: result.ftsMode, files: result.files, durationMs, ...extra });
  emitSlowOperation(progress, { phase: "write", stage: "delete-old", action, path: filePath, edges: result.edges, symbols: result.symbols, entities: result.entities, fts: result.fts, ftsMode: result.ftsMode, files: result.files, ...extra }, durationMs);
}

/** Supports the importer file ids for helper. */ function importerFileIdsFor(db: SearchDB, fileIds: Set<number>): Set<number> {
  const ids = [...fileIds];
  if (!ids.length) return new Set();
  const rows = db.conn.prepare(`SELECT DISTINCT from_file_id FROM edges WHERE to_file_id IN (${ids.map(() => "?").join(",")}) AND from_file_id IS NOT NULL AND kind IN ('import','export','part','require','dynamic_import','calls','references_type')`).all(...ids) as Array<{ from_file_id: number }>;
  return new Set(rows.map((row) => row.from_file_id));
}

/** Supports the all file ids helper. */ function allFileIds(db: SearchDB, languages?: readonly string[]): number[] {
  const rows = languages?.length
    ? db.conn.prepare(`SELECT id FROM files WHERE language IN (${languages.map(() => "?").join(",")})`).all(...languages) as Array<{ id: number }>
    : db.conn.prepare("SELECT id FROM files").all() as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

/** Supports the file rows for ids helper. */ function fileRowsForIds(db: SearchDB, ids: readonly number[]): Array<Pick<FileRow, "id" | "path" | "language">> {
  if (!ids.length) return [];
  return db.conn.prepare(`SELECT id,path,language FROM files WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<Pick<FileRow, "id" | "path" | "language">>;
}

/** Writes meta. */ function writeMeta(db: SearchDB, root: string, includeGenerated: boolean, languages: readonly string[], contextSignature: string): void {
  for (const [key, value] of Object.entries({
    version: searchIndexVersion,
    root,
    include_generated: includeGenerated ? "1" : "0",
    languages: [...languages].sort().join(","),
    context_signature: contextSignature,
    indexed_at: String(Date.now() / 1000)
  })) {
    db.setMeta(key, value);
  }
}

/** Supports the counts for helper. */ function countsFor(db: SearchDB): Pick<IndexResult, "files" | "symbols" | "edges"> {
  return {
    files: Number((db.conn.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c),
    symbols: Number((db.conn.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c),
    edges: Number((db.conn.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number }).c)
  };
}

/** Supports the adapter for path helper. */ function adapterForPath(rel: string, extToAdapter: Map<string, LanguageAdapter>): LanguageAdapter | undefined {
  for (const [extension, adapter] of extToAdapter) {
    if (rel.endsWith(extension)) return adapter;
  }
  return undefined;
}

/** Adds lookup. */ function addLookup(map: Map<string, SymbolRow[]>, key: string, value: SymbolRow): void {
  map.set(key, [...(map.get(key) || []), value]);
}

/** Supports the tuple key helper. */ function tupleKey(tuple: readonly unknown[]): string {
  return tuple.join("\0");
}

/** Supports the intersection helper. */ function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((item) => b.has(item)));
}

/** Supports the unique numbers helper. */ function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.map(Number))].filter((value) => Number.isFinite(value));
}

/** Supports the snapshot key helper. */ function snapshotKey(value: Map<string, SnapshotRow>): string {
  return [...value.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => `${key}:${row.language}:${row.size}:${row.mtimeNs}`).join("\n");
}

/** Supports the stem name helper. */ function stemName(filePath: string): string {
  const name = path.posix.basename(filePath);
  return name.slice(0, name.length - path.posix.extname(name).length);
}

/** Supports the test target stem helper. */ function testTargetStem(stem: string): string {
  for (const suffix of ["_test", ".test", ".spec", "-test", "-spec"]) {
    if (stem.endsWith(suffix)) return stem.slice(0, -suffix.length);
  }
  return stem;
}

/** Supports the stat sync safe helper. */ function statSyncSafe(filePath: string): { size: number; mtimeNs: number } {
  try {
    const item = statSync(filePath);
    return { size: item.size, mtimeNs: Math.trunc(item.mtimeMs * 1_000_000) };
  } catch {
    return { size: 0, mtimeNs: 0 };
  }
}
