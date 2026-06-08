use anyhow::{anyhow, Context, Result};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

const VERSION: &str = "0.4.0-rust";

#[derive(Debug, Deserialize)]
struct SearchConfig {
    indexing: IndexingConfig,
}

#[derive(Debug, Deserialize)]
struct IndexingConfig {
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default, rename = "includeGenerated")]
    include_generated: bool,
    #[serde(default, rename = "includeGlobs")]
    include_globs: Vec<String>,
    #[serde(default, rename = "excludeGlobs")]
    exclude_globs: Vec<String>,
}

#[derive(Debug)]
struct Cli {
    command: String,
    values: HashMap<String, String>,
    flags: HashSet<String>,
}

#[derive(Debug, Clone)]
struct FileCandidate {
    rel: String,
    language: String,
    size: i64,
    mtime_ns: i64,
}

#[derive(Debug, Clone)]
struct ParsedImport {
    kind: String,
    uri: String,
    line: i64,
    resolved_path: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedSymbol {
    temp_id: i64,
    name: String,
    qualified_name: String,
    kind: String,
    visibility: String,
    start_line: i64,
    end_line: i64,
    signature: String,
    doc: String,
    parent_temp_id: Option<i64>,
}

#[derive(Debug, Clone)]
struct ParsedFile {
    language: String,
    path: String,
    absolute_path: PathBuf,
    is_test: bool,
    is_generated: bool,
    package_name: Option<String>,
    library_uri: Option<String>,
    imports: Vec<ParsedImport>,
    symbols: Vec<ParsedSymbol>,
    clean_source: String,
    line_starts: Vec<usize>,
}

#[derive(Debug, Serialize)]
struct IndexResult {
    action: String,
    files: i64,
    symbols: i64,
    edges: i64,
    parsed: usize,
    deleted: usize,
    #[serde(rename = "elapsedMs")]
    elapsed_ms: u128,
    #[serde(rename = "dbPath")]
    db_path: String,
}

#[derive(Debug, Serialize)]
struct SearchHit {
    #[serde(rename = "type")]
    hit_type: String,
    score: f64,
    language: String,
    name: String,
    #[serde(rename = "qualifiedName")]
    qualified_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "startLine")]
    start_line: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "endLine")]
    end_line: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    reasons: Vec<String>,
    #[serde(rename = "isTest")]
    is_test: bool,
}

#[derive(Debug, Serialize)]
struct SearchResults {
    query: String,
    mode: String,
    #[serde(rename = "implementationSymbols")]
    implementation_symbols: Vec<SearchHit>,
    #[serde(rename = "implementationFiles")]
    implementation_files: Vec<SearchHit>,
    tests: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
struct SymbolDetails {
    #[serde(rename = "qualifiedName")]
    qualified_name: String,
    language: String,
    kind: String,
    path: String,
    #[serde(rename = "startLine")]
    start_line: i64,
    #[serde(rename = "endLine")]
    end_line: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(rename = "calledBy")]
    called_by: Vec<NamePath>,
    calls: Vec<NamePath>,
    tests: Vec<String>,
}

#[derive(Debug, Serialize)]
struct NamePath {
    #[serde(rename = "qualifiedName")]
    qualified_name: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct CallGraphResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    root: Option<SymbolDetails>,
    direction: String,
    rows: Vec<CallGraphRow>,
}

#[derive(Debug, Serialize)]
struct CallGraphRow {
    #[serde(rename = "qualifiedName")]
    qualified_name: String,
    path: String,
    line: i64,
    evidence: String,
}

#[derive(Debug, Serialize)]
struct TestResult {
    target: String,
    rows: Vec<TestRow>,
}

#[derive(Debug, Serialize)]
struct TestRow {
    path: String,
    confidence: f64,
    evidence: String,
}

#[derive(Debug, Serialize)]
struct SkeletonResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    rows: Vec<SkeletonRow>,
}

#[derive(Debug, Serialize)]
struct SkeletonRow {
    kind: String,
    #[serde(rename = "qualifiedName")]
    qualified_name: String,
    #[serde(rename = "startLine")]
    start_line: i64,
    #[serde(rename = "endLine")]
    end_line: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "parentSymbolId")]
    parent_symbol_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct OpenPlanResult {
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
struct StatusResult {
    #[serde(rename = "dbPath")]
    db_path: String,
    exists: bool,
    root: Option<String>,
    version: Option<String>,
    #[serde(rename = "indexedAt")]
    indexed_at: Option<String>,
    languages: Vec<LanguageStatus>,
    #[serde(rename = "ftsEnabled")]
    fts_enabled: bool,
}

#[derive(Debug, Serialize)]
struct LanguageStatus {
    language: String,
    files: i64,
    symbols: i64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = parse_cli(env::args().skip(1).collect())?;
    match cli.command.as_str() {
        "index" => print_json(&cmd_index(&cli)?),
        "query" => print_json(&cmd_query(&cli)?),
        "symbol" => print_json(&cmd_symbol(&cli)?),
        "callers" => print_json(&cmd_call_graph(&cli, true)?),
        "callees" => print_json(&cmd_call_graph(&cli, false)?),
        "tests" => print_json(&cmd_tests(&cli)?),
        "skeleton" => print_json(&cmd_skeleton(&cli)?),
        "open-plan" => print_json(&cmd_open_plan(&cli)?),
        "status" => print_json(&cmd_status(&cli)?),
        other => Err(anyhow!("unknown command: {other}")),
    }
}

fn parse_cli(argv: Vec<String>) -> Result<Cli> {
    let command = argv
        .first()
        .cloned()
        .ok_or_else(|| anyhow!("missing command"))?;
    let mut values = HashMap::new();
    let mut flags = HashSet::new();
    let mut index = 1;
    while index < argv.len() {
        let item = &argv[index];
        if !item.starts_with("--") {
            return Err(anyhow!("unexpected positional argument: {item}"));
        }
        let key = item.trim_start_matches("--").to_string();
        let next = argv.get(index + 1);
        if let Some(value) = next {
            if !value.starts_with("--") {
                values.insert(key, value.clone());
                index += 2;
                continue;
            }
        }
        flags.insert(key);
        index += 1;
    }
    Ok(Cli {
        command,
        values,
        flags,
    })
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}

fn required<'a>(cli: &'a Cli, key: &str) -> Result<&'a str> {
    cli.values
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| anyhow!("missing --{key}"))
}

