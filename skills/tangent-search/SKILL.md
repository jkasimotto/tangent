---
name: tangent-search
description: "Use Tangent structural repository search to find relevant code, symbols, callers, callees, tests, and file skeletons before editing code in repos that have the `tangent search` CLI available. Use when the agent needs to orient in a codebase, plan an implementation, locate definitions, understand call relationships, debug search index state, or avoid broad manual file reads."
---

# Tangent Search

Assume `tangent` is installed on `PATH` and run commands from the target repo unless a command uses `--repo`.

## Index State

Start by checking the index when search results are missing, stale, or surprisingly slow:

```bash
tangent search status
tangent search doctor
```

Build or refresh the index:

```bash
tangent search index
```

Use verbose indexing only when debugging slow or confusing index work:

```bash
tangent search index --verbose
```

`--verbose` prints repo-relative paths, DB/FTS work, cleanup row counts, edge rebuild counts, durations, and slow-operation warnings. If no files changed since the last index run, `tangent search index` should be fast and report no file changes.

Use language filters only when intentionally narrowing index or query scope:

```bash
tangent search index --language dart
tangent search index --language typescript
tangent search "query" --language dart
```

Do not run `tangent search index dart`; positional arguments are repo paths, not language names.

## Discovery Workflow

Prefer structural search before broad file reads:

1. Run `tangent search open-plan "<task query>"` to get a recommended read order.
2. Run `tangent search "<query>"` for likely implementation symbols, files, and tests.
3. Run `tangent search skeleton <path-or-symbol>` before reading a whole large file.
4. Run `tangent search symbol <name>` for definitions, callers, callees, and likely tests.
5. Run `tangent search callers <name>` or `tangent search callees <name>` for call graph questions.
6. Run `tangent search tests <path-or-symbol>` before changing behavior.
7. Read the top one to three full files after skeleton review, then edit normally.

Use search modes to adjust recall:

```bash
tangent search "exact phrase" --mode precise
tangent search "rough task terms" --mode broad --max-results 20
```

Use `--include-tests` when test hits matter in the main query:

```bash
tangent search "auth controller" --include-tests
```

## Text Fallbacks

Use Tangent's wrappers when structural search misses plain text but repo excludes still matter:

```bash
tangent search rg "pattern" path/
tangent search grep -rn "pattern" path/
```

Plain `rg` is still appropriate for exact strings, generated output checks, or repositories without a Tangent index.

## Output Handling

Treat search hits as routing hints, not proof. Verify important files with direct reads before editing.

If results are empty:

1. Run `tangent search status`.
2. Run `tangent search index` if the index is missing or stale.
3. Broaden query terms, search by symbol name, or search by file stem.
4. Use `tangent search rg` or normal `rg` for exact text fallback.
