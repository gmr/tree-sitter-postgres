; injections.scm — tree-sitter-postgres language injection queries
;
; PL/pgSQL function bodies inside CREATE FUNCTION / CREATE PROCEDURE
; are delegated to the plpgsql grammar for detailed parsing.

((func_as
  (Sconst
    (dollar_quoted_string) @injection.content))
  (#set! injection.language "plpgsql")
  (#set! injection.include-children))
