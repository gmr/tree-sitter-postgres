---
name: pg-version-update
description: Update tree-sitter-postgres to a new PostgreSQL release — bump the PG source checkout, analyze grammar changes, fix the generator, regenerate, harvest GLR conflicts, add corpus tests, and align version numbers. Use when adopting a new PostgreSQL major/beta/point release (e.g. "update to PG 19", "adopt REL_19_0", "support the new Postgres beta").
---

# Updating tree-sitter-postgres to a new PostgreSQL release

This grammar is **auto-generated** from PostgreSQL's own Bison grammar (`gram.y`,
`pl_gram.y`) and keyword lists (`kwlist.h`). Adopting a new PostgreSQL release
means pointing the generator at a new source checkout, fixing the *generator*
(never the generated files) for any new syntax, regenerating, and re-harvesting
GLR conflicts.

Read `CONTRIBUTING.md` and `CLAUDE.md` before starting — they are the source of
truth for what is generated vs. hand-written. This skill is the step-by-step
procedure and the list of gotchas that aren't obvious from those docs.

## Prerequisites

- A PostgreSQL source checkout, path in `$PG_SOURCE_DIR` (typically
  `~/Source/gmr/postgres`). Codegen needs it; tests don't.
- **~67 GB free RAM** for the full parse-table build (`tree-sitter generate` on
  `postgres/grammar.js` peaks ~67 GB, ~8 min). On a smaller machine you can only
  run `just codegen-postgres` (the low-RAM Node step) and let a maintainer /
  CI do the full build. Check `sysctl hw.memsize` before attempting the full run.
- `npm install` done; `just` installed.

## Procedure

### 1. Point the PG checkout at the new release

```bash
git -C "$PG_SOURCE_DIR" fetch --tags
git -C "$PG_SOURCE_DIR" checkout REL_XX_Y      # e.g. REL_19_0, REL_19_BETA2
git -C "$PG_SOURCE_DIR" log -1 --oneline        # confirm the Stamp commit
```

### 2. Analyze what changed vs. the currently-targeted release

Diff the three inputs that drive codegen between the old tag and the new one:

```bash
git -C "$PG_SOURCE_DIR" diff OLD_TAG..NEW_TAG -- src/backend/parser/gram.y
git -C "$PG_SOURCE_DIR" diff OLD_TAG..NEW_TAG -- src/include/parser/kwlist.h
git -C "$PG_SOURCE_DIR" diff OLD_TAG..NEW_TAG -- src/backend/parser/scan.l
# plpgsql inputs:
git -C "$PG_SOURCE_DIR" diff OLD_TAG..NEW_TAG -- src/pl/plpgsql/src/pl_gram.y
git -C "$PG_SOURCE_DIR" diff OLD_TAG..NEW_TAG -- src/pl/plpgsql/src/pl_scanner.c
```

Find the old tag from the current README / `CONTRIBUTING.md` (they name the
targeted `REL_*` tag). Classify the diff into:

- **New keywords** (`kwlist.h`) — picked up automatically by `parse-kwlist.js`;
  no generator change needed, but they may shift keyword categories
  (UNRESERVED/COL_NAME/TYPE_FUNC_NAME/RESERVED), which can change parsing.
- **New/changed grammar rules** (`gram.y`) — mostly handled automatically, but
  new *token* patterns or lexer rules may need generator work (see step 3).
- **New lexer tokens** (`scan.l`) — e.g. PG 19 added `->` (`RIGHT_ARROW`) and a
  standalone `|`. New operator tokens need an entry in `OPERATOR_TOKEN_MAP` in
  `script/codegen.js`, and the `operator` lexer regex must match scan.l's rules
  (notably: an operator may end in `+`/`-` only if it also contains one of
  `~ ! @ # ^ & | ?`).
- **plpgsql keyword reclassification** (`pl_scanner.c`) — reserved↔unreserved
  moves are handled by `generate-plpgsql-grammar.js`.

Present the classified change list and a plan before editing anything.

### 3. Fix the generator, never the generated files

For anything the generator gets wrong, edit **`script/codegen.js`** (or its
helpers `parse-gram-y.js` / `parse-kwlist.js`) — not `postgres/grammar.js`,
which is overwritten on the next run. Known kinds of generator work:

- **New operator token**: add to `OPERATOR_TOKEN_MAP`; if it's a clean binary op
  (`a_expr OP a_expr`) confirm it lands in the static-precedence `a_expr_prec`
  path rather than forcing a new GLR conflict.
- **New lexer syntax**: adjust the `operator` `token(choice(...))` regex to
  match scan.l.
