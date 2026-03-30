# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Run all corpus tests (default target)
just test

# Run tests for a specific corpus file
./node_modules/.bin/tree-sitter test -f "SELECT with WHERE"

# Regenerate postgres grammar from PostgreSQL source (requires PG_SOURCE_DIR env var)
just generate

# Generate only the postgres grammar
just generate-postgres

# Generate only the plpgsql grammar
just generate-plpgsql

# Discover GLR conflicts iteratively
just harvest-conflicts

# Build WebAssembly
just build-wasm
```

`PG_SOURCE_DIR` must point to a local PostgreSQL source checkout. Recipes that need it will fail if unset.

## Architecture

This project auto-generates a tree-sitter grammar from PostgreSQL's own Bison grammar (`gram.y`) and keyword list (`kwlist.h`). There are two separate grammars:

- **postgres/** — Auto-generated SQL grammar. **Do not hand-edit `postgres/grammar.js`**; it is produced by the generation pipeline.
- **plpgsql/** — Hand-written PL/pgSQL grammar with an external scanner (`plpgsql/src/scanner.c`) for dollar-quoting and context-sensitive keywords. SQL fragments are delegated to the postgres parser via language injection (`plpgsql/queries/injections.scm`).

### Generation Pipeline

`script/generate-grammar.js` orchestrates the pipeline:

1. **parse-kwlist.js** — Extracts 494 keywords with PG categories (UNRESERVED, COL_NAME, TYPE_FUNC_NAME, RESERVED) from `kwlist.h`
2. **parse-gram-y.js** — Parses Bison grammar: strips C action blocks, extracts rules/terminals/precedence declarations/`%prec` annotations
3. **codegen.js** — Core generator (~716 lines) that transforms Bison rules into tree-sitter grammar.js:
   - Propagates optionality upward via fixpoint loop (Bison `/* EMPTY */` → `optional()` at call sites)
   - Splits `a_expr` into `a_expr_prec` (static precedence for binary/unary ops) and `a_expr` (GLR for complex patterns like IS, IN, BETWEEN, LIKE)
   - Emits case-insensitive keyword rules with `prec(1)` to outrank identifiers
   - Applies both `prec.left`/`prec.right` and `prec.dynamic` from `%prec` annotations

### Key Design Constraints

**Empty rule propagation**: Tree-sitter forbids non-start rules matching empty. The generator's fixpoint loop marks rules as optional and wraps *references* (not definitions) with `optional()`. This is the most subtle part of the codebase — always wrap at the call site, never the rule definition.

**GLR conflicts**: `postgres/known-conflicts.json` lists rule pairs that require GLR. `harvest-conflicts.sh` discovers these iteratively by running `tree-sitter generate`, parsing errors, and re-generating until clean.

**Operator precedence**: Binary operators use static precedence in `a_expr_prec` (no GLR needed). Complex operators (IS NULL, IN, BETWEEN, etc.) stay in `a_expr` with GLR conflict resolution.

## Test Corpus

Tests use tree-sitter's corpus format (SQL input → expected S-expression tree):
- `postgres/test/corpus/` — 11 files (select, dml, ddl, expressions, joins, etc.)
- `plpgsql/test/corpus/` — 9 files (blocks, control_flow, loops, cursors, etc.)

## Language Bindings

Bindings exist for C, Go, Node.js, Python, Rust, and Swift under `bindings/`. The Rust and Node bindings have their own test suites.
