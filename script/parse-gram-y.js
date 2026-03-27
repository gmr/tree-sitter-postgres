'use strict';
const fs = require('fs');

/**
 * Strip C action blocks { ... } from Bison grammar rule text.
 *
 * C actions can appear:
 *   - After each alternative in a rule (trailing action)
 *   - In the middle of a rule (mid-rule action)
 *
 * We also strip C-style block comments /* ... * / that are NOT the
 * conventional /* EMPTY * / marker (which we replace with a sentinel).
 *
 * Returns the stripped text with EMPTY_PRODUCTION markers where
 * /* EMPTY * / (or /* empty * / etc.) appeared as the only content
 * of an alternative.
 */
function stripCActions(text) {
  let result = '';
  let i = 0;
  const len = text.length;

  // State
  let depth = 0;        // depth inside { } C action block
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringChar = '';

  while (i < len) {
    // ---- Inside a C action block ----
    if (depth > 0) {
      if (inLineComment) {
        if (text[i] === '\n') inLineComment = false;
        i++;
        continue;
      }
      if (inBlockComment) {
        if (text[i] === '*' && text[i + 1] === '/') { inBlockComment = false; i += 2; }
        else i++;
        continue;
      }
      if (inString) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === stringChar) { inString = false; }
        i++;
        continue;
      }
      if (text[i] === '/' && text[i + 1] === '/') { inLineComment = true; i += 2; continue; }
      if (text[i] === '/' && text[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
      if (text[i] === '"' || text[i] === "'") { inString = true; stringChar = text[i]; i++; continue; }
      if (text[i] === '{') { depth++; i++; continue; }
      if (text[i] === '}') {
        depth--;
        i++;
        // When we close the outermost action block, emit a space
        if (depth === 0) result += ' ';
        continue;
      }
      i++;
      continue;
    }

    // ---- Outside a C action block ----

    // Block comment — check for EMPTY marker
    if (text[i] === '/' && text[i + 1] === '*') {
      // Collect content between /* and */
      let j = i + 2;
      let commentContent = '';
      while (j < len) {
        if (text[j] === '*' && j + 1 < len && text[j + 1] === '/') {
          j += 2; // skip */
          break;
        }
        commentContent += text[j];
        j++;
      }
      if (/^\s*empty\s*$/i.test(commentContent)) {
        // Emit EMPTY sentinel that the rule parser can detect
        result += ' __EMPTY__ ';
      }
      // Otherwise drop the comment
      i = j;
      continue;
    }

    // Line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < len && text[i] !== '\n') i++;
      continue;
    }

    // Opening brace — start of C action
    if (text[i] === '{') {
      depth = 1;
      i++;
      continue;
    }

    // Everything else — pass through
    result += text[i];
    i++;
  }

  return result;
}

/**
 * Extract token names and single-char literals from a precedence line.
 * ALL_CAPS identifiers are stored as-is (e.g. "UNION").
 * Single-quoted chars are stored with quotes (e.g. "'+'").
 */
function extractPrecTokens(text, tokens) {
  // Strip block comments
  text = text.replace(/\/\*.*?\*\//g, '');
  // Match identifiers (starting with uppercase) and single-quoted characters.
  // Most tokens are ALL_CAPS but a few like "Op" are mixed-case.
  const re = /\b([A-Z]\w*)\b|'([^']*)'/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2]) {
      tokens.push("'" + match[2] + "'");
    }
  }
}

/**
 * Parse precedence declarations from the Bison declarations section.
 * Returns an array of:
 *   { type: 'left'|'right'|'nonassoc', tokens: string[], level: number }
 * Level 1 = lowest precedence, increasing upward.
 *
 * Tokens are either ALL_CAPS names (e.g. "UNION") or quoted single-char
 * literals (e.g. "'+'"). Handles continuation lines that follow a directive.
 */
