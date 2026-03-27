# tree-sitter-postgres

A [tree-sitter](https://tree-sitter.github.io/) grammar for PostgreSQL, generated directly from PostgreSQL's Bison grammar (`gram.y`) and keyword list (`kwlist.h`).

## Features

- **727 grammar rules** covering the full PostgreSQL SQL syntax (REL_18_3)
- **494 case-insensitive keywords** across all four PG keyword categories
- **Correct operator precedence** — `1 + 2 * 3` parses as `1 + (2 * 3)`
- **Generated, not hand-written** — regenerate for any PostgreSQL version

## Quick start

```bash
npm install
cd postgres && npx tree-sitter generate && npx tree-sitter test
```

## Regenerating from PostgreSQL source

The grammar is generated from a local PostgreSQL checkout:

```bash
# Default: ~/Source/gmr/postgres
node script/generate-grammar.js

# Or specify the path
node script/generate-grammar.js /path/to/postgres

# Then build the parser
cd postgres && npx tree-sitter generate
```

### Input files

| File                          | Source                                       |
| ----------------------------- | -------------------------------------------- |
| `src/backend/parser/gram.y`   | Bison grammar (733 rules, 3236 alternatives) |
| `src/include/parser/kwlist.h` | Keyword definitions (494 keywords)           |

### Generator scripts

| Script                          | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `script/generate-grammar.js`    | Orchestrator — reads PG source, writes `postgres/grammar.js`             |
| `script/parse-gram-y.js`        | Parses Bison grammar: rules, terminals, precedence, `%prec` annotations  |
| `script/parse-kwlist.js`        | Parses keyword list into categories                                      |
| `script/codegen.js`             | Generates tree-sitter grammar with precedence and optional-rule handling |
| `postgres/harvest-conflicts.sh` | Iteratively discovers GLR conflicts needed by tree-sitter                |

## Repository structure

```
postgres/               PostgreSQL SQL grammar
  grammar.js            Generated tree-sitter grammar
  src/                  Generated parser (C)
  test/corpus/          Test cases (22 tests)
  bindings/             Language bindings (Node, Rust, Python, Go, Swift, C)
  known-conflicts.json  GLR conflict pairs

script/                 Shared generator code
  generate-grammar.js   Orchestrator
  parse-gram-y.js       Bison parser
  parse-kwlist.js       Keyword parser
  codegen.js            Grammar code generator

plpgsql/                (future) PL/pgSQL grammar
```

## Design notes

### Empty rule handling

Bison's `/* EMPTY */` alternatives cannot be directly translated — tree-sitter forbids non-start rules that match the empty string. The generator propagates optionality upward via a fixpoint loop and wraps references with `optional()` at call sites.

### Operator precedence

Binary operators are split into a separate `a_expr_prec` rule resolved by static precedence (no GLR), while complex patterns (IS, IN, BETWEEN, LIKE, subquery operators) stay in `a_expr` with GLR conflict resolution. Both `prec.left`/`prec.right` (generation-time) and `prec.dynamic` (runtime) are emitted.

### PL/pgSQL

PL/pgSQL uses a separate Bison grammar (`src/pl/plpgsql/src/pl_gram.y`) in PostgreSQL. A future `plpgsql/` grammar can reuse the shared generator scripts and delegate SQL expression parsing to the postgres grammar via tree-sitter language injection.

## License

BSD 3-Clause
