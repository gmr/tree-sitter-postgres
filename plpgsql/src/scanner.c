/**
 * External scanner for PL/pgSQL tree-sitter grammar.
 *
 * PL/pgSQL embeds PostgreSQL SQL in many different grammar contexts. The
 * important detail is that those contexts do not all use the same terminator:
 * IF conditions end at THEN, WHILE/FOR expressions end at LOOP, dynamic
 * EXECUTE expressions end at INTO/USING/;, and ordinary SQL statements end at
 * semicolon. PostgreSQL's real PL/pgSQL parser models this with calls like
 * read_sql_expression() and read_sql_construct() that receive context-specific
 * terminators.
 *
 * This scanner mirrors that model with several external tokens. The grammar
 * chooses the token for the current context, and the scanner consumes an opaque
 * SQL fragment until that token's delimiter set is reached. The fragment is
 * later parsed/highlighted by the PostgreSQL grammar through language
 * injection.
 */
#include "tree_sitter/parser.h"

#include <string.h>

enum TokenType {
  SQL_STATEMENT,
  SQL_UNTIL_SEMICOLON,
  SQL_UNTIL_THEN,
  SQL_UNTIL_WHEN,
  SQL_UNTIL_LOOP,
  SQL_UNTIL_ASSIGNMENT,
  SQL_UNTIL_RANGE,
  SQL_UNTIL_BY_OR_LOOP,
  SQL_UNTIL_INTO_USING_OR_SEMICOLON,
  SQL_UNTIL_USING_OR_SEMICOLON,
  SQL_UNTIL_USING_OR_LOOP,
  SQL_UNTIL_COMMA_OR_SEMICOLON,
  SQL_UNTIL_COMMA_USING_OR_SEMICOLON,
  SQL_UNTIL_COMMA_OR_LOOP,
  SQL_UNTIL_COMMA_OR_RPAREN,
  SQL_UNTIL_FROM_OR_INTO,
};

void *tree_sitter_plpgsql_external_scanner_create(void) { return NULL; }
void tree_sitter_plpgsql_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_plpgsql_external_scanner_serialize(void *payload, char *buffer) { (void)payload; (void)buffer; return 0; }
void tree_sitter_plpgsql_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) { (void)payload; (void)buffer; (void)length; }

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
}

/* Keep the scanner self-contained for WebAssembly builds. Zed and other
 * editor runtimes may not provide libc ctype imports to grammar Wasm modules. */
