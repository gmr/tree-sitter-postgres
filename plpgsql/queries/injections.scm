; injections.scm — tree-sitter-plpgsql language injection queries
;
; SQL expressions within PL/pgSQL are delegated to the postgres grammar
; for detailed parsing.

((sql_expression) @injection.content
  (#set! injection.language "postgres")
  (#set! injection.include-children))
