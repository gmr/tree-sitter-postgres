#!/usr/bin/env node
'use strict';

/**
 * extract-doc-sql.js
 *
 * Extracts the SQL examples from the PostgreSQL documentation
 * (doc/src/sgml) into postgres/test/docs/*.sql, one file per doc source,
 * for use as a parse-regression corpus.
 *
 * Why this is generated rather than hand-written:
 *   The docs are the largest curated body of real PostgreSQL SQL that ships
 *   with the server. Running the grammar over all of it exercises roughly
 *   four times as many node types as the hand-written corpus does, and it
 *   re-derives itself for free on every PostgreSQL release. The extracted
 *   .sql files are checked in so the parse check runs without a PostgreSQL
 *   checkout and so doc churn shows up as a reviewable diff.
 *
 *   These are parse-success tests, not tree-shape tests: they assert only
 *   that the grammar produces no ERROR or MISSING nodes. Expected
 *   S-expressions belong in postgres/test/corpus/, where they are reviewed
 *   by hand.
 *
 * Usage:
 *   node script/extract-doc-sql.js [pg_source_dir]
 *
 * Requires a full PostgreSQL source checkout (doc/src/sgml), not the
 * two-file gram.y + kwlist.h directory that codegen alone needs.
 *
 * Output:
 *   postgres/test/docs/*.sql
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const outputDir = path.join(projectRoot, 'postgres/test/docs');
const skipPath = path.join(__dirname, 'doc-sql-skip.json');

// ─── Source selection ─────────────────────────────────────────────────────────

// <synopsis> is excluded everywhere: those blocks are command templates built
// out of <replaceable> and <optional>, not runnable SQL.
const BLOCK_RE = /<(programlisting|screen)\b[^>]*>([\s\S]*?)<\/\1>/g;

// plpgsql.sgml is almost entirely PL/pgSQL fragments (bare DECLARE/BEGIN
// blocks, EXECUTE ... INTO ... USING). They belong to the plpgsql grammar, so
// feeding them to the postgres parser only produces noise.
const SKIP_FILES = new Set(['plpgsql.sgml']);

// ─── SGML cleanup ─────────────────────────────────────────────────────────────

const TAG_RE = /<[^>]+>/g;
const ENTITY_RE = /&[A-Za-z0-9._-]+;/g;
const KNOWN_ENTITIES = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
};

// A listing that carries inline markup (<replaceable>, <optional>) or a doc
// entity reference is a template, not an example; stripping the tags would
// leave placeholder text that no parser should be expected to accept.
function hasMarkup(raw) {
  if (TAG_RE.test(raw)) {
    TAG_RE.lastIndex = 0;
    return true;
  }
  const entities = raw.match(ENTITY_RE) || [];
  return entities.some((e) => !(e in KNOWN_ENTITIES));
}

function unescape(raw) {
  return raw.replace(ENTITY_RE, (e) => KNOWN_ENTITIES[e] ?? e);
}

// ─── Statement recognition ────────────────────────────────────────────────────

const STMT_START_RE = new RegExp(
  '^\\s*(' +
    [
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER',
      'DROP', 'WITH', 'BEGIN', 'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE',
      'COPY', 'EXPLAIN', 'ANALYZE', 'VACUUM', 'SET', 'SHOW', 'TABLE',
      'VALUES', 'DECLARE', 'FETCH', 'CLOSE', 'PREPARE', 'EXECUTE',
      'DEALLOCATE', 'TRUNCATE', 'COMMENT', 'REINDEX', 'CLUSTER', 'REFRESH',
      'LISTEN', 'NOTIFY', 'UNLISTEN', 'CALL', 'DO', 'LOCK', 'SAVEPOINT',
      'RELEASE', 'START', 'CHECKPOINT', 'DISCARD', 'IMPORT', 'RESET',
      'MOVE', 'LOAD',
    ].join('|') +
    ')\\b',
  'i',
);

// psql prompts: "regression=>", "mydb=#", "mydb-#", "mydb(#".
const PROMPT_RE = /^[A-Za-z0-9_]*[=\-(][>#]\s?/;

// psql prints a bare command tag after each statement ("SET", "INSERT 0 1",
// "UPDATE 3"). Those lines start with a SQL keyword, so without this they get
// picked up as the start of a new statement.
const COMMAND_TAG_RE =
  /^(INSERT \d+ \d+|(UPDATE|DELETE|SELECT|COPY|MERGE|FETCH|MOVE) \d+|CREATE [A-Z ]+|DROP [A-Z ]+|ALTER [A-Z ]+|GRANT|REVOKE|SET|RESET|SHOW|LISTEN|NOTIFY|UNLISTEN|BEGIN|COMMIT|ROLLBACK|START TRANSACTION|SAVEPOINT|RELEASE|TRUNCATE TABLE|ANALYZE|VACUUM|CHECKPOINT|CLUSTER|REINDEX|REFRESH MATERIALIZED VIEW|COMMENT|DO|CALL|PREPARE|EXECUTE|DEALLOCATE( ALL)?|DECLARE CURSOR|CLOSE CURSOR|LOCK TABLE|DISCARD [A-Z]+|LOAD)$/;

// Server messages ("ERROR:  ...") run on over several lines and their
// continuations often start with a SQL keyword ("with existing key ..."), so
// everything from the first message line to the next blank line is output.
const MESSAGE_RE = /^(ERROR|NOTICE|WARNING|INFO|DEBUG|LOG|FATAL|PANIC|DETAIL|HINT|CONTEXT|QUERY|STATEMENT|LINE \d+):/;

// psql meta-commands can also sit at the end of a statement (\gset, \g) or
// between statements on one line (\;).
const META_RE = /(^|\s)\\(g|gset|gexec|gdesc|bind|parse|crosstab|watch|;)\b/;

// Examples abbreviate a list either with "..." or with a column of dots.
const ELLIPSIS_RE = /\.\.\.|^\s*\.\s*$/m;

// A DECLARE that is not DECLARE ... CURSOR is a PL/pgSQL declaration block.
function isPlpgsqlDeclare(text) {
  return /^\s*DECLARE\b/i.test(text) && !/\bCURSOR\b/i.test(text);
}

/**
 * Report whether `text` contains a `;` at the top level — outside string
 * literals, quoted identifiers, dollar quotes and comments.
 *
 * Statements whose body is a `BEGIN ATOMIC ... END` block hold their own
 * semicolon-terminated statements, so for those the terminator is the `END`.
 */
