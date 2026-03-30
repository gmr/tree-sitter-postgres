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
  UIDENT:  '$.identifier',   // reduced to IDENT in PG lexer
  FCONST:  '$.float_literal',
  SCONST:  'choice($.string_literal, $.dollar_quoted_string)',
  USCONST: 'choice($.string_literal, $.dollar_quoted_string)',  // reduced to SCONST in PG lexer
  BCONST:  '$.bit_string_literal',
  XCONST:  '$.hex_string_literal',
  ICONST:  '$.integer_literal',
  Op:      '$.operator',
  PARAM:   '$.param',
};

// ─── Precedence ──────────────────────────────────────────────────────────────

/**
 * Build a lookup map from token/literal to { level, assoc }.
 * Token names are stored as-is ("UNION"), single-char literals as ("'+'").
 */
function buildPrecedenceMap(precedence) {
  const map = new Map();
  for (const { type, tokens, level } of precedence) {
    for (const tok of tokens) {
      map.set(tok, { level, assoc: type });
    }
  }
  return map;
}

/**
 * Determine the precedence for an alternative.
 *
 * If an explicit %prec annotation is present, use that token's precedence.
 * Otherwise, use the first terminal with declared precedence. This differs
 * from Bison (which uses the rightmost terminal), but is more appropriate for
 * tree-sitter: tree-sitter resolves shift/reduce conflicts by comparing rule
 * precedences, and the first operator/keyword is what drives the conflict
 * decision. E.g., `a_expr IN '(' expr_list ')'` should have IN's precedence
 * (level 8), not ')'s (level 20), because the conflict occurs at the IN token.
 *
 * @param {Array} alt       — token array (may contain a trailing PREC token)
 * @param {Map}   precMap   — token/literal -> { level, assoc }
 * @param {Set}   terminals — terminal token names
 * @returns {{ level: number, assoc: string }|null}
 */