- **Bison char literals** like `'{'` / `'}'` (used by PG 19 graph-pattern
  quantifiers): `parse-gram-y.js` must pass single-quoted char literals through
  `stripCActions` verbatim so they aren't mistaken for C-action braces.

Iterate with the low-RAM codegen and review the grammar diff:

```bash
just codegen-postgres          # writes postgres/grammar.js only, no parse-table build
git diff postgres/grammar.js   # review new rules / changed tokens
```

### 4. Regenerate everything

```bash
just generate                  # postgres grammar (~67 GB RAM) + injections + plpgsql
```

On a low-RAM machine, run the parts that fit and hand the full build to CI:

```bash
just codegen-postgres
just generate-injections
just generate-plpgsql
```

### 5. Harvest GLR conflicts

New rules almost always introduce new GLR conflicts. Harvest them iteratively:

```bash
just harvest-conflicts
```

This appends pairs to `postgres/known-conflicts.json` and regenerates until
`tree-sitter generate` is clean.

> **GOTCHA — harvest writes artifacts to the wrong `src/`.**
> `harvest-conflicts.sh` runs `tree-sitter generate` from the **repo root**, so
> `parser.c`, `grammar.json`, `node-types.json`, and `tree_sitter/` headers land
> in a stray **repo-root `src/`**, not `postgres/src/`. After a successful
> harvest:
> 1. Move those artifacts into `postgres/src/` (preserving the hand-written
>    `postgres/src/scanner.c`).
> 2. Delete the stray repo-root `src/`.

> **GOTCHA — stale tree-sitter cache dylib.** The CLI does not reliably rebuild
> its cached parser when `parser.c` changes. A stale
> `~/.cache/tree-sitter/lib/postgres.dylib` makes new keywords lex as plain
> identifiers while old tests still pass — a very confusing symptom. Always:
> ```bash
> rm -f ~/.cache/tree-sitter/lib/postgres.dylib
> ```
> The same staleness hits the Node binding: force `npx node-gyp rebuild` if the
> Node addon tests don't see the new rules.

### 6. Add corpus tests for the new syntax

Add hand-written cases to `postgres/test/corpus/*.txt` (and
`plpgsql/test/corpus/*.txt` for PL/pgSQL changes). Group a release's new
features in a dedicated file (e.g. `postgres/test/corpus/pg19.txt`, and a
separate file per big feature like `property_graph.txt`). Then:

```bash
just test                      # runs both grammars' corpora
```

Fix the *generator* (or the conflict list) until green — not the S-expressions
by hand unless the expected tree is genuinely what you want.

### 7. Align version numbers

Versions track the supported PostgreSQL release (see the
`pg19-version-alignment` project memory). Two formats are needed:

- **semver** (`19.0.0-beta.2`) in: `justfile`, `package.json`,
  `package-lock.json`, `Cargo.toml`, `tree-sitter.json`
- **PEP 440** (`19.0.0b2`) in: `pyproject.toml`
- `Cargo.lock` via `cargo update --workspace`

`just bump 19.0.0-beta.2` handles all of this in one shot: it rewrites every
file and derives the PEP 440 form for `pyproject.toml` automatically
(`-beta.2` → `b2`, `-alpha`/`-rc` likewise) and runs `cargo update --workspace`.
Pass the semver form; the recipe does the conversion.

### 8. Update docs

- `README.md` — "Current as of PostgreSQL XX ... (generated from REL_XX_Y)".
- `CONTRIBUTING.md` — the `REL_*` tag references in the setup section.

### 9. Validate and open the PR

```bash
just test
git diff --stat                # confirm only intended files moved
```

The generated `postgres/src/parser.c` is ~110 MB and tracked via **Git LFS** —
confirm `git lfs status` shows it as an LFS object before pushing. Open the PR
with `git-repository:pr-creation`; for a beta/rc, call it a **pre-release** and
hold the GA-quality tag until the PostgreSQL release is final (beta grammar
rules occasionally get reverted before GA).

## Quick checklist

1. `git -C $PG_SOURCE_DIR checkout REL_XX_Y`
2. Diff `gram.y` / `kwlist.h` / `scan.l` / `pl_gram.y` / `pl_scanner.c`; classify + plan
3. Fix `script/codegen.js` (+ helpers) for new tokens/syntax — never edit generated files
4. `just codegen-postgres` → review `postgres/grammar.js` diff → `just generate`
5. `just harvest-conflicts` → move artifacts to `postgres/src/`, delete stray root `src/`, `rm ~/.cache/tree-sitter/lib/postgres.dylib`
6. Add corpus tests → `just test`
7. Bump versions (semver + PEP 440 + `cargo update`)
8. Update `README.md` + `CONTRIBUTING.md`
9. Verify LFS on `parser.c`, open PR (pre-release for beta/rc)