function terminated(text) {
  const atomic = /\bBEGIN\s+ATOMIC\b/i.test(text);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { i += 2; continue; }
          break;
        }
        i++;
      }
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i++;
    } else if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        if (close === -1) return false;
        i = close + m[0].length - 1;
      }
    } else if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return false;
      i = nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i);
      if (close === -1) return false;
      i = close + 1;
    } else if (atomic) {
      // Track BEGIN/END nesting and terminate on the `;` after the outermost
      // END rather than on the first `;` inside the body.
      const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(i));
      if (word) {
        const w = word[0].toUpperCase();
        if (w === 'BEGIN' || w === 'CASE') depth++;
        else if (w === 'END') depth--;
        i += word[0].length - 1;
      } else if (c === ';' && depth <= 0) {
        return true;
      }
    } else if (c === ';') {
      return true;
    }
  }
  return false;
}

/** Split one doc listing into whole SQL statements, dropping psql output. */
function statements(text) {
  const out = [];
  let buf = null;
  let inMessage = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(PROMPT_RE, '');
    if (MESSAGE_RE.test(line.trim())) {
      inMessage = true;
      buf = null;
      continue;
    }
    if (inMessage) {
      if (line.trim() === '') inMessage = false;
      continue;
    }
    if (buf === null) {
      if (!STMT_START_RE.test(line) || COMMAND_TAG_RE.test(line.trim())) continue;
      buf = [line];
    } else {
      buf.push(line);
    }
    const joined = buf.join('\n');
    if (terminated(joined)) {
      out.push(joined.trim());
      buf = null;
    }
  }
  return out;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

function sgmlFiles(sgmlDir) {
  const files = [];
  for (const entry of fs.readdirSync(sgmlDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'ref') {
      for (const ref of fs.readdirSync(path.join(sgmlDir, 'ref'))) {
        if (ref.endsWith('.sgml')) files.push(path.join('ref', ref));
      }
    } else if (entry.isFile() && entry.name.endsWith('.sgml')) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

function extract(sgmlDir, skipHashes) {
  const crypto = require('crypto');
  const perFile = new Map();
  const seen = new Set();
  const counts = { blocks: 0, statements: 0, duplicates: 0, skipped: 0 };

  for (const rel of sgmlFiles(sgmlDir)) {
    if (SKIP_FILES.has(rel)) continue;
    const src = fs.readFileSync(path.join(sgmlDir, rel), 'utf8');
    for (const m of src.matchAll(BLOCK_RE)) {
      const raw = m[2];
      if (hasMarkup(raw)) continue;
      counts.blocks++;
      const line = src.slice(0, m.index).split('\n').length;
      for (const stmt of statements(unescape(raw))) {
        // Ellipses and psql meta-commands mark an abbreviated example.
        if (ELLIPSIS_RE.test(stmt) || META_RE.test(stmt)) continue;
        if (isPlpgsqlDeclare(stmt)) continue;
        const hash = crypto.createHash('sha1').update(stmt).digest('hex').slice(0, 12);
        if (skipHashes.has(hash)) { counts.skipped++; continue; }
        if (seen.has(hash)) { counts.duplicates++; continue; }
        seen.add(hash);
        const key = rel.replace(/\//g, '-').replace(/\.sgml$/, '');
        if (!perFile.has(key)) perFile.set(key, []);
        perFile.get(key).push({ line, stmt });
        counts.statements++;
      }
    }
  }
  return { perFile, counts };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const pgDir = process.argv[2] || process.env.PG_SOURCE_DIR;
  if (!pgDir) {
    console.error('Usage: node script/extract-doc-sql.js <pg_source_dir>');
    process.exit(1);
  }
  const sgmlDir = path.join(pgDir, 'doc/src/sgml');
  if (!fs.existsSync(sgmlDir)) {
    console.error(`No documentation at ${sgmlDir}.`);
    console.error('This script needs a full PostgreSQL source checkout.');
    process.exit(1);
  }

  const skip = JSON.parse(fs.readFileSync(skipPath, 'utf8'));
  const skipHashes = new Set(skip.map((s) => s.hash));

  const { perFile, counts } = extract(sgmlDir, skipHashes);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [key, items] of [...perFile].sort()) {
    const header =
      `-- Generated by script/extract-doc-sql.js from doc/src/sgml/${key.replace(/^ref-/, 'ref/')}.sgml\n` +
      '-- Do not edit; see CONTRIBUTING.md, "The documentation SQL corpus".\n\n';
    const body = items
      .map(({ line, stmt }) => `-- ${key}.sgml:${line}\n${stmt}\n`)
      .join('\n');
    fs.writeFileSync(path.join(outputDir, `${key}.sql`), header + body);
  }

  console.log(`Wrote ${counts.statements} statements to ${perFile.size} files`);
  console.log(
    `  ${counts.blocks} listings, ${counts.duplicates} duplicates, ` +
      `${counts.skipped} known failures skipped`,
  );
}

if (require.main === module) main();

module.exports = { statements, terminated, hasMarkup };