function determinePrecedence(alt, precMap, terminals) {
  // Explicit %prec annotation takes priority
  for (const tok of alt) {
    if (tok.type === 'PREC') {
      return precMap.get(tok.value) || null;
    }
  }

  // First terminal with declared precedence
  for (let i = 0; i < alt.length; i++) {
    const tok = alt[i];
    if (tok.type === 'LITERAL') {
      const key = "'" + tok.value + "'";
      const info = precMap.get(key);
      if (info) return info;
    }
    if (tok.type === 'SYMBOL' && terminals.has(tok.value)) {
      const info = precMap.get(tok.value);
      if (info) return info;
    }
  }

  return null;
}

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
function altToExpr(alt, terminals, kwTokenMap, optionalRules, precMap) {
  // Separate syntax tokens from PREC annotation
  const syntaxAlt = alt.filter(tok => tok.type !== 'PREC');

  // Determine precedence for this alternative (uses original alt with PREC)
  const precInfo = precMap ? determinePrecedence(alt, precMap, terminals) : null;

  // Check if wrapping every optional element would make this entire
  // alternative match empty. If so, we must NOT wrap any element —
  // the containing rule is already in optionalRules (via propagation)
  // and will be wrapped at its call sites instead.
  const allCanBeEmpty = syntaxAlt.every(tok => {
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

  for (const tok of syntaxAlt) {
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
  let expr;
  if (parts.length === 1) expr = parts[0];
  else expr = `seq(${parts.join(', ')})`;

  // Wrap with precedence if applicable.
  // We use both static precedence (prec/prec.left/prec.right) for
  // generation-time conflict resolution and associativity, AND dynamic
  // precedence (prec.dynamic) for runtime GLR disambiguation. This is
  // necessary because rules declared in the conflicts array use GLR at
  // parse time, where only prec.dynamic is consulted.
  if (precInfo) {
    const { level, assoc } = precInfo;
    expr = `prec.dynamic(${level}, ${expr})`;
    if (assoc === 'left') {
      expr = `prec.left(${level}, ${expr})`;
    } else if (assoc === 'right') {
      expr = `prec.right(${level}, ${expr})`;
    } else {
      // nonassoc in Bison means the operator can't chain (a = b = c is invalid).
      // tree-sitter has no prec.nonassoc, so we use prec.left as the closest
      // approximation — it parses deterministically and accepts slightly more
      // than Bison would (but rejects at the semantic level anyway).
      expr = `prec.left(${level}, ${expr})`;
    }
  }

  return expr;
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
function generateRule(name, rule, terminals, kwTokenMap, optionalRules, precMap) {
  const { alternatives } = rule;

  // Convert each alternative to an expression, filtering nulls
  const altExprs = alternatives
    .map(alt => altToExpr(alt, terminals, kwTokenMap, optionalRules, precMap))
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

/**
 * For expression rules (a_expr, b_expr), split alternatives into:
 * - "prec-resolvable": clean binary/unary operators resolved by static prec
 * - "complex": alternatives requiring GLR (IS, IN, BETWEEN, LIKE, subquery_Op)
 *
 * The prec alternatives go into a hidden _X_prec rule that is SELF-REFERENTIAL
 * (operands reference _X_prec, not X) so it's completely decoupled from X's
 * GLR conflicts. Static precedence cleanly resolves all _X_prec self-conflicts.
 *
 * The main rule X includes _X_prec as an alternative plus the complex alternatives.
 */
function generateExprRule(name, rule, terminals, kwTokenMap, optionalRules, precMap) {
  const { alternatives } = rule;
  const precRuleName = `${name}_prec`;

  const precAlts = [];
  const complexAlts = [];

  for (const alt of alternatives) {
    const syntaxTokens = alt.filter(t => t.type !== 'PREC');
    const precInfo = determinePrecedence(alt, precMap, terminals);

    // A "prec-resolvable" alternative must be a simple binary/unary pattern
    // with a LITERAL operator (single-char like +, -, *, etc.). These go into
    // the self-referential _prec rule for static precedence resolution.
    //
    // AND, OR, and NOT are kept in the main (complex) rule so they reference
    // $.a_expr instead of $.a_expr_prec. This allows IS/ISNULL/NOTNULL results
    // (which are a_expr, not a_expr_prec) to participate as operands of boolean
    // operators. Without this, `a IS NULL AND b = 1` cannot parse because the
    // IS result can't be consumed by a_expr_prec's AND rule.
    //
    // Complex keyword operators (IS, LIKE, ILIKE, etc.) have multiple
    // alternatives starting the same way and create multi-way conflicts
    // that need GLR.
    let isCleanOp = false;
    if (precInfo && syntaxTokens.length >= 2 && syntaxTokens.length <= 3) {
      // Binary: self OP self (where OP is a literal or operator token)
      if (syntaxTokens.length === 3
          && syntaxTokens[0].type === 'SYMBOL' && syntaxTokens[0].value === name
          && syntaxTokens[2].type === 'SYMBOL' && syntaxTokens[2].value === name
          && syntaxTokens[1].type === 'LITERAL') {
        isCleanOp = true;
      }
      // Binary postfix: self OP arg (like TYPECAST Typename, COLLATE any_name)
      // These have unique operator tokens that don't create multi-way conflicts.
      // The operator must have declared precedence and not be a complex keyword
      // that starts multiple alternatives (like IS, IN, LIKE, AND, OR, etc.)
      const complexKw = new Set(['IS', 'ISNULL', 'NOTNULL', 'IN_P', 'LIKE', 'ILIKE',
        'SIMILAR', 'BETWEEN', 'NOT', 'NOT_LA', 'AND', 'OR']);
      if (syntaxTokens.length === 3
          && syntaxTokens[0].type === 'SYMBOL' && syntaxTokens[0].value === name
          && syntaxTokens[1].type === 'SYMBOL' && !complexKw.has(syntaxTokens[1].value)
          && syntaxTokens[2].type === 'SYMBOL' && syntaxTokens[2].value !== name
          && precInfo) {
        isCleanOp = true;
      }
      // Unary prefix: OP self (where OP is a literal char like +, -)
      if (syntaxTokens.length === 2
          && syntaxTokens[0].type === 'LITERAL'
          && syntaxTokens[1].type === 'SYMBOL' && syntaxTokens[1].value === name) {
        isCleanOp = true;
      }
    }

    if (isCleanOp) {
      precAlts.push(alt);
    } else {
      complexAlts.push(alt);
    }
  }

  if (precAlts.length === 0) {
    return generateRule(name, rule, terminals, kwTokenMap, optionalRules, precMap);
  }

  const result = [];

  // Generate the _prec rule with SELF-REFERENTIAL operands.
  // Replace references to the parent rule (e.g., $.a_expr) with the
  // _prec rule (e.g., $._a_expr_prec) so the rule is self-contained
  // and doesn't conflict with the parent's GLR alternatives.
  const precExprs = precAlts
    .map(alt => {
      const expr = altToExpr(alt, terminals, kwTokenMap, optionalRules, precMap);
      if (expr === null) return null;
      // Replace $.name with $.precRuleName
      return expr.replace(
        new RegExp(`\\$\\.${name}\\b`, 'g'),
        `$.${precRuleName}`
      );
    })
    .filter(e => e !== null);

  if (precExprs.length > 0) {
    // Add $.c_expr as the base case (leaf of the precedence chain)
    const hasCExpr = alternatives.some(alt => {
      const st = alt.filter(t => t.type !== 'PREC');
      return st.length === 1 && st[0].type === 'SYMBOL' && st[0].value === 'c_expr';
    });
    const allPrecExprs = hasCExpr
      ? ['$.c_expr', ...precExprs]
      : precExprs;

    const precExpr = allPrecExprs.length === 1
      ? allPrecExprs[0]
      : `choice(\n        ${allPrecExprs.join(',\n        ')}\n      )`;
    result.push(`    ${precRuleName}: $ => ${precExpr},\n`);
  }

  // Generate the main rule: _prec + complex alternatives
  const complexExprs = complexAlts
    .map(alt => altToExpr(alt, terminals, kwTokenMap, optionalRules, precMap))
    .filter(e => e !== null);

  const filteredComplexExprs = complexExprs.filter(e => e !== '$.c_expr');
  // Alias the prec rule so its nodes appear with the parent's name in the tree
  const mainExprs = [`alias($.${precRuleName}, $.${name})`, ...filteredComplexExprs];

  const mainExpr = mainExprs.length === 1
    ? mainExprs[0]
    : `choice(\n        ${mainExprs.join(',\n        ')}\n      )`;
  result.push(`    ${name}: $ => ${mainExpr},\n`);

  return result.join('');
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
    // NOTE: U&"..." unicode identifiers have the same lexer limitation as
    // prefix strings — the U is consumed as an identifier. An external
    // scanner would be needed to handle these correctly.
    quoted_identifier: _ => token(/"([^"]|"")*"/),

    // Positional parameter: $1, $2, ...
    param: _ => /\\$[0-9]+/,

    // ── Numeric literals ─────────────────────────────────────────────────────────

    integer_literal: _ => token(/[0-9](_?[0-9])*/),

    float_literal: _ => token(choice(
      /[0-9](_?[0-9])*\\.[0-9](_?[0-9])*([eE][+-]?[0-9](_?[0-9])*)? /,
      /\\.[0-9](_?[0-9])*([eE][+-]?[0-9](_?[0-9])*)?/,
      /[0-9](_?[0-9])*[eE][+-]?[0-9](_?[0-9])*/
    )),

    // ── String literals ──────────────────────────────────────────────────────────

    // Standard SQL string: 'hello' — doubled single-quote is the escape: 'it''s'
    string_literal: _ => token(/'([^']|'')*'/),

    // NOTE: E'...', N'...', and U&'...' prefix strings are parsed as
    // function-call-like forms (identifier + string_literal) rather than
    // single tokens. This is a tree-sitter limitation: the lexer can't
    // prefer a multi-char token over an identifier when both start with
    // a letter, because the parser state commits to 'identifier' before
    // considering string alternatives. An external scanner would fix this
    // but adds significant complexity. The parse is still correct — PG
    // treats E'...' the same as a function call to E() at parse time.

    // Dollar-quoted string: $$body$$ or $tag$body$tag$
    // NOTE: full correctness requires matching the open/close tags;
    // this regex accepts any dollar-quoted form and is good enough for highlighting.
    dollar_quoted_string: _ => token(/\\$[a-zA-Z_0-9]*\\$[\\s\\S]*?\\$[a-zA-Z_0-9]*\\$/),

    // Bit string: B'0101'
    bit_string_literal: _ => token(/[bB]'[01]*'/),

    // Hex string: X'deadbeef'
    hex_string_literal: _ => token(/[xX]'[0-9a-fA-F]*'/),

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
function generateGrammarJs(keywords, terminals, rules, knownConflicts = [], precedence = []) {
  // Build keyword token map: Bison token name -> keyword info
  const kwTokenMap = new Map();
  for (const kw of keywords) {
    kwTokenMap.set(kw.token, kw);
  }

  // Build precedence lookup map
  const precMap = buildPrecedenceMap(precedence);

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
      if (tok.type === 'PREC') return true; // metadata, not syntax
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
    source_file: $ => seq(
      repeat(seq(optional($.toplevel_stmt), ';')),
      optional($.toplevel_stmt)
    ),

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

  // Expression rules that need split treatment: binary operators go into
  // a hidden _prec rule (static prec, no GLR) while complex alternatives
  // stay in the main rule (GLR via conflicts array).
  const exprSplitRules = new Set(['a_expr', 'b_expr']);

  let ruleCount = 0;
  for (const [name, rule] of rules) {
    if (skipRules.has(name) || kwCategoryRules.has(name)) continue;

    let snippet;
    if (exprSplitRules.has(name)) {
      snippet = generateExprRule(name, rule, terminals, kwTokenMap, optionalRules, precMap);
    } else {
      snippet = generateRule(name, rule, terminals, kwTokenMap, optionalRules, precMap);
    }
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
