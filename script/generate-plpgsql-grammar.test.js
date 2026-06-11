'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function extractTopLevelRule(source, ruleName) {
  const pattern = new RegExp(
    String.raw`^    ${ruleName}: \$ => [\s\S]*?^    \),`,
    'm'
  );
  const match = source.match(pattern);
  assert.ok(match, `Could not find top-level rule ${ruleName}`);
  return match[0].trimEnd();
}

test('PL/pgSQL generator template matches committed grammar for drift-sensitive rules', () => {
  const generator = readRepoFile('script/generate-plpgsql-grammar.js');
  const grammar = readRepoFile('plpgsql/grammar.js');

  for (const ruleName of ['decl_statement', 'stmt_fetch']) {
    assert.equal(
      extractTopLevelRule(generator, ruleName),
      extractTopLevelRule(grammar, ruleName),
      `${ruleName} differs between script/generate-plpgsql-grammar.js and plpgsql/grammar.js`
    );
  }
});
