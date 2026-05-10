#!/usr/bin/env node
'use strict';

/**
 * generate-injections.js
 *
 * Generates postgres/queries/injections.scm — the language-injection queries
 * that delegate dollar-quoted CREATE FUNCTION / CREATE PROCEDURE bodies to the
 * plpgsql or postgres parser based on the LANGUAGE clause.
 *
 * Why this is generated:
 *   The createfunc_opt_list rule in gram.y is left-recursive, so the LANGUAGE
 *   and AS items can sit at varying depths. Tree-sitter queries don't have
 *   wildcards over recursive lists, so we emit one pattern per (depth,
 *   ordering, language) combination — 4*N nearly-identical blocks. Encoding
 *   this in a script (rather than hand-maintaining the .scm) keeps fixes like
 *   case-insensitive language matching from being lost when the file is
 *   regenerated, and makes it trivial to extend the depth coverage.
 *
 * Usage:
 *   node script/generate-injections.js
 *
 * Output:
 *   postgres/queries/injections.scm
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const outputPath = path.join(projectRoot, 'postgres/queries/injections.scm');

// Number of CREATE FUNCTION options to support. Real-world CREATE FUNCTION
// statements rarely exceed 7 options; depths 2..MAX_OPTIONS cover both
// orderings (LANGUAGE deeper / AS deeper) for n options each.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 7;

// ─── Building blocks ──────────────────────────────────────────────────────────

const indent = (n) => '  '.repeat(n);

// Match a LANGUAGE option whose lang name is captured as @_lang. Used for
// plpgsql, where we filter the captured name with a case-insensitive
// #match? predicate.
function langItemCapture(level) {
  return [
    `${indent(level)}(createfunc_opt_item`,
    `${indent(level + 1)}(kw_language)`,
    `${indent(level + 1)}(NonReservedWord_or_Sconst`,
    `${indent(level + 2)}(NonReservedWord`,
    `${indent(level + 3)}(identifier) @_lang)))`,
  ].join('\n');
}

// Match a LANGUAGE option whose lang name is the SQL keyword. SQL is a
// reserved keyword in this position so it parses as (kw_sql), not as an
// identifier — no predicate needed.
function langItemSqlKeyword(level) {
  return [
    `${indent(level)}(createfunc_opt_item`,
    `${indent(level + 1)}(kw_language)`,
    `${indent(level + 1)}(NonReservedWord_or_Sconst`,
    `${indent(level + 2)}(NonReservedWord`,
    `${indent(level + 3)}(unreserved_keyword`,
    `${indent(level + 4)}(kw_sql)))))`,
  ].join('\n');
}

// Match an AS option whose dollar-quoted body becomes @injection.content.
function asItem(level) {
  return [
    `${indent(level)}(createfunc_opt_item`,
    `${indent(level + 1)}(func_as`,
    `${indent(level + 2)}(Sconst`,
    `${indent(level + 3)}(dollar_quoted_string) @injection.content)))`,
  ].join('\n');
}

// Build a query block for n CREATE FUNCTION options.
//
//   n       - total number of options (>= 2)
//   deeper  - 'language' or 'as'  — which item sits at the deepest cfol
//   langItem(level)  - emitter for the LANGUAGE item at the given indent level
//   tail    - predicate + #set! lines that follow the matched tree
function buildBlock(n, deeper, langItem, tail) {
  const deepestItem = deeper === 'language' ? langItem : asItem;
  const rightmostItem = deeper === 'language' ? asItem : langItem;

  const lines = [];
  lines.push('((CreateFunctionStmt');
  lines.push(`${indent(1)}(opt_createfunc_opt_list`);

  // Open n nested createfunc_opt_list: outer is level 2 (after
  // CreateFunctionStmt and opt_createfunc_opt_list), deepest is level n+1.
  for (let i = 0; i < n; i++) {
    lines.push(`${indent(2 + i)}(createfunc_opt_list`);
  }

  // Deepest item lives inside the innermost cfol (level n+2).
  lines.push(deepestItem(n + 2));

  // Close the n-1 inner cfols by appending ')'.repeat(n-1) to the
  // deepest-item line, then push the rightmost item at indent 3 (a sibling
  // child of the outermost cfol), then append ')))' to close the outermost
  // cfol + opt_createfunc_opt_list + CreateFunctionStmt.
  const innerCloses = ')'.repeat(n - 1);
  lines[lines.length - 1] += innerCloses;
  lines.push(rightmostItem(3));
  lines[lines.length - 1] += ')))';

  lines.push(...tail);
  return lines.join('\n');
}

// ─── Tail predicates ──────────────────────────────────────────────────────────

// PL/pgSQL: case-insensitive #match? on the captured @_lang. PostgreSQL
// itself accepts LANGUAGE plpgsql / PLPGSQL / PlPgSql interchangeably
// (the language name is a NonReservedWord, lookup is case-insensitive),
// so the injection must match all casings.
const plpgsqlTail = [
  ` (#match? @_lang "(?i)^plpgsql$")`,
  ` (#set! injection.language "plpgsql")`,
  ` (#set! injection.include-children))`,
];

// SQL: kw_sql is a structural match in the grammar, so case-insensitivity
// is handled by the lexer — no predicate needed.
const sqlTail = [
  ` (#set! injection.language "sql")`,
  ` (#set! injection.include-children))`,
];

// ─── Emit ─────────────────────────────────────────────────────────────────────

const out = [];

out.push('; injections.scm — tree-sitter-postgres language injection queries');
out.push(';');
out.push('; Dollar-quoted function bodies in CREATE FUNCTION / CREATE PROCEDURE');
out.push('; are injected as plpgsql or postgres depending on the LANGUAGE clause.');
out.push(';');
out.push('; The createfunc_opt_list is left-recursive, so the LANGUAGE and AS items');
out.push('; may be at varying nesting depths depending on how many options appear.');
out.push(`; Patterns cover ${MIN_OPTIONS}..${MAX_OPTIONS} createfunc_opt_items in both orderings,`);
out.push('; which handles all practical CREATE FUNCTION statements.');
out.push(';');
out.push('; GENERATED FILE — DO NOT EDIT MANUALLY.');
out.push('; Regenerate with: node script/generate-injections.js');
out.push('');
out.push('; ============================================================');
out.push('; PL/pgSQL injection');
out.push('; ============================================================');
out.push('');

for (let n = MIN_OPTIONS; n <= MAX_OPTIONS; n++) {
  out.push(`; ${n} options: LANGUAGE deeper, AS rightmost`);
  out.push(buildBlock(n, 'language', langItemCapture, plpgsqlTail));
  out.push('');
  out.push(`; ${n} options: AS deeper, LANGUAGE rightmost`);
  out.push(buildBlock(n, 'as', langItemCapture, plpgsqlTail));
  out.push('');
}

out.push('; ============================================================');
out.push('; SQL injection (postgres self-injection)');
out.push('; ============================================================');
out.push('');

for (let n = MIN_OPTIONS; n <= MAX_OPTIONS; n++) {
  out.push(`; ${n} options: LANGUAGE deeper, AS rightmost`);
  out.push(buildBlock(n, 'language', langItemSqlKeyword, sqlTail));
  out.push('');
  out.push(`; ${n} options: AS deeper, LANGUAGE rightmost`);
  out.push(buildBlock(n, 'as', langItemSqlKeyword, sqlTail));
  out.push('');
}

const content = out.join('\n');
fs.writeFileSync(outputPath, content, 'utf8');

console.log(`Wrote ${outputPath}`);
console.log(`  ${(MAX_OPTIONS - MIN_OPTIONS + 1) * 4} query blocks emitted`);
console.log(`  ${content.split('\n').length} lines`);
