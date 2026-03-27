/**
 * External scanner for PL/pgSQL tree-sitter grammar.
 *
 * Provides the _sql_expression token type that captures SQL expression
 * fragments. In PL/pgSQL, SQL expressions are consumed until a
 * context-specific delimiter is found (;, THEN, LOOP, etc.). Since
 * tree-sitter can't dynamically change the delimiter set, we use a simple
 * heuristic: consume everything that looks like SQL, respecting balanced
 * parentheses/brackets and string literals, stopping at tokens that are
 * unambiguously PL/pgSQL structure.
 */
#include "tree_sitter/parser.h"

#include <string.h>
#include <ctype.h>

enum TokenType {
  SQL_BODY,
};

void *tree_sitter_plpgsql_external_scanner_create(void) { return NULL; }
void tree_sitter_plpgsql_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_plpgsql_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_plpgsql_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
}

/* Case-insensitive keyword check. Reads ahead without advancing. */
static bool check_keyword(TSLexer *lexer, const char *kw) {
  /* The lexer is positioned at the first char already confirmed. */
  /* We just return true — caller already matched. */
  (void)lexer;
  (void)kw;
  return true;
}

bool tree_sitter_plpgsql_external_scanner_scan(
  void *payload, TSLexer *lexer, const bool *valid_symbols
) {
  if (!valid_symbols[SQL_BODY]) return false;

  skip_whitespace(lexer);

  if (lexer->lookahead == 0) return false;

  /* Don't start on a semicolon — that's a delimiter, not SQL content */
  if (lexer->lookahead == ';') return false;

  int depth = 0;
  bool has_content = false;
  bool has_non_ident = false;  /* true if we've seen operators, literals, etc. */
  int ident_count = 0;  /* number of identifiers consumed */

  while (lexer->lookahead != 0) {
    /* At depth 0, semicolon terminates */
    if (depth == 0 && lexer->lookahead == ';') break;

    /* At depth 0, << terminates (block/loop label) */
    if (depth == 0 && lexer->lookahead == '<') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '<') {
        /* << found — stop before it */
        if (has_content) {
          lexer->result_symbol = SQL_BODY;
          return true;
        }
        return false;
      }
      /* Single < — part of SQL operator, continue */
      has_non_ident = true;
      has_content = true;
      continue;
    }

    /* At depth 0, := terminates (assignment operator) */
    if (depth == 0 && lexer->lookahead == ':') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '=') {
        /* := found — stop before it */
        if (has_content) {
          lexer->result_symbol = SQL_BODY;
          return true;
        }
        return false;
      }
      /* Just a colon, not :=  — continue (it's part of SQL like ::) */
      if (lexer->lookahead == ':') {
        /* :: typecast — consume both */
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }

    /* At depth 0, .. terminates (range operator in FOR loops) */
    if (depth == 0 && lexer->lookahead == '.') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '.') {
        /* .. found — stop before it */
        if (has_content) {
          lexer->result_symbol = SQL_BODY;
          return true;
        }
        return false;
      }
      /* Just a single dot — part of dotted name, continue */
      has_content = true;
      continue;
    }

    /* Track balanced parens/brackets */
    if (lexer->lookahead == '(' || lexer->lookahead == '[') {
      depth++;
      lexer->advance(lexer, false);
      has_content = true;
      continue;
    }
    if (lexer->lookahead == ')' || lexer->lookahead == ']') {
      if (depth > 0) {
        depth--;
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      /* Unbalanced close — stop */
      break;
    }

    /* String literals — consume whole */
    if (lexer->lookahead == '\'') {
      lexer->advance(lexer, false);
      while (lexer->lookahead != 0) {
        if (lexer->lookahead == '\'') {
          lexer->advance(lexer, false);
          if (lexer->lookahead != '\'') break;  /* doubled quote */
          lexer->advance(lexer, false);
        } else {
          lexer->advance(lexer, false);
        }
      }
      has_content = true;
      continue;
    }

    /* Dollar-quoted strings */
    if (lexer->lookahead == '$') {
      /* Just consume the $ and let it be part of the expression */
      lexer->advance(lexer, false);
      has_content = true;
      continue;
    }

    /* Comments */
    if (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '-') {
        /* Line comment — consume to end of line */
        while (lexer->lookahead != 0 && lexer->lookahead != '\n') {
          lexer->advance(lexer, false);
        }
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }
    if (lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '*') {
        /* Block comment */
        lexer->advance(lexer, false);
        int comment_depth = 1;
        while (lexer->lookahead != 0 && comment_depth > 0) {
          if (lexer->lookahead == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '*') {
              comment_depth++;
              lexer->advance(lexer, false);
            }
          } else if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
              comment_depth--;
              lexer->advance(lexer, false);
            }
          } else {
            lexer->advance(lexer, false);
          }
        }
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }

    /* At depth 0, check for PL/pgSQL delimiter keywords.
     * We mark the position before checking, and if it's a delimiter, we stop. */
    if (depth == 0 && isalpha(lexer->lookahead)) {
      lexer->mark_end(lexer);
      /* Read the identifier */
      char word[32];
      int len = 0;
      while (isalnum(lexer->lookahead) || lexer->lookahead == '_') {
        if (len < 30) word[len++] = tolower(lexer->lookahead);
        lexer->advance(lexer, false);
      }
      word[len] = '\0';

      /* Check if this word is a PL/pgSQL structural delimiter.
       * These are keywords that, in context, indicate the end of a SQL
       * expression in PL/pgSQL. We stop BEFORE consuming them.
       *
       * Note: This is a heuristic. The real parser knows the exact
       * delimiter from context. We err on the side of stopping too
       * early — the grammar rules will then match the keyword. */
      if (/* Expression terminators */
          strcmp(word, "then") == 0 ||
          strcmp(word, "loop") == 0 ||
          strcmp(word, "into") == 0 ||
          strcmp(word, "using") == 0 ||
          strcmp(word, "when") == 0 ||
          strcmp(word, "elsif") == 0 ||
          strcmp(word, "elseif") == 0 ||
          strcmp(word, "else") == 0 ||
          strcmp(word, "end") == 0 ||
          strcmp(word, "declare") == 0 ||
          strcmp(word, "begin") == 0 ||
          strcmp(word, "exception") == 0 ||
          /* Statement-starting keywords — must not be swallowed */
          strcmp(word, "if") == 0 ||
          strcmp(word, "case") == 0 ||
          strcmp(word, "for") == 0 ||
          strcmp(word, "foreach") == 0 ||
          strcmp(word, "while") == 0 ||
          strcmp(word, "return") == 0 ||
          strcmp(word, "raise") == 0 ||
          strcmp(word, "assert") == 0 ||
          strcmp(word, "execute") == 0 ||
          strcmp(word, "perform") == 0 ||
          strcmp(word, "call") == 0 ||
          strcmp(word, "open") == 0 ||
          strcmp(word, "fetch") == 0 ||
          strcmp(word, "move") == 0 ||
          strcmp(word, "close") == 0 ||
          strcmp(word, "null") == 0 ||
          strcmp(word, "exit") == 0 ||
          strcmp(word, "continue") == 0 ||
          strcmp(word, "commit") == 0 ||
          strcmp(word, "rollback") == 0 ||
          strcmp(word, "get") == 0 ||
          strcmp(word, "do") == 0 ||
          /* Additional context-sensitive delimiters */
          strcmp(word, "next") == 0 ||
          strcmp(word, "query") == 0 ||
          strcmp(word, "reverse") == 0 ||
          strcmp(word, "by") == 0 ||
          strcmp(word, "alias") == 0 ||
          strcmp(word, "strict") == 0 ||
          strcmp(word, "cursor") == 0 ||
          strcmp(word, "slice") == 0 ||
          strcmp(word, "array") == 0 ||
          strcmp(word, "all") == 0) {
        /* Stop before this keyword — it's a PL/pgSQL delimiter */
        if (has_content) {
          lexer->result_symbol = SQL_BODY;
          return true;
        }
        return false;
      }

      ident_count++;
      has_content = true;
      continue;
    }

    /* Identifiers starting with underscore or non-ASCII */
    if (depth == 0 && (lexer->lookahead == '_' || (lexer->lookahead >= 0x80))) {
      while (isalnum(lexer->lookahead) || lexer->lookahead == '_' ||
             lexer->lookahead == '$' || lexer->lookahead >= 0x80) {
        lexer->advance(lexer, false);
      }
      ident_count++;
      has_content = true;
      continue;
    }
    /* Inside parens, consume identifiers without keyword checking */
    if (depth > 0 && (isalpha(lexer->lookahead) || lexer->lookahead == '_')) {
      while (isalnum(lexer->lookahead) || lexer->lookahead == '_' ||
             lexer->lookahead == '$') {
        lexer->advance(lexer, false);
      }
      has_non_ident = true;
      has_content = true;
      continue;
    }

    /* Everything else (operators, digits, etc.) — just consume */
    has_non_ident = true;
    lexer->advance(lexer, false);
    has_content = true;
  }

  if (has_content) {
    lexer->mark_end(lexer);
    lexer->result_symbol = SQL_BODY;
    return true;
  }

  return false;
}
