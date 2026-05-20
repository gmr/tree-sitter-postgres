'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { _test } = require('./codegen');

const symbol = value => ({ type: 'SYMBOL', value });

test('all-optional alternatives emit a non-empty ordered choice', () => {
  const optionalRules = new Set([
    'opt_collate',
    'opt_qualified_name',
    'opt_asc_desc',
    'opt_nulls_order',
  ]);

  const expr = _test.altToExpr(
    [
      symbol('opt_collate'),
      symbol('opt_qualified_name'),
      symbol('opt_asc_desc'),
      symbol('opt_nulls_order'),
    ],
    new Set(),
    new Map(),
    optionalRules,
    null
  );

  assert.equal(expr, `choice(
        seq($.opt_collate, optional($.opt_qualified_name), optional($.opt_asc_desc), optional($.opt_nulls_order)),
        seq($.opt_qualified_name, optional($.opt_asc_desc), optional($.opt_nulls_order)),
        seq($.opt_asc_desc, optional($.opt_nulls_order)),
        $.opt_nulls_order
      )`);

  assert.doesNotMatch(
    expr,
    /seq\(\$\.opt_collate, \$\.opt_qualified_name, \$\.opt_asc_desc, \$\.opt_nulls_order\)/
  );
});

test('mixed alternatives still wrap optional nonterminals at their call sites', () => {
  const expr = _test.altToExpr(
    [
      symbol('required_head'),
      symbol('optional_tail'),
    ],
    new Set(),
    new Map(),
    new Set(['optional_tail']),
    null
  );

  assert.equal(expr, 'seq($.required_head, optional($.optional_tail))');
});

test('single all-optional reference stays non-empty', () => {
  const expr = _test.altToExpr(
    [symbol('optional_rule')],
    new Set(),
    new Map(),
    new Set(['optional_rule']),
    null
  );

  assert.equal(expr, '$.optional_rule');
});
