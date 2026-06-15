# @tangent/search

Structural repository search for `tangent`.

```bash
tangent search index
tangent search index --language dart
tangent search index --verbose
tangent search "query"
tangent search symbol SymbolName
tangent search callers SymbolName
tangent search skeleton src/file.ts
```

When installed standalone as `@tangent/search`, use the `tangent-search` binary with the same arguments:

```bash
tangent-search index
tangent-search "query"
```

`search` indexes Dart and TypeScript/JavaScript source into a private SQLite database under `~/.tangent/search/repos/<repo-name>-<hash>` by default. It works without config; `tangent search init` writes private overrides when needed.

`tangent search index` prints progress while scanning, parsing, writing SQLite rows, and rebuilding graph edges. Use `--language dart` or `--language typescript` to narrow an index run when needed. Use `--verbose` for per-file diagnostics, DB/FTS details, aggregated cleanup row counts, durations, and slow-step warnings.

Repo-shared defaults can be written explicitly:

```bash
tangent search init . --scope repo-shared --language typescript
```

The index is syntax-aware and intentionally does not require `tsserver`, the TypeScript compiler API, Dart analyzer, or LSP services.
