#!/usr/bin/env node
'use strict';

/**
 * generate-grammar.js
 *
 * Reads PostgreSQL source files and generates grammar.js for tree-sitter.
 *
 * Usage:
 *   node script/generate-grammar.js [postgres-dir]
 *
 * Default postgres-dir: ~/Source/gmr/postgres
 *
 * Input files (relative to postgres-dir):
 *   src/include/parser/kwlist.h     — keyword definitions
 *   src/backend/parser/gram.y       — Bison grammar rules
 *
 * Output:
 *   grammar.js  (in the project root)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseKwlist } = require('./parse-kwlist');
const { parseGramY } = require('./parse-gram-y');
const { generateGrammarJs } = require('./codegen');

// ─── Paths ────────────────────────────────────────────────────────────────────

const postgresDir = process.argv[2] || path.join(os.homedir(), 'Source/gmr/postgres');
const projectRoot = path.join(__dirname, '..');

const kwlistPath      = path.join(postgresDir, 'src/include/parser/kwlist.h');
const gramYPath       = path.join(postgresDir, 'src/backend/parser/gram.y');
const conflictsPath   = path.join(__dirname, 'known-conflicts.json');
const outputPath      = path.join(projectRoot, 'grammar.js');

// ─── Validate inputs ──────────────────────────────────────────────────────────

for (const p of [kwlistPath, gramYPath]) {
  if (!fs.existsSync(p)) {
    console.error(`ERROR: File not found: ${p}`);
    console.error(`       Pass the path to your postgres checkout as the first argument.`);
    process.exit(1);
  }
}

// ─── Parse ───────────────────────────────────────────────────────────────────

console.log(`Parsing kwlist.h...`);
const keywords = parseKwlist(kwlistPath);
console.log(`  ${keywords.length} keywords found`);

console.log(`Parsing gram.y...`);
const { terminals, precedence, rules } = parseGramY(gramYPath);
console.log(`  ${terminals.size} terminals`);
console.log(`  ${precedence.length} precedence levels`);
console.log(`  ${rules.size} grammar rules`);

// ─── Load known conflicts ─────────────────────────────────────────────────────

const knownConflicts = fs.existsSync(conflictsPath)
  ? JSON.parse(fs.readFileSync(conflictsPath, 'utf8'))
  : [];
if (knownConflicts.length > 0) {
  console.log(`  ${knownConflicts.length} known conflicts loaded`);
}

// ─── Generate ─────────────────────────────────────────────────────────────────

console.log(`Generating grammar.js...`);
const { content, ruleCount } = generateGrammarJs(keywords, terminals, rules, knownConflicts);

fs.writeFileSync(outputPath, content, 'utf8');

const lineCount = content.split('\n').length;
const byteCount = Buffer.byteLength(content, 'utf8');
console.log(`  Wrote ${outputPath}`);
console.log(`  ${ruleCount} grammar rules emitted`);
console.log(`  ${lineCount} lines, ${Math.round(byteCount / 1024)} KB`);
console.log('');
console.log('Next step: run `tree-sitter generate` to build the parser.');
