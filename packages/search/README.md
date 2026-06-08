# @tangent/search

Structural repository search for `tangent`.

```bash
tangent search index
tangent search "query"
tangent search symbol SymbolName
tangent search callers SymbolName
tangent search skeleton src/file.ts
tangent search bench . --query "query"
```

`search` indexes Dart and TypeScript/JavaScript source into a private SQLite database under `~/.tangent/search/repos/<repo-name>-<hash>` by default. It works without config; `tangent search init` writes private overrides when needed.

Repo-shared defaults can be written explicitly:

```bash
tangent search init . --scope repo-shared --language typescript
```

The index is syntax-aware and intentionally does not require `tsserver`, the TypeScript compiler API, Dart analyzer, or LSP services.

Temporary engine comparison:

```bash
cargo build -p tangent-search-engine
tangent search index --engine rust
TANGENT_SEARCH_ENGINE=rust tangent search "query"
tangent search bench . --query "query"
```
