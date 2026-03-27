package tree_sitter_postgres_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_postgres "github.com/gmr/tree-sitter-postgres/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_postgres.Language())
	if language == nil {
		t.Errorf("Error loading Postgres grammar")
	}
}

func TestCanLoadPlpgsqlGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_postgres.LanguagePlpgsql())
	if language == nil {
		t.Errorf("Error loading PL/pgSQL grammar")
	}
}
