'use strict';
const fs = require('fs');

/**
 * Parse PL/pgSQL keyword lists.
 *
 * PL/pgSQL uses a different format than the main parser:
 *   PG_KEYWORD("word", K_TOKEN)
 *
 * Two files:
 *   pl_reserved_kwlist.h   — reserved keywords
 *   pl_unreserved_kwlist.h — unreserved keywords
 *
 * Returns an array of:
 *   { name: string, token: string, reserved: boolean }
 */
function parsePlpgsqlKwlist(reservedPath, unreservedPath) {
  const keywords = [];

  const pattern = /PG_KEYWORD\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g;

  for (const [path, reserved] of [[reservedPath, true], [unreservedPath, false]]) {
    const content = fs.readFileSync(path, 'utf8');
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      keywords.push({
        name: match[1],
        token: match[2],
        reserved,
      });
    }
  }

  return keywords;
}

module.exports = { parsePlpgsqlKwlist };
