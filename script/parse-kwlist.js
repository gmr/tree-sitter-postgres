'use strict';
const fs = require('fs');

// Keyword categories from keywords.h
const UNRESERVED_KEYWORD = 'UNRESERVED_KEYWORD';
const COL_NAME_KEYWORD = 'COL_NAME_KEYWORD';
const TYPE_FUNC_NAME_KEYWORD = 'TYPE_FUNC_NAME_KEYWORD';
const RESERVED_KEYWORD = 'RESERVED_KEYWORD';

/**
 * Parse kwlist.h to extract PostgreSQL keywords with their categories.
 *
 * Each entry looks like:
 *   PG_KEYWORD("select", SELECT, RESERVED_KEYWORD, BARE_LABEL)
 *
 * Returns an array of:
 *   { name: string, token: string, category: string, bareLabel: string }
 */
function parseKwlist(kwlistPath) {
  const content = fs.readFileSync(kwlistPath, 'utf8');
  const keywords = [];

  const pattern = /PG_KEYWORD\(\s*"([^"]+)"\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    keywords.push({
      name: match[1],      // e.g. "select"   (lowercase SQL spelling)
      token: match[2],     // e.g. "SELECT"   (Bison token name)
      category: match[3],  // e.g. "RESERVED_KEYWORD"
      bareLabel: match[4], // e.g. "BARE_LABEL"
    });
  }

  return keywords;
}

/**
 * Build a map from Bison token name -> keyword info.
 * e.g. "SELECT" -> { name: "select", token: "SELECT", category: "RESERVED_KEYWORD", ... }
 */
function buildTokenMap(keywords) {
  const map = new Map();
  for (const kw of keywords) {
    map.set(kw.token, kw);
  }
  return map;
}

/**
 * Generate a case-insensitive regex source string for a keyword.
 * e.g. "select" -> "[sS][eE][lL][eE][cC][tT]"
 */
function caseInsensitiveRegex(word) {
  return word
    .split('')
    .map(ch => {
      const lo = ch.toLowerCase();
      const hi = ch.toUpperCase();
      return lo === hi ? ch : `[${lo}${hi}]`;
    })
    .join('');
}

/**
 * Derive a safe JS identifier for use as a tree-sitter rule name from a keyword.
 * Strips trailing _P suffix (Bison uses these to avoid C keyword conflicts).
 * e.g. "BEGIN_P" -> "kw_begin", "ABORT_P" -> "kw_abort"
 */
function kwRuleName(token) {
  // Strip trailing _P suffix (used in Bison to avoid C keyword conflicts)
  const base = token.replace(/_P$/, '').toLowerCase();
  return `kw_${base}`;
}

module.exports = { parseKwlist, buildTokenMap, caseInsensitiveRegex, kwRuleName,
  UNRESERVED_KEYWORD, COL_NAME_KEYWORD, TYPE_FUNC_NAME_KEYWORD, RESERVED_KEYWORD };
