package tree_sitter_postgres

// #cgo CFLAGS: -std=c11 -fPIC
// #include "../../postgres/src/parser.c"
// #include "../../plpgsql/src/parser.c"
// #include "../../plpgsql/src/scanner.c"
import "C"

import "unsafe"

// Get the tree-sitter Language for the PostgreSQL SQL grammar.
func Language() unsafe.Pointer {
	return unsafe.Pointer(C.tree_sitter_postgres())
}

// Get the tree-sitter Language for the PL/pgSQL grammar.
func LanguagePlpgsql() unsafe.Pointer {
	return unsafe.Pointer(C.tree_sitter_plpgsql())
}
