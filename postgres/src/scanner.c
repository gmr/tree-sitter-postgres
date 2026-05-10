/**
 * External scanner for the postgres tree-sitter grammar.
 *
 * Provides the dollar_quoted_string token type. PostgreSQL dollar-quoted
 * strings have the form $tag$...$tag$ where the opening and closing tags
 * must match exactly. The previous implementation used a non-greedy regex,
 * but tree-sitter compiles tokens into a DFA that ignores `*?`, so the
 * effective match was greedy and consumed across multiple dollar-quoted
 * strings in a single file. This scanner mirrors PostgreSQL's own lexer:
 * remember the opening tag, then scan forward until a matching $tag$.
 */
#include "tree_sitter/parser.h"

#include <string.h>

enum TokenType {
  DOLLAR_QUOTED_STRING,
};

void *tree_sitter_postgres_external_scanner_create(void) { return NULL; }
void tree_sitter_postgres_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_postgres_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload; (void)buffer; return 0;
}
void tree_sitter_postgres_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload; (void)buffer; (void)length;
}

/*
 * Self-contained ASCII helpers so the compiled Wasm does not import libc
 * functions like isalnum/tolower that Zed's grammar runtime cannot resolve.
 */
static bool is_tag_char(int c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '_';
}

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
}

bool tree_sitter_postgres_external_scanner_scan(
  void *payload, TSLexer *lexer, const bool *valid_symbols
) {
  (void)payload;
  if (!valid_symbols[DOLLAR_QUOTED_STRING]) return false;

  skip_whitespace(lexer);

  if (lexer->lookahead != '$') return false;

  lexer->advance(lexer, false);

  /* PostgreSQL caps identifier length at NAMEDATALEN-1 = 63. */
  char tag[64];
  int tag_len = 0;
  while (is_tag_char(lexer->lookahead)) {
    if (tag_len >= 63) return false;
    tag[tag_len++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }

  if (lexer->lookahead != '$') return false;
  lexer->advance(lexer, false);

  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '$') {
      lexer->advance(lexer, false);
      int i = 0;
      while (i < tag_len && lexer->lookahead == (unsigned char)tag[i]) {
        lexer->advance(lexer, false);
        i++;
      }
      if (i == tag_len && lexer->lookahead == '$') {
        lexer->advance(lexer, false);
        lexer->result_symbol = DOLLAR_QUOTED_STRING;
        return true;
      }
      /* Partial match — continue scanning body. */
      continue;
    }
    lexer->advance(lexer, false);
  }

  return false;
}
