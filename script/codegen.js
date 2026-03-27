'use strict';
const { caseInsensitiveRegex, kwRuleName,
  UNRESERVED_KEYWORD, COL_NAME_KEYWORD, TYPE_FUNC_NAME_KEYWORD, RESERVED_KEYWORD } = require('./parse-kwlist');

// ─── Token resolution maps ────────────────────────────────────────────────────

/**
 * Non-keyword terminal tokens that map to literal strings in the grammar.
 * These are the special compound operators defined in gram.y.
 */
const OPERATOR_TOKEN_MAP = {
  TYPECAST:        "'::'",
  DOT_DOT:         "'..'",
  COLON_EQUALS:    "':='",
  EQUALS_GREATER:  "'=>'",
  LESS_EQUALS:     "'<='",
  GREATER_EQUALS:  "'>='",
  NOT_EQUALS:      "'<>'",
};

/**
 * Look-ahead synthetic tokens — map to their base keyword.
 * Bison uses these to resolve LALR(1) conflicts via lookahead.
 * In tree-sitter (GLR), we simply use the base keyword.
 */
const LOOKAHEAD_TOKEN_MAP = {
  NOT_LA:     'NOT',
  NULLS_LA:   'NULLS_P',
  WITH_LA:    'WITH',
  WITHOUT_LA: 'WITHOUT',
  FORMAT_LA:  'FORMAT',
};

/**
 * Mode tokens — parser-internal signals, not real syntax.
 * We drop the alternatives that use these (they're for PL/pgSQL).
 */
const MODE_TOKENS = new Set([
  'MODE_TYPE_NAME',
  'MODE_PLPGSQL_EXPR',
  'MODE_PLPGSQL_ASSIGN1',
  'MODE_PLPGSQL_ASSIGN2',
  'MODE_PLPGSQL_ASSIGN3',
]);

/**
 * Base (non-keyword) tokens from gram.y — map to tree-sitter rule references.
 */
const BASE_TOKEN_MAP = {
  IDENT:   '$.identifier',
  UIDENT:  '$.identifier',   // unicode identifier, simplify for now
  FCONST:  '$.float_literal',
  SCONST:  '$.string_literal',
  USCONST: '$.string_literal',
  BCONST:  '$.bit_string_literal',
  XCONST:  '$.hex_string_literal',
  ICONST:  '$.integer_literal',
  Op:      '$.operator',
  PARAM:   '$.param',
};

// ─── Symbol resolution ────────────────────────────────────────────────────────

/**
 * Resolve a grammar symbol (terminal or non-terminal) to a tree-sitter expression string.
 *
 * @param {string} sym          — symbol name from gram.y
 * @param {Set}    terminals    — set of all terminal token names
 * @param {Map}    kwTokenMap   — Bison token name -> keyword info
 * @returns {string|null}       — JS expression string, or null to skip this token
 */
function resolveSymbol(sym, terminals, kwTokenMap) {
  // Mode tokens — skip (not real syntax)
  if (MODE_TOKENS.has(sym)) return null;

  // Look-ahead tokens — substitute base keyword
  if (LOOKAHEAD_TOKEN_MAP[sym]) {
    const base = LOOKAHEAD_TOKEN_MAP[sym];
    if (kwTokenMap.has(base)) {
      return `$.${kwRuleName(base)}`;
    }
    // Fallback if not in kwlist (shouldn't happen)
    return `'${base.toLowerCase()}'`;
  }

  // Operator tokens — literal strings
  if (OPERATOR_TOKEN_MAP[sym]) {
    return OPERATOR_TOKEN_MAP[sym];
  }

  // Base tokens — rule references
  if (BASE_TOKEN_MAP[sym]) {
    return BASE_TOKEN_MAP[sym];
  }

  // Keyword tokens (from kwlist.h)
  if (kwTokenMap.has(sym)) {
    return `$.${kwRuleName(sym)}`;
  }

  // Other terminals not in keyword list — could be single-char ops already
  // handled as LITERAL by the tokenizer, so this case is mostly non-terminals
  if (terminals.has(sym)) {
    // Unknown terminal not otherwise mapped — treat as string literal
    return `'${sym.toLowerCase()}'`;
  }

  // Non-terminal — reference to another rule
  return `$.${sym}`;
}

/**
 * Resolve a LITERAL token (single-quoted char like '(' ')' ';' etc.)
 */