static bool is_ascii_alpha(int c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

static bool is_ascii_digit(int c) {
  return c >= '0' && c <= '9';
}

static bool is_ascii_alnum(int c) {
  return is_ascii_alpha(c) || is_ascii_digit(c);
}

static char ascii_tolower(int c) {
  return (c >= 'A' && c <= 'Z') ? (char)(c + ('a' - 'A')) : (char)c;
}

static bool is_tag_start_char(int c) {
  return is_ascii_alpha(c) || c == '_' || c >= 0x80;
}

static bool is_tag_char(int c) {
  return is_tag_start_char(c) || is_ascii_digit(c);
}

typedef struct {
  enum TokenType symbol;
  bool stop_semicolon;
  bool stop_then;
  bool stop_when;
  bool stop_loop;
  bool stop_into;
  bool stop_using;
  bool stop_comma;
  bool stop_assignment;
  bool stop_range;
  bool stop_by;
  bool stop_from;
  bool refuse_plpgsql_statement_start;
  bool loop_yields_loop_token;
} ScanMode;

static ScanMode mode_for(enum TokenType symbol) {
  ScanMode mode = {0};
  mode.symbol = symbol;

  switch (symbol) {
    case SQL_STATEMENT:
      mode.stop_semicolon = true;
      mode.refuse_plpgsql_statement_start = true;
      break;
    case SQL_UNTIL_SEMICOLON:
      mode.stop_semicolon = true;
      break;
    case SQL_UNTIL_THEN:
      mode.stop_semicolon = true;
      mode.stop_then = true;
      break;
    case SQL_UNTIL_WHEN:
      mode.stop_semicolon = true;
      mode.stop_when = true;
      break;
    case SQL_UNTIL_LOOP:
      mode.stop_semicolon = true;
      mode.stop_loop = true;
      break;
    case SQL_UNTIL_ASSIGNMENT:
      mode.stop_semicolon = true;
      mode.stop_assignment = true;
      break;
    case SQL_UNTIL_RANGE:
      mode.stop_semicolon = true;
      mode.stop_range = true;
      break;
    case SQL_UNTIL_BY_OR_LOOP:
      mode.stop_semicolon = true;
      mode.stop_by = true;
      mode.stop_loop = true;
      break;
    case SQL_UNTIL_INTO_USING_OR_SEMICOLON:
      mode.stop_semicolon = true;
      mode.stop_into = true;
      mode.stop_using = true;
      break;
    case SQL_UNTIL_USING_OR_SEMICOLON:
      mode.stop_semicolon = true;
      mode.stop_using = true;
      break;
    case SQL_UNTIL_USING_OR_LOOP:
      mode.stop_semicolon = true;
      mode.stop_using = true;
      mode.stop_loop = true;
      break;
    case SQL_UNTIL_COMMA_OR_SEMICOLON:
      mode.stop_semicolon = true;
      mode.stop_comma = true;
      break;
    case SQL_UNTIL_COMMA_USING_OR_SEMICOLON:
      mode.stop_semicolon = true;
      mode.stop_comma = true;
      mode.stop_using = true;
      break;
    case SQL_UNTIL_COMMA_OR_LOOP:
      mode.stop_semicolon = true;
      mode.stop_comma = true;
      mode.stop_loop = true;
      break;
    case SQL_UNTIL_COMMA_OR_RPAREN:
      mode.stop_semicolon = true;
      mode.stop_comma = true;
      break;
    case SQL_UNTIL_FROM_OR_INTO:
      mode.stop_semicolon = true;
      mode.stop_from = true;
      mode.stop_into = true;
      break;
  }

  return mode;
}

static bool is_plpgsql_statement_start(const char *word) {
  return strcmp(word, "begin") == 0 ||
         strcmp(word, "declare") == 0 ||
         strcmp(word, "end") == 0 ||
         strcmp(word, "exception") == 0 ||
         strcmp(word, "if") == 0 ||
         strcmp(word, "case") == 0 ||
         strcmp(word, "loop") == 0 ||
         strcmp(word, "while") == 0 ||
         strcmp(word, "for") == 0 ||
         strcmp(word, "foreach") == 0 ||
         strcmp(word, "return") == 0 ||
         strcmp(word, "raise") == 0 ||
         strcmp(word, "assert") == 0 ||
         strcmp(word, "execute") == 0 ||
         strcmp(word, "perform") == 0 ||
         strcmp(word, "call") == 0 ||
         strcmp(word, "do") == 0 ||
         strcmp(word, "get") == 0 ||
         strcmp(word, "open") == 0 ||
         strcmp(word, "fetch") == 0 ||
         strcmp(word, "move") == 0 ||
         strcmp(word, "close") == 0 ||
         strcmp(word, "null") == 0 ||
         strcmp(word, "exit") == 0 ||
         strcmp(word, "continue") == 0 ||
         strcmp(word, "commit") == 0 ||
         strcmp(word, "rollback") == 0 ||
         strcmp(word, "elsif") == 0 ||
         strcmp(word, "elseif") == 0 ||
         strcmp(word, "else") == 0 ||
         strcmp(word, "when") == 0;
}

static bool is_sql_statement_start(const char *word) {
  return strcmp(word, "select") == 0 ||
         strcmp(word, "insert") == 0 ||
         strcmp(word, "update") == 0 ||
         strcmp(word, "delete") == 0 ||
         strcmp(word, "merge") == 0 ||
         strcmp(word, "with") == 0 ||
         strcmp(word, "values") == 0 ||
         strcmp(word, "create") == 0 ||
         strcmp(word, "alter") == 0 ||
         strcmp(word, "drop") == 0 ||
         strcmp(word, "truncate") == 0 ||
         strcmp(word, "grant") == 0 ||
         strcmp(word, "revoke") == 0 ||
         strcmp(word, "analyze") == 0 ||
         strcmp(word, "analyse") == 0 ||
         strcmp(word, "explain") == 0 ||
         strcmp(word, "vacuum") == 0 ||
         strcmp(word, "lock") == 0 ||
         strcmp(word, "notify") == 0 ||
         strcmp(word, "listen") == 0 ||
         strcmp(word, "unlisten") == 0 ||
         strcmp(word, "refresh") == 0 ||
         strcmp(word, "reindex") == 0 ||
         strcmp(word, "copy") == 0 ||
         strcmp(word, "set") == 0 ||
         strcmp(word, "reset") == 0 ||
         strcmp(word, "show") == 0 ||
         strcmp(word, "discard") == 0 ||
         strcmp(word, "prepare") == 0 ||
         strcmp(word, "deallocate") == 0;
}

static bool is_keyword_terminator(const ScanMode *mode, const char *word, enum TokenType *result_symbol) {
  *result_symbol = mode->symbol;
  if (mode->stop_loop && strcmp(word, "loop") == 0) {
    if (mode->loop_yields_loop_token) *result_symbol = SQL_UNTIL_LOOP;
    return true;
  }
  return (mode->stop_then && strcmp(word, "then") == 0) ||
         (mode->stop_when && strcmp(word, "when") == 0) ||
         (mode->stop_into && strcmp(word, "into") == 0) ||
         (mode->stop_using && strcmp(word, "using") == 0) ||
         (mode->stop_by && strcmp(word, "by") == 0) ||
         (mode->stop_from && strcmp(word, "from") == 0);
}

static bool finish_token(TSLexer *lexer, enum TokenType symbol, bool has_content) {
  if (!has_content) return false;
  lexer->result_symbol = symbol;
  return true;
}

static bool consume_single_quoted_string(TSLexer *lexer) {
  lexer->advance(lexer, false);
  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '\'') {
      lexer->advance(lexer, false);
      if (lexer->lookahead != '\'') return true;
      lexer->advance(lexer, false);
    } else {
      lexer->advance(lexer, false);
    }
  }
  return true;
}