function parsePrecedence(declarationsText) {
  const rules = [];
  let level = 1;

  // Strip the %{ ... %} C preamble and %union { ... } block
  let text = declarationsText.replace(/%\{[\s\S]*?%\}/g, '');
  text = text.replace(/%union\s*\{[\s\S]*?\n\}/m, '');

  const lines = text.split('\n');
  let currentType = null;
  let currentTokens = null;

  function flushLevel() {
    if (currentTokens && currentTokens.length > 0) {
      rules.push({ type: currentType, tokens: currentTokens, level });
      level++;
    }
    currentType = null;
    currentTokens = null;
  }

  for (const line of lines) {
    const m = line.match(/^\s*%(left|right|nonassoc)\s+(.*)/);
    if (m) {
      flushLevel();
      currentType = m[1];
      currentTokens = [];
      extractPrecTokens(m[2], currentTokens);
    } else if (currentType && /^\s+\S/.test(line) && !/^\s*%/.test(line)) {
      // Continuation line (indented, no new % directive)
      extractPrecTokens(line, currentTokens);
    } else {
      flushLevel();
    }
  }
  flushLevel();

  return rules;
}

/**
 * Collect all terminal token names from the Bison declarations section.
 * These are the ALL_CAPS identifiers declared with %token or in %left/%right/%nonassoc.
 * We use this set to distinguish terminals from non-terminals when parsing rules.
 */
function collectTerminals(declarationsText) {
  const terminals = new Set();

  // Strip preamble
  let text = declarationsText.replace(/%\{[\s\S]*?%\}/g, '');
  text = text.replace(/%union\s*\{[\s\S]*?\n\}/m, '');
  // Remove type specifiers like <str> <ival>
  text = text.replace(/<\w+>/g, '');

  // Collect ALL_CAPS words from %token, %left, %right, %nonassoc lines
  // These span multiple lines (continuation lines are indented with whitespace)
  const lines = text.split('\n');
  let inDirective = false;

  for (const line of lines) {
    if (/^\s*%(token|left|right|nonassoc)\b/.test(line)) {
      inDirective = true;
    } else if (/^\s*%\w/.test(line)) {
      inDirective = false;
    }

    if (inDirective) {
      const matches = line.match(/\b[A-Z][A-Z0-9_]*\b/g) || [];
      matches.forEach(m => terminals.add(m));
    }
  }

  // Also add single-char tokens that appear in precedence rules as 'x'
  // These are handled as string literals, not as terminal names

  return terminals;
}

/**
 * Tokenize the stripped grammar rules text into a stream of parser tokens.
 *
 * Token types:
 *   RULE_NAME  — word followed by ':' (not '::')
 *   PIPE       — '|'
 *   SEMICOLON  — ';'  (rule terminator, not inside quotes)
 *   SYMBOL     — identifier (terminal or non-terminal)
 *   LITERAL    — single-quoted character 'x'
 *   PREC       — %prec XXXX (stripped, just marks that a prec annotation existed)
 *   EMPTY      — __EMPTY__ sentinel
 */
function tokenizeRules(text) {
  const tokens = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(text[i])) { i++; continue; }

    // EMPTY sentinel
    if (text.slice(i, i + 9) === '__EMPTY__') {
      tokens.push({ type: 'EMPTY' });
      i += 9;
      continue;
    }

    // Pipe
    if (text[i] === '|') {
      tokens.push({ type: 'PIPE' });
      i++;
      continue;
    }

    // Semicolon (rule terminator)
    if (text[i] === ';') {
      tokens.push({ type: 'SEMICOLON' });
      i++;
      continue;
    }

    // Percent directive (%prec)
    if (text[i] === '%') {
      let j = i + 1;
      while (j < len && /\w/.test(text[j])) j++;
      const directive = text.slice(i + 1, j);
      if (directive === 'prec') {
        // Capture the precedence token name
        while (j < len && /\s/.test(text[j])) j++;
        const nameStart = j;
        while (j < len && /\w/.test(text[j])) j++;
        const precToken = text.slice(nameStart, j);
        tokens.push({ type: 'PREC', value: precToken });
      }
      // Other % directives in the rules section are unusual; skip
      i = j;
      continue;
    }

    // Single-quoted literal character like '(' or ';'
    // Format: '<char>' where char is a single character
    if (text[i] === "'" && i + 2 < len && text[i + 2] === "'") {
      tokens.push({ type: 'LITERAL', value: text[i + 1] });
      i += 3;
      continue;
    }
    // Also handle two-char quoted sequences (shouldn't appear but be safe)
    if (text[i] === "'") {
      let j = i + 1;
      let val = '';
      while (j < len && text[j] !== "'") { val += text[j]; j++; }
      if (j < len) j++; // skip closing '
      tokens.push({ type: 'LITERAL', value: val });
      i = j;
      continue;
    }

    // Identifier (rule name or symbol)
    if (/[a-zA-Z_]/.test(text[i])) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);

      // Check if it's a rule definition: word followed by ':' (but not '::')
      let k = j;
      while (k < len && text[k] === ' ' || text[k] === '\t') k++;
      if (text[k] === ':' && text[k + 1] !== ':') {
        tokens.push({ type: 'RULE_NAME', value: word });
        i = k + 1;
      } else {
        tokens.push({ type: 'SYMBOL', value: word });
        i = j;
      }
      continue;
    }

    // Unknown character — skip
    i++;
  }

  return tokens;
}

