#!/usr/bin/env node
'use strict';

/**
 * check-doc-sql.js
 *
 * Parses every statement in postgres/test/docs/*.sql and fails if the grammar
 * produces an ERROR or MISSING node for any of them.
 *
 * Why this exists rather than a corpus test:
 *   These are parse-success assertions, not tree-shape assertions. Expected
 *   S-expressions for 2,000+ statements would be ~40x the size of the
 *   hand-written corpus and would be regenerated, not reviewed, on every
 *   PostgreSQL release — locking in whatever the parser happens to do.
 *
 * Why it re-splits the files:
 *   tree-sitter reports the first error in a file and a GLR error can swallow
 *   the statements after it, so each statement is parsed on its own. They are
 *   written to a temporary directory and parsed in a single CLI invocation,
 *   which is far faster than one process per statement.
 *
 * Usage:
 *   node script/check-doc-sql.js
 *
 * Exit status:
 *   0 if every statement parses cleanly, 1 otherwise.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'postgres/test/docs');
// CI installs the CLI on PATH rather than into node_modules.
const localCli = path.join(projectRoot, 'node_modules/.bin/tree-sitter');
const cli = fs.existsSync(localCli) ? localCli : 'tree-sitter';

// Each statement in the extracted files is preceded by its origin, e.g.
// "-- ref-select.sgml:1903".
const ORIGIN_RE = /^-- (\S+\.sgml:\d+)$/;

function readStatements() {
  const statements = [];
  for (const name of fs.readdirSync(docsDir).sort()) {
    if (!name.endsWith('.sql')) continue;
    let origin = null;
    let buf = [];
    const flush = () => {
      const text = buf.join('\n').trim();
      if (origin && text) statements.push({ origin, text });
      buf = [];
    };
    for (const line of fs.readFileSync(path.join(docsDir, name), 'utf8').split('\n')) {
      const m = ORIGIN_RE.exec(line);
      if (m) {
        flush();
        origin = m[1];
      } else {
        buf.push(line);
      }
    }
    flush();
  }
  return statements;
}

function main() {
  if (!fs.existsSync(docsDir)) {
    console.error(`No extracted documentation SQL at ${docsDir}.`);
    console.error('Run: just extract-doc-sql');
    process.exit(1);
  }

  const statements = readStatements();
  if (!statements.length) {
    console.error(`No statements found in ${docsDir}.`);
    console.error('Run: just extract-doc-sql');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-sql-'));
  try {
    const byName = new Map();
    statements.forEach((s, i) => {
      const name = `${String(i).padStart(5, '0')}.sql`;
      byName.set(name, s);
      fs.writeFileSync(path.join(tmp, name), `${s.text}\n`);
    });

    const result = spawnSync(cli, ['parse', '-q', '--stat', path.join(tmp, '*.sql')], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    // Without these the script reads an empty stdout as "nothing failed" and
    // reports a clean run when the CLI never parsed anything.
    if (result.error) {
      console.error(`Could not run ${cli}: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status === null) {
      console.error(`${cli} was terminated by signal ${result.signal}.`);
      if (result.stderr) console.error(result.stderr);
      process.exit(1);
    }

    const failures = [];
    for (const line of (result.stdout || '').split('\n')) {
      if (!/\((ERROR|MISSING)\b/.test(line)) continue;
      const name = path.basename(line.split(/\s+/)[0]);
      const stmt = byName.get(name);
      if (stmt) failures.push(stmt);
    }

    if (failures.length) {
      for (const f of failures) {
        console.log(`FAIL ${f.origin}`);
        console.log(`${f.text.split('\n').map((l) => `    ${l}`).join('\n')}\n`);
      }
    }

    // A non-zero status with nothing matched means the CLI reported a problem
    // the stdout scan did not recognise, for example after a format change.
    if (result.status !== 0 && !failures.length) {
      console.error(`${cli} exited ${result.status} but reported no parse errors.`);
      if (result.stderr) console.error(result.stderr);
      process.exit(1);
    }

    const passed = statements.length - failures.length;
    const pct = ((passed / statements.length) * 100).toFixed(2);
    console.log(`${passed}/${statements.length} documentation statements parse cleanly (${pct}%)`);
    process.exit(failures.length ? 1 : 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) main();