static bool consume_double_quoted_identifier(TSLexer *lexer) {
  lexer->advance(lexer, false);
  while (lexer->lookahead != 0) {
    if (lexer->lookahead == '"') {
      lexer->advance(lexer, false);
      if (lexer->lookahead != '"') return true;
      lexer->advance(lexer, false);
    } else {
      lexer->advance(lexer, false);
    }
  }
  return true;
}

static bool consume_dollar_quoted_string(TSLexer *lexer) {
  lexer->advance(lexer, false); /* opening $ */

  char tag[64];
  int tag_len = 0;
  if (is_tag_start_char(lexer->lookahead)) {
    do {
      if (tag_len >= 63) return true;
      tag[tag_len++] = (char)lexer->lookahead;
      lexer->advance(lexer, false);
    } while (is_tag_char(lexer->lookahead));
  }

  if (lexer->lookahead != '$') {
    return true; /* Not actually a dollar quote; we consumed a SQL '$'. */
  }
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
        return true;
      }
      continue;
    }
    lexer->advance(lexer, false);
  }

  return true;
}

static bool scan_sql(TSLexer *lexer, ScanMode mode, const bool *valid_symbols) {
  (void)valid_symbols;

  skip_whitespace(lexer);

  if (lexer->lookahead == 0) return false;

  int depth = 0;
  bool has_content = false;
  bool saw_first_word = false;
  bool disable_assignment_stop = false;

  while (lexer->lookahead != 0) {
    if (depth == 0) {
      if (mode.stop_semicolon && lexer->lookahead == ';') {
        lexer->mark_end(lexer);
        return finish_token(lexer, mode.symbol, has_content);
      }

      if (mode.stop_comma && lexer->lookahead == ',') {
        lexer->mark_end(lexer);
        return finish_token(lexer, mode.symbol, has_content);
      }
    }

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
      lexer->mark_end(lexer);
      return finish_token(lexer, mode.symbol, has_content);
    }

    if (lexer->lookahead == '\'') {
      consume_single_quoted_string(lexer);
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '"') {
      consume_double_quoted_identifier(lexer);
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '$') {
      consume_dollar_quoted_string(lexer);
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '-') {
        if (!has_content) return false;
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
        if (!has_content) return false;
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

    if (depth == 0 && lexer->lookahead == '<') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '<') {
        return finish_token(lexer, mode.symbol, has_content);
      }
      has_content = true;
      continue;
    }

    if (depth == 0 && lexer->lookahead == ':') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '=') {
        if (mode.stop_assignment && !disable_assignment_stop) {
          return finish_token(lexer, mode.symbol, has_content);
        }
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      if (lexer->lookahead == ':') {
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }

    if (depth == 0 && lexer->lookahead == '=') {
      lexer->mark_end(lexer);
      if (mode.stop_assignment && !disable_assignment_stop) {
        return finish_token(lexer, mode.symbol, has_content);
      }
      lexer->advance(lexer, false);
      has_content = true;
      continue;
    }

    if (depth == 0 && lexer->lookahead == '.') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '.') {
        if (mode.stop_range) {
          return finish_token(lexer, mode.symbol, has_content);
        }
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }

    if (depth == 0 && is_ascii_alpha(lexer->lookahead)) {
      lexer->mark_end(lexer);

      char word[32];
      int len = 0;
      while (is_ascii_alnum(lexer->lookahead) || lexer->lookahead == '_') {
        if (len < 31) word[len++] = ascii_tolower(lexer->lookahead);
        lexer->advance(lexer, false);
      }
      word[len] = '\0';

      if (!saw_first_word) {
        saw_first_word = true;
        if (mode.refuse_plpgsql_statement_start && is_plpgsql_statement_start(word)) {
          return false;
        }
        if (mode.stop_assignment && is_sql_statement_start(word)) {
          disable_assignment_stop = true;
        }
      }

      enum TokenType result_symbol = mode.symbol;
      if (is_keyword_terminator(&mode, word, &result_symbol)) {
        return finish_token(lexer, result_symbol, has_content);
      }

      has_content = true;
      continue;
    }

    if (is_ascii_alpha(lexer->lookahead) || lexer->lookahead == '_' || lexer->lookahead >= 0x80) {
      while (is_ascii_alnum(lexer->lookahead) || lexer->lookahead == '_' ||
             lexer->lookahead == '$' || lexer->lookahead >= 0x80) {
        lexer->advance(lexer, false);
      }
      has_content = true;
      continue;
    }

    lexer->advance(lexer, false);
    has_content = true;
  }

  lexer->mark_end(lexer);
  return finish_token(lexer, mode.symbol, has_content);
}