/**
 * Parse the token stream into rule definitions.
 *
 * Returns a Map: ruleName -> { alternatives: Array<Array<token>>, hasEmpty: boolean }
 *
 * Each alternative is an array of tokens:
 *   { type: 'SYMBOL', value: string }  — terminal or non-terminal identifier
 *   { type: 'LITERAL', value: string } — single-char literal
 */
function parseRuleTokens(tokens) {
  const rules = new Map();
  let i = 0;
  const len = tokens.length;

  while (i < len) {
    if (tokens[i].type !== 'RULE_NAME') { i++; continue; }

    const name = tokens[i].value;
    i++;

    const alternatives = [];
    let currentAlt = [];
    let hasEmpty = false;

    while (i < len && tokens[i].type !== 'RULE_NAME') {
      const tok = tokens[i];

      if (tok.type === 'SEMICOLON') {
        // End of rule — flush current alternative then stop
        if (currentAlt.length > 0) {
          alternatives.push(currentAlt);
          currentAlt = []; // clear so the post-loop flush doesn't duplicate it
        } else if (alternatives.length === 0) {
          // Rule with no alternatives — shouldn't happen but be safe
          hasEmpty = true;
        }
        i++;
        break;
      }

      if (tok.type === 'PIPE') {
        // Alternative separator
        if (currentAlt.length > 0) {
          alternatives.push(currentAlt);
        } else {
          // Empty alternative before pipe — this means previous alt was empty,
          // or this is the start after rule_name: | alt1
          hasEmpty = true;
        }
        currentAlt = [];
        i++;
        continue;
      }

      if (tok.type === 'EMPTY') {
        hasEmpty = true;
        i++;
        continue;
      }

      if (tok.type === 'PREC') {
        // Keep precedence annotation in the alternative for codegen
        currentAlt.push(tok);
        i++;
        continue;
      }

      if (tok.type === 'SYMBOL' || tok.type === 'LITERAL') {
        currentAlt.push(tok);
        i++;
        continue;
      }

      i++;
    }

    // If we ran out of tokens without hitting SEMICOLON, flush
    if (currentAlt.length > 0) {
      alternatives.push(currentAlt);
    }

    rules.set(name, { alternatives, hasEmpty });
  }

  return rules;
}

/**
 * Parse gram.y and return:
 *   terminals: Set<string>         — all terminal token names
 *   precedence: Array              — precedence rules (lowest to highest)
 *   rules: Map<name, {alternatives, hasEmpty}>  — all grammar rules
 */
function parseGramY(gramYPath) {
  const content = fs.readFileSync(gramYPath, 'utf8');

  // Split at %% markers (should be exactly 2 of them)
  // We match %% at the start of a line
  const parts = content.split(/^%%$/m);
  if (parts.length < 3) {
    throw new Error('Could not find %% section markers in gram.y');
  }

  const declarationsText = parts[0];
  const rulesText = parts[1];

  // Parse terminals from declarations
  const terminals = collectTerminals(declarationsText);

  // Parse precedence from declarations
  const precedence = parsePrecedence(declarationsText);

  // Strip C actions from rules section
  const stripped = stripCActions(rulesText);

  // Tokenize and parse the rule structure
  const tokenStream = tokenizeRules(stripped);
  const rules = parseRuleTokens(tokenStream);

  return { terminals, precedence, rules };
}

module.exports = { parseGramY };
