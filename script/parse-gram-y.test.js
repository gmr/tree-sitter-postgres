'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { parseGramY } = require('./parse-gram-y');

function parseSnippet(rulesText) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'parse-gram-y-')),
    'gram.y'
  );
  fs.writeFileSync(file, `%token AND\n%%\n${rulesText}\n%%\n`);
  return parseGramY(file);
}

test('a trailing empty alternative without /* EMPTY */ marks the rule optional', () => {
  const { rules } = parseSnippet(`
opt_merge_when_condition:
			AND a_expr				{ $$ = $2; }
			|						{ $$ = NULL; }
		;
`);

  const rule = rules.get('opt_merge_when_condition');
  assert.equal(rule.hasEmpty, true);
  assert.equal(rule.alternatives.length, 1);
});

test('an explicit /* EMPTY */ alternative still marks the rule optional', () => {
  const { rules } = parseSnippet(`
opt_thing:
			AND a_expr				{ $$ = $2; }
			| /* EMPTY */			{ $$ = NULL; }
		;
`);

  assert.equal(rules.get('opt_thing').hasEmpty, true);
});

test('a rule with no empty alternative is not optional', () => {
  const { rules } = parseSnippet(`
required_thing:
			AND a_expr				{ $$ = $2; }
			| a_expr				{ $$ = $1; }
		;
`);

  const rule = rules.get('required_thing');
  assert.equal(rule.hasEmpty, false);
  assert.equal(rule.alternatives.length, 2);
});