static bool scan_assignment_or_statement(TSLexer *lexer, const bool *valid_symbols) {
  (void)valid_symbols;

  /* If we reach ';' before an assignment operator, emit SQL_STATEMENT instead.
   * If we reach ':=' or '=' first, emit SQL_UNTIL_ASSIGNMENT. */
  skip_whitespace(lexer);
  if (lexer->lookahead == 0) return false;

  int depth = 0;
  bool has_content = false;
  bool saw_first_word = false;
  bool disable_assignment_stop = false;

  while (lexer->lookahead != 0) {
    if (depth == 0 && lexer->lookahead == ';') {
      lexer->mark_end(lexer);
      if (!has_content) return false;
      lexer->result_symbol = SQL_STATEMENT;
      return true;
    }

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
      lexer->mark_end(lexer);
      if (!has_content) return false;
      lexer->result_symbol = SQL_STATEMENT;
      return true;
    }

    if (lexer->lookahead == '\'') {
      consume_single_quoted_string(lexer);
      has_content = true;
      continue;
    }
    if (lexer->lookahead == '"') {
      consume_double_quoted_identifier(lexer);
      has_content = true;
      continue;
    }
    if (lexer->lookahead == '$') {
      consume_dollar_quoted_string(lexer);
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '-') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '-') {
        if (!has_content) return false;
        while (lexer->lookahead != 0 && lexer->lookahead != '\n') lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '*') {
        if (!has_content) return false;
        lexer->advance(lexer, false);
        int comment_depth = 1;
        while (lexer->lookahead != 0 && comment_depth > 0) {
          if (lexer->lookahead == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '*') { comment_depth++; lexer->advance(lexer, false); }
          } else if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') { comment_depth--; lexer->advance(lexer, false); }
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

    if (depth == 0 && lexer->lookahead == '<') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '<') {
        if (!has_content) return false;
        lexer->result_symbol = SQL_STATEMENT;
        return true;
      }
      has_content = true;
      continue;
    }

    if (depth == 0 && lexer->lookahead == ':') {
      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead == '=') {
        if (!disable_assignment_stop) {
          return finish_token(lexer, SQL_UNTIL_ASSIGNMENT, has_content);
        }
        lexer->advance(lexer, false);
        has_content = true;
        continue;
      }
      if (lexer->lookahead == ':') lexer->advance(lexer, false);
      has_content = true;
      continue;
    }

    if (depth == 0 && lexer->lookahead == '=') {
      lexer->mark_end(lexer);
      if (!disable_assignment_stop) {
        return finish_token(lexer, SQL_UNTIL_ASSIGNMENT, has_content);
      }
      lexer->advance(lexer, false);
      has_content = true;
      continue;
    }

    if (depth == 0 && is_ascii_alpha(lexer->lookahead)) {
      lexer->mark_end(lexer);
      char word[32];
      int len = 0;
      while (is_ascii_alnum(lexer->lookahead) || lexer->lookahead == '_') {
        if (len < 31) word[len++] = ascii_tolower(lexer->lookahead);
        lexer->advance(lexer, false);
      }
      word[len] = '\0';

      if (!saw_first_word) {
        saw_first_word = true;
        if (is_plpgsql_statement_start(word)) return false;
        if (is_sql_statement_start(word)) disable_assignment_stop = true;
      }

      has_content = true;
      continue;
    }

    if (is_ascii_alpha(lexer->lookahead) || lexer->lookahead == '_' || lexer->lookahead >= 0x80) {
      while (is_ascii_alnum(lexer->lookahead) || lexer->lookahead == '_' ||
             lexer->lookahead == '$' || lexer->lookahead >= 0x80) {
        lexer->advance(lexer, false);
      }
      has_content = true;
      continue;
    }

    lexer->advance(lexer, false);
    has_content = true;
  }

  lexer->mark_end(lexer);
  if (!has_content) return false;
  lexer->result_symbol = SQL_STATEMENT;
  return true;
}

bool tree_sitter_plpgsql_external_scanner_scan(
  void *payload, TSLexer *lexer, const bool *valid_symbols
) {
  (void)payload;

  if (valid_symbols[SQL_UNTIL_ASSIGNMENT] && valid_symbols[SQL_STATEMENT]) {
    return scan_assignment_or_statement(lexer, valid_symbols);
  }

  /* FOR ... IN can begin either an integer range (expr .. expr) or a query
   * (query LOOP). Scan once and choose the token based on which delimiter is
   * encountered first. */
  if (valid_symbols[SQL_UNTIL_RANGE] && valid_symbols[SQL_UNTIL_LOOP]) {
    ScanMode mode = mode_for(SQL_UNTIL_RANGE);
    mode.stop_loop = true;
    mode.loop_yields_loop_token = true;
    return scan_sql(lexer, mode, valid_symbols);
  }

  for (int symbol = SQL_STATEMENT; symbol <= SQL_UNTIL_FROM_OR_INTO; symbol++) {
    if (valid_symbols[symbol]) {
      return scan_sql(lexer, mode_for((enum TokenType)symbol), valid_symbols);
    }
  }

  return false;
}