function resolveLiteral(value) {
  // Escape backslash and single-quote for JS string
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// ─── Alternative → expression ────────────────────────────────────────────────

/**
 * Convert one alternative (array of tokens) to a tree-sitter expression.
 * Returns null if the alternative should be dropped (e.g. all mode tokens).
 *
 * @param {Set} optionalRules — set of rule names that have empty alternatives;
 *   references to these are wrapped with optional() at the call site.
 */
function altToExpr(alt, terminals, kwTokenMap, optionalRules) {
  // Check if wrapping every optional element would make this entire
  // alternative match empty. If so, we must NOT wrap any element —
  // the containing rule is already in optionalRules (via propagation)
  // and will be wrapped at its call sites instead.
  const allCanBeEmpty = alt.every(tok => {
    if (tok.type === 'LITERAL') return false;
    if (tok.type !== 'SYMBOL') return false;
    if (terminals.has(tok.value)) return false;
    if (kwTokenMap.has(tok.value)) return false;
    if (LOOKAHEAD_TOKEN_MAP[tok.value]) return false;
    if (OPERATOR_TOKEN_MAP[tok.value]) return false;
    if (BASE_TOKEN_MAP[tok.value]) return false;
    return optionalRules.has(tok.value);
  });

  const parts = [];

  for (const tok of alt) {
    let expr;
    if (tok.type === 'LITERAL') {
      expr = resolveLiteral(tok.value);
    } else {
      expr = resolveSymbol(tok.value, terminals, kwTokenMap);
      if (expr === null) {
        // Mode token in this alternative — drop the whole alternative
        return null;
      }
      // Wrap non-terminal references to optional rules with optional()
      // EXCEPTION: skip wrapping when ALL elements are optional —
      // wrapping them all would make the seq/alternative match empty.
      if (optionalRules && !allCanBeEmpty
          && !terminals.has(tok.value) && !LOOKAHEAD_TOKEN_MAP[tok.value]
          && !MODE_TOKENS.has(tok.value) && !OPERATOR_TOKEN_MAP[tok.value]
          && !BASE_TOKEN_MAP[tok.value] && optionalRules.has(tok.value)) {
        expr = `optional(${expr})`;
      }
    }
    parts.push(expr);
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `seq(${parts.join(', ')})`;
}

// ─── Rule → grammar.js entry ──────────────────────────────────────────────────

/**
 * Generate the grammar.js rule body for one rule.
 *
 * Rules with empty alternatives (hasEmpty = true) are defined WITHOUT
 * optional() here — instead, every reference to such a rule from another
 * rule is wrapped with optional() at the call site (see altToExpr).
 * This is required because tree-sitter does not allow non-start rules to
 * match the empty string.
 *
 * @param {string}   name          — rule name
 * @param {object}   rule          — { alternatives, hasEmpty }
 * @param {Set}      terminals     — terminal set
 * @param {Map}      kwTokenMap    — keyword token map
 * @param {Set}      optionalRules — rules that have empty alternatives
 * @returns {string|null}          — JS snippet, or null to skip this rule
 */
function generateRule(name, rule, terminals, kwTokenMap, optionalRules) {
  const { alternatives } = rule;

  // Convert each alternative to an expression, filtering nulls
  const altExprs = alternatives
    .map(alt => altToExpr(alt, terminals, kwTokenMap, optionalRules))
    .filter(e => e !== null);

  if (altExprs.length === 0) {
    // All alternatives dropped (pure empty rule or all mode tokens) — skip
    return null;
  }

  let expr;
  if (altExprs.length === 1) {
    expr = altExprs[0];
  } else {
    expr = `choice(\n        ${altExprs.join(',\n        ')}\n      )`;
  }

  return `    ${name}: $ => ${expr},\n`;
}

// ─── Keyword rules ────────────────────────────────────────────────────────────

/**
 * Generate all keyword token rules for grammar.js.
 * Each keyword becomes a case-insensitive regex token with prec(1) over identifiers.
 */
function generateKeywordRules(keywords) {
  const lines = [];

  for (const kw of keywords) {
    const ruleName = kwRuleName(kw.token);
    const regex = caseInsensitiveRegex(kw.name);
    lines.push(`    ${ruleName}: _ => token(prec(1, /${regex}/)),\n`);
  }

  return lines.join('');
}

// ─── Lexer rules ──────────────────────────────────────────────────────────────

/**
 * Generate the base lexer rules (identifier, literals, operators, comments).
 * These correspond to the token patterns in scan.l.
 */
function generateLexerRules() {
  // NOTE: backslashes in these template strings are for the OUTPUT file —
  // each \\ here becomes a single \ in grammar.js (which is a JS file).
  return `
    // ── Identifiers ──────────────────────────────────────────────────────────────

    // Plain unquoted identifier; keywords (prec 1) take priority over this (prec 0).
    identifier: _ => token(prec(0, /[a-zA-Z_\\u0080-\\u00ff][a-zA-Z0-9_$\\u0080-\\u00ff]*/)),

    // Double-quoted delimited identifier: "my table" or "My""Column"
    quoted_identifier: _ => token(/"([^"]|"")*"/),

    // Positional parameter: $1, $2, ...
    param: _ => /\\$[0-9]+/,

    // ── Numeric literals ─────────────────────────────────────────────────────────

    integer_literal: _ => token(/[0-9](_?[0-9])*/),

    float_literal: _ => token(choice(
      /[0-9](_?[0-9])*\\.[0-9](_?[0-9])*([eE][+-]?[0-9](_?[0-9])*)? /,
      /\\.[0-9](_?[0-9])*([eE][+-]?[0-9](_?[0-9])*)? /,
      /[0-9](_?[0-9])*[eE][+-]?[0-9](_?[0-9])*/
    )),

    // ── String literals ──────────────────────────────────────────────────────────

    // Standard SQL string: 'hello' — doubled single-quote is the escape: 'it''s'
    string_literal: _ => token(/'([^']|'')*'/),

    // E-prefix escape string: E'hello\\nworld'
    escape_string_literal: _ => token(/[eE]'([^'\\\\]|\\\\.)*'/),

    // Dollar-quoted string: $$body$$ or $tag$body$tag$
    // NOTE: full correctness requires matching the open/close tags;
    // this regex accepts any dollar-quoted form and is good enough for highlighting.
    dollar_quoted_string: _ => token(/\\$[a-zA-Z_0-9]*\\$[\\s\\S]*?\\$[a-zA-Z_0-9]*\\$/),

    // Bit string: B'0101'
    bit_string_literal: _ => token(/[bB]'[01]*'/),

    // Hex string: X'deadbeef'
    hex_string_literal: _ => token(/[xX]'[0-9a-fA-F]*'/),

    // National character string: N'text'
    national_string_literal: _ => token(/[nN]'([^']|'')*'/),

    // ── Operators ────────────────────────────────────────────────────────────────

    // Custom and built-in multi-character operators.
    // The specific compound operators (::, .., :=, =>, <=, >=, <>) are matched
    // as string literals in the grammar rules and take priority.
    operator: _ => token(/[~!@#^&|?+\\-*\/%<>=]+/),

    // ── Comments ─────────────────────────────────────────────────────────────────

    comment: _ => token(choice(
      /--[^\\r\\n]*/,
      /\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\//
    )),
`;
}

// ─── Main codegen ─────────────────────────────────────────────────────────────

/**
 * Generate the full grammar.js content.
 *
 * @param {Array}   keywords        — from parseKwlist
 * @param {Set}     terminals       — from parseGramY
 * @param {Map}     rules           — from parseGramY
 * @param {Array}   knownConflicts  — array of [rule1, rule2] string pairs
 * @returns {{ content: string, ruleCount: number }}
 */
function generateGrammarJs(keywords, terminals, rules, knownConflicts = []) {
  // Build keyword token map: Bison token name -> keyword info
  const kwTokenMap = new Map();
  for (const kw of keywords) {
    kwTokenMap.set(kw.token, kw);
  }

  // Build set of "optional rules" — rules with empty alternatives.
  // References to these rules in other rules will be wrapped with optional()
  // at the call site, rather than in the rule definition, because tree-sitter
  // does not allow non-start rules that can match the empty string.
  const optionalRules = new Set();
  for (const [name, rule] of rules) {
    if (rule.hasEmpty) optionalRules.add(name);
  }

  // Propagate optionality upward: a rule is effectively optional if any
  // alternative can match empty. An alternative can match empty if:
  //   (a) it has a single non-terminal symbol that is in optionalRules, OR
  //   (b) ALL of its non-terminal symbols are in optionalRules and there
  //       are no terminal tokens (literals, keywords, operators).
  // We propagate transitively so the optionality is handled at call sites.
  // This prevents tree-sitter's "matches the empty string" error.
  function altCanBeEmpty(alt) {
    if (alt.length === 0) return true;
    return alt.every(tok => {
      if (tok.type === 'LITERAL') return false;
      if (tok.type !== 'SYMBOL') return false;
      // Terminal symbols (keywords, operators, base tokens) are always required
      if (terminals.has(tok.value)) return false;
      if (kwTokenMap.has(tok.value)) return false;
      if (LOOKAHEAD_TOKEN_MAP[tok.value]) return false;
      if (OPERATOR_TOKEN_MAP[tok.value]) return false;
      if (BASE_TOKEN_MAP[tok.value]) return false;
      // Non-terminal — only optional if in optionalRules
      return optionalRules.has(tok.value);
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, rule] of rules) {
      if (optionalRules.has(name)) continue;
      for (const alt of rule.alternatives) {
        if (altCanBeEmpty(alt)) {
          optionalRules.add(name);
          changed = true;
          break;
        }
      }
    }
  }

  const lines = [];

  // ── File header ─────────────────────────────────────────────────────────────
  lines.push(`// grammar.js — PostgreSQL tree-sitter grammar
// Generated by script/generate-grammar.js from PostgreSQL source.
// DO NOT EDIT MANUALLY — regenerate with: npm run generate:grammar
//
// Source: src/backend/parser/gram.y + src/include/parser/kwlist.h
// This file is committed to git so the grammar can be used without
// running the generator.

'use strict';

module.exports = grammar({
  name: 'postgres',

  // Whitespace and comments are extras — they can appear anywhere.
  extras: $ => [
    /\\s+/,
    $.comment,
  ],

  // 'word' lets tree-sitter know which rule represents bare identifiers.
  // Keywords (prec 1) outrank identifiers (prec 0) on the same text.
  word: $ => $.identifier,

  // Conflicts: PostgreSQL's grammar has many shift/reduce conflicts that
  // Bison resolves via precedence rules. Tree-sitter (GLR) will handle
  // these as ambiguities. Conflict pairs are stored in script/known-conflicts.json
  // and regenerated into this file automatically via script/harvest-conflicts.sh.
  conflicts: $ => [
${knownConflicts.map(([a, b]) => `    [$.${a}, $.${b}],`).join('\n')}
  ],

  rules: {
`);

  // ── Entry point ─────────────────────────────────────────────────────────────
  // Override parse_toplevel to remove mode-token alternatives and map to
  // a cleaner source_file entry.
  lines.push(`    // Top-level entry: a file is zero or more semicolon-terminated statements.
    source_file: $ => repeat(seq(optional($.toplevel_stmt), ';')),

`);

  // ── Grammar rules ────────────────────────────────────────────────────────────
  // Emit all rules from gram.y except parse_toplevel (we replaced it above)
  // and the unreserved/col_name/type_func_name/reserved_keyword list rules
  // (we generate those from kwlist.h below, to avoid the huge repetition).
  const skipRules = new Set([
    'parse_toplevel',        // replaced by source_file above
    'stmtblock',             // internal; parse_toplevel calls it
    'stmtmulti',             // internal; replaced by source_file repeat
  ]);

  // The keyword category list rules in gram.y (e.g. unreserved_keyword: ABORT_P | ABSENT | ...)
  // are very long lists that we regenerate from kwlist.h for accuracy.
  const kwCategoryRules = new Set([
    'unreserved_keyword',
    'col_name_keyword',
    'type_func_name_keyword',
    'reserved_keyword',
  ]);

  let ruleCount = 0;
  for (const [name, rule] of rules) {
    if (skipRules.has(name) || kwCategoryRules.has(name)) continue;

    const snippet = generateRule(name, rule, terminals, kwTokenMap, optionalRules);
    if (snippet !== null) {
      lines.push(snippet);
      ruleCount++;
    }
  }

  // ── Keyword category rules ────────────────────────────────────────────────
  // Generated from kwlist.h, grouped by category
  const unreserved = keywords.filter(k => k.category === UNRESERVED_KEYWORD);
  const colName    = keywords.filter(k => k.category === COL_NAME_KEYWORD);
  const typeFunc   = keywords.filter(k => k.category === TYPE_FUNC_NAME_KEYWORD);
  const reserved   = keywords.filter(k => k.category === RESERVED_KEYWORD);

  function kwListRule(ruleName, kwList) {
    if (kwList.length === 0) return '';
    const choices = kwList.map(k => `$.${kwRuleName(k.token)}`).join(',\n        ');
    return `    ${ruleName}: $ => choice(\n        ${choices}\n      ),\n\n`;
  }

  lines.push('\n    // ── Keyword category lists (from kwlist.h) ─────────────────────────────\n\n');
  lines.push(kwListRule('unreserved_keyword', unreserved));
  lines.push(kwListRule('col_name_keyword', colName));
  lines.push(kwListRule('type_func_name_keyword', typeFunc));
  lines.push(kwListRule('reserved_keyword', reserved));

  // ── Keyword token rules ───────────────────────────────────────────────────
  lines.push('\n    // ── Keyword tokens (case-insensitive) ────────────────────────────────────\n\n');
  lines.push(generateKeywordRules(keywords));

  // ── Lexer rules ───────────────────────────────────────────────────────────
  lines.push('\n    // ── Lexer rules ────────────────────────────────────────────────────────────\n');
  lines.push(generateLexerRules());

  // ── Close ────────────────────────────────────────────────────────────────
  lines.push(`  }, // end rules\n}); // end grammar\n`);

  const content = lines.join('');
  return { content, ruleCount };
}

module.exports = { generateGrammarJs };