fn optional_list(cli: &Cli, key: &str) -> Vec<String> {
    cli.values
        .get(key)
        .map(|value| {
            value
                .split(',')
                .filter(|item| !item.is_empty())
                .map(|item| item.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn load_config(cli: &Cli) -> Result<SearchConfig> {
    let raw = required(cli, "config-json")?;
    serde_json::from_str(raw).context("invalid --config-json")
}

fn cmd_index(cli: &Cli) -> Result<IndexResult> {
    let started = Instant::now();
    let root = PathBuf::from(required(cli, "root")?);
    let db_path = PathBuf::from(required(cli, "db")?);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let config = load_config(cli)?;
    let languages = requested_languages(cli, &config);
    let include_generated =
        cli.flags.contains("include-generated") || config.indexing.include_generated;
    let force = cli.flags.contains("force");

    let conn = Connection::open(&db_path)?;
    init_schema(&conn, force)?;
    let candidates = scan_files(&root, &languages, include_generated, &config)?;
    if !force && index_is_up_to_date(&conn, &candidates, include_generated, &languages)? {
        write_meta(&conn, &root, include_generated, &languages)?;
        let (files, symbols, edges) = counts(&conn)?;
        return Ok(IndexResult {
            action: "up-to-date".to_string(),
            files,
            symbols,
            edges,
            parsed: 0,
            deleted: 0,
            elapsed_ms: started.elapsed().as_millis(),
            db_path: db_path.to_string_lossy().into_owned(),
        });
    }
    let parsed = parse_files(&root, &candidates)?;

    let tx = conn.unchecked_transaction()?;
    if force {
        reset_index(&tx)?;
    } else {
        reset_languages(&tx, &languages)?;
    }
    let path_to_id = upsert_files(&tx, &parsed)?;
    build_import_edges(&tx, &parsed, &path_to_id)?;
    build_symbol_edges(&tx, &parsed, &path_to_id)?;
    build_test_edges(&tx)?;
    write_meta(&tx, &root, include_generated, &languages)?;
    tx.commit()?;

    let (files, symbols, edges) = counts(&conn)?;
    Ok(IndexResult {
        action: "full".to_string(),
        files,
        symbols,
        edges,
        parsed: parsed.len(),
        deleted: 0,
        elapsed_ms: started.elapsed().as_millis(),
        db_path: db_path.to_string_lossy().into_owned(),
    })
}

fn cmd_query(cli: &Cli) -> Result<SearchResults> {
    let db_path = required(cli, "db")?;
    let query = required(cli, "query")?.to_string();
    let mode = cli
        .values
        .get("mode")
        .cloned()
        .unwrap_or_else(|| "precise".to_string());
    let max_results = cli
        .values
        .get("max-results")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_else(|| mode_limit(&mode));
    let languages = optional_list(cli, "languages");
    let include_tests = cli.flags.contains("include-tests");
    let conn = Connection::open(db_path)?;
    require_index(&conn)?;
    let rows = search_entities(&conn, &query, &languages, max_results)?;
    let mut seen = HashSet::new();
    let mut scored = Vec::new();
    for row in rows {
        let key = format!("{}:{}", row.entity_type, row.entity_id);
        if !seen.insert(key) {
            continue;
        }
        let (mut score, reasons) = score_entity(&row, &query);
        if row.entity_type == "symbol" {
            score += related_boost(&conn, row.entity_id)?;
        }
        if score > 0.0 {
            scored.push((score, row, reasons));
        }
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut implementation_symbols = Vec::new();
    let mut implementation_files = Vec::new();
    let mut tests = Vec::new();
    for (score, row, reasons) in scored {
        if let Some(hit) = hit_for_entity(&conn, &row, score, reasons)? {
            if hit.is_test {
                tests.push(hit);
            } else if hit.hit_type == "symbol" {
                implementation_symbols.push(hit);
            } else {
                implementation_files.push(hit);
            }
        }
    }
    implementation_symbols.truncate(max_results);
    implementation_files.truncate(max_results.saturating_sub(implementation_symbols.len()));
    if include_tests || !tests.is_empty() {
        tests.truncate(max_results.min(8));
    } else {
        tests.clear();
    }
    Ok(SearchResults {
        query,
        mode,
        implementation_symbols,
        implementation_files,
        tests,
    })
}

fn cmd_symbol(cli: &Cli) -> Result<Vec<SymbolDetails>> {
    let conn = Connection::open(required(cli, "db")?)?;
    require_index(&conn)?;
    let name = required(cli, "name")?;
    let languages = optional_list(cli, "languages");
    let rows = find_symbols(&conn, name, &languages)?;
    rows.into_iter()
        .take(20)
        .map(|row| symbol_details(&conn, row))
        .collect()
}

fn cmd_call_graph(cli: &Cli, incoming: bool) -> Result<CallGraphResult> {
    let conn = Connection::open(required(cli, "db")?)?;
    require_index(&conn)?;
    let name = required(cli, "name")?;
    let languages = optional_list(cli, "languages");
    let direction = if incoming { "callers" } else { "callees" }.to_string();
    let Some(symbol) = find_symbols(&conn, name, &languages)?.into_iter().next() else {
        return Ok(CallGraphResult {
            root: None,
            direction,
            rows: Vec::new(),
        });
    };
    let rows = if incoming {
        let mut stmt = conn.prepare("SELECT fs.qualified_name,ff.path,fs.start_line,e.evidence FROM edges e JOIN symbols fs ON fs.id=e.from_symbol_id JOIN files ff ON ff.id=fs.file_id WHERE e.to_symbol_id=? AND e.kind='calls' ORDER BY e.confidence DESC LIMIT 80")?;
        let rows = stmt
            .query_map(params![symbol.id], |row| {
                Ok(CallGraphRow {
                    qualified_name: row.get(0)?,
                    path: row.get(1)?,
                    line: row.get(2)?,
                    evidence: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    } else {
        let mut stmt = conn.prepare("SELECT ts.qualified_name,tf.path,ts.start_line,e.evidence FROM edges e JOIN symbols ts ON ts.id=e.to_symbol_id JOIN files tf ON tf.id=ts.file_id WHERE e.from_symbol_id=? AND e.kind='calls' ORDER BY e.confidence DESC LIMIT 80")?;
        let rows = stmt
            .query_map(params![symbol.id], |row| {
                Ok(CallGraphRow {
                    qualified_name: row.get(0)?,
                    path: row.get(1)?,
                    line: row.get(2)?,
                    evidence: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    Ok(CallGraphResult {
        root: Some(symbol_details(&conn, symbol)?),
        direction,
        rows,
    })
}

fn cmd_tests(cli: &Cli) -> Result<TestResult> {
    let conn = Connection::open(required(cli, "db")?)?;
    require_index(&conn)?;
    let target = required(cli, "target")?.to_string();
    let languages = optional_list(cli, "languages");
    let file_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE path=?",
            params![target],
            |row| row.get(0),
        )
        .optional()?
        .or_else(|| {
            find_symbols(&conn, &target, &languages)
                .ok()
                .and_then(|rows| rows.first().map(|row| row.file_id))
        });
    let rows = if let Some(file_id) = file_id {
        let mut stmt = conn.prepare("SELECT tf.path,e.confidence,e.evidence FROM edges e JOIN files tf ON tf.id=e.from_file_id WHERE e.to_file_id=? AND e.kind='tests' ORDER BY e.confidence DESC LIMIT 30")?;
        let rows = stmt
            .query_map(params![file_id], |row| {
                Ok(TestRow {
                    path: row.get(0)?,
                    confidence: row.get(1)?,
                    evidence: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    } else {
        Vec::new()
    };
    Ok(TestResult { target, rows })
}

fn cmd_skeleton(cli: &Cli) -> Result<SkeletonResult> {
    let conn = Connection::open(required(cli, "db")?)?;
    require_index(&conn)?;
    let target = required(cli, "target")?;
    let languages = optional_list(cli, "languages");
    let file = find_file_for_target(&conn, target, &languages)?;
    if let Some(file) = file {
        let mut stmt = conn.prepare("SELECT kind,qualified_name,start_line,end_line,signature,parent_symbol_id FROM symbols WHERE file_id=? ORDER BY start_line,kind,name")?;
        let rows = stmt
            .query_map(params![file.id], |row| {
                Ok(SkeletonRow {
                    kind: row.get(0)?,
                    qualified_name: row.get(1)?,
                    start_line: row.get(2)?,
                    end_line: row.get(3)?,
                    signature: empty_to_none(row.get::<_, Option<String>>(4)?),
                    parent_symbol_id: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(SkeletonResult {
            path: Some(file.path),
            language: Some(file.language),
            rows,
        })
    } else {
        Ok(SkeletonResult {
            path: None,
            language: None,
            rows: Vec::new(),
        })
    }
}

fn cmd_open_plan(cli: &Cli) -> Result<OpenPlanResult> {
    let conn = Connection::open(required(cli, "db")?)?;
    require_index(&conn)?;
    let query = required(cli, "query")?;
    let languages = optional_list(cli, "languages");
    let rows = search_entities(&conn, query, &languages, 8)?;
    let mut paths = Vec::new();
    for row in rows {
        if row.path.is_empty() || paths.iter().any(|path| path == &row.path) {
            continue;
        }
        paths.push(row.path);
        if paths.len() >= 5 {
            break;
        }
    }
    Ok(OpenPlanResult { paths })
}

fn cmd_status(cli: &Cli) -> Result<StatusResult> {
    let db_path = required(cli, "db")?.to_string();
    let conn = match Connection::open(&db_path) {
        Ok(conn) => conn,
        Err(_) => {
            return Ok(StatusResult {
                db_path,
                exists: false,
                root: None,
                version: None,
                indexed_at: None,
                languages: Vec::new(),
                fts_enabled: false,
            })
        }
    };
    init_schema(&conn, false)?;
    let mut stmt =
        conn.prepare("SELECT language,COUNT(*) FROM files GROUP BY language ORDER BY language")?;
    let file_counts = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut symbols = HashMap::new();
    let mut stmt = conn.prepare("SELECT language,COUNT(*) FROM symbols GROUP BY language")?;
    for item in stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })? {
        let (language, count) = item?;
        symbols.insert(language, count);
    }
    let languages = file_counts
        .into_iter()
        .map(|(language, files)| LanguageStatus {
            symbols: *symbols.get(&language).unwrap_or(&0),
            language,
            files,
        })
        .collect::<Vec<_>>();
    Ok(StatusResult {
        db_path,
        exists: !languages.is_empty(),
        root: get_meta(&conn, "root")?,
        version: get_meta(&conn, "version")?,
        indexed_at: get_meta(&conn, "indexed_at")?,
        languages,
        fts_enabled: true,
    })
}

fn requested_languages(cli: &Cli, config: &SearchConfig) -> Vec<String> {
    let raw = optional_list(cli, "languages");
    let input = if raw.is_empty() {
        if config.indexing.languages.is_empty() {
            vec!["dart".to_string(), "typescript".to_string()]
        } else {
            config.indexing.languages.clone()
        }
    } else {
        raw
    };
    let mut out = Vec::new();
    for item in input {
        let language = match item.as_str() {
            "dart" => "dart",
            "typescript" | "javascript" | "ts" | "js" => "typescript",
            "all" => {
                if !out.iter().any(|item| item == "dart") {
                    out.push("dart".to_string());
                }
                if !out.iter().any(|item| item == "typescript") {
                    out.push("typescript".to_string());
                }
                continue;
            }
            _ => continue,
        };
        if !out.iter().any(|item| item == language) {
            out.push(language.to_string());
        }
    }
    out
}

fn init_schema(conn: &Connection, reset: bool) -> Result<()> {
    if reset {
        conn.execute_batch("DROP TABLE IF EXISTS meta;DROP TABLE IF EXISTS files;DROP TABLE IF EXISTS symbols;DROP TABLE IF EXISTS edges;DROP TABLE IF EXISTS entities;DROP TABLE IF EXISTS entities_fts;")?;
    }
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL,language TEXT NOT NULL DEFAULT 'dart',package TEXT,library_uri TEXT,is_test INTEGER NOT NULL DEFAULT 0,is_generated INTEGER NOT NULL DEFAULT 0,hash TEXT,size INTEGER,mtime REAL,mtime_ns INTEGER,indexed_at REAL,parse_error TEXT);
        CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE TABLE IF NOT EXISTS symbols(id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL,language TEXT NOT NULL DEFAULT 'dart',name TEXT NOT NULL,qualified_name TEXT NOT NULL,kind TEXT NOT NULL,visibility TEXT NOT NULL,start_line INTEGER,end_line INTEGER,signature TEXT,doc TEXT,parent_symbol_id INTEGER,FOREIGN KEY(file_id) REFERENCES files(id));
        CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
        CREATE INDEX IF NOT EXISTS idx_symbols_qname ON symbols(qualified_name);
        CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
        CREATE INDEX IF NOT EXISTS idx_symbols_language ON symbols(language);
        CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY,from_symbol_id INTEGER,to_symbol_id INTEGER,from_file_id INTEGER,to_file_id INTEGER,kind TEXT NOT NULL,confidence REAL NOT NULL DEFAULT 1.0,evidence TEXT);
        CREATE INDEX IF NOT EXISTS idx_edges_from_symbol ON edges(from_symbol_id,kind);
        CREATE INDEX IF NOT EXISTS idx_edges_to_symbol ON edges(to_symbol_id,kind);
        CREATE INDEX IF NOT EXISTS idx_edges_from_file ON edges(from_file_id,kind);
        CREATE INDEX IF NOT EXISTS idx_edges_to_file ON edges(to_file_id,kind);
        CREATE TABLE IF NOT EXISTS entities(entity_type TEXT NOT NULL,entity_id INTEGER NOT NULL,language TEXT NOT NULL,name TEXT,qualified_name TEXT,path TEXT,signature TEXT,doc TEXT,tokens TEXT,PRIMARY KEY(entity_type,entity_id));
        CREATE INDEX IF NOT EXISTS idx_entities_language ON entities(language);
        CREATE INDEX IF NOT EXISTS idx_entities_path ON entities(path);
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(entity_type UNINDEXED,entity_id UNINDEXED,language UNINDEXED,name,qualified_name,path,signature,doc,tokens);
        ",
    )?;
    Ok(())
}

fn reset_index(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM edges;DELETE FROM symbols;DELETE FROM files;DELETE FROM entities;DELETE FROM entities_fts;")?;
    Ok(())
}

fn index_is_up_to_date(
    conn: &Connection,
    candidates: &[FileCandidate],
    include_generated: bool,
    languages: &[String],
) -> Result<bool> {
    let old_include = get_meta(conn, "include_generated")?;
    if old_include.as_deref() != Some(if include_generated { "1" } else { "0" }) {
        return Ok(false);
    }
    let mut sorted_languages = languages.to_vec();
    sorted_languages.sort();
    if get_meta(conn, "languages")?.as_deref() != Some(&sorted_languages.join(",")) {
        return Ok(false);
    }
    let existing = existing_snapshot(conn, languages)?;
    if existing.len() != candidates.len() {
        return Ok(false);
    }
    for candidate in candidates {
        match existing.get(&candidate.rel) {
            Some((language, size, mtime_ns))
                if language == &candidate.language
                    && *size == candidate.size
                    && *mtime_ns == candidate.mtime_ns => {}
            _ => return Ok(false),
        }
    }
    Ok(!existing.is_empty())
}

fn existing_snapshot(
    conn: &Connection,
    languages: &[String],
) -> Result<HashMap<String, (String, i64, i64)>> {
    if languages.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT path,language,size,mtime_ns FROM files WHERE language IN ({})",
        placeholders(languages.len())
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(languages), |row| {
            Ok((
                row.get::<_, String>(0)?,
                (
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                ),
            ))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    Ok(rows)
}

fn reset_languages(conn: &Connection, languages: &[String]) -> Result<()> {
    if languages.is_empty() {
        return Ok(());
    }
    let ids = query_file_ids(conn, languages)?;
    for id in ids {
        delete_file_rows(conn, id, true)?;
    }
    Ok(())
}

fn query_file_ids(conn: &Connection, languages: &[String]) -> Result<Vec<i64>> {
    let sql = format!(
        "SELECT id FROM files WHERE language IN ({})",
        placeholders(languages.len())
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(languages), |row| {
            row.get::<_, i64>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn delete_file_rows(conn: &Connection, file_id: i64, delete_file: bool) -> Result<()> {
    conn.execute(
        "DELETE FROM edges WHERE from_file_id=? OR to_file_id=?",
        params![file_id, file_id],
    )?;
    let mut stmt = conn.prepare("SELECT id FROM symbols WHERE file_id=?")?;
    let symbol_ids = stmt
        .query_map(params![file_id], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for symbol_id in symbol_ids {
        delete_entity(conn, "symbol", symbol_id)?;
    }
    delete_entity(conn, "file", file_id)?;
    conn.execute("DELETE FROM symbols WHERE file_id=?", params![file_id])?;
    if delete_file {
        conn.execute("DELETE FROM files WHERE id=?", params![file_id])?;
    }
    Ok(())
}

fn delete_entity(conn: &Connection, entity_type: &str, entity_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM entities WHERE entity_type=? AND entity_id=?",
        params![entity_type, entity_id],
    )?;
    conn.execute(
        "DELETE FROM entities_fts WHERE entity_type=? AND entity_id=?",
        params![entity_type, entity_id],
    )
    .ok();
    Ok(())
}

fn scan_files(
    root: &Path,
    languages: &[String],
    include_generated: bool,
    config: &SearchConfig,
) -> Result<Vec<FileCandidate>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| should_skip(entry.path()))
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = relpath(path, root);
        let Some(language) = language_for_path(&rel, languages) else {
            continue;
        };
        if !include_generated && is_generated_path(&rel, &language) {
            continue;
        }
        if !config.indexing.include_globs.is_empty()
            && !config
                .indexing
                .include_globs
                .iter()
                .any(|glob| glob_match(&rel, glob))
        {
            continue;
        }
        if config
            .indexing
            .exclude_globs
            .iter()
            .any(|glob| glob_match(&rel, glob))
        {
            continue;
        }
        let metadata = fs::metadata(path)?;
        let mtime_ns = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos() as i64)
            .unwrap_or(0);
        out.push(FileCandidate {
            rel,
            language,
            size: metadata.len() as i64,
            mtime_ns,
        });
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

fn should_skip(path: &Path) -> bool {
    if !path.is_dir() {
        return true;
    }
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    !matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | ".dart_tool"
            | ".idea"
            | ".vscode"
            | "build"
            | "coverage"
            | "dist"
            | "out"
            | "target"
            | "node_modules"
            | ".next"
            | ".nuxt"
            | ".turbo"
            | ".cache"
            | ".parcel-cache"
            | ".pub-cache"
    )
}

fn language_for_path(rel: &str, languages: &[String]) -> Option<String> {
    let language = if rel.ends_with(".dart") {
        "dart"
    } else if [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
        .iter()
        .any(|extension| rel.ends_with(extension))
    {
        "typescript"
    } else {
        return None;
    };
    if languages.iter().any(|item| item == language) {
        Some(language.to_string())
    } else {
        None
    }
}

fn is_generated_path(rel: &str, language: &str) -> bool {
    let lower = rel.to_lowercase();
    if lower.contains("/generated/") || lower.contains("/gen/") || lower.contains("/__generated__/")
    {
        return true;
    }
    if language == "dart" {
        [
            ".g.dart",
            ".freezed.dart",
            ".mocks.dart",
            ".mock.dart",
            ".gr.dart",
            ".pb.dart",
            ".pbenum.dart",
            ".pbjson.dart",
            ".graphql.dart",
            ".config.dart",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    } else {
        [
            ".d.ts",
            ".generated.ts",
            ".generated.tsx",
            ".gen.ts",
            ".gen.tsx",
            ".graphql.ts",
            ".pb.ts",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    }
}

fn parse_files(root: &Path, candidates: &[FileCandidate]) -> Result<Vec<ParsedFile>> {
    let dart_packages = discover_dart_packages(root)?;
    let ts_packages = discover_ts_packages(root)?;
    let mut out = Vec::new();
    for candidate in candidates {
        let absolute = root.join(&candidate.rel);
        let text = fs::read_to_string(&absolute).unwrap_or_else(|_| String::new());
        let parsed = if candidate.language == "dart" {
            parse_dart(
                root,
                &absolute,
                &candidate.rel,
                &text,
                &dart_packages,
                candidate,
            )?
        } else {
            parse_typescript(
                root,
                &absolute,
                &candidate.rel,
                &text,
                &ts_packages,
                candidate,
            )?
        };
        out.push(parsed);
    }
    Ok(out)
}

fn parse_typescript(
    root: &Path,
    absolute: &Path,
    rel: &str,
    text: &str,
    packages: &HashMap<String, String>,
    _candidate: &FileCandidate,
) -> Result<ParsedFile> {
    let clean = strip_comments_and_strings(text);
    let line_starts = line_starts(text);
    let mut imports = Vec::new();
    let import_from = Regex::new(r#"^\s*(import|export)\b.*?\bfrom\s+['"]([^'"]+)['"]"#)?;
    let side_import = Regex::new(r#"^\s*import\s+['"]([^'"]+)['"]"#)?;
    let require = Regex::new(r#"require\s*\(\s*['"]([^'"]+)['"]\s*\)"#)?;
    for (index, line) in text.lines().enumerate() {
        if let Some(caps) = import_from.captures(line) {
            let uri = caps.get(2).unwrap().as_str().to_string();
            imports.push(ParsedImport {
                kind: caps.get(1).unwrap().as_str().to_string(),
                resolved_path: resolve_ts_uri(root, absolute, &uri, packages),
                uri,
                line: index as i64 + 1,
            });
        } else if let Some(caps) = side_import.captures(line) {
            let uri = caps.get(1).unwrap().as_str().to_string();
            imports.push(ParsedImport {
                kind: "import".to_string(),
                resolved_path: resolve_ts_uri(root, absolute, &uri, packages),
                uri,
                line: index as i64 + 1,
            });
        }
        for caps in require.captures_iter(line) {
            let uri = caps.get(1).unwrap().as_str().to_string();
            imports.push(ParsedImport {
                kind: "require".to_string(),
                resolved_path: resolve_ts_uri(root, absolute, &uri, packages),
                uri,
                line: index as i64 + 1,
            });
        }
    }
    let mut symbols = Vec::new();
    let mut temp_id = 1;
    let class_re = Regex::new(
        r#"(?:export\s+default\s+|export\s+)?(?:abstract\s+)?(class|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)"#,
    )?;
    let enum_re = Regex::new(r#"(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)"#)?;
    let type_re = Regex::new(r#"(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)"#)?;
    let fn_re = Regex::new(
        r#"(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)"#,
    )?;
    let arrow_re = Regex::new(
        r#"(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;]+)?=\s*(?:async\s*)?(?:\([^;{}]*?\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>"#,
    )?;
    let method_re = Regex::new(
        r#"^\s*(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][A-Za-z0-9_$]*|constructor|get\s+[A-Za-z_$][A-Za-z0-9_$]*|set\s+[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\("#,
    )?;
    let mut class_stack: Vec<(String, i64, i64, i64)> = Vec::new();
    let mut depth = 0i64;
    for (index, line) in clean.lines().enumerate() {
        let line_no = index as i64 + 1;
        let line_depth = depth;
        if line_depth == 0 {
            if let Some(caps) = class_re.captures(line) {
                let kind = caps.get(1).unwrap().as_str();
                let name = caps.get(2).unwrap().as_str();
                let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    kind,
                    line_no,
                    end_line,
                    text_line(text, line_no),
                    None,
                ));
                class_stack.push((name.to_string(), temp_id, line_no, end_line));
                temp_id += 1;
            } else if let Some(caps) = enum_re.captures(line) {
                let name = caps.get(1).unwrap().as_str();
                let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    "enum",
                    line_no,
                    end_line,
                    text_line(text, line_no),
                    None,
                ));
                class_stack.push((name.to_string(), temp_id, line_no, end_line));
                temp_id += 1;
            } else if let Some(caps) = type_re.captures(line) {
                let name = caps.get(1).unwrap().as_str();
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    "type",
                    line_no,
                    line_no,
                    text_line(text, line_no),
                    None,
                ));
                temp_id += 1;
            } else if let Some(caps) = fn_re.captures(line) {
                let name = caps.get(1).unwrap().as_str();
                let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    "function",
                    line_no,
                    end_line,
                    text_line(text, line_no),
                    None,
                ));
                temp_id += 1;
            } else if let Some(caps) = arrow_re.captures(line) {
                let name = caps.get(1).unwrap().as_str();
                let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    "arrow_function",
                    line_no,
                    end_line,
                    text_line(text, line_no),
                    None,
                ));
                temp_id += 1;
            }
        } else if let Some((class_name, class_temp, _start, _end)) = class_stack
            .iter()
            .rev()
            .find(|(_, _, start, end)| *start < line_no && line_no < *end)
            .cloned()
        {
            if line_depth == 1 {
                if let Some(caps) = method_re.captures(line) {
                    let raw = caps.get(1).unwrap().as_str().trim();
                    let (kind, name) = if raw == "constructor" {
                        ("constructor", raw.to_string())
                    } else if let Some(value) = raw.strip_prefix("get ") {
                        ("getter", value.to_string())
                    } else if let Some(value) = raw.strip_prefix("set ") {
                        ("setter", value.to_string())
                    } else {
                        ("method", raw.to_string())
                    };
                    let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                    symbols.push(symbol(
                        temp_id,
                        &name,
                        &format!("{class_name}.{name}"),
                        kind,
                        line_no,
                        end_line,
                        text_line(text, line_no),
                        Some(class_temp),
                    ));
                    temp_id += 1;
                }
            }
        }
        depth += line.matches('{').count() as i64;
        depth -= line.matches('}').count() as i64;
        depth = depth.max(0);
    }
    Ok(ParsedFile {
        language: "typescript".to_string(),
        path: rel.to_string(),
        absolute_path: absolute.to_path_buf(),
        is_test: is_ts_test(rel),
        is_generated: is_generated_path(rel, "typescript"),
        package_name: package_for_file(rel, packages),
        library_uri: None,
        imports,
        symbols,
        clean_source: clean,
        line_starts,
    })
}

fn parse_dart(
    root: &Path,
    absolute: &Path,
    rel: &str,
    text: &str,
    packages: &HashMap<String, String>,
    _candidate: &FileCandidate,
) -> Result<ParsedFile> {
    let clean = strip_comments_and_strings(text);
    let line_starts = line_starts(text);
    let mut imports = Vec::new();
    let import_re = Regex::new(r#"^\s*(import|export|part)\s+['"]([^'"]+)['"]"#)?;
    for (index, line) in text.lines().enumerate() {
        if let Some(caps) = import_re.captures(line) {
            let uri = caps.get(2).unwrap().as_str().to_string();
            imports.push(ParsedImport {
                kind: caps.get(1).unwrap().as_str().to_string(),
                resolved_path: resolve_dart_uri(root, absolute, &uri, packages),
                uri,
                line: index as i64 + 1,
            });
        }
    }
    let mut symbols = Vec::new();
    let mut temp_id = 1;
    let class_re = Regex::new(
        r#"(?:(?:abstract|base|interface|final|sealed)\s+)*(class|mixin|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)"#,
    )?;
    let fn_re = Regex::new(
        r#"^\s*(?:(?:external|static|abstract|factory|const|final|late|covariant|override)\s+)*(?:(?:[A-Za-z_$][A-Za-z0-9_$]*|void|dynamic|Future|Stream|List|Map|Set)(?:\s*<[^;{}()\n]*>)?(?:\?|\*)?(?:\s+|\s*\.\s*))?([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\s*(?:<[^;{}()\n]*>)?\s*\([^;{}]*?\)"#,
    )?;
    let mut class_stack: Vec<(String, i64, i64, i64)> = Vec::new();
    let mut depth = 0i64;
    for (index, line) in clean.lines().enumerate() {
        let line_no = index as i64 + 1;
        let line_depth = depth;
        if line_depth == 0 {
            if let Some(caps) = class_re.captures(line) {
                let kind = caps.get(1).unwrap().as_str();
                let name = caps.get(2).unwrap().as_str();
                let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                symbols.push(symbol(
                    temp_id,
                    name,
                    name,
                    kind,
                    line_no,
                    end_line,
                    text_line(text, line_no),
                    None,
                ));
                class_stack.push((name.to_string(), temp_id, line_no, end_line));
                temp_id += 1;
            } else if let Some(caps) = fn_re.captures(line) {
                let name = caps.get(1).unwrap().as_str();
                if !dart_noise(name) {
                    let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                    symbols.push(symbol(
                        temp_id,
                        name,
                        name,
                        "function",
                        line_no,
                        end_line,
                        text_line(text, line_no),
                        None,
                    ));
                    temp_id += 1;
                }
            }
        } else if line_depth == 1 {
            if let Some((class_name, class_temp, _start, _end)) = class_stack
                .iter()
                .rev()
                .find(|(_, _, start, end)| *start < line_no && line_no < *end)
                .cloned()
            {
                if let Some(caps) = fn_re.captures(line) {
                    let name = caps.get(1).unwrap().as_str();
                    if !dart_noise(name) {
                        let kind = if name == class_name
                            || text_line(text, line_no).contains("factory ")
                        {
                            "constructor"
                        } else {
                            "method"
                        };
                        let end_line = find_block_end(&clean, line_no).unwrap_or(line_no);
                        symbols.push(symbol(
                            temp_id,
                            name,
                            &format!("{class_name}.{name}"),
                            kind,
                            line_no,
                            end_line,
                            text_line(text, line_no),
                            Some(class_temp),
                        ));
                        temp_id += 1;
                    }
                }
            }
        }
        depth += line.matches('{').count() as i64;
        depth -= line.matches('}').count() as i64;
        depth = depth.max(0);
    }
    Ok(ParsedFile {
        language: "dart".to_string(),
        path: rel.to_string(),
        absolute_path: absolute.to_path_buf(),
        is_test: is_dart_test(rel),
        is_generated: is_generated_path(rel, "dart"),
        package_name: package_for_file(rel, packages),
        library_uri: None,
        imports,
        symbols,
        clean_source: clean,
        line_starts,
    })
}

#[allow(clippy::too_many_arguments)]
fn symbol(
    temp_id: i64,
    name: &str,
    qualified_name: &str,
    kind: &str,
    start_line: i64,
    end_line: i64,
    signature: String,
    parent_temp_id: Option<i64>,
) -> ParsedSymbol {
    ParsedSymbol {
        temp_id,
        name: name.to_string(),
        qualified_name: qualified_name.to_string(),
        kind: kind.to_string(),
        visibility: if name.starts_with('_') || name.starts_with('#') {
            "private"
        } else {
            "public"
        }
        .to_string(),
        start_line,
        end_line,
        signature: single_line_signature(&signature, 220),
        doc: String::new(),
        parent_temp_id,
    }
}

fn upsert_files(conn: &Connection, parsed_files: &[ParsedFile]) -> Result<HashMap<String, i64>> {
    let mut path_to_id = HashMap::new();
    let now = now_seconds();
    for parsed in parsed_files {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM files WHERE path=?",
                params![parsed.path],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(file_id) = existing {
            delete_file_rows(conn, file_id, false)?;
        }
        let metadata = fs::metadata(&parsed.absolute_path).ok();
        let size = metadata.as_ref().map(|item| item.len() as i64).unwrap_or(0);
        let mtime_ns = metadata
            .and_then(|item| item.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos() as i64)
            .unwrap_or(0);
        let file_id = if let Some(id) = existing {
            conn.execute(
                "UPDATE files SET language=?,package=?,library_uri=?,is_test=?,is_generated=?,hash=?,size=?,mtime=?,mtime_ns=?,indexed_at=?,parse_error=NULL WHERE id=?",
                params![parsed.language, parsed.package_name, parsed.library_uri, parsed.is_test as i64, parsed.is_generated as i64, "", size, mtime_ns as f64 / 1_000_000_000.0, mtime_ns, now, id],
            )?;
            id
        } else {
            conn.execute(
                "INSERT INTO files(path,language,package,library_uri,is_test,is_generated,hash,size,mtime,mtime_ns,indexed_at,parse_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)",
                params![parsed.path, parsed.language, parsed.package_name, parsed.library_uri, parsed.is_test as i64, parsed.is_generated as i64, "", size, mtime_ns as f64 / 1_000_000_000.0, mtime_ns, now],
            )?;
            conn.last_insert_rowid()
        };
        path_to_id.insert(parsed.path.clone(), file_id);
        insert_entity(
            conn,
            "file",
            file_id,
            &parsed.language,
            &basename(&parsed.path),
            &parsed.path,
            &parsed.path,
            "",
            parsed.library_uri.as_deref().unwrap_or(""),
        )?;
        let mut temp_to_real = HashMap::new();
        for sym in &parsed.symbols {
            let parent = sym
                .parent_temp_id
                .and_then(|id| temp_to_real.get(&id).cloned());
            conn.execute(
                "INSERT INTO symbols(file_id,language,name,qualified_name,kind,visibility,start_line,end_line,signature,doc,parent_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                params![file_id, parsed.language, sym.name, sym.qualified_name, sym.kind, sym.visibility, sym.start_line, sym.end_line, sym.signature, sym.doc, parent],
            )?;
            let symbol_id = conn.last_insert_rowid();
            temp_to_real.insert(sym.temp_id, symbol_id);
            insert_entity(
                conn,
                "symbol",
                symbol_id,
                &parsed.language,
                &sym.name,
                &sym.qualified_name,
                &parsed.path,
                &sym.signature,
                &sym.doc,
            )?;
        }
    }
    Ok(path_to_id)
}

#[allow(clippy::too_many_arguments)]
fn insert_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    language: &str,
    name: &str,
    qualified_name: &str,
    path: &str,
    signature: &str,
    doc: &str,
) -> Result<()> {
    let tokens = tokenize(&format!(
        "{name} {qualified_name} {path} {signature} {doc} {language}"
    ))
    .join(" ");
    conn.execute(
        "INSERT OR REPLACE INTO entities(entity_type,entity_id,language,name,qualified_name,path,signature,doc,tokens) VALUES (?,?,?,?,?,?,?,?,?)",
        params![entity_type, entity_id, language, name, qualified_name, path, signature, doc, tokens],
    )?;
    conn.execute(
        "INSERT INTO entities_fts(entity_type,entity_id,language,name,qualified_name,path,signature,doc,tokens) VALUES (?,?,?,?,?,?,?,?,?)",
        params![entity_type, entity_id, language, name, qualified_name, path, signature, doc, tokens],
    )
    .ok();
    Ok(())
}

fn build_import_edges(
    conn: &Connection,
    parsed_files: &[ParsedFile],
    path_to_id: &HashMap<String, i64>,
) -> Result<()> {
    let all_paths = current_path_to_file_id(conn)?;
    for parsed in parsed_files {
        let Some(from_id) = path_to_id
            .get(&parsed.path)
            .or_else(|| all_paths.get(&parsed.path))
        else {
            continue;
        };
        for import in &parsed.imports {
            let to_id = import
                .resolved_path
                .as_ref()
                .and_then(|item| all_paths.get(item).or_else(|| path_to_id.get(item)))
                .cloned();
            conn.execute(
                "INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)",
                params![Option::<i64>::None, Option::<i64>::None, from_id, to_id, import.kind, 1.0, format!("{} at line {}", import.uri, import.line)],
            )?;
        }
    }
    Ok(())
}

fn build_symbol_edges(
    conn: &Connection,
    parsed_files: &[ParsedFile],
    path_to_id: &HashMap<String, i64>,
) -> Result<()> {
    let symbols = all_symbols(conn)?;
    let mut lookup: HashMap<String, Vec<DbSymbol>> = HashMap::new();
    let mut by_file: HashMap<i64, Vec<DbSymbol>> = HashMap::new();
    for sym in symbols {
        lookup
            .entry(sym.name.clone())
            .or_default()
            .push(sym.clone());
        if sym.qualified_name != sym.name {
            lookup
                .entry(sym.qualified_name.clone())
                .or_default()
                .push(sym.clone());
        }
        by_file.entry(sym.file_id).or_default().push(sym);
    }
    let import_map = import_map(conn)?;
    for parsed in parsed_files {
        let Some(file_id) = path_to_id.get(&parsed.path).cloned() else {
            continue;
        };
        let imported = import_map.get(&file_id).cloned().unwrap_or_default();
        for sym in by_file.get(&file_id).cloned().unwrap_or_default() {
            if !function_like(&parsed.language, &sym.kind) {
                continue;
            }
            let body = body_slice(parsed, sym.start_line, sym.end_line);
            let mut seen = HashSet::new();
            for name in call_names(&parsed.language, &body) {
                if !seen.insert(name.clone()) {
                    continue;
                }
                for target in choose_targets(
                    lookup.get(&name).cloned().unwrap_or_default(),
                    file_id,
                    &imported,
                ) {
                    if target.id == sym.id {
                        continue;
                    }
                    let confidence =
                        if target.file_id == file_id || imported.contains(&target.file_id) {
                            0.85
                        } else {
                            0.65
                        };
                    conn.execute(
                        "INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)",
                        params![sym.id, target.id, file_id, target.file_id, "calls", confidence, name],
                    )?;
                }
            }
            let mut seen_types = HashSet::new();
            for name in type_names(&body) {
                if !seen_types.insert(name.clone()) {
                    continue;
                }
                for target in choose_targets(
                    lookup.get(&name).cloned().unwrap_or_default(),
                    file_id,
                    &imported,
                ) {
                    let confidence =
                        if target.file_id == file_id || imported.contains(&target.file_id) {
                            0.8
                        } else {
                            0.55
                        };
                    conn.execute(
                        "INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)",
                        params![sym.id, target.id, file_id, target.file_id, "references_type", confidence, name],
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn build_test_edges(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM edges WHERE kind='tests'", [])?;
    let mut pairs = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT e.from_file_id,e.to_file_id,e.evidence FROM edges e JOIN files tf ON tf.id=e.from_file_id JOIN files pf ON pf.id=e.to_file_id WHERE e.kind IN ('import','export','part','require','dynamic_import') AND tf.is_test=1 AND pf.is_test=0")?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (test_id, prod_id, evidence) in rows {
            if pairs.insert((test_id, prod_id)) {
                conn.execute(
                    "INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)",
                    params![Option::<i64>::None, Option::<i64>::None, test_id, prod_id, "tests", 0.95, format!("test imports {evidence}")],
                )?;
            }
        }
    }
    let mut prod_by_base: HashMap<String, Vec<(i64, Option<String>)>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT id,path,package FROM files WHERE is_test=0")?;
    for row in stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })? {
        let (id, path, package) = row?;
        prod_by_base
            .entry(stem(&path))
            .or_default()
            .push((id, package));
    }
    let mut stmt = conn.prepare("SELECT id,path,package FROM files WHERE is_test=1")?;
    let tests = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (test_id, path, package) in tests {
        let base = test_target_stem(&stem(&path));
        for (prod_id, prod_package) in prod_by_base.get(&base).cloned().unwrap_or_default() {
            if pairs.insert((test_id, prod_id)) {
                let same_package = package.is_some() && package == prod_package;
                conn.execute(
                    "INSERT INTO edges(from_symbol_id,to_symbol_id,from_file_id,to_file_id,kind,confidence,evidence) VALUES (?,?,?,?,?,?,?)",
                    params![Option::<i64>::None, Option::<i64>::None, test_id, prod_id, "tests", if same_package { 0.75 } else { 0.65 }, if same_package { "matching test basename; same package" } else { "matching test basename" }],
                )?;
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct DbSymbol {
    id: i64,
    file_id: i64,
    language: String,
    name: String,
    qualified_name: String,
    kind: String,
    path: String,
    start_line: i64,
    end_line: i64,
    signature: Option<String>,
}

struct EntityRow {
    entity_type: String,
    entity_id: i64,
    language: String,
    name: String,
    qualified_name: String,
    path: String,
    signature: String,
    doc: String,
    tokens: String,
}

struct DbFile {
    id: i64,
    path: String,
    language: String,
}

fn search_entities(
    conn: &Connection,
    query: &str,
    languages: &[String],
    max_results: usize,
) -> Result<Vec<EntityRow>> {
    let tokens = tokenize(query).into_iter().take(8).collect::<Vec<_>>();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut rows = all_entities(conn)?;
    if !languages.is_empty() {
        rows.retain(|row| languages.iter().any(|language| language == &row.language));
    }
    rows.retain(|row| {
        tokens.iter().any(|token| {
            let hay = format!(
                "{} {} {} {} {} {}",
                row.name, row.qualified_name, row.path, row.signature, row.doc, row.tokens
            )
            .to_lowercase();
            hay.contains(token)
        })
    });
    rows.truncate(max_results * 4);
    Ok(rows)
}

fn score_entity(row: &EntityRow, query: &str) -> (f64, Vec<String>) {
    let tokens = tokenize(query).into_iter().collect::<HashSet<_>>();
    let fields = [
        ("name", row.name.as_str(), 8.0),
        ("qualified name", row.qualified_name.as_str(), 7.0),
        ("path", row.path.as_str(), 5.0),
        ("signature", row.signature.as_str(), 4.0),
        ("doc", row.doc.as_str(), 2.0),
    ];
    let mut score = 0.0;
    let mut reasons = Vec::new();
    for (label, value, weight) in fields {
        let hits = tokens
            .iter()
            .filter(|token| value.to_lowercase().contains(*token))
            .cloned()
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            score += weight * hits.len() as f64;
            reasons.push(format!(
                "{label} matches {}",
                hits.into_iter().take(4).collect::<Vec<_>>().join(", ")
            ));
        }
    }
    let query_lower = query.to_lowercase();
    if row.name.to_lowercase().contains(&query_lower)
        || row.qualified_name.to_lowercase().contains(&query_lower)
    {
        score += 12.0;
        reasons.insert(0, "exact phrase match".to_string());
    }
    if row.entity_type == "symbol" {
        score += 2.0;
    }
    reasons.truncate(4);
    (score, reasons)
}

fn related_boost(conn: &Connection, symbol_id: i64) -> Result<f64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM edges WHERE from_symbol_id=? OR to_symbol_id=?",
        params![symbol_id, symbol_id],
        |row| row.get(0),
    )?;
    Ok((count as f64 * 0.15).min(3.0))
}

fn hit_for_entity(
    conn: &Connection,
    row: &EntityRow,
    score: f64,
    reasons: Vec<String>,
) -> Result<Option<SearchHit>> {
    if row.entity_type == "file" {
        let file = conn
            .query_row(
                "SELECT path,language,is_test FROM files WHERE id=?",
                params![row.entity_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;
        Ok(file.map(|(path, language, is_test)| SearchHit {
            hit_type: "file".to_string(),
            score,
            language,
            name: basename(&path),
            qualified_name: path.clone(),
            kind: None,
            path,
            start_line: None,
            end_line: None,
            signature: None,
            reasons,
            is_test: is_test != 0,
        }))
    } else {
        let symbol = conn
            .query_row(
                "SELECT s.language,s.name,s.qualified_name,s.kind,f.path,s.start_line,s.end_line,s.signature,f.is_test FROM symbols s JOIN files f ON f.id=s.file_id WHERE s.id=?",
                params![row.entity_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()?;
        Ok(symbol.map(
            |(
                language,
                name,
                qualified_name,
                kind,
                path,
                start_line,
                end_line,
                signature,
                is_test,
            )| SearchHit {
                hit_type: "symbol".to_string(),
                score,
                language,
                name,
                qualified_name,
                kind: Some(kind),
                path,
                start_line: Some(start_line),
                end_line: Some(end_line),
                signature: empty_to_none(signature),
                reasons,
                is_test: is_test != 0,
            },
        ))
    }
}

fn all_entities(conn: &Connection) -> Result<Vec<EntityRow>> {
    let mut stmt = conn.prepare("SELECT entity_type,entity_id,language,name,qualified_name,path,signature,doc,tokens FROM entities")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(EntityRow {
                entity_type: row.get(0)?,
                entity_id: row.get(1)?,
                language: row.get(2)?,
                name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                qualified_name: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                path: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                signature: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                doc: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                tokens: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn find_symbols(conn: &Connection, name: &str, languages: &[String]) -> Result<Vec<DbSymbol>> {
    let mut rows = all_symbols(conn)?;
    if !languages.is_empty() {
        rows.retain(|row| languages.iter().any(|language| language == &row.language));
    }
    let mut exact = rows
        .iter()
        .filter(|row| row.name == name || row.qualified_name == name)
        .cloned()
        .collect::<Vec<_>>();
    if exact.is_empty() {
        let lower = name.to_lowercase();
        exact = rows
            .into_iter()
            .filter(|row| {
                row.name.to_lowercase().contains(&lower)
                    || row.qualified_name.to_lowercase().contains(&lower)
            })
            .take(50)
            .collect();
    }
    exact.sort_by(|a, b| {
        a.language
            .cmp(&b.language)
            .then(a.path.cmp(&b.path))
            .then(a.start_line.cmp(&b.start_line))
    });
    Ok(exact)
}

fn symbol_details(conn: &Connection, symbol: DbSymbol) -> Result<SymbolDetails> {
    let mut stmt = conn.prepare("SELECT fs.qualified_name,ff.path FROM edges e JOIN symbols fs ON fs.id=e.from_symbol_id JOIN files ff ON ff.id=fs.file_id WHERE e.to_symbol_id=? AND e.kind='calls' LIMIT 8")?;
    let called_by = stmt
        .query_map(params![symbol.id], |row| {
            Ok(NamePath {
                qualified_name: row.get(0)?,
                path: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare("SELECT ts.qualified_name,tf.path FROM edges e JOIN symbols ts ON ts.id=e.to_symbol_id JOIN files tf ON tf.id=ts.file_id WHERE e.from_symbol_id=? AND e.kind='calls' LIMIT 8")?;
    let calls = stmt
        .query_map(params![symbol.id], |row| {
            Ok(NamePath {
                qualified_name: row.get(0)?,
                path: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare("SELECT tf.path FROM edges e JOIN files tf ON tf.id=e.from_file_id WHERE e.to_file_id=? AND e.kind='tests' LIMIT 8")?;
    let tests = stmt
        .query_map(params![symbol.file_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(SymbolDetails {
        qualified_name: symbol.qualified_name,
        language: symbol.language,
        kind: symbol.kind,
        path: symbol.path,
        start_line: symbol.start_line,
        end_line: symbol.end_line,
        signature: empty_to_none(symbol.signature),
        called_by,
        calls,
        tests,
    })
}

fn find_file_for_target(
    conn: &Connection,
    target: &str,
    languages: &[String],
) -> Result<Option<DbFile>> {
    if let Some(file) = conn
        .query_row(
            "SELECT id,path,language FROM files WHERE path=?",
            params![target],
            |row| {
                Ok(DbFile {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    language: row.get(2)?,
                })
            },
        )
        .optional()?
    {
        return Ok(Some(file));
    }
    if let Some(symbol) = find_symbols(conn, target, languages)?.first() {
        let file = conn
            .query_row(
                "SELECT id,path,language FROM files WHERE id=?",
                params![symbol.file_id],
                |row| {
                    Ok(DbFile {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        language: row.get(2)?,
                    })
                },
            )
            .optional()?;
        return Ok(file);
    }
    Ok(None)
}

fn all_symbols(conn: &Connection) -> Result<Vec<DbSymbol>> {
    let mut stmt = conn.prepare("SELECT s.id,s.file_id,s.language,s.name,s.qualified_name,s.kind,f.path,s.start_line,s.end_line,s.signature FROM symbols s JOIN files f ON f.id=s.file_id")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DbSymbol {
                id: row.get(0)?,
                file_id: row.get(1)?,
                language: row.get(2)?,
                name: row.get(3)?,
                qualified_name: row.get(4)?,
                kind: row.get(5)?,
                path: row.get(6)?,
                start_line: row.get(7)?,
                end_line: row.get(8)?,
                signature: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn current_path_to_file_id(conn: &Connection) -> Result<HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT path,id FROM files")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    Ok(rows)
}

fn import_map(conn: &Connection) -> Result<HashMap<i64, HashSet<i64>>> {
    let mut stmt = conn.prepare("SELECT from_file_id,to_file_id FROM edges WHERE kind IN ('import','export','part','require','dynamic_import') AND to_file_id IS NOT NULL")?;
    let mut map: HashMap<i64, HashSet<i64>> = HashMap::new();
    for row in stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))? {
        let (from, to) = row?;
        map.entry(from).or_default().insert(to);
    }
    Ok(map)
}

fn choose_targets(
    candidates: Vec<DbSymbol>,
    current_file_id: i64,
    imported: &HashSet<i64>,
) -> Vec<DbSymbol> {
    let same = candidates
        .iter()
        .filter(|row| row.file_id == current_file_id)
        .cloned()
        .collect::<Vec<_>>();
    if !same.is_empty() {
        return same.into_iter().take(4).collect();
    }
    let imported_rows = candidates
        .iter()
        .filter(|row| imported.contains(&row.file_id))
        .cloned()
        .collect::<Vec<_>>();
    if !imported_rows.is_empty() {
        return imported_rows.into_iter().take(4).collect();
    }
    candidates.into_iter().take(2).collect()
}

fn counts(conn: &Connection) -> Result<(i64, i64, i64)> {
    let files = conn.query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))?;
    let symbols = conn.query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))?;
    let edges = conn.query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
    Ok((files, symbols, edges))
}

fn write_meta(
    conn: &Connection,
    root: &Path,
    include_generated: bool,
    languages: &[String],
) -> Result<()> {
    let values = [
        ("version", VERSION.to_string()),
        ("root", root.to_string_lossy().into_owned()),
        (
            "include_generated",
            if include_generated { "1" } else { "0" }.to_string(),
        ),
        ("languages", {
            let mut sorted = languages.to_vec();
            sorted.sort();
            sorted.join(",")
        }),
        ("indexed_at", now_seconds().to_string()),
    ];
    for (key, value) in values {
        conn.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
            params![key, value],
        )?;
    }
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key=?", params![key], |row| {
            row.get(0)
        })
        .optional()?)
}

fn require_index(conn: &Connection) -> Result<()> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        Err(anyhow!("search index is empty. Run: tangent search index"))
    } else {
        Ok(())
    }
}

fn discover_dart_packages(root: &Path) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| should_skip(entry.path()))
    {
        let entry = entry?;
        if entry.file_type().is_file() && entry.file_name() == "pubspec.yaml" {
            if let Some(name) = parse_pubspec_name(entry.path()) {
                if let Some(parent) = entry.path().parent() {
                    out.insert(name, relpath(parent, root));
                }
            }
        }
    }
    Ok(out)
}

fn discover_ts_packages(root: &Path) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| should_skip(entry.path()))
    {
        let entry = entry?;
        if entry.file_type().is_file() && entry.file_name() == "package.json" {
            if let Ok(text) = fs::read_to_string(entry.path()) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(name) = value.get("name").and_then(|item| item.as_str()) {
                        if let Some(parent) = entry.path().parent() {
                            out.insert(name.to_string(), relpath(parent, root));
                        }
                    }
                }
            }
        }
    }
    Ok(out)
}

fn parse_pubspec_name(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()?.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed.strip_prefix("name:").map(|value| {
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        })
    })
}

fn resolve_ts_uri(
    root: &Path,
    current_file: &Path,
    uri: &str,
    packages: &HashMap<String, String>,
) -> Option<String> {
    if uri.starts_with("http://") || uri.starts_with("https://") || uri.starts_with("node:") {
        return None;
    }
    if uri.starts_with('.') {
        return resolve_file_candidate(
            root,
            &current_file.parent()?.join(uri),
            &[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
        );
    }
    for (name, package_root) in packages {
        if uri == name {
            for sub in ["src/index", "index"] {
                if let Some(value) = resolve_file_candidate(
                    root,
                    &root.join(package_root).join(sub),
                    &[".ts", ".tsx", ".js", ".jsx"],
                ) {
                    return Some(value);
                }
            }
        } else if let Some(rest) = uri.strip_prefix(&format!("{name}/")) {
            for prefix in ["src", "lib", ""] {
                if let Some(value) = resolve_file_candidate(
                    root,
                    &root.join(package_root).join(prefix).join(rest),
                    &[".ts", ".tsx", ".js", ".jsx"],
                ) {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn resolve_dart_uri(
    root: &Path,
    current_file: &Path,
    uri: &str,
    packages: &HashMap<String, String>,
) -> Option<String> {
    if uri.starts_with("dart:") || uri.starts_with("package:flutter/") {
        return None;
    }
    if let Some(rest) = uri.strip_prefix("package:") {
        let (package, sub) = rest.split_once('/')?;
        let package_root = packages.get(package)?;
        return Some(relpath(
            &root.join(package_root).join("lib").join(sub),
            root,
        ));
    }
    Some(relpath(&current_file.parent()?.join(uri), root))
}

fn resolve_file_candidate(root: &Path, base: &Path, extensions: &[&str]) -> Option<String> {
    let mut candidates = Vec::new();
    if base.extension().is_some() {
        candidates.push(base.to_path_buf());
    } else {
        for extension in extensions {
            candidates.push(PathBuf::from(format!(
                "{}{}",
                base.to_string_lossy(),
                extension
            )));
        }
        for extension in extensions {
            candidates.push(base.join(format!("index{extension}")));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| relpath(&path, root))
}

fn package_for_file(rel: &str, packages: &HashMap<String, String>) -> Option<String> {
    let mut best: Option<(usize, String)> = None;
    for (name, root) in packages {
        let prefix = format!("{}/", root.trim_end_matches('/'));
        if (rel == root || rel.starts_with(&prefix))
            && best
                .as_ref()
                .map(|item| prefix.len() > item.0)
                .unwrap_or(true)
        {
            best = Some((prefix.len(), name.clone()));
        }
    }
    best.map(|item| item.1)
}

fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, ch) in text.char_indices() {
        if ch == '\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_to_pos(starts: &[usize], line: i64) -> usize {
    if line <= 1 {
        0
    } else {
        starts
            .get(line as usize - 1)
            .cloned()
            .unwrap_or_else(|| *starts.last().unwrap_or(&0))
    }
}

fn body_slice(parsed: &ParsedFile, start_line: i64, end_line: i64) -> String {
    let start = line_to_pos(&parsed.line_starts, start_line);
    let end = line_to_pos(&parsed.line_starts, end_line + 1).min(parsed.clean_source.len());
    parsed
        .clean_source
        .get(start..end)
        .unwrap_or("")
        .to_string()
}

fn strip_comments_and_strings(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut quote: Option<char> = None;
    while let Some(ch) = chars.next() {
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                out.push('\n');
            } else {
                out.push(' ');
            }
            continue;
        }
        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                out.push(' ');
                out.push(' ');
                in_block_comment = false;
            } else {
                out.push(if ch == '\n' { '\n' } else { ' ' });
            }
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == '\\' {
                out.push(' ');
                if let Some(next) = chars.next() {
                    out.push(if next == '\n' { '\n' } else { ' ' });
                }
                continue;
            }
            if ch == active_quote {
                quote = None;
            }
            out.push(if ch == '\n' { '\n' } else { ' ' });
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'/') {
            chars.next();
            out.push(' ');
            out.push(' ');
            in_line_comment = true;
        } else if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            out.push(' ');
            out.push(' ');
            in_block_comment = true;
        } else if ch == '"' || ch == '\'' || ch == '`' {
            quote = Some(ch);
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out
}

fn find_block_end(clean: &str, start_line: i64) -> Option<i64> {
    let mut depth = 0i64;
    let mut seen_open = false;
    for (index, line) in clean.lines().enumerate().skip(start_line as usize - 1) {
        for ch in line.chars() {
            if ch == '{' {
                depth += 1;
                seen_open = true;
            } else if ch == '}' {
                depth -= 1;
                if seen_open && depth <= 0 {
                    return Some(index as i64 + 1);
                }
            }
        }
        if !seen_open && line.contains(';') {
            return Some(index as i64 + 1);
        }
    }
    Some(start_line)
}

fn text_line(text: &str, line_no: i64) -> String {
    text.lines()
        .nth(line_no as usize - 1)
        .unwrap_or("")
        .to_string()
}

fn single_line_signature(text: &str, max_len: usize) -> String {
    let value = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.len() > max_len {
        format!("{}...", value[..max_len.saturating_sub(3)].trim_end())
    } else {
        value
    }
}

fn tokenize(text: &str) -> Vec<String> {
    let re = Regex::new(r"[A-Za-z0-9_$]+").unwrap();
    let split_re = Regex::new(r"([a-z0-9])([A-Z])").unwrap();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let stop = [
        "the", "and", "for", "with", "from", "this", "that", "src", "lib",
    ]
    .into_iter()
    .collect::<HashSet<_>>();
    for cap in re.find_iter(text) {
        let word = cap.as_str();
        let mut pieces = vec![word.to_lowercase()];
        let split = split_re.replace_all(word, "$1 $2").replace(['_', '$'], "-");
        pieces.extend(
            split
                .split(|ch: char| !ch.is_ascii_alphanumeric())
                .map(|item| item.to_lowercase()),
        );
        for piece in pieces {
            if piece.len() >= 2 && !stop.contains(piece.as_str()) && seen.insert(piece.clone()) {
                out.push(piece);
            }
        }
    }
    out
}

fn call_names(language: &str, text: &str) -> Vec<String> {
    let re = Regex::new(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^;{}()]*>)?\s*\(").unwrap();
    let noise = if language == "dart" {
        [
            "if", "for", "while", "switch", "catch", "assert", "return", "throw", "await", "yield",
            "print", "expect", "group", "test", "setUp", "tearDown", "main",
        ]
        .as_slice()
    } else {
        [
            "if",
            "for",
            "while",
            "switch",
            "catch",
            "return",
            "throw",
            "await",
            "yield",
            "new",
            "typeof",
            "instanceof",
            "describe",
            "it",
            "test",
            "expect",
            "beforeEach",
            "afterEach",
            "beforeAll",
            "afterAll",
            "console",
            "require",
        ]
        .as_slice()
    };
    re.captures_iter(text)
        .filter_map(|caps| caps.get(1).map(|item| item.as_str().to_string()))
        .filter(|name| !noise.contains(&name.as_str()))
        .collect()
}

fn type_names(text: &str) -> Vec<String> {
    let re = Regex::new(r"\b([A-Z][A-Za-z0-9_$]*)\b").unwrap();
    let primitives = [
        "String", "Object", "Array", "Promise", "Record", "Map", "Set", "List", "Future", "Stream",
    ];
    re.captures_iter(text)
        .filter_map(|caps| caps.get(1).map(|item| item.as_str().to_string()))
        .filter(|name| !primitives.contains(&name.as_str()))
        .collect()
}

fn function_like(language: &str, kind: &str) -> bool {
    if language == "dart" {
        matches!(
            kind,
            "function" | "method" | "constructor" | "getter" | "setter"
        )
    } else {
        matches!(
            kind,
            "function" | "method" | "constructor" | "getter" | "setter" | "arrow_function"
        )
    }
}

fn is_ts_test(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    lower.contains("/__tests__/")
        || lower.starts_with("test/")
        || lower.starts_with("tests/")
        || lower.contains("/test/")
        || lower.contains("/tests/")
        || [
            ".test.ts",
            ".test.tsx",
            ".spec.ts",
            ".spec.tsx",
            ".test.js",
            ".spec.js",
            ".test.jsx",
            ".spec.jsx",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn is_dart_test(rel: &str) -> bool {
    rel.starts_with("test/") || rel.contains("/test/") || rel.ends_with("_test.dart")
}

fn dart_noise(name: &str) -> bool {
    matches!(
        name,
        "if" | "for"
            | "while"
            | "switch"
            | "catch"
            | "assert"
            | "return"
            | "throw"
            | "await"
            | "yield"
            | "test"
            | "expect"
            | "main"
    )
}

fn relpath(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or(path)
        .to_string()
}

fn stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or(path)
        .to_string()
}

fn test_target_stem(stem: &str) -> String {
    for suffix in ["_test", ".test", ".spec", "-test", "-spec"] {
        if let Some(value) = stem.strip_suffix(suffix) {
            return value.to_string();
        }
    }
    stem.to_string()
}

fn glob_match(value: &str, pattern: &str) -> bool {
    if pattern == "*" || pattern == "**" {
        return true;
    }
    if let Some(inner) = pattern
        .strip_prefix('*')
        .and_then(|item| item.strip_suffix('*'))
    {
        return value.contains(inner);
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return value.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    value == pattern
}

fn now_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or(0.0)
}

fn placeholders(count: usize) -> String {
    (0..count).map(|_| "?").collect::<Vec<_>>().join(",")
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.is_empty())
}

fn mode_limit(mode: &str) -> usize {
    match mode {
        "precise" => 5,
        "broad" => 25,
        _ => 10,
    }
}
